"""Core tracer — session/trace/span management with context propagation."""

import logging
import os
import random
import time
import uuid
from contextvars import ContextVar
from typing import Any, Optional

from cluco_obs.config import ClucoConfig
from cluco_obs.exporter import AsyncHTTPExporter
from cluco_obs.spans import Span, SpanKind, SpanStatus

logger = logging.getLogger("cluco_obs.tracer")

_current_span: ContextVar[Optional[Span]] = ContextVar("cluco_current_span", default=None)
_current_trace_id: ContextVar[Optional[str]] = ContextVar("cluco_current_trace_id", default=None)
_current_session_id: ContextVar[Optional[str]] = ContextVar("cluco_current_session_id", default=None)

_global_tracer: Optional["ClucoTracer"] = None

MODEL_COSTS_PER_1K = {
    "gpt-4o": {"input": 0.0025, "output": 0.01},
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "gpt-4o-2024-11-20": {"input": 0.0025, "output": 0.01},
    "gpt-4-turbo": {"input": 0.01, "output": 0.03},
    "gpt-3.5-turbo": {"input": 0.0005, "output": 0.0015},
    "claude-3-5-sonnet": {"input": 0.003, "output": 0.015},
    "claude-3-haiku": {"input": 0.00025, "output": 0.00125},
    "text-embedding-3-small": {"input": 0.00002, "output": 0.0},
    "text-embedding-3-large": {"input": 0.00013, "output": 0.0},
    "text-embedding-ada-002": {"input": 0.0001, "output": 0.0},
}


def _estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    costs = MODEL_COSTS_PER_1K.get(model)
    if not costs:
        for key, val in MODEL_COSTS_PER_1K.items():
            if key in model:
                costs = val
                break
    if not costs:
        return 0.0
    return (input_tokens / 1000) * costs["input"] + (output_tokens / 1000) * costs["output"]


