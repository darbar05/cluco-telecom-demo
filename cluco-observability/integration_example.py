"""
Minimal integration example — LECO or any Cluco product.
Set 2–3 env vars, then run your agent with the tracer.
"""
import os

# Minimal config for LECO (or any product)
os.environ.setdefault("AGENT_OBS_PRODUCT_ID", "leco")
os.environ.setdefault("AGENT_OBS_SERVICE_NAME", "leco-legal-agent")
os.environ.setdefault("AGENT_OBS_EXPORTER", "http")
os.environ.setdefault("AGENT_OBS_BACKEND_URL", "http://localhost:9410")

from agent_observability import AgentTracer, ObservabilityConfig

config = ObservabilityConfig.from_env()
tracer = AgentTracer(config)

# Use in your agent
with tracer.start_span("invoke_agent"):
    tracer.record_event("user_input", {"query": "Summarize this document"})
    tracer.record_llm_call(model="claude-sonnet", input_tokens=100, output_tokens=50)
    tracer.record_tool_call("search", "query=...", "results...", success=True)
    # RAG, fine-tuning, infrastructure
    tracer.record_rag_retrieval(index_name="legal-index", num_results=5, latency_ms=12.5)
    tracer.record_rag_embedding(model="text-embedding-3-small", num_chunks=10, latency_ms=45.0)
    tracer.record_infrastructure("db", target="postgres", latency_ms=2.1)

# Traces appear in Cluco UI at http://localhost:9411
