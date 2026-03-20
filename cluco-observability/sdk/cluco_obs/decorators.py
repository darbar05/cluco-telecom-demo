"""Decorators — @traceable, @trace_llm, @trace_tool, @trace_rag, @trace_embedding."""

import asyncio
import functools
import inspect
import time
from typing import Any, Callable, Optional

from cluco_obs.spans import SpanKind


def traceable(
    _func: Optional[Callable] = None,
    *,
    name: Optional[str] = None,
    kind: SpanKind = SpanKind.CHAIN,
    metadata: Optional[dict] = None,
    tags: Optional[list] = None,
    capture_inputs: bool = True,
    capture_outputs: bool = True,
):
    def decorator(func: Callable) -> Callable:
        span_name = name or func.__name__

        if asyncio.iscoroutinefunction(func):
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                from cluco_obs.tracer import get_tracer
                tracer = get_tracer()
                if not tracer or not tracer.config.enabled:
                    return await func(*args, **kwargs)

                inputs = _capture_args(func, args, kwargs) if capture_inputs else None
                span = tracer.start_span(span_name, kind=kind, inputs=inputs, metadata=metadata, tags=tags)
                try:
                    result = await func(*args, **kwargs)
                    outputs = result if capture_outputs else None
                    tracer.end_span(span, outputs=outputs)
                    return result
                except Exception as e:
                    tracer.end_span(span, error=e)
                    raise
            return async_wrapper
        else:
            @functools.wraps(func)
            def sync_wrapper(*args, **kwargs):
                from cluco_obs.tracer import get_tracer
                tracer = get_tracer()
                if not tracer or not tracer.config.enabled:
                    return func(*args, **kwargs)

                inputs = _capture_args(func, args, kwargs) if capture_inputs else None
                span = tracer.start_span(span_name, kind=kind, inputs=inputs, metadata=metadata, tags=tags)
                try:
                    result = func(*args, **kwargs)
                    outputs = result if capture_outputs else None
                    tracer.end_span(span, outputs=outputs)
                    return result
                except Exception as e:
                    tracer.end_span(span, error=e)
                    raise
            return sync_wrapper

    if _func is not None:
        return decorator(_func)
    return decorator


def trace_llm(
    _func: Optional[Callable] = None,
    *,
    name: Optional[str] = None,
    model: Optional[str] = None,
    provider: str = "openai",
):
    def decorator(func: Callable) -> Callable:
        span_name = name or f"llm:{func.__name__}"

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            from cluco_obs.tracer import get_tracer
            tracer = get_tracer()
            if not tracer or not tracer.config.enabled:
                return func(*args, **kwargs)

            span = tracer.start_span(span_name, kind=SpanKind.LLM)
            start = time.time_ns()
            try:
                result = func(*args, **kwargs)
                latency = (time.time_ns() - start) / 1_000_000
                _extract_llm_data(span, result, model, provider)
                tracer.end_span(span, outputs=result)
                return result
            except Exception as e:
                tracer.end_span(span, error=e)
                raise
        return wrapper

    if _func is not None:
        return decorator(_func)
    return decorator


def trace_tool(
    _func: Optional[Callable] = None,
    *,
    name: Optional[str] = None,
):
    def decorator(func: Callable) -> Callable:
        tool_name = name or func.__name__

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            from cluco_obs.tracer import get_tracer
            tracer = get_tracer()
            if not tracer or not tracer.config.enabled:
                return func(*args, **kwargs)

            inputs = _capture_args(func, args, kwargs)
            span = tracer.start_span(f"tool:{tool_name}", kind=SpanKind.TOOL, inputs=inputs)
            span.tool_name = tool_name
            span.tool_input = inputs
            try:
                result = func(*args, **kwargs)
                span.tool_output = result
                tracer.end_span(span, outputs=result)
                return result
            except Exception as e:
                tracer.end_span(span, error=e)
                raise
        return wrapper

    if _func is not None:
        return decorator(_func)
    return decorator


