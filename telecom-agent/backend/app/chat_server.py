"""
FastAPI chat server for the TelcoAssist telecom agent.
Integrates with Cluco SDK for observability tracing.
"""
import os
import sys
import uuid
import time
from datetime import datetime
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import uvicorn

load_dotenv()

CLUCO_SDK_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "cluco-observability", "sdk")
)
if CLUCO_SDK_PATH not in sys.path:
    sys.path.insert(0, CLUCO_SDK_PATH)

try:
    from cluco_obs import ClucoTracer, ClucoConfig
    from cluco_obs.spans import SpanKind

    cluco_config = ClucoConfig(
        backend_url=os.getenv("CLUCO_OBS_BACKEND_URL", "http://localhost:9410"),
        product_id=os.getenv("CLUCO_OBS_PRODUCT_ID", "telecom-agent"),
        service_name="telecom-agent",
    )
    tracer = ClucoTracer(config=cluco_config)
    TRACING_ENABLED = True
    print("Cluco tracing enabled.")
except Exception as e:
    print(f"Cluco tracing not available: {e}")
    TRACING_ENABLED = False
    tracer = None

from app.agents import run_agent, get_agent, extract_graph_architecture
from app.prompts import (
    ROUTER_PROMPT_V1, ROUTER_PROMPT_V2,
    BILLING_AGENT_PROMPT, PRODUCT_AGENT_PROMPT,
    SUPPORT_AGENT_PROMPT, RESPONSE_FORMATTER_PROMPT,
)

app = FastAPI(title="TelcoAssist Chat API", version="1.0.0")


@app.on_event("startup")
def _register_with_cluco():
    """Register agent architecture and prompts with Cluco on startup."""
    if not TRACING_ENABLED or not tracer:
        return

    # --- Register agent graph ---
    try:
        compiled = get_agent("v1")
        arch = extract_graph_architecture(compiled)
        if arch.get("nodes"):
            result = tracer.register_agent_architecture(
                nodes=arch["nodes"],
                edges=arch["edges"],
                parallel_groups=arch.get("parallel_groups", []),
            )
            print(f"Agent architecture registered: {result}")
    except Exception as e:
        print(f"Could not register agent architecture: {e}")

    # --- Register prompts ---
    try:
        prompts = [
            {"name": "Router Prompt (v1)", "content": ROUTER_PROMPT_V1,
             "agent_name": "router", "description": "Classifies queries into billing/products/support",
             "variables": ["query"], "tags": ["v1", "routing"]},
            {"name": "Router Prompt (v2)", "content": ROUTER_PROMPT_V2,
             "agent_name": "router", "description": "Enhanced routing with disambiguation rules",
             "variables": ["query"], "tags": ["v2", "routing", "improved"]},
            {"name": "Billing Agent Prompt", "content": BILLING_AGENT_PROMPT,
             "agent_name": "billing_agent", "description": "RAG-based billing specialist prompt",
             "variables": ["context", "query"], "tags": ["specialist", "billing"]},
            {"name": "Product Agent Prompt", "content": PRODUCT_AGENT_PROMPT,
             "agent_name": "product_agent", "description": "RAG-based product specialist prompt",
             "variables": ["context", "query"], "tags": ["specialist", "products"]},
            {"name": "Support Agent Prompt", "content": SUPPORT_AGENT_PROMPT,
             "agent_name": "support_agent", "description": "RAG-based support specialist prompt",
             "variables": ["context", "query"], "tags": ["specialist", "support"]},
            {"name": "Response Formatter", "content": RESPONSE_FORMATTER_PROMPT,
             "agent_name": "response_formatter", "description": "Polishes specialist output into friendly reply",
             "variables": ["specialist_response", "query"], "tags": ["formatter"]},
        ]
        results = tracer.register_prompts(prompts)
        registered = sum(1 for r in results if "error" not in r)
        print(f"Prompts registered: {registered}/{len(prompts)}")
    except Exception as e:
        print(f"Could not register prompts: {e}")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

sessions: dict[str, dict] = {}
current_agent_version = "v1"


class ChatRequest(BaseModel):
    message: str
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    response: str
    trace_id: str
    session_id: str
    agent_version: str
    category: str
    timestamp: str


class FeedbackRequest(BaseModel):
    trace_id: str
    thumbs: str  # "up" or "down"
    comment: Optional[str] = None


class SessionResponse(BaseModel):
    session_id: str
    created_at: str
    message_count: int
    title: str


