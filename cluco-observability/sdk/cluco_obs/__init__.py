"""Cluco Observability SDK — product-agnostic tracing for AI agents."""

from cluco_obs.tracer import ClucoTracer, get_tracer, init_tracer, submit_feedback
from cluco_obs.decorators import traceable, trace_llm, trace_tool, trace_rag, trace_embedding, trace_langgraph_node
from cluco_obs.spans import Span, SpanKind
from cluco_obs.config import ClucoConfig
from cluco_obs.autolog import autolog

__version__ = "0.1.0"

__all__ = [
    "ClucoTracer",
    "get_tracer",
    "init_tracer",
    "traceable",
    "trace_llm",
    "trace_tool",
    "trace_rag",
    "trace_embedding",
    "trace_langgraph_node",
    "Span",
    "SpanKind",
    "ClucoConfig",
    "submit_feedback",
    "autolog",
]