def trace_rag(
    _func: Optional[Callable] = None,
    *,
    name: Optional[str] = None,
    source: str = "default",
):
    def decorator(func: Callable) -> Callable:
        span_name = name or f"retriever:{func.__name__}"

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            from cluco_obs.tracer import get_tracer
            tracer = get_tracer()
            if not tracer or not tracer.config.enabled:
                return func(*args, **kwargs)

            inputs = _capture_args(func, args, kwargs)
            query = inputs.get("query", "") if isinstance(inputs, dict) else str(inputs)
            span = tracer.start_span(span_name, kind=SpanKind.RETRIEVER, inputs=inputs)
            span.query = query[:500] if query else ""
            span.metadata["source"] = source
            try:
                result = func(*args, **kwargs)
                if isinstance(result, (list, tuple)):
                    span.retrieved_documents = [_doc_summary(d) for d in result[:20]]
                    span.retrieval_scores = [getattr(d, "score", None) for d in result[:20]]
                tracer.end_span(span, outputs=result)
                return result
            except Exception as e:
                tracer.end_span(span, error=e)
                raise
        return wrapper

    if _func is not None:
        return decorator(_func)
    return decorator


def trace_embedding(
    _func: Optional[Callable] = None,
    *,
    name: Optional[str] = None,
    model: str = "text-embedding-3-small",
):
    def decorator(func: Callable) -> Callable:
        span_name = name or f"embedding:{func.__name__}"

        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            from cluco_obs.tracer import get_tracer
            tracer = get_tracer()
            if not tracer or not tracer.config.enabled:
                return func(*args, **kwargs)

            span = tracer.start_span(span_name, kind=SpanKind.EMBEDDING)
            try:
                result = func(*args, **kwargs)
                span.set_embedding_data(model=model)
                tracer.end_span(span, outputs="<embedding vector>")
                return result
            except Exception as e:
                tracer.end_span(span, error=e)
                raise
        return wrapper

    if _func is not None:
        return decorator(_func)
    return decorator


def _capture_args(func: Callable, args: tuple, kwargs: dict) -> dict:
    try:
        sig = inspect.signature(func)
        bound = sig.bind(*args, **kwargs)
        bound.apply_defaults()
        result = {}
        for k, v in bound.arguments.items():
            if k in ("self", "cls"):
                continue
            result[k] = _summarize_arg(v)
        return result
    except Exception:
        return {"args": str(args)[:500], "kwargs": str(kwargs)[:500]}


def _summarize_arg(v: Any, max_len: int = 2000) -> Any:
    if v is None or isinstance(v, (int, float, bool)):
        return v
    if isinstance(v, str):
        return v[:max_len] if len(v) > max_len else v
    if isinstance(v, dict):
        return {str(k)[:100]: _summarize_arg(val, max_len=500) for k, val in list(v.items())[:50]}
    if isinstance(v, (list, tuple)):
        return [_summarize_arg(item, max_len=500) for item in list(v)[:50]]
    if isinstance(v, bytes):
        return f"<bytes len={len(v)}>"
    return str(v)[:max_len]


def _extract_llm_data(span, result: Any, model: Optional[str], provider: str) -> None:
    try:
        if hasattr(result, "usage"):
            usage = result.usage
            inp = getattr(usage, "prompt_tokens", 0) or getattr(usage, "input_tokens", 0) or 0
            out = getattr(usage, "completion_tokens", 0) or getattr(usage, "output_tokens", 0) or 0
            m = model or getattr(result, "model", "unknown")
            from cluco_obs.tracer import _estimate_cost
            span.set_llm_data(model=m, provider=provider, input_tokens=inp, output_tokens=out, cost_usd=_estimate_cost(m, inp, out))
    except Exception:
        pass


