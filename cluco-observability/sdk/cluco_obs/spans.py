"""Span model — the core unit of work in Cluco Observability."""

import re
import time
import uuid
from enum import Enum
from typing import Any, Optional

# PII masking patterns (loaded from config at init time)
_pii_masking_enabled = False
_pii_patterns: list = []

# Default PII patterns for common sensitive data
_DEFAULT_PII_PATTERNS = [
    (r"\b\d{3}-\d{2}-\d{4}\b", "[SSN_REDACTED]"),  # SSN
    (r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b", "[EMAIL_REDACTED]"),  # Email
    (r"\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b", "[PHONE_REDACTED]"),  # Phone
    (r"\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{4}\b", "[CARD_REDACTED]"),  # Credit card
]


def configure_pii_masking(enabled: bool, patterns: list = None):
    """Configure PII masking globally. Called by init_tracer."""
    global _pii_masking_enabled, _pii_patterns
    _pii_masking_enabled = enabled
    if enabled:
        _pii_patterns = [(re.compile(p), r) for p, r in _DEFAULT_PII_PATTERNS]
        for custom in (patterns or []):
            if isinstance(custom, (list, tuple)) and len(custom) == 2:
                _pii_patterns.append((re.compile(custom[0]), custom[1]))
            elif isinstance(custom, str):
                _pii_patterns.append((re.compile(custom), "[PII_REDACTED]"))


def _mask_pii(text: str) -> str:
    """Apply PII masking patterns to text."""
    if not _pii_masking_enabled or not _pii_patterns or not isinstance(text, str):
        return text
    for pattern, replacement in _pii_patterns:
        text = pattern.sub(replacement, text)
    return text


class SpanKind(str, Enum):
    CHAIN = "chain"
    AGENT = "agent"
    LLM = "llm"
    TOOL = "tool"
    RETRIEVER = "retriever"
    EMBEDDING = "embedding"
    GUARDRAIL = "guardrail"


class SpanStatus(str, Enum):
    RUNNING = "running"
    OK = "ok"
    ERROR = "error"


class Span:
    __slots__ = (
        "span_id", "trace_id", "parent_span_id", "name", "kind",
        "status", "start_time_ns", "end_time_ns",
        "inputs", "outputs", "metadata", "tags", "events",
        "error_message", "error_type",
        "model", "provider", "input_tokens", "output_tokens", "total_tokens",
        "cost_usd", "prompt_messages", "completion",
        "tool_name", "tool_input", "tool_output",
        "query", "retrieved_documents", "retrieval_scores",
        "embedding_model", "embedding_dimensions", "embedding_count",
        "children",
    )

    def __init__(
        self,
        name: str,
        kind: SpanKind = SpanKind.CHAIN,
        trace_id: Optional[str] = None,
        parent_span_id: Optional[str] = None,
        metadata: Optional[dict] = None,
        tags: Optional[list] = None,
    ):
        self.span_id = uuid.uuid4().hex
        self.trace_id = trace_id or uuid.uuid4().hex
        self.parent_span_id = parent_span_id
        self.name = name
        self.kind = kind
        self.status = SpanStatus.RUNNING
        self.start_time_ns = time.time_ns()
        self.end_time_ns: Optional[int] = None

        self.inputs: Optional[Any] = None
        self.outputs: Optional[Any] = None
        self.metadata: dict = metadata or {}
        self.tags: list = tags or []
        self.events: list[dict] = []
        self.error_message: Optional[str] = None
        self.error_type: Optional[str] = None

        self.model: Optional[str] = None
        self.provider: Optional[str] = None
        self.input_tokens: int = 0
        self.output_tokens: int = 0
        self.total_tokens: int = 0
        self.cost_usd: float = 0.0
        self.prompt_messages: Optional[list] = None
        self.completion: Optional[str] = None

        self.tool_name: Optional[str] = None
        self.tool_input: Optional[Any] = None
        self.tool_output: Optional[Any] = None

        self.query: Optional[str] = None
        self.retrieved_documents: Optional[list] = None
        self.retrieval_scores: Optional[list] = None

        self.embedding_model: Optional[str] = None
        self.embedding_dimensions: Optional[int] = None
        self.embedding_count: int = 0

        self.children: list["Span"] = []

    @property
    def duration_ms(self) -> float:
        end = self.end_time_ns or time.time_ns()
        return (end - self.start_time_ns) / 1_000_000

    def add_event(self, name: str, attributes: Optional[dict] = None) -> None:
        self.events.append({
            "name": name,
            "timestamp_ns": time.time_ns(),
            "attributes": attributes or {},
        })

    def set_llm_data(
        self,
        model: str,
        provider: str = "openai",
        input_tokens: int = 0,
        output_tokens: int = 0,
        cost_usd: float = 0.0,
        prompt_messages: Optional[list] = None,
        completion: Optional[str] = None,
    ) -> None:
        self.kind = SpanKind.LLM
        self.model = model
        self.provider = provider
        self.input_tokens = input_tokens
        self.output_tokens = output_tokens
        self.total_tokens = input_tokens + output_tokens
        self.cost_usd = cost_usd
        self.prompt_messages = prompt_messages
        self.completion = completion

    def set_tool_data(self, tool_name: str, tool_input: Any = None, tool_output: Any = None) -> None:
        self.kind = SpanKind.TOOL
        self.tool_name = tool_name
        self.tool_input = tool_input
        self.tool_output = tool_output

    def set_retriever_data(self, query: str, documents: Optional[list] = None, scores: Optional[list] = None) -> None:
        self.kind = SpanKind.RETRIEVER
        self.query = query
        self.retrieved_documents = documents
        self.retrieval_scores = scores

    def set_embedding_data(self, model: str, dimensions: int = 0, count: int = 0) -> None:
        self.kind = SpanKind.EMBEDDING
        self.embedding_model = model
        self.embedding_dimensions = dimensions
        self.embedding_count = count

    def end(self, status: SpanStatus = SpanStatus.OK, outputs: Any = None, error: Optional[Exception] = None) -> None:
        self.end_time_ns = time.time_ns()
        if error:
            self.status = SpanStatus.ERROR
            self.error_message = str(error)
            self.error_type = type(error).__name__
        else:
            self.status = status
        if outputs is not None:
            self.outputs = outputs

    def to_dict(self) -> dict:
        d = {
            "span_id": self.span_id,
            "trace_id": self.trace_id,
            "parent_span_id": self.parent_span_id,
            "name": self.name,
            "kind": self.kind.value if isinstance(self.kind, SpanKind) else self.kind,
            "status": self.status.value if isinstance(self.status, SpanStatus) else self.status,
            "start_time_ns": self.start_time_ns,
            "end_time_ns": self.end_time_ns,
            "duration_ms": self.duration_ms,
            "metadata": self.metadata,
            "tags": self.tags,
            "events": self.events,
        }
        if self.inputs is not None:
            d["inputs"] = _safe_serialize(self.inputs)
        if self.outputs is not None:
            d["outputs"] = _safe_serialize(self.outputs)
        if self.error_message:
            d["error"] = {"message": self.error_message, "type": self.error_type}
        if self.kind == SpanKind.LLM or self.model:
            d["llm"] = {
                "model": self.model,
                "provider": self.provider,
                "input_tokens": self.input_tokens,
                "output_tokens": self.output_tokens,
                "total_tokens": self.total_tokens,
                "cost_usd": self.cost_usd,
                "prompt_messages": _safe_serialize(self.prompt_messages) if self.prompt_messages else [],
                "completion": _truncate(self.completion, 10000) if self.completion else None,
            }
        if self.kind == SpanKind.TOOL or self.tool_name:
            d["tool"] = {
                "name": self.tool_name,
                "input": _safe_serialize(self.tool_input),
                "output": _safe_serialize(self.tool_output),
            }
        if self.kind == SpanKind.RETRIEVER or self.query:
            d["retriever"] = {
                "query": self.query,
                "documents": _safe_serialize(self.retrieved_documents),
                "scores": self.retrieval_scores,
            }
        if self.kind == SpanKind.EMBEDDING or self.embedding_model:
            d["embedding"] = {
                "model": self.embedding_model,
                "dimensions": self.embedding_dimensions,
                "count": self.embedding_count,
                "input_tokens": getattr(self, "input_tokens", 0) or 0,
                "cost_usd": getattr(self, "cost_usd", 0.0) or 0.0,
            }
        if self.children:
            d["children"] = [c.to_dict() for c in self.children]
        return d


def _safe_serialize(obj: Any, max_depth: int = 5) -> Any:
    if obj is None:
        return None
    if max_depth <= 0:
        return _mask_pii(str(obj)[:500])
    if isinstance(obj, str):
        return _mask_pii(obj)
    if isinstance(obj, (int, float, bool)):
        return obj
    if isinstance(obj, bytes):
        return f"<bytes len={len(obj)}>"
    if isinstance(obj, dict):
        return {str(k): _safe_serialize(v, max_depth - 1) for k, v in list(obj.items())[:100]}
    if isinstance(obj, (list, tuple)):
        return [_safe_serialize(v, max_depth - 1) for v in list(obj)[:100]]
    try:
        return _mask_pii(str(obj)[:1000])
    except Exception:
        return "<unserializable>"


def _truncate(s: str, max_len: int = 5000) -> str:
    if len(s) <= max_len:
        return s
    return s[:max_len] + f"... [truncated, total {len(s)} chars]"