class VersionRequest(BaseModel):
    version: str


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "telcoassist-chat",
        "agent_version": current_agent_version,
        "tracing_enabled": TRACING_ENABLED,
    }


@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    global current_agent_version
    trace_id = str(uuid.uuid4())
    session_id = req.session_id or str(uuid.uuid4())

    if session_id not in sessions:
        sessions[session_id] = {
            "id": session_id,
            "created_at": datetime.utcnow().isoformat(),
            "messages": [],
            "title": req.message[:50],
        }

    if TRACING_ENABLED and tracer:
        tracer.start_session(session_id)
        tracer.start_trace(trace_id=trace_id)

    root_span = None
    if TRACING_ENABLED and tracer:
        root_span = tracer.start_span(
            name="telecom_agent_pipeline",
            kind=SpanKind.CHAIN,
            inputs={"query": req.message, "agent_version": current_agent_version},
            metadata={
                "agent_version": current_agent_version,
                "service_name": f"telecom-agent-{current_agent_version}",
            },
        )

    try:
        start_time = time.time()
        result = run_agent(req.message, version=current_agent_version)
        elapsed = time.time() - start_time

        category = result.get("category", "unknown")
        final_response = result.get("final_response", "I'm sorry, I couldn't process your request.")
        context_docs = result.get("context_docs", [])
        token_usage = result.get("token_usage", {})

        CATEGORY_TO_NODE = {
            "billing": "billing_agent",
            "products": "product_agent",
            "support": "support_agent",
        }
        specialist_node = CATEGORY_TO_NODE.get(category, f"{category}_agent")

        if TRACING_ENABLED and tracer:
            # --- Router agent span (kind=AGENT so it shows in Agent Flow) ---
            router_agent = tracer.start_span(
                name="agent:router",
                kind=SpanKind.AGENT,
                inputs={"query": req.message},
                metadata={"node_type": "router", "agent_version": current_agent_version},
            )
            router_tokens = token_usage.get("router", {})
            router_prompt = ROUTER_PROMPT_V2 if current_agent_version == "v2" else ROUTER_PROMPT_V1
            tracer.record_llm_call(
                model="gpt-4o-mini",
                provider="openai",
                input_tokens=router_tokens.get("input_tokens", 0),
                output_tokens=router_tokens.get("output_tokens", 0),
                agent_name="router",
                metadata={"routing_decision": category},
                prompt_messages=[
                    {"role": "system", "content": router_prompt.replace("{query}", req.message)},
                    {"role": "user", "content": req.message},
                ],
                completion=f"Route to: {category}",
            )
            tracer.end_span(router_agent, outputs={
                "routing_decision": category,
                "selected_agent": specialist_node,
            })

            # --- Specialist agent span (kind=AGENT) with retrieval + LLM ---
            specialist_agent = tracer.start_span(
                name=f"agent:{specialist_node}",
                kind=SpanKind.AGENT,
                inputs={"query": req.message, "context_doc_count": len(context_docs)},
                metadata={"sub_agent": category, "node_type": "specialist"},
            )
            tracer.record_retrieval(
                query=req.message,
                source=category,
                documents=[
                    {
                        "content": d.get("content", ""),
                        "metadata": {
                            "title": d.get("title", ""),
                            "score": d.get("score", 0),
                            "category": d.get("category", category),
                        },
                    }
                    for d in context_docs
                ],
                scores=[d.get("score", 0) for d in context_docs],
                top_k=len(context_docs),
            )
            specialist_tokens = token_usage.get("specialist", {})
            SPECIALIST_PROMPTS = {
                "billing": BILLING_AGENT_PROMPT,
                "products": PRODUCT_AGENT_PROMPT,
                "support": SUPPORT_AGENT_PROMPT,
            }
            spec_prompt = SPECIALIST_PROMPTS.get(category, f"You are a {category} specialist agent for a telecom company.")
            tracer.record_llm_call(
                model="gpt-4o-mini",
                provider="openai",
                input_tokens=specialist_tokens.get("input_tokens", 0),
                output_tokens=specialist_tokens.get("output_tokens", 0),
                agent_name=specialist_node,
                metadata={"sub_agent": category},
                prompt_messages=[
                    {"role": "system", "content": spec_prompt},
                    {"role": "user", "content": req.message},
                ],
                completion=result.get("specialist_response", "")[:500],
            )
            tracer.end_span(specialist_agent, outputs={
                "response_length": len(result.get("specialist_response", "")),
                "specialist_response": result.get("specialist_response", "")[:300],
            })

            # --- Response formatter agent span (kind=AGENT) ---
            formatter_agent = tracer.start_span(
                name="agent:response_formatter",
                kind=SpanKind.AGENT,
                inputs={"specialist_response_preview": result.get("specialist_response", "")[:200]},
                metadata={"node_type": "formatter"},
            )
            formatter_tokens = token_usage.get("formatter", {})
            tracer.record_llm_call(
                model="gpt-4o-mini",
                provider="openai",
                input_tokens=formatter_tokens.get("input_tokens", 0),
                output_tokens=formatter_tokens.get("output_tokens", 0),
                agent_name="response_formatter",
                prompt_messages=[
                    {"role": "system", "content": RESPONSE_FORMATTER_PROMPT},
                    {"role": "user", "content": result.get("specialist_response", "")[:300]},
                ],
                completion=final_response[:500],
            )
            tracer.end_span(formatter_agent, outputs={
                "final_response": final_response[:300],
                "final_response_length": len(final_response),
            })

        if TRACING_ENABLED and tracer and root_span:
            tracer.end_span(
                root_span,
                outputs={
                    "category": category,
                    "final_response": final_response,
                    "response_preview": final_response[:200],
                    "routing_decision": category,
                    "doc_count": len(context_docs),
                    "latency_seconds": round(elapsed, 2),
                    "agent_version": current_agent_version,
                },
            )

        timestamp = datetime.utcnow().isoformat()
        sessions[session_id]["messages"].append({
            "role": "user",
            "content": req.message,
            "timestamp": timestamp,
        })
        sessions[session_id]["messages"].append({
            "role": "assistant",
            "content": final_response,
            "timestamp": timestamp,
            "trace_id": trace_id,
            "category": category,
            "agent_version": current_agent_version,
        })

        return ChatResponse(
            response=final_response,
            trace_id=trace_id,
            session_id=session_id,
            agent_version=current_agent_version,
            category=category,
            timestamp=timestamp,
        )

    except Exception as e:
        if TRACING_ENABLED and tracer and root_span:
            tracer.end_span(root_span, error=e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/feedback")
def submit_feedback(req: FeedbackRequest):
    """Submit user feedback via SDK only (single write path to avoid duplicates)."""
    import json
    import urllib.request

    cluco_url = os.getenv("CLUCO_OBS_BACKEND_URL", "http://localhost:9410")
    sent = False

    if TRACING_ENABLED and tracer:
        score = 1.0 if req.thumbs == "up" else 0.0
        tracer.add_feedback(
            trace_id=req.trace_id,
            key="user_feedback",
            score=score,
            value="True" if req.thumbs == "up" else "False",
            comment=req.comment,
            source="user",
        )
        sent = True
    else:
        url = cluco_url.rstrip("/") + "/api/v1/feedback/thumbs"
        payload = json.dumps({
            "trace_id": req.trace_id,
            "thumbs": req.thumbs,
            "comment": req.comment,
            "source": "user",
        }).encode("utf-8")
        try:
            http_req = urllib.request.Request(
                url, data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(http_req, timeout=5):
                sent = True
        except Exception:
            pass

    return {"ok": True, "method": "sdk" if TRACING_ENABLED and tracer else "direct"}


@app.post("/sessions")
def create_session():
    session_id = str(uuid.uuid4())
    sessions[session_id] = {
        "id": session_id,
        "created_at": datetime.utcnow().isoformat(),
        "messages": [],
        "title": "New Chat",
    }
    return {"session_id": session_id, "created_at": sessions[session_id]["created_at"]}


@app.get("/sessions")
def list_sessions():
    result = []
    for sid, session in sessions.items():
        result.append({
            "session_id": sid,
            "created_at": session["created_at"],
            "message_count": len(session["messages"]),
            "title": session.get("title", "New Chat"),
        })
    result.sort(key=lambda s: s["created_at"], reverse=True)
    return result


@app.get("/sessions/{session_id}/messages")
def get_session_messages(session_id: str):
    if session_id not in sessions:
        raise HTTPException(status_code=404, detail="Session not found")
    return sessions[session_id]["messages"]


@app.get("/agent/version")
def get_agent_version():
    return {"version": current_agent_version}


@app.post("/agent/version")
def set_agent_version(req: VersionRequest):
    global current_agent_version
    if req.version not in ("v1", "v2"):
        raise HTTPException(status_code=400, detail="Version must be 'v1' or 'v2'")
    current_agent_version = req.version
    return {"version": current_agent_version, "message": f"Switched to agent {req.version}"}


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 9412))
    uvicorn.run(app, host="0.0.0.0", port=port)