def trace_langgraph_node(
    _func: Optional[Callable] = None,
    *,
    name: Optional[str] = None,
    node_type: str = "agent",
    metadata: Optional[dict] = None,
):
    """Decorator for LangGraph node functions. Captures node name, state transitions, and routing decisions."""

    def decorator(func: Callable) -> Callable:
        node_name = name or func.__name__

        if asyncio.iscoroutinefunction(func):
            @functools.wraps(func)
            async def async_wrapper(*args, **kwargs):
                from cluco_obs.tracer import get_tracer
                tracer = get_tracer()
                if not tracer or not tracer.config.enabled:
                    return await func(*args, **kwargs)

                state_input = args[0] if args else kwargs.get("state", {})
                inputs = {
                    "node_name": node_name,
                    "node_type": node_type,
                }
                if isinstance(state_input, dict):
                    if "query" in state_input:
                        inputs["query"] = str(state_input["query"])[:500]
                    if "category" in state_input:
                        inputs["current_category"] = state_input["category"]

                span_meta = {
                    "node_type": node_type,
                    "graph_node": node_name,
                    "is_langgraph_node": True,
                    **(metadata or {}),
                }
                span = tracer.start_span(
                    f"graph:{node_name}",
                    kind=SpanKind.CHAIN,
                    inputs=inputs,
                    metadata=span_meta,
                )
                try:
                    result = await func(*args, **kwargs)
                    outputs = _extract_node_outputs(result, node_type)
                    tracer.end_span(span, outputs=outputs)
                    return result
                except Exception as e:
                    tracer.end_span(span, error=e)
                    raise
            return async_wrapper
        else:
            @functools.wraps(func)
            def sync_wrapper(*args, **kwargs):
                from cluco_obs.tracer import get_tracer
                tracer = get_tracer()
                if not tracer or not tracer.config.enabled:
                    return func(*args, **kwargs)

                state_input = args[0] if args else kwargs.get("state", {})
                inputs = {
                    "node_name": node_name,
                    "node_type": node_type,
                }
                if isinstance(state_input, dict):
                    if "query" in state_input:
                        inputs["query"] = str(state_input["query"])[:500]
                    if "category" in state_input:
                        inputs["current_category"] = state_input["category"]

                span_meta = {
                    "node_type": node_type,
                    "graph_node": node_name,
                    "is_langgraph_node": True,
                    **(metadata or {}),
                }
                span = tracer.start_span(
                    f"graph:{node_name}",
                    kind=SpanKind.CHAIN,
                    inputs=inputs,
                    metadata=span_meta,
                )
                try:
                    result = func(*args, **kwargs)
                    outputs = _extract_node_outputs(result, node_type)
                    tracer.end_span(span, outputs=outputs)
                    return result
                except Exception as e:
                    tracer.end_span(span, error=e)
                    raise
            return sync_wrapper

    if _func is not None:
        return decorator(_func)
    return decorator


def _extract_node_outputs(result: Any, node_type: str) -> dict:
    """Extract relevant outputs from a LangGraph node result."""
    if not isinstance(result, dict):
        return {"result": str(result)[:1000]}

    outputs = {}
    if "category" in result:
        outputs["routing_decision"] = result["category"]
    if "routing_confidence" in result:
        outputs["routing_confidence"] = result["routing_confidence"]
    if "final_response" in result:
        outputs["final_response"] = str(result["final_response"])[:500]
    if "specialist_response" in result:
        outputs["specialist_response_preview"] = str(result["specialist_response"])[:300]
    if "context_docs" in result:
        outputs["retrieved_doc_count"] = len(result["context_docs"])
    if "agent_version" in result:
        outputs["agent_version"] = result["agent_version"]
    if "trace_metadata" in result:
        outputs["trace_metadata"] = result["trace_metadata"]

    return outputs or {"result": str(result)[:1000]}


def _doc_summary(doc: Any) -> dict:
    if isinstance(doc, dict):
        return {k: str(v)[:200] for k, v in list(doc.items())[:10]}
    content = getattr(doc, "page_content", None) or getattr(doc, "text", None) or str(doc)
    return {"content": str(content)[:300], "metadata": str(getattr(doc, "metadata", {}))[:200]}