class ClucoTracer:
    def __init__(self, config: Optional[ClucoConfig] = None):
        self.config = config or ClucoConfig.from_env()
        self._exporter: Optional[AsyncHTTPExporter] = None
        self._root_spans: dict[str, Span] = {}
        if self.config.enabled:
            self._exporter = AsyncHTTPExporter(
                backend_url=self.config.backend_url,
                batch_size=self.config.batch_size,
                flush_interval=self.config.flush_interval_seconds,
                max_queue_size=self.config.max_queue_size,
            )
            self._exporter.start()

    def start_session(self, session_id: Optional[str] = None) -> str:
        sid = session_id or uuid.uuid4().hex
        _current_session_id.set(sid)
        return sid

    def start_trace(self, trace_id: Optional[str] = None) -> str:
        tid = trace_id or uuid.uuid4().hex
        _current_trace_id.set(tid)
        return tid

    def start_span(
        self,
        name: str,
        kind: SpanKind = SpanKind.CHAIN,
        inputs: Any = None,
        metadata: Optional[dict] = None,
        tags: Optional[list] = None,
    ) -> Span:
        if not self.config.enabled:
            return Span(name=name, kind=kind)

        if self.config.sample_rate < 1.0 and random.random() > self.config.sample_rate:
            return Span(name=name, kind=kind)

        trace_id = _current_trace_id.get() or uuid.uuid4().hex
        _current_trace_id.set(trace_id)

        parent = _current_span.get()
        parent_id = parent.span_id if parent else None

        merged_meta = {**self.config.metadata, **(metadata or {})}
        merged_tags = list(set(self.config.tags + (tags or [])))

        span = Span(
            name=name,
            kind=kind,
            trace_id=trace_id,
            parent_span_id=parent_id,
            metadata=merged_meta,
            tags=merged_tags,
        )

        if self.config.capture_inputs and inputs is not None:
            span.inputs = inputs

        if parent:
            parent.children.append(span)
        else:
            self._root_spans[trace_id] = span

        _current_span.set(span)
        return span

    def end_span(self, span: Span, outputs: Any = None, error: Optional[Exception] = None) -> None:
        if self.config.capture_outputs and outputs is not None:
            span.outputs = outputs
        span.end(error=error)

        # Budget guardrails: check if trace has exceeded token/cost limits
        self._check_budget_guardrails(span)

        parent = None
        if span.parent_span_id:
            current = _current_span.get()
            if current and current.span_id == span.span_id:
                for root in self._root_spans.values():
                    p = _find_parent(root, span.parent_span_id)
                    if p:
                        parent = p
                        break
                _current_span.set(parent)
        else:
            _current_span.set(None)
            self._export_trace(span)

    def _check_budget_guardrails(self, span: Span) -> None:
        """Check token/cost limits and log warnings when exceeded."""
        # Per-span token limit
        if self.config.max_span_tokens > 0:
            span_tokens = (span.input_tokens or 0) + (span.output_tokens or 0)
            if span_tokens > self.config.max_span_tokens:
                logger.warning(
                    "[budget] Span %s exceeded token limit: %d > %d",
                    span.name, span_tokens, self.config.max_span_tokens
                )
                span.metadata = span.metadata or {}
                span.metadata["budget_exceeded"] = True
                span.metadata["budget_exceeded_reason"] = f"span_tokens={span_tokens}"

        # Per-trace token/cost limit (check on root spans by aggregating)
        trace_id = span.trace_id
        root = self._root_spans.get(trace_id)
        if root and (self.config.max_trace_tokens > 0 or self.config.max_trace_cost_usd > 0):
            total_tokens, total_cost = _aggregate_tokens(root)
            if self.config.max_trace_tokens > 0 and total_tokens > self.config.max_trace_tokens:
                logger.warning(
                    "[budget] Trace %s exceeded token limit: %d > %d",
                    trace_id[:12], total_tokens, self.config.max_trace_tokens
                )
                root.metadata = root.metadata or {}
                root.metadata["budget_exceeded"] = True
                root.metadata["budget_token_usage"] = total_tokens
            if self.config.max_trace_cost_usd > 0 and total_cost > self.config.max_trace_cost_usd:
                logger.warning(
                    "[budget] Trace %s exceeded cost limit: $%.4f > $%.4f",
                    trace_id[:12], total_cost, self.config.max_trace_cost_usd
                )
                root.metadata = root.metadata or {}
                root.metadata["budget_exceeded"] = True
                root.metadata["budget_cost_usd"] = round(total_cost, 6)

    def record_llm_call(
        self,
        model: str,
        provider: str = "openai",
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost_usd: Optional[float] = None,
        prompt_messages: Optional[list] = None,
        completion: Optional[str] = None,
        latency_ms: Optional[float] = None,
        agent_name: Optional[str] = None,
        metadata: Optional[dict] = None,
    ) -> Span:
        name = f"llm:{model}"
        if agent_name:
            name = f"{agent_name}:llm:{model}"
        span = self.start_span(name, kind=SpanKind.LLM, metadata=metadata)
        actual_cost = cost_usd if cost_usd is not None else _estimate_cost(model, input_tokens, output_tokens)
        span.set_llm_data(
            model=model,
            provider=provider,
            input_tokens=input_tokens,
            output_tokens=output_tokens,
            cost_usd=actual_cost,
            prompt_messages=prompt_messages,
            completion=completion,
        )
        if latency_ms:
            span.start_time_ns = time.time_ns() - int(latency_ms * 1_000_000)
        self.end_span(span)

        if prompt_messages and agent_name and self._exporter:
            self._auto_capture_prompt(agent_name, model, prompt_messages)

        return span

    def _auto_capture_prompt(self, agent_name: str, model: str, messages: list) -> None:
        """Send prompt fingerprint to the backend for SDK-detected versions."""
        import hashlib
        import json
        import threading

        try:
            content = json.dumps(messages, default=str)
            prompt_hash = hashlib.sha256(content.encode()).hexdigest()[:16]

            def _send():
                import urllib.request
                url = self.config.backend_url.rstrip("/") + "/api/v1/prompt-versions"
                payload = json.dumps({
                    "prompt_hash": prompt_hash,
                    "agent_name": agent_name,
                    "model": model,
                    "product_id": self.config.product_id,
                    "content": content[:4000],
                }).encode("utf-8")
                try:
                    req = urllib.request.Request(
                        url, data=payload,
                        headers={"Content-Type": "application/json"},
                        method="POST",
                    )
                    urllib.request.urlopen(req, timeout=5)
                except Exception:
                    pass

            threading.Thread(target=_send, daemon=True).start()
        except Exception:
            pass

    def record_tool_call(
        self,
        tool_name: str,
        tool_input: Any = None,
        tool_output: Any = None,
        latency_ms: Optional[float] = None,
        error: Optional[Exception] = None,
        metadata: Optional[dict] = None,
    ) -> Span:
        span = self.start_span(f"tool:{tool_name}", kind=SpanKind.TOOL, metadata=metadata)
        span.set_tool_data(tool_name, tool_input, tool_output)
        if latency_ms:
            span.start_time_ns = time.time_ns() - int(latency_ms * 1_000_000)
        self.end_span(span, error=error)
        return span

    def record_retrieval(
        self,
        query: str,
        source: str = "default",
        documents: Optional[list] = None,
        scores: Optional[list] = None,
        top_k: int = 0,
        latency_ms: Optional[float] = None,
        metadata: Optional[dict] = None,
    ) -> Span:
        span = self.start_span(f"retriever:{source}", kind=SpanKind.RETRIEVER, metadata=metadata)
        span.set_retriever_data(query, documents, scores)
        span.metadata["source"] = source
        span.metadata["top_k"] = top_k
        if latency_ms:
            span.start_time_ns = time.time_ns() - int(latency_ms * 1_000_000)
        self.end_span(span)
        return span

    def record_embedding(
        self,
        model: str,
        input_text: Optional[str] = None,
        dimensions: int = 0,
        count: int = 1,
        input_tokens: int = 0,
        latency_ms: Optional[float] = None,
        metadata: Optional[dict] = None,
    ) -> Span:
        span = self.start_span(f"embedding:{model}", kind=SpanKind.EMBEDDING, metadata=metadata)
        span.set_embedding_data(model, dimensions, count)
        span.input_tokens = input_tokens
        span.cost_usd = _estimate_cost(model, input_tokens, 0)
        if input_text:
            span.inputs = input_text[:500]
        if latency_ms:
            span.start_time_ns = time.time_ns() - int(latency_ms * 1_000_000)
        self.end_span(span)
        return span

    def record_evaluation(
        self,
        agent_name: str,
        scores: dict,
        overall_score: float,
        pass_fail: bool,
        section: str = "",
        revision_count: int = 0,
        metadata: Optional[dict] = None,
    ) -> Span:
        """Record a quality evaluation for an agent's output."""
        span = self.start_span(f"evaluation:{agent_name}", kind=SpanKind.CHAIN, metadata=metadata)
        span.outputs = {
            "agent_name": agent_name,
            "section": section,
            "overall_score": overall_score,
            "pass_fail": pass_fail,
            "category_scores": scores,
            "revision_count": revision_count,
        }
        self.end_span(span)
        return span

    def add_feedback(
        self,
        trace_id: str,
        key: str,
        score: Optional[float] = None,
        value: Optional[str] = None,
        comment: Optional[str] = None,
        source: str = "sdk",
    ) -> None:
        if not self.config.enabled or not self._exporter:
            return
        feedback_data = {
            "type": "feedback",
            "trace_id": trace_id,
            "feedback": {
                "key": key,
                "score": score,
                "value": value,
                "comment": comment,
                "source": source,
                "timestamp_ns": time.time_ns(),
            },
            "product_id": self.config.product_id,
            "service_name": self.config.service_name,
        }
        self._exporter.enqueue(feedback_data)

    def _export_trace(self, root_span: Span) -> None:
        if not self.config.enabled or not self._exporter:
            return
        session_id = _current_session_id.get() or ""
        try:
            total_tokens, total_cost = _aggregate_tokens(root_span)
            span_dict = root_span.to_dict()
            child_count = len(root_span.children)
            trace_data = {
                "type": "trace",
                "trace_id": root_span.trace_id,
                "session_id": session_id,
                "product_id": self.config.product_id,
                "service_name": self.config.service_name,
                "environment": self.config.environment,
                "start_time_ns": root_span.start_time_ns,
                "end_time_ns": root_span.end_time_ns,
                "latency_ms": root_span.duration_ms,
                "status": root_span.status.value if isinstance(root_span.status, SpanStatus) else root_span.status,
                "total_tokens": total_tokens,
                "total_cost_usd": total_cost,
                "spans": [span_dict],
            }
            logger.info(
                "Exporting trace %s: %d children, %d tokens, $%.4f cost, %.0f ms",
                root_span.trace_id[:12], child_count, total_tokens, total_cost, root_span.duration_ms,
            )
            self._exporter.enqueue(trace_data)
        except Exception as e:
            logger.warning("Failed to export trace %s: %s", root_span.trace_id[:12], e)
        self._root_spans.pop(root_span.trace_id, None)

    def register_agent_architecture(
        self,
        nodes: list[dict],
        edges: list[dict],
        parallel_groups: Optional[list[list[str]]] = None,
    ) -> dict:
        """Register the agent architecture (nodes + edges) with the Cluco backend.

        This lets the Agent Flow page display the project's agent graph
        without requiring any traces to exist first.  The registration is
        idempotent — subsequent calls update the stored architecture.

        Args:
            nodes: List of agent descriptors, each with at least ``id`` and
                   optionally ``label`` and ``type`` (agent / llm / tool).
            edges: List of connections, each with ``source``, ``target`` and
                   optionally ``type`` (sequential / parallel / conditional).
            parallel_groups: Optional list of groups of agent ids that run in
                             parallel.

        Returns:
            The response body from the backend, or an error dict.
        """
        import json
        import urllib.request

        url = self.config.backend_url.rstrip("/") + "/api/v1/pipelines"
        payload = json.dumps({
            "product_id": self.config.product_id,
            "nodes": nodes,
            "edges": edges,
            "parallel_groups": parallel_groups or [],
        }).encode("utf-8")
        try:
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            logger.info("Agent architecture registered for product '%s'", self.config.product_id)
            return result
        except Exception as e:
            logger.warning("Failed to register agent architecture: %s", e)
            return {"error": str(e)}

    def register_prompt(
        self,
        name: str,
        content: str,
        agent_name: str = "",
        description: str = "",
        variables: Optional[list[str]] = None,
        tags: Optional[list[str]] = None,
        version: int = 1,
    ) -> dict:
        """Register a prompt template with the Cluco backend.

        Creates (or updates) the prompt in the prompt registry, scoped to the
        current ``product_id``.  Call once per prompt at startup, or whenever
        a prompt changes.
        """
        import json
        import urllib.request
        import re

        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        prompt_id = f"{self.config.product_id}-{slug}"

        url = self.config.backend_url.rstrip("/") + "/api/v1/prompts"
        payload = json.dumps({
            "prompt_id": prompt_id,
            "name": name,
            "description": description or f"Prompt for {agent_name or name}",
            "agent_name": agent_name,
            "product_id": self.config.product_id,
            "content": content,
            "variables": variables or [],
            "tags": tags or [],
        }).encode("utf-8")
        try:
            req = urllib.request.Request(
                url, data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                result = json.loads(resp.read().decode("utf-8"))
            logger.info("Prompt '%s' registered for product '%s'", name, self.config.product_id)
            return result
        except Exception as e:
            logger.debug("Prompt registration for '%s': %s", name, e)
            return {"error": str(e)}

    def register_prompts(self, prompts: list[dict]) -> list[dict]:
        """Register multiple prompts at once. Each dict should have at least
        ``name``, ``content``, and optionally ``agent_name``, ``description``,
        ``variables``, ``tags``."""
        results = []
        for p in prompts:
            results.append(self.register_prompt(**p))
        return results

    def flush(self) -> None:
        if self._exporter:
            self._exporter._flush()

    def shutdown(self) -> None:
        if self._exporter:
            self._exporter.stop()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.shutdown()


class SpanContext:
    def __init__(self, tracer: "ClucoTracer", span: Span):
        self._tracer = tracer
        self._span = span
        self._token = None

    def __enter__(self) -> Span:
        self._token = _current_span.set(self._span)
        return self._span

    def __exit__(self, exc_type, exc_val, exc_tb):
        error = exc_val if exc_type else None
        self._tracer.end_span(self._span, error=error)
        if self._token:
            _current_span.reset(self._token)
        return False


def _find_parent(root: Span, parent_id: str) -> Optional[Span]:
    if root.span_id == parent_id:
        return root
    for child in root.children:
        found = _find_parent(child, parent_id)
        if found:
            return found
    return None


def _aggregate_tokens(span: Span) -> tuple[int, float]:
    tokens = span.total_tokens or (span.input_tokens + span.output_tokens)
    cost = span.cost_usd
    for child in span.children:
        ct, cc = _aggregate_tokens(child)
        tokens += ct
        cost += cc
    return tokens, cost


def init_tracer(config: Optional[ClucoConfig] = None) -> ClucoTracer:
    global _global_tracer
    cfg = config or ClucoConfig.from_env()
    _global_tracer = ClucoTracer(cfg)
    # Configure PII masking from config
    try:
        from cluco_obs.spans import configure_pii_masking
        configure_pii_masking(cfg.pii_masking_enabled, cfg.pii_patterns)
    except Exception:
        pass
    return _global_tracer


def get_tracer() -> Optional[ClucoTracer]:
    return _global_tracer


def get_current_span() -> Optional[Span]:
    return _current_span.get()


def submit_feedback(
    trace_id: str,
    thumbs: str = "up",
    comment: Optional[str] = None,
    span_id: Optional[str] = None,
    source: str = "user",
) -> None:
    """Submit thumbs up/down feedback for a trace from an external application.

    This is the primary method external chat apps use to capture user feedback.
    Call this when a user clicks thumbs up or thumbs down on an AI response.

    Args:
        trace_id: The trace ID to attach feedback to.
        thumbs: "up" or "down".
        comment: Optional user comment explaining the feedback.
        span_id: Optional span ID to attach feedback to a specific span.
        source: Feedback source identifier (default "user").
    """
    tracer = get_tracer()
    if tracer and tracer.config.enabled:
        score = 1.0 if thumbs == "up" else 0.0
        value = "True" if thumbs == "up" else "False"
        tracer.add_feedback(
            trace_id=trace_id,
            key="user_feedback",
            score=score,
            value=value,
            comment=comment,
            source=source,
        )
    else:
        import json
        import urllib.request
        backend_url = os.environ.get(
            "CLUCO_OBS_BACKEND_URL",
            os.environ.get("AGENT_OBS_BACKEND_URL", "http://localhost:9410"),
        )
        payload = json.dumps({
            "trace_id": trace_id,
            "span_id": span_id or "",
            "thumbs": thumbs,
            "comment": comment,
            "source": source,
        }).encode("utf-8")
        url = backend_url.rstrip("/") + "/api/v1/feedback/thumbs"
        try:
            req = urllib.request.Request(
                url, data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=5):
                pass
        except Exception as e:
            logger.warning("submit_feedback failed: %s", e)
