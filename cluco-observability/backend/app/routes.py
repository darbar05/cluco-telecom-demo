"""API routes — traces, spans, LLM calls, tools, RAG, embeddings, feedback, metrics, dashboards."""

import json
import logging
from typing import Any, Optional
from fastapi import APIRouter, Query, HTTPException, Body, Request, UploadFile, File, Form
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, field_validator

logger = logging.getLogger("cluco.routes")
router = APIRouter()


def _run_judge_monitors_for_trace(store, trace_id: str, trace_doc: dict | None,
                                   run_alert_rules_after: bool = False):
    """Run active judge monitors on a finalized trace. Safe to call from ingest or finalize flows.

    When ``run_alert_rules_after`` is True, alert-rule evaluation runs *after*
    all judge monitors have written their feedback so that evaluator_result
    conditions see up-to-date data.
    """
    import threading
    import random

    try:
        active_monitors = store.get_active_judge_monitors()
        has_monitors = active_monitors and trace_doc
        if not has_monitors and not run_alert_rules_after:
            return
        if has_monitors:
            logger.info("Auto-evaluate: running %d judge monitor(s) for trace %s", len(active_monitors), trace_id)

        def _run_online_judges():
            try:
                if has_monitors:
                    from app.evaluation_engine import TraceContext, run_single_evaluator
                    trace_data = store.get(trace_id)
                    if not trace_data:
                        logger.warning("Auto-evaluate: trace %s not found for evaluation", trace_id)
                        return
                    context = TraceContext.from_trace_dict(trace_data)
                    for mon in active_monitors:
                        try:
                            if random.random() * 100 > mon.get("sample_rate", 100):
                                continue
                            mon_filters = mon.get("filters", {})
                            if mon_filters.get("product_id") and trace_doc.get("product_id") != mon_filters["product_id"]:
                                continue
                            if mon_filters.get("service_name") and trace_doc.get("service_name") != mon_filters["service_name"]:
                                continue
                            evaluator = store.get_evaluator(mon["evaluator_id"])
                            if not evaluator:
                                continue
                            cfg = dict(evaluator.get("config") or {})
                            mon_config = mon.get("evaluator_config")
                            if mon_config and isinstance(mon_config, dict):
                                stored_rubric = (mon_config.get("rubric") or "").strip()
                                if stored_rubric and not stored_rubric.startswith("Evaluate the quality of the output"):
                                    cfg.update({k: v for k, v in mon_config.items() if v is not None})
                                    logger.debug("Auto-evaluate: using evaluator_config from monitor for %s", mon.get("evaluator_id"))
                            rubric = (cfg.get("rubric") or "").strip()
                            name_lower = (evaluator.get("name") or "").lower()
                            cat = (evaluator.get("category") or "").lower()
                            is_routing = "routing" in name_lower or cat == "agent"
                            if is_routing and (not rubric or rubric.startswith("Evaluate the quality of the output")):
                                cfg["rubric"] = (
                                    "You are evaluating an AI agent's routing decisions. Use the Full Trace Context.\n"
                                    "Determine: 1) User's query 2) Which sub-agent was selected (routing_decision, selected_agent) "
                                    "3) Was this correct given the query's PRIMARY intent?\n"
                                    "Be strict: passed=true only when routing was clearly correct. "
                                    "passed=false if wrong or uncertain. Billing/pricing questions should route to billing, not support."
                                )
                                cfg["output_type"] = "boolean"
                                logger.info("Auto-evaluate: applied routing rubric+boolean for %s", mon.get("evaluator_id"))
                            evaluator = dict(evaluator, config=cfg)
                            result = run_single_evaluator(evaluator, context)
                            store.add_feedback(
                                trace_id=trace_id,
                                key=evaluator.get("name", mon["evaluator_id"]),
                                score=result.get("score"),
                                value="True" if result.get("passed", (result.get("score", 0) or 0) >= 50) else "False",
                                comment=result.get("reasoning", ""),
                                source="judge",
                            )
                            logger.debug("Auto-evaluate: evaluator %s completed for trace %s", mon.get("evaluator_id"), trace_id)
                        except Exception as e:
                            logger.warning("Auto-evaluate: evaluator %s failed for trace %s: %s", mon.get("evaluator_id"), trace_id, e)
            except Exception as e:
                logger.warning("Auto-evaluate: judge monitors failed for trace %s: %s", trace_id, e)

            if run_alert_rules_after and trace_doc:
                _evaluate_alert_rules_for_trace(store, trace_id, trace_doc)

        threading.Thread(
            target=_run_online_judges,
            daemon=True,
            name="online-judge-eval",
        ).start()
    except Exception as e:
        logger.warning("Auto-evaluate: could not start judge monitors for trace %s: %s", trace_id, e)


def _evaluate_alert_rules_for_trace(store, trace_id: str, trace_doc: dict):
    """Evaluate email alert rules for a trace. Re-fetches trace data to capture latest feedback."""
    try:
        from app.email_alerts import evaluate_rules_for_trace, dispatch_alert_emails
        fresh_trace = store.get(trace_id)
        if not fresh_trace:
            fresh_trace = trace_doc
        triggered = evaluate_rules_for_trace(fresh_trace)
        if triggered:
            import threading
            threading.Thread(
                target=dispatch_alert_emails,
                args=(fresh_trace, triggered),
                daemon=True,
                name="email-rule-eval",
            ).start()
    except Exception as e:
        logger.warning("Alert rule evaluation failed for trace %s: %s", trace_id, e)


@router.get("/health")
def health() -> dict:
    """Backend health under /api/v1 so UI can ping with baseURL /api/v1."""
    return {"status": "ok", "service": "cluco-observability"}


class TracePayload(BaseModel):
    trace_id: str
    session_id: Optional[str] = None
    product_id: Optional[str] = "default"
    service_name: Optional[str] = "agent"
    environment: Optional[str] = "development"
    start_time_ns: Optional[int] = None
    end_time_ns: Optional[int] = None
    latency_ms: Optional[float] = None
    status: Optional[str] = "ok"
    total_tokens: Optional[int] = None
    total_cost_usd: Optional[float] = None
    metadata: Optional[dict] = None
    tags: Optional[list] = None
    spans: list[dict[str, Any]] = []


class BatchIngestPayload(BaseModel):
    traces: list[dict[str, Any]]


class FeedbackPayload(BaseModel):
    trace_id: str
    key: str
    score: Optional[float] = None
    value: Optional[str] = None
    comment: Optional[str] = None
    source: Optional[str] = "api"
    span_id: Optional[str] = ""


class DashboardPayload(BaseModel):
    name: str
    product_id: Optional[str] = "default"
    description: Optional[str] = None
    layout: Optional[dict] = None


@router.post("/traces")
async def ingest_trace(payload: TracePayload, request: Request) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    result = store.ingest(payload.trace_id, payload.model_dump())
    # Notify live monitor clients about the ingested trace and its spans
    try:
        data = payload.model_dump()
        meta = {
            "product_id": data.get("product_id", "default"),
            "service_name": data.get("service_name", "agent"),
            "session_id": data.get("session_id", ""),
        }
        global_notify = getattr(request.app.state, 'notify_global_live_clients', None)
        if global_notify:
            for span in (data.get("spans") or []):
                await global_notify(payload.trace_id, span, meta)
        finalize_notify = getattr(request.app.state, 'notify_global_trace_finalized', None)
        if finalize_notify:
            await finalize_notify(payload.trace_id, {**meta, "status": data.get("status", "ok")})
        # Run auto-evaluate judge monitors when trace has spans (was finalized during ingest)
        if data.get("spans"):
            try:
                trace_doc = store._traces.find_one({"trace_id": payload.trace_id})
                if trace_doc:
                    trace_doc.pop("_id", None)
                _run_judge_monitors_for_trace(store, payload.trace_id, trace_doc)
            except Exception:
                pass
    except Exception:
        pass
    return result


@router.post("/traces/ingest")
async def batch_ingest(payload: BatchIngestPayload, request: Request) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    result = store.ingest_batch(payload.traces)
    # Notify live monitor clients for each trace in the batch
    try:
        global_notify = getattr(request.app.state, 'notify_global_live_clients', None)
        finalize_notify = getattr(request.app.state, 'notify_global_trace_finalized', None)
        for trace_data in (payload.traces or []):
            trace_type = trace_data.get("type", "trace")
            if trace_type in ("feedback", "span_stream"):
                continue
            tid = trace_data.get("trace_id", "")
            if not tid:
                continue
            meta = {
                "product_id": trace_data.get("product_id", "default"),
                "service_name": trace_data.get("service_name", "agent"),
                "session_id": trace_data.get("session_id", ""),
            }
            if global_notify:
                for span in (trace_data.get("spans") or []):
                    await global_notify(tid, span, meta)
            if finalize_notify:
                await finalize_notify(tid, {**meta, "status": trace_data.get("status", "ok")})
            # Run auto-evaluate judge monitors for each ingested trace (has spans = finalized during ingest)
            if trace_data.get("spans"):
                try:
                    trace_doc = store._traces.find_one({"trace_id": tid})
                    if trace_doc:
                        trace_doc.pop("_id", None)
                    _run_judge_monitors_for_trace(store, tid, trace_doc)
                except Exception:
                    pass
    except Exception:
        pass
    return result


class SpanStreamPayload(BaseModel):
    trace_id: str
    product_id: Optional[str] = "default"
    service_name: Optional[str] = "agent"
    session_id: Optional[str] = None
    span: dict[str, Any] = {}


@router.post("/spans/stream")
async def stream_span(payload: SpanStreamPayload, request: Request) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    result = store.stream_span(
        trace_id=payload.trace_id,
        span_data=payload.span,
        product_id=payload.product_id or "default",
        service_name=payload.service_name or "agent",
        session_id=payload.session_id or "",
    )
    # Notify per-trace WebSocket live clients
    try:
        notify_fn = getattr(request.app.state, 'notify_live_clients', None)
        if notify_fn:
            await notify_fn(payload.trace_id, payload.span)
    except Exception:
        pass
    # Notify global live feed clients (auto-discovery)
    try:
        global_notify_fn = getattr(request.app.state, 'notify_global_live_clients', None)
        if global_notify_fn:
            await global_notify_fn(payload.trace_id, payload.span, {
                "product_id": payload.product_id or "default",
                "service_name": payload.service_name or "agent",
                "session_id": payload.session_id or "",
            })
    except Exception:
        pass
    return result


@router.get("/traces")
def list_traces(
    product_id: Optional[str] = Query(None),
    session_id: Optional[str] = Query(None),
    service_name: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    environment: Optional[str] = Query(None),
    assessment_name: Optional[str] = Query(None),
    assessment_value: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    result = store.list_traces(
        product_id=product_id, session_id=session_id, service_name=service_name,
        status=status, environment=environment,
        assessment_name=assessment_name, assessment_value=assessment_value,
        limit=limit, offset=offset,
    )
    trace_ids = [t["trace_id"] for t in result["traces"]]
    if trace_ids:
        assessments_by_trace = store.get_assessments_for_traces(trace_ids)
        for t in result["traces"]:
            t["assessments"] = assessments_by_trace.get(t["trace_id"], {})
    return result


@router.post("/traces/{trace_id}/debug-assistant")
async def debug_assistant(trace_id: str, body: dict = Body(default={})):
    """AI-powered trace debugging assistant. Streams analysis via SSE."""
    from app.storage import get_trace_store
    from app.trace_assistant import stream_trace_analysis, analyze_trace_sync
    store = get_trace_store()
    trace = store.get(trace_id)
    if not trace:
        raise HTTPException(status_code=404, detail="Trace not found")

    question = body.get("question", "")
    stream = body.get("stream", True)

    if not stream:
        result = analyze_trace_sync(trace, question)
        return {"trace_id": trace_id, "analysis": result}

    async def sse_generator():
        async for chunk in stream_trace_analysis(trace, question):
            yield f"data: {json.dumps({'chunk': chunk})}\n\n"
        yield "data: [DONE]\n\n"

    return StreamingResponse(sse_generator(), media_type="text/event-stream")


@router.get("/traces/active")
def list_active_traces(
    product_id: Optional[str] = Query(None),
    service_name: Optional[str] = Query(None),
    limit: int = Query(20, le=100),
) -> dict:
    """Return traces with status='running', ordered by most recently updated."""
    from app.storage import get_trace_store
    store = get_trace_store()
    query: dict = {"status": "running"}
    if product_id:
        query["product_id"] = product_id
    if service_name:
        query["service_name"] = service_name
    cursor = store._traces.find(query).sort("updated_at", -1).limit(limit)
    traces = []
    for doc in cursor:
        doc.pop("_id", None)
        traces.append(doc)
    return {"traces": traces, "count": len(traces)}


@router.get("/traces/compare")
def compare_traces(
    trace_a: str = Query(...),
    trace_b: str = Query(...),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.compare_traces(trace_a, trace_b)


@router.get("/traces/{trace_id}")
def get_trace(trace_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    data = store.get(trace_id)
    if not data:
        raise HTTPException(status_code=404, detail="Trace not found")
    return data


@router.get("/traces/{trace_id}/summary")
def get_trace_summary(trace_id: str) -> dict:
    """Generate a non-technical, SME-friendly summary of a trace using OpenAI."""
    import os
    from app.storage import get_trace_store
    store = get_trace_store()
    data = store.get(trace_id)
    if not data:
        raise HTTPException(status_code=404, detail="Trace not found")

    db = store.db if hasattr(store, 'db') else None
    if db:
        cached = db.trace_summaries.find_one({"trace_id": trace_id})
        if cached:
            return {"trace_id": trace_id, "summary": cached["summary"]}

    trace = data.get("trace", data)
    spans = trace.get("spans", trace.get("flat_spans", []))

    span_descriptions = []
    for s in spans:
        name = s.get("name", "unknown")
        kind = s.get("kind", "")
        inp = s.get("inputs") or s.get("input") or {}
        out = s.get("outputs") or s.get("output") or {}
        span_descriptions.append(
            f"- [{kind}] {name}: input={str(inp)}, output={str(out)}"
        )

    span_text = "\n".join(span_descriptions) if span_descriptions else "No span details available."

    prompt = f"""You are a helpful assistant that explains AI agent execution traces in simple, non-technical language.
A domain expert (not a developer) needs to understand what happened when an AI agent processed a customer query.

Trace information:
- Service: {trace.get('service_name', 'unknown')}
- Status: {trace.get('status', 'unknown')}
- Duration: {trace.get('latency_ms', 'unknown')}ms
- Total tokens: {trace.get('total_tokens', 'unknown')}

Steps the agent took:
{span_text}

Write a 3-5 sentence plain-English summary explaining:
1. What question/request was received
2. How the agent handled it (what steps it took)
3. What answer was produced
4. Any issues or noteworthy observations

Use simple language. Avoid technical jargon like "spans", "tokens", "LLM". Say things like "the agent looked up information", "the agent classified the request", "the agent consulted a knowledge source", etc."""

    try:
        from langchain_openai import ChatOpenAI
        llm = ChatOpenAI(model="gpt-4o-mini", temperature=0.3, api_key=os.getenv("OPENAI_API_KEY"))
        from langchain_core.messages import HumanMessage
        response = llm.invoke([HumanMessage(content=prompt)])
        summary = response.content.strip()
    except Exception as e:
        summary = f"Unable to generate summary: {str(e)}"

    if db:
        try:
            db.trace_summaries.update_one(
                {"trace_id": trace_id},
                {"$set": {"trace_id": trace_id, "summary": summary}},
                upsert=True,
            )
        except Exception:
            pass

    return {"trace_id": trace_id, "summary": summary}


@router.delete("/traces/{trace_id}")
def delete_trace(trace_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    ok = store.delete_trace(trace_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Trace not found")
    return {"ok": True}


@router.get("/spans")
def list_spans(
    trace_id: Optional[str] = Query(None),
    kind: Optional[str] = Query(None),
    limit: int = Query(200, le=1000),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    spans = store.get_spans(trace_id=trace_id, kind=kind, limit=limit)
    return {"spans": spans, "count": len(spans)}


@router.get("/llm-calls")
def list_llm_calls(
    trace_id: Optional[str] = Query(None),
    product_id: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    calls = store.get_llm_calls(trace_id=trace_id, product_id=product_id, limit=limit)
    return {"llm_calls": calls, "count": len(calls)}


@router.get("/tool-calls")
def list_tool_calls(
    trace_id: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    calls = store.get_tool_calls(trace_id=trace_id, limit=limit)
    return {"tool_calls": calls, "count": len(calls)}


@router.get("/rag-queries")
def list_rag_queries(
    trace_id: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    calls = store.get_retriever_calls(trace_id=trace_id, limit=limit)
    return {"rag_queries": calls, "count": len(calls)}


@router.get("/embedding-calls")
def list_embedding_calls(
    trace_id: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    calls = store.get_embedding_calls(trace_id=trace_id, limit=limit)
    return {"embedding_calls": calls, "count": len(calls)}


@router.post("/feedback")
def add_feedback(payload: FeedbackPayload) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.add_feedback(
        trace_id=payload.trace_id, key=payload.key, score=payload.score,
        value=payload.value, comment=payload.comment, source=payload.source,
        span_id=payload.span_id,
    )


@router.get("/feedback")
def list_feedback(
    trace_id: Optional[str] = Query(None),
    key: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    items = store.get_feedback(trace_id=trace_id, key=key, limit=limit)
    return {"feedback": items, "count": len(items)}


class ThumbsFeedbackPayload(BaseModel):
    trace_id: str
    span_id: Optional[str] = ""
    thumbs: str  # "up" or "down"
    comment: Optional[str] = None
    source: Optional[str] = "user"

    @field_validator("thumbs")
    @classmethod
    def thumbs_must_be_up_or_down(cls, v: str) -> str:
        if v not in ("up", "down"):
            raise ValueError("thumbs must be 'up' or 'down'")
        return v


@router.post("/feedback/thumbs")
def add_thumbs_feedback(payload: ThumbsFeedbackPayload) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    score = 1.0 if payload.thumbs == "up" else 0.0
    value = "True" if payload.thumbs == "up" else "False"
    return store.add_feedback(
        trace_id=payload.trace_id,
        key="user_feedback",
        score=score,
        value=value,
        comment=payload.comment,
        source=payload.source or "user",
        span_id=payload.span_id or "",
    )


@router.get("/traces/{trace_id}/assessments")
def get_trace_assessments(trace_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.get_trace_assessments(trace_id)


@router.get("/metrics")
def get_metrics(
    product_id: Optional[str] = Query(None),
    service_name: Optional[str] = Query(None),
    days: int = Query(30, le=365),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.get_metrics_advanced(product_id=product_id, service_name=service_name, days=days)


@router.post("/traces/{trace_id}/finalize")
async def finalize_trace(trace_id: str, request: Request, body: dict = Body(default={})) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    status = body.get("status", "ok")
    session_id = body.get("session_id")
    result = store.finalize_trace(trace_id, status=status, session_id=session_id)

    # Fetch trace doc once (used for both global notification and email alerts)
    trace_doc = None
    try:
        trace_doc = store._traces.find_one({"trace_id": trace_id})
        if trace_doc:
            trace_doc.pop("_id", None)
    except Exception:
        pass

    # ── Notify global live feed that the trace is finalized ──
    try:
        global_finalize_fn = getattr(request.app.state, 'notify_global_trace_finalized', None)
        if global_finalize_fn:
            meta = {}
            if trace_doc:
                meta = {
                    "product_id": trace_doc.get("product_id", ""),
                    "service_name": trace_doc.get("service_name", ""),
                    "status": status,
                }
            await global_finalize_fn(trace_id, meta)
    except Exception:
        pass

    # ── Run online judge monitors, then evaluate alert rules AFTER judges complete ──
    try:
        _run_judge_monitors_for_trace(store, trace_id, trace_doc, run_alert_rules_after=True)
    except Exception:
        pass  # never let judge/alert failures break trace finalization

    return result


@router.post("/traces/{trace_id}/recalculate-cost")
def recalculate_trace_cost(trace_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.recalculate_cost(trace_id)


@router.post("/traces/recalculate-costs")
def recalculate_all_costs() -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.recalculate_all_costs()


@router.get("/pricing")
def get_pricing() -> dict:
    from app.cost import get_pricing_config, get_model_costs
    config = get_pricing_config()
    models = config.get("models", {})
    by_provider: dict = {}
    for name, info in models.items():
        provider = info.get("provider", "unknown")
        if provider not in by_provider:
            by_provider[provider] = []
        by_provider[provider].append({
            "model": name,
            "type": info.get("type", "llm"),
            "input_per_1k": info.get("input", 0),
            "output_per_1k": info.get("output", 0),
        })
    return {
        "total_models": len(models),
        "updated": config.get("_updated", "unknown"),
        "providers": by_provider,
    }


@router.get("/pricing/models")
def get_pricing_models() -> dict:
    from app.cost import get_model_costs
    costs = get_model_costs()
    return {"models": costs, "total": len(costs)}


@router.get("/pricing/estimate")
def estimate_pricing(
    model: str = Query(...),
    input_tokens: int = Query(0),
    output_tokens: int = Query(0),
) -> dict:
    from app.cost import estimate_cost, get_model_costs
    costs_map = get_model_costs()
    model_info = costs_map.get(model)
    if not model_info:
        for key, val in costs_map.items():
            if key in model or model in key:
                model_info = val
                model = key
                break
    cost = estimate_cost(model, input_tokens, output_tokens)
    return {
        "model": model,
        "input_tokens": input_tokens,
        "output_tokens": output_tokens,
        "estimated_cost_usd": round(cost, 8),
        "model_found": model_info is not None,
        "rates_per_1k": model_info if model_info else None,
    }


@router.get("/products")
def list_products() -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    rows = store.get_all_traces()
    return {"products": sorted({r.product_id for r in rows if r.product_id})}


@router.get("/agents")
def list_agents(product_id: Optional[str] = Query(None)) -> dict:
    from app.storage import get_trace_store
    from collections import defaultdict
    store = get_trace_store()
    rows = store.get_all_traces(product_id=product_id)
    by_service = defaultdict(lambda: {
        "sessions": set(), "traces": 0, "errors": 0, "latencies": [],
        "tokens": 0, "cost": 0.0,
        "llm_tokens": 0, "llm_cost": 0.0, "llm_calls": 0,
        "embedding_tokens": 0, "embedding_cost": 0.0, "embedding_calls": 0,
        "trace_ids": [],
    })
    for r in rows:
        svc = r.service_name or "unknown"
        by_service[svc]["sessions"].add(r.session_id or "_")
        by_service[svc]["traces"] += 1
        by_service[svc]["tokens"] += r.total_tokens or 0
        by_service[svc]["trace_ids"].append(r.trace_id)
        if r.latency_ms:
            by_service[svc]["latencies"].append(r.latency_ms)
        payload = r.payload or {}
        if payload.get("status") == "error":
            by_service[svc]["errors"] += 1
        by_service[svc]["cost"] += payload.get("total_cost_usd", 0) or 0

    # Collect per-service span-level counts (llm, embedding, tool)
    all_trace_ids = [r.trace_id for r in rows]
    if all_trace_ids:
        try:
            from app.storage.mongodb import _get_db
            db = _get_db()
            # Build a trace_id -> service_name map
            tid_to_svc = {}
            for r in rows:
                tid_to_svc[r.trace_id] = r.service_name or "unknown"
            # Aggregate span counts by trace_id and kind
            pipeline = [
                {"$match": {"trace_id": {"$in": all_trace_ids}, "kind": {"$in": ["llm", "embedding", "tool"]}}},
                {"$group": {
                    "_id": {"trace_id": "$trace_id", "kind": "$kind"},
                    "count": {"$sum": 1},
                    "tokens": {"$sum": {
                        "$cond": [
                            {"$eq": ["$kind", "llm"]},
                            {"$add": [
                                {"$ifNull": ["$llm.input_tokens", 0]},
                                {"$ifNull": ["$llm.output_tokens", 0]}
                            ]},
                            {"$cond": [
                                {"$eq": ["$kind", "embedding"]},
                                {"$ifNull": ["$embedding.input_tokens", {"$ifNull": ["$embedding.token_count", 0]}]},
                                0
                            ]}
                        ]
                    }},
                    "cost": {"$sum": {
                        "$cond": [
                            {"$eq": ["$kind", "llm"]},
                            {"$ifNull": ["$llm.cost_usd", 0]},
                            {"$cond": [
                                {"$eq": ["$kind", "embedding"]},
                                {"$ifNull": ["$embedding.cost_usd", 0]},
                                0
                            ]}
                        ]
                    }},
                }},
            ]
            for doc in db["spans"].aggregate(pipeline):
                tid = doc["_id"]["trace_id"]
                kind = doc["_id"]["kind"]
                svc = tid_to_svc.get(tid, "unknown")
                if kind == "llm":
                    by_service[svc]["llm_calls"] += doc["count"]
                    by_service[svc]["llm_tokens"] += doc.get("tokens", 0) or 0
                    by_service[svc]["llm_cost"] += doc.get("cost", 0) or 0
                elif kind == "embedding":
                    by_service[svc]["embedding_calls"] += doc["count"]
                    by_service[svc]["embedding_tokens"] += doc.get("tokens", 0) or 0
                    by_service[svc]["embedding_cost"] += doc.get("cost", 0) or 0
        except Exception:
            pass  # Fallback: span counts remain 0

    agents = []
    for name, data in sorted(by_service.items()):
        lats = sorted(data["latencies"]) if data["latencies"] else [0]
        p95 = lats[int(len(lats) * 0.95)] if len(lats) > 1 else (lats[0] if lats else 0)
        traces = data["traces"]
        errors = data["errors"]
        agents.append({
            "name": name,
            "environment": product_id or "all",
            "sessions": len(data["sessions"]),
            "traces": traces,
            "errors": errors,
            "error_rate": round(errors / max(traces, 1) * 100, 2),
            "success_rate": round((traces - errors) / max(traces, 1) * 100, 2),
            "total_tokens": data["tokens"],
            "total_cost_usd": round(data["cost"], 6),
            "llm_calls": data["llm_calls"],
            "llm_tokens": data["llm_tokens"],
            "llm_cost_usd": round(data["llm_cost"], 6),
            "embedding_calls": data["embedding_calls"],
            "embedding_tokens": data["embedding_tokens"],
            "embedding_cost_usd": round(data["embedding_cost"], 6),
            "p95_latency_ms": round(p95, 2),
            "sub_agents": [],
        })

    def extract_sub_agents(spans):
        out = set()
        for s in spans:
            n = s.get("name", "")
            if ":" in n:
                out.add(n.split(":")[0])
            for c in s.get("children", []):
                out |= extract_sub_agents([c])
        return out

    for r in rows:
        payload = r.payload or {}
        subs = extract_sub_agents(payload.get("spans", []))
        for a in agents:
            if a["name"] == (r.service_name or "unknown"):
                a["sub_agents"] = sorted(set(a["sub_agents"]) | subs)

    total_traces = sum(a["traces"] for a in agents)
    total_sessions = sum(a["sessions"] for a in agents)
    total_errors = sum(a["errors"] for a in agents)
    return {
        "agents": agents,
        "overview": {
            "agents_count": len(agents),
            "sessions": total_sessions,
            "traces": total_traces,
            "error_rate": round(total_errors / total_traces * 100, 2) if total_traces else 0,
            "throttle_rate": 0,
        },
    }


@router.get("/agent-breakdown")
def get_agent_breakdown(
    product_id: Optional[str] = Query(None),
    trace_id: Optional[str] = Query(None),
    service_name: Optional[str] = Query(None),
    days: int = Query(30, le=365),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.get_per_agent_breakdown(product_id=product_id, trace_id=trace_id, service_name=service_name, days=days)


@router.get("/sessions")
def list_sessions(
    product_id: Optional[str] = Query(None),
    service_name: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    from app.storage import get_trace_store
    from collections import defaultdict
    store = get_trace_store()
    rows = store.get_all_traces(product_id=product_id)
    by_session = defaultdict(lambda: {"trace_count": 0, "total_latency_ms": 0.0, "agent": "", "tokens": 0, "cost": 0.0, "errors": 0})
    for r in rows:
        if not r.session_id:
            continue
        if service_name and r.service_name != service_name:
            continue
        key = r.session_id
        by_session[key]["trace_count"] += 1
        by_session[key]["total_latency_ms"] += r.latency_ms or 0
        by_session[key]["agent"] = r.service_name or "agent"
        by_session[key]["tokens"] += r.total_tokens or 0
        cost = getattr(r, "total_cost_usd", None)
        if cost is None:
            cost = (r.payload or {}).get("total_cost_usd", 0) or 0
        by_session[key]["cost"] += cost
        payload = r.payload or {}
        if payload.get("status") == "error":
            by_session[key]["errors"] += 1

    items = sorted(by_session.items(), key=lambda x: -x[1]["total_latency_ms"])[offset:offset + limit]
    return {
        "sessions": [
            {"session_id": k, "agent": v["agent"], "trace_count": v["trace_count"],
             "total_latency_ms": round(v["total_latency_ms"], 2), "total_tokens": v["tokens"],
             "total_cost_usd": round(v["cost"], 6), "errors": v["errors"]}
            for k, v in items
        ],
        "count": len(items),
        "total": len(by_session),
    }


@router.get("/sessions/{session_id}")
def get_session_detail(session_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    rows = store.get_all_traces(session_id=session_id)
    if not rows:
        raise HTTPException(status_code=404, detail="Session not found")
    traces = []
    total_tokens = 0
    total_cost = 0.0
    agent_name = None
    for r in rows:
        payload = r.payload or {}
        total_tokens += r.total_tokens or 0
        cost = getattr(r, "total_cost_usd", None)
        if cost is None:
            cost = payload.get("total_cost_usd", 0) or 0
        total_cost += cost
        if not agent_name and r.service_name:
            agent_name = r.service_name
        trace_cost = getattr(r, "total_cost_usd", None) or payload.get("total_cost_usd")
        traces.append({
            "trace_id": r.trace_id,
            "latency_ms": r.latency_ms,
            "total_tokens": r.total_tokens,
            "status": payload.get("status", "ok"),
            "total_cost_usd": trace_cost,
            "service_name": r.service_name,
            "created_at": r.created_at.isoformat() if r.created_at and hasattr(r.created_at, "isoformat") else None,
        })
    return {
        "session_id": session_id,
        "agent": agent_name or "agent",
        "trace_count": len(traces),
        "total_tokens": total_tokens,
        "total_cost_usd": round(total_cost, 6),
        "traces": traces,
    }


@router.get("/agents/{service_name}/metrics")
def get_agent_metrics(
    service_name: str,
    product_id: Optional[str] = Query(None),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    rows = store.get_all_traces(product_id=product_id)
    rows = [r for r in rows if r.service_name == service_name]
    if not rows:
        return {
            "sessions": 0, "traces": 0, "total_tokens": 0, "input_tokens": 0, "output_tokens": 0,
            "total_cost_usd": 0, "spans": [], "sub_agents": [], "errors": 0,
            "traces_by_date": [], "model_breakdown": [],
        }
    sessions = len(set(r.session_id for r in rows))
    total_tokens = sum(r.total_tokens or 0 for r in rows)
    total_cost = sum(
        getattr(r, "total_cost_usd", None) or (r.payload or {}).get("total_cost_usd", 0) or 0
        for r in rows
    )
    errors = sum(1 for r in rows if (r.payload or {}).get("status") == "error")

    span_stats, sub_agents, input_tokens, output_tokens = _collect_from_traces(rows)

    span_list = []
    for name, s in span_stats.items():
        lats = sorted(s["latencies"])
        p95 = lats[int(len(lats) * 0.95)] if lats else 0
        span_list.append({"span_name": name, "error_rate": 0, "p95_latency_ms": round(p95, 2), "count": s["count"]})

    sub_agent_list = [
        {"name": k, "llm_calls": v["llm_calls"], "input_tokens": v["input_tokens"],
         "output_tokens": v["output_tokens"], "latency_ms": round(v["latency_ms"], 2),
         "cost_usd": round(v.get("cost_usd", 0), 6)}
        for k, v in sorted(sub_agents.items())
    ]

    from collections import defaultdict
    by_date = defaultdict(lambda: {"traces": 0, "sessions": set()})
    for r in rows:
        d = r.created_at.strftime("%Y-%m-%d") if r.created_at and hasattr(r.created_at, "strftime") else "unknown"
        by_date[d]["traces"] += 1
        if r.session_id:
            by_date[d]["sessions"].add(r.session_id)
    traces_by_date = [{"date": d, "traces": v["traces"], "sessions": len(v["sessions"])} for d, v in sorted(by_date.items())]

    return {
        "sessions": sessions, "traces": len(rows), "total_tokens": total_tokens,
        "input_tokens": input_tokens, "output_tokens": output_tokens,
        "total_cost_usd": round(total_cost, 6), "errors": errors,
        "spans": sorted(span_list, key=lambda x: -x["p95_latency_ms"]),
        "sub_agents": sub_agent_list, "traces_by_date": traces_by_date,
    }


@router.post("/agents/{service_name}/send-report")
def send_agent_report(service_name: str, body: dict = Body(default={})):
    """Send an agent performance report to specified email addresses."""
    from app.email_alerts import build_agent_report_email, send_email
    recipient_emails = body.get("recipient_emails", [])
    if not recipient_emails:
        raise HTTPException(status_code=400, detail="recipient_emails required")

    product_id = body.get("product_id")
    period_days = body.get("period_days", 7)

    metrics = get_agent_metrics(service_name, product_id=product_id)
    subject, html, text = build_agent_report_email(service_name, metrics, period_days)
    result = send_email(recipient_emails, subject, html, text)
    return {"ok": result.get("ok", False), "detail": result.get("error", "Report sent")}


def _collect_from_traces(rows: list) -> tuple:
    span_stats = {}
    sub_agents: dict[str, dict] = {}
    input_tokens = 0
    output_tokens = 0

    def collect_spans(spans, prefix=""):
        nonlocal input_tokens, output_tokens
        for span in spans:
            name = span.get("name", "unknown")
            kind = span.get("kind", "chain")
            key = f"{prefix}{name}" if prefix else name
            start = span.get("start_time_ns", 0) or 0
            end = span.get("end_time_ns", 0) or 0
            lat = span.get("duration_ms") or ((end - start) / 1e6 if end and start else 0)
            if key not in span_stats:
                span_stats[key] = {"count": 0, "latencies": []}
            span_stats[key]["count"] += 1
            span_stats[key]["latencies"].append(lat)

            llm_data = span.get("llm") or {}
            if llm_data or kind == "llm":
                inp = llm_data.get("input_tokens", 0) or 0
                out = llm_data.get("output_tokens", 0) or 0
                input_tokens += inp
                output_tokens += out
                agent_name = name.split(":")[0] if ":" in name else name
                if agent_name not in sub_agents:
                    sub_agents[agent_name] = {"llm_calls": 0, "input_tokens": 0, "output_tokens": 0, "latency_ms": 0, "cost_usd": 0}
                sub_agents[agent_name]["llm_calls"] += 1
                sub_agents[agent_name]["input_tokens"] += inp
                sub_agents[agent_name]["output_tokens"] += out
                sub_agents[agent_name]["latency_ms"] += lat
                sub_agents[agent_name]["cost_usd"] += llm_data.get("cost_usd", 0) or 0

            for evt in span.get("events", []):
                a = evt.get("attributes", {})
                inp_e = int(a.get("input_tokens", 0) or 0)
                out_e = int(a.get("output_tokens", 0) or 0)
                input_tokens += inp_e
                output_tokens += out_e

            for c in span.get("children", []):
                collect_spans([c], f"{key}/")

    for r in rows:
        payload = r.payload or {}
        collect_spans(payload.get("spans", []))

    return span_stats, sub_agents, input_tokens, output_tokens


@router.get("/dashboards")
def list_dashboards(product_id: Optional[str] = Query(None)) -> dict:
    from app.storage import get_dashboard_store
    store = get_dashboard_store()
    return {"dashboards": store.list_dashboards(product_id=product_id)}


@router.post("/dashboards")
def create_dashboard(payload: DashboardPayload) -> dict:
    from app.storage import get_dashboard_store
    store = get_dashboard_store()
    return store.create_dashboard(payload.name, payload.product_id or "default", payload.description, payload.layout or {})


@router.get("/dashboards/{dashboard_id}")
def get_dashboard(dashboard_id: str) -> dict:
    from app.storage import get_dashboard_store
    store = get_dashboard_store()
    d = store.get_dashboard(dashboard_id)
    if not d:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return d


@router.put("/dashboards/{dashboard_id}")
def update_dashboard(dashboard_id: str, payload: DashboardPayload) -> dict:
    from app.storage import get_dashboard_store
    store = get_dashboard_store()
    ok = store.update_dashboard(dashboard_id, name=payload.name, layout=payload.layout, description=payload.description)
    if not ok:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return {"ok": True}


@router.delete("/dashboards/{dashboard_id}")
def delete_dashboard(dashboard_id: str) -> dict:
    from app.storage import get_dashboard_store
    store = get_dashboard_store()
    ok = store.delete_dashboard(dashboard_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    return {"ok": True}


@router.get("/graph/health")
def graph_health() -> dict:
    import httpx
    try:
        resp = httpx.get("http://localhost:9000/graph/health", timeout=5.0)
        if resp.status_code == 200:
            return resp.json()
        return {"status": "degraded", "detail": f"demand-draft-service returned {resp.status_code}"}
    except Exception as e:
        return {"status": "unavailable", "detail": str(e)}


@router.get("/graph/metrics")
def graph_metrics(case_id: Optional[str] = Query(None)) -> dict:
    import httpx
    try:
        params = {}
        if case_id:
            params["case_id"] = case_id
        resp = httpx.get("http://localhost:9000/graph/metrics", params=params, timeout=10.0)
        if resp.status_code == 200:
            return resp.json()
        return {"error": f"demand-draft-service returned {resp.status_code}"}
    except Exception as e:
        return {"error": str(e)}


class PipelinePayload(BaseModel):
    product_id: str
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    parallel_groups: list[list[str]] = []


@router.post("/pipelines")
def register_pipeline(payload: PipelinePayload) -> dict:
    from app.storage import get_pipeline_store
    store = get_pipeline_store()
    return store.upsert_pipeline(payload.product_id, payload.dict())


@router.get("/pipelines")
def list_pipelines() -> dict:
    from app.storage import get_pipeline_store
    store = get_pipeline_store()
    return {"pipelines": store.list_pipelines()}


@router.get("/pipelines/{product_id}")
def get_pipeline(product_id: str) -> dict:
    from app.storage import get_pipeline_store
    store = get_pipeline_store()
    result = store.get_pipeline(product_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"No pipeline registered for '{product_id}'")
    return result


@router.get("/agent-architecture")
def get_agent_architecture(product_id: Optional[str] = Query(None)) -> dict:
    """Return the agent architecture for a project.

    **Primary source**: the architecture registered via the SDK
    (``POST /pipelines``).  This is the canonical graph that the
    integrating project declares — nodes, edges, parallel groups.

    **Enrichment**: trace data is used *only* to add runtime statistics
    (transition counts / rates, assessment scores) to the registered
    nodes & edges.  The graph topology itself always comes from the
    registration.

    **Fallback**: if no architecture has been registered yet, the
    endpoint falls back to discovering agents from trace spans (legacy
    behaviour) so the page isn't blank for projects that haven't
    adopted ``register_agent_architecture`` yet.
    """
    from app.storage import get_pipeline_store, get_trace_store
    from collections import defaultdict

    store = get_trace_store()

    # ── Helper: collect trace-based stats for enrichment ────────────
    def _collect_trace_stats(product_id_filter):
        """Scan agent spans to build transition counts + assessments."""
        order_counts = defaultdict(lambda: defaultdict(int))
        spans_by_trace = defaultdict(list)
        agent_names = set()
        pg = defaultdict(lambda: defaultdict(int))
        total = 0
        try:
            from app.storage.mongodb import _get_db
            db = _get_db()
            span_q = {"kind": "agent"}
            if product_id_filter:
                tids = [
                    t["trace_id"]
                    for t in db["traces"].find(
                        {"product_id": product_id_filter}, {"trace_id": 1}
                    ).limit(2000)
                ]
                span_q["trace_id"] = {"$in": tids} if tids else {"$in": []}
                total = len(tids)

            for sp in db["spans"].find(span_q).limit(50000):
                name = _clean_agent_name(sp.get("name", ""))
                if not name:
                    continue
                agent_names.add(name)
                spans_by_trace[sp.get("trace_id", "")].append(sp)

            for _tid, slist in spans_by_trace.items():
                slist.sort(key=lambda s: s.get("start_time_ns", 0) or 0)
                prev = None
                for sp in slist:
                    n = _clean_agent_name(sp.get("name", ""))
                    if not n:
                        continue
                    if prev and prev != n:
                        order_counts[prev][n] += 1
                    prev = n
                _detect_parallel_spans(slist, pg)

            # Assessments per agent
            assessments = {}
            for name in agent_names:
                atids = set()
                for _tid, slist in spans_by_trace.items():
                    for sp in slist:
                        if _clean_agent_name(sp.get("name", "")) == name:
                            atids.add(_tid)
                if atids:
                    pipe = [
                        {"$match": {"trace_id": {"$in": list(atids)[:200]}}},
                        {"$group": {
                            "_id": "$key",
                            "total": {"$sum": 1},
                            "true_count": {"$sum": {"$cond": [{"$eq": ["$value", "True"]}, 1, 0]}},
                        }},
                    ]
                    for doc in db["feedback"].aggregate(pipe):
                        assessments.setdefault(name, {})[doc["_id"]] = {
                            "total": doc["total"],
                            "true_count": doc["true_count"],
                            "true_pct": round(doc["true_count"] / doc["total"] * 100, 1) if doc["total"] else 0,
                        }
        except Exception:
            pass
        return order_counts, agent_names, pg, assessments, total

    # ── 1. Try registered pipeline (primary source) ─────────────────
    registered = None
    if product_id:
        try:
            pstore = get_pipeline_store()
            registered = pstore.get_pipeline(product_id)
        except Exception:
            pass

    if registered and registered.get("nodes"):
        nodes = registered["nodes"]
        edges = registered.get("edges", [])
        parallel_sets = registered.get("parallel_groups", [])
        node_ids = {n["id"] for n in nodes}

        order_counts, _, _, assessments, total_traces = _collect_trace_stats(product_id)

        routing_stats = {}
        for source, targets in order_counts.items():
            total_transitions = sum(targets.values())
            routing_stats[source] = {}
            for target, count in targets.items():
                rate = round(count / total_transitions * 100, 1) if total_transitions > 0 else 0
                routing_stats[source][target] = {"count": count, "rate": rate}

        for e in edges:
            src, tgt = e.get("source", ""), e.get("target", "")
            stats = routing_stats.get(src, {}).get(tgt, {})
            if stats:
                e["label"] = f"{stats['count']}x ({stats['rate']}%)"
                e["transition_count"] = stats["count"]
                e["transition_rate"] = stats["rate"]

        for n in nodes:
            n["assessments"] = assessments.get(n["id"], {})

        return {
            "nodes": nodes,
            "edges": edges,
            "parallel_groups": parallel_sets,
            "routing_stats": routing_stats,
            "total_traces": total_traces,
            "product_id": product_id,
            "source": "registered",
        }

    # ── 2. Fallback: discover from traces (legacy) ──────────────────
    agent_order_counts = defaultdict(lambda: defaultdict(int))
    agent_set = set()
    agent_types = {}
    parallel_groups = defaultdict(lambda: defaultdict(int))
    agent_spans_by_trace = defaultdict(list)

    try:
        from app.storage.mongodb import _get_db
        db = _get_db()
        span_query = {"kind": "agent"}
        if product_id:
            trace_ids = [
                t["trace_id"]
                for t in db["traces"].find(
                    {"product_id": product_id}, {"trace_id": 1}
                ).limit(2000)
            ]
            span_query["trace_id"] = {"$in": trace_ids} if trace_ids else {"$in": []}

        for sp in db["spans"].find(span_query).limit(50000):
            name = _clean_agent_name(sp.get("name", ""))
            if not name:
                continue
            agent_set.add(name)
            raw_name = sp.get("name", "")
            kind = sp.get("kind", "agent")
            if "graph:" in raw_name:
                agent_types[name] = "tool"
            elif kind == "llm" or sp.get("llm"):
                agent_types[name] = "llm"
            else:
                agent_types.setdefault(name, "agent")
            agent_spans_by_trace[sp.get("trace_id", "")].append(sp)

        for _tid, spans_list in agent_spans_by_trace.items():
            spans_list.sort(key=lambda s: s.get("start_time_ns", 0) or 0)
            prev_name = None
            for sp in spans_list:
                name = _clean_agent_name(sp.get("name", ""))
                if not name:
                    continue
                if prev_name and prev_name != name:
                    agent_order_counts[prev_name][name] += 1
                prev_name = name
            _detect_parallel_spans(spans_list, parallel_groups)
    except Exception:
        pass

    rows = store.get_all_traces(product_id=product_id)
    for r in rows:
        payload = r.payload or {}
        spans = payload.get("spans", [])
        embedded_agent_spans = _extract_agent_spans_flat(spans)
        if not embedded_agent_spans:
            continue

        embedded_agent_spans.sort(key=lambda s: s.get("start_time_ns", 0) or 0)
        for sp in embedded_agent_spans:
            name = _clean_agent_name(sp.get("name", ""))
            if name:
                agent_set.add(name)
                raw_name = sp.get("name", "")
                kind = sp.get("kind", "agent")
                if "graph:" in raw_name:
                    agent_types[name] = "tool"
                elif kind == "llm" or "llm" in sp:
                    agent_types[name] = "llm"
                else:
                    agent_types.setdefault(name, "agent")

        prev_name = None
        for sp in embedded_agent_spans:
            name = _clean_agent_name(sp.get("name", ""))
            if not name:
                continue
            if prev_name and prev_name != name:
                agent_order_counts[prev_name][name] += 1
            prev_name = name

        _detect_parallel_spans(embedded_agent_spans, parallel_groups)

    if not agent_set:
        return {"nodes": [], "edges": [], "product_id": product_id or "all", "source": "none"}

    nodes = []
    for name in sorted(agent_set):
        node_type = agent_types.get(name, "agent")
        nodes.append({
            "id": name,
            "label": _format_agent_label(name),
            "type": node_type,
        })

    edges = []
    seen_edges = set()
    for source, targets in agent_order_counts.items():
        for target, count in targets.items():
            if count >= 1 and (source, target) not in seen_edges:
                is_parallel = False
                for group_key, members in parallel_groups.items():
                    if source in members or target in members:
                        is_parallel = True
                        break
                edges.append({
                    "source": source,
                    "target": target,
                    "count": count,
                    "type": "parallel" if is_parallel else "sequential",
                })
                seen_edges.add((source, target))

    parallel_sets = []
    for group_key, members in parallel_groups.items():
        agent_names = [_clean_agent_name(m) for m in members if _clean_agent_name(m)]
        if len(agent_names) >= 2:
            parallel_sets.append(sorted(agent_names))

    total_traces = len(rows) if rows else 0

    routing_stats = {}
    for source, targets in agent_order_counts.items():
        total_transitions = sum(targets.values())
        routing_stats[source] = {}
        for target, count in targets.items():
            rate = round(count / total_transitions * 100, 1) if total_transitions > 0 else 0
            routing_stats[source][target] = {"count": count, "rate": rate}

    for e in edges:
        src = e.get("source", "")
        tgt = e.get("target", "")
        stats = routing_stats.get(src, {}).get(tgt, {})
        e["label"] = f"{stats.get('count', e.get('count', 0))}x ({stats.get('rate', 0)}%)"
        e["transition_count"] = stats.get("count", e.get("count", 0))
        e["transition_rate"] = stats.get("rate", 0)

    agent_assessments = {}
    try:
        for name in agent_set:
            agent_tids = set()
            for _tid, spans_list in agent_spans_by_trace.items():
                for sp in spans_list:
                    if _clean_agent_name(sp.get("name", "")) == name:
                        agent_tids.add(_tid)
            if agent_tids:
                fb_pipeline = [
                    {"$match": {"trace_id": {"$in": list(agent_tids)[:200]}}},
                    {"$group": {
                        "_id": "$key",
                        "total": {"$sum": 1},
                        "true_count": {"$sum": {"$cond": [{"$eq": ["$value", "True"]}, 1, 0]}},
                    }},
                ]
                for doc in db["feedback"].aggregate(fb_pipeline):
                    if name not in agent_assessments:
                        agent_assessments[name] = {}
                    total = doc["total"]
                    true_count = doc["true_count"]
                    agent_assessments[name][doc["_id"]] = {
                        "total": total,
                        "true_count": true_count,
                        "true_pct": round(true_count / total * 100, 1) if total else 0,
                    }
    except Exception:
        pass

    for n in nodes:
        n["assessments"] = agent_assessments.get(n["id"], {})

    return {
        "nodes": nodes,
        "edges": edges,
        "parallel_groups": parallel_sets,
        "routing_stats": routing_stats,
        "total_traces": total_traces,
        "product_id": product_id or "all",
        "source": "traces",
    }


def _extract_agent_spans_flat(spans, depth=0):
    result = []
    for sp in (spans or []):
        name = sp.get("name", "")
        if name.startswith("agent:") or name.startswith("graph:") or sp.get("kind") == "agent":
            result.append(sp)
        for child in sp.get("children", []):
            result.extend(_extract_agent_spans_flat([child], depth + 1))
    return result


def _clean_agent_name(name):
    if not name:
        return ""
    if ":" in name:
        parts = name.split(":", 1)
        return parts[1].strip()
    return name.strip()


def _format_agent_label(name):
    return " ".join(w.capitalize() for w in name.replace("_", " ").split())


def _detect_parallel_spans(agent_spans, parallel_groups):
    if len(agent_spans) < 2:
        return
    TIME_OVERLAP_THRESHOLD_MS = 500
    for i in range(len(agent_spans)):
        for j in range(i + 1, len(agent_spans)):
            sp_a = agent_spans[i]
            sp_b = agent_spans[j]
            start_a = sp_a.get("start_time_ns", 0) or 0
            start_b = sp_b.get("start_time_ns", 0) or 0
            end_a = sp_a.get("end_time_ns", 0) or 0
            end_b = sp_b.get("end_time_ns", 0) or 0
            if start_a and start_b and end_a and end_b:
                overlap_start = max(start_a, start_b)
                overlap_end = min(end_a, end_b)
                if overlap_end > overlap_start:
                    overlap_ms = (overlap_end - overlap_start) / 1e6
                    if overlap_ms > TIME_OVERLAP_THRESHOLD_MS:
                        name_a = sp_a.get("name", "")
                        name_b = sp_b.get("name", "")
                        group_key = tuple(sorted([name_a, name_b]))
                        parallel_groups[group_key][name_a] += 1
                        parallel_groups[group_key][name_b] += 1


# ── Evaluations ──────────────────────────────────────────────────────

class EvaluationPayload(BaseModel):
    trace_id: str
    product_id: Optional[str] = "default"
    agent_name: str
    section: Optional[str] = ""
    overall_score: float
    pass_fail: bool = True
    category_scores: Optional[list] = []
    revision_count: Optional[int] = 0
    deficiencies: Optional[list] = []
    strengths: Optional[list] = []
    summary: Optional[str] = ""


@router.post("/evaluations")
def store_evaluation(payload: EvaluationPayload) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.store_evaluation(payload.dict())


@router.get("/evaluations")
def list_evaluations(
    agent_name: Optional[str] = Query(None),
    product_id: Optional[str] = Query(None),
    trace_id: Optional[str] = Query(None),
    days: int = Query(30, le=365),
    limit: int = Query(200, le=1000),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    evals = store.get_evaluations(agent_name=agent_name, product_id=product_id,
                                  trace_id=trace_id, days=days, limit=limit)
    return {"evaluations": evals, "count": len(evals)}


@router.get("/evaluations/trends")
def evaluation_trends(
    product_id: Optional[str] = Query(None),
    days: int = Query(30, le=365),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.get_evaluation_trends(product_id=product_id, days=days)


# ── Evaluators (Evaluation Framework) ─────────────────────────────────

@router.get("/evaluators")
def list_evaluators(
    type: Optional[str] = Query(None),
    category: Optional[str] = Query(None),
    enabled: bool = Query(True),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    docs = store.list_evaluators(evaluator_type=type, enabled_only=enabled, category=category)
    return {"evaluators": docs, "count": len(docs)}


@router.get("/evaluators/templates")
def get_evaluator_templates() -> dict:
    from app.evaluation_engine import EVALUATOR_TEMPLATES, TEMPLATE_VARIABLES
    return {
        "templates": EVALUATOR_TEMPLATES,
        "variables": TEMPLATE_VARIABLES,
    }


@router.post("/evaluators")
def create_evaluator(body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    import uuid
    store = get_trace_store()
    body.setdefault("evaluator_id", f"custom.{uuid.uuid4().hex[:10]}")
    body.setdefault("type", "custom")
    body.setdefault("is_builtin", False)
    return store.create_evaluator(body)


@router.put("/evaluators/{evaluator_id}")
def update_evaluator(evaluator_id: str, body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.update_evaluator(evaluator_id, body)


@router.delete("/evaluators/{evaluator_id}")
def delete_evaluator(evaluator_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.delete_evaluator(evaluator_id)


@router.post("/evaluators/{evaluator_id}/test")
def test_evaluator(evaluator_id: str, body: dict = Body(...)) -> dict:
    """Run evaluator on a single trace and return sample output.

    Accepts optional ``config_override`` so the UI can test unsaved
    form changes (rubric, model, output_type, etc.) without having to
    save first.  Also returns ``trace_context`` so the UI can display
    the resolved trace details the judge actually received.
    """
    from app.storage import get_trace_store
    store = get_trace_store()

    evaluator = store.get_evaluator(evaluator_id)
    if not evaluator:
        raise HTTPException(status_code=404, detail="Evaluator not found")

    config_override = body.get("config_override")
    if config_override and isinstance(config_override, dict):
        merged = dict(evaluator.get("config", {}))
        merged.update(config_override)
        evaluator = dict(evaluator)
        evaluator["config"] = merged

    trace_id = body.get("trace_id")
    if not trace_id:
        raise HTTPException(status_code=400, detail="trace_id required")

    trace = store.get(trace_id)
    if not trace:
        raise HTTPException(status_code=404, detail="Trace not found")

    try:
        from app.evaluation_engine import TraceContext, run_single_evaluator
        context = TraceContext.from_trace_dict(trace)

        trace_context_info = {
            "trace_id": context.trace_id,
            "service_name": context.service_name,
            "status": context.status,
            "latency_ms": context.latency_ms,
            "total_tokens": context.total_tokens,
            "total_cost_usd": context.total_cost_usd,
            "llm_calls": context.llm_calls,
            "final_input": context.final_input or "",
            "final_output": context.final_output or "",
            "llm_span_count": len(context.llm_spans),
            "tool_span_count": len(context.tool_spans),
            "retriever_span_count": len(context.retriever_spans),
            "total_span_count": len(context.spans),
            "tool_calls": [
                {"name": s.get("name", "?"), "status": s.get("status", "ok"),
                 "input": str(s.get("inputs", "")),
                 "output": str(s.get("outputs", s.get("output", "")))}
                for s in context.tool_spans
            ],
            "llm_models": list({
                (s.get("llm") or {}).get("model", "unknown")
                for s in context.llm_spans
            }),
            "retriever_queries": [
                {"query": str((s.get("retriever") or {}).get("query", "")),
                 "doc_count": len((s.get("retriever") or {}).get("documents") or s.get("documents") or []),
                 "documents": (s.get("retriever") or {}).get("documents") or s.get("documents") or []}
                for s in context.retriever_spans
            ],
        }

        result = run_single_evaluator(evaluator, context)
        return {"ok": True, "result": result, "trace_context": trace_context_info}
    except Exception as e:
        import traceback
        logger.error("test_evaluator failed: %s", traceback.format_exc())
        return {"ok": False, "error": str(e)}


@router.put("/evaluators/{evaluator_id}/monitor")
def set_evaluator_monitor(evaluator_id: str, body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    evaluator = store.get_evaluator(evaluator_id)
    if not evaluator:
        raise HTTPException(status_code=404, detail="Evaluator not found")
    # Use evaluator_config from body, or current evaluator config when enabling
    evaluator_config = body.get("evaluator_config")
    if evaluator_config is None and body.get("enabled", False):
        evaluator_config = evaluator.get("config") or {}
    return store.set_judge_monitor_config(
        evaluator_id=evaluator_id,
        enabled=body.get("enabled", False),
        sample_rate=body.get("sample_rate", 100),
        filters=body.get("filters", {}),
        evaluator_config=evaluator_config,
    )


@router.get("/evaluators/{evaluator_id}/monitor")
def get_evaluator_monitor(evaluator_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    config = store.get_judge_monitor_config(evaluator_id)
    if not config:
        return {"evaluator_id": evaluator_id, "enabled": False, "sample_rate": 100, "filters": {}}
    return config


@router.post("/evaluators/{evaluator_id}/run-on-traces")
def run_evaluator_on_traces(evaluator_id: str, body: dict = Body(...)) -> dict:
    """Run evaluator on selected trace_ids in parallel and return results."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from app.storage import get_trace_store
    from app.evaluation_engine import TraceContext, run_single_evaluator
    store = get_trace_store()

    evaluator = store.get_evaluator(evaluator_id)
    if not evaluator:
        raise HTTPException(status_code=404, detail="Evaluator not found")

    config_override = body.get("evaluator_config") or body.get("config_override")
    if config_override and isinstance(config_override, dict):
        cfg = dict(evaluator.get("config") or {})
        cfg.update(config_override)
        evaluator = dict(evaluator, config=cfg)
        logger.debug("run_evaluator_on_traces: using evaluator_config override for %s", evaluator_id)

    trace_ids = body.get("trace_ids", [])
    logger.debug(
        "run_evaluator_on_traces: evaluator=%s evaluator_id=%s trace_ids=%s count=%d",
        evaluator.get("name"), evaluator_id, trace_ids[:5] if len(trace_ids) > 5 else trace_ids,
        len(trace_ids),
    )
    if not trace_ids:
        raise HTTPException(status_code=400, detail="trace_ids required")

    max_workers = min(body.get("max_workers", 8), 16, len(trace_ids))

    evaluated_trace_ids = []

    def _evaluate_single(tid):
        trace = store.get(tid)
        if not trace:
            return {"trace_id": tid, "error": "not found"}
        try:
            context = TraceContext.from_trace_dict(trace)
            result = run_single_evaluator(evaluator, context)
            result["trace_id"] = tid
            store.add_feedback(
                trace_id=tid,
                key=evaluator.get("name", evaluator_id),
                score=result.get("score"),
                value="True" if result.get("passed", result.get("score", 0) >= 50) else "False",
                comment=result.get("reasoning", ""),
                source="judge",
            )
            evaluated_trace_ids.append(tid)
            return result
        except Exception as e:
            return {"trace_id": tid, "error": str(e)}

    results = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_evaluate_single, tid): tid for tid in trace_ids}
        for future in as_completed(futures):
            results.append(future.result())

    for tid in evaluated_trace_ids:
        try:
            trace_doc = store.get(tid)
            if trace_doc:
                _evaluate_alert_rules_for_trace(store, tid, trace_doc)
        except Exception:
            pass

    passed = sum(1 for r in results if r.get("passed") or (r.get("score", 0) >= 50 and "error" not in r))
    logger.debug(
        "run_evaluator_on_traces DONE: evaluator=%s total=%d passed=%d pass_rate=%.1f%% results=%s",
        evaluator.get("name"), len(results), passed,
        round(passed / len(results) * 100, 1) if results else 0,
        [(r.get("trace_id", "")[:8], r.get("passed"), r.get("score"), r.get("error", "")) for r in results[:5]],
    )
    return {
        "ok": True,
        "total": len(results),
        "passed": passed,
        "pass_rate": round(passed / len(results) * 100, 1) if results else 0,
        "results": results,
    }


@router.post("/evaluators/{evaluator_id}/run-on-all-traces")
def run_evaluator_on_all_traces(evaluator_id: str, body: dict = Body(default={})) -> dict:
    """Run evaluator across all traces matching filters. Executes in parallel."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from app.storage import get_trace_store
    from app.evaluation_engine import TraceContext, run_single_evaluator
    store = get_trace_store()

    evaluator = store.get_evaluator(evaluator_id)
    if not evaluator:
        raise HTTPException(status_code=404, detail="Evaluator not found")

    config_override = body.get("evaluator_config") or body.get("config_override")
    if config_override and isinstance(config_override, dict):
        merged = dict(evaluator.get("config") or {})
        merged.update(config_override)
        evaluator = {**evaluator, "config": merged}
        logger.debug("run_evaluator_on_all_traces: using evaluator_config override for %s", evaluator_id)

    product_id = body.get("product_id")
    limit = min(body.get("limit", 200), 1000)
    logger.debug(
        "run_evaluator_on_all_traces: evaluator=%s evaluator_id=%s product_id=%s limit=%d",
        evaluator.get("name"), evaluator_id, product_id, limit,
    )
    max_workers = min(body.get("max_workers", 8), 16)

    trace_list = store.list_traces(product_id=product_id, limit=limit)
    trace_ids = [t["trace_id"] for t in trace_list.get("traces", [])]
    if not trace_ids:
        return {"ok": True, "total": 0, "passed": 0, "pass_rate": 0, "results": []}

    evaluated_trace_ids = []

    def _evaluate_single(tid):
        trace = store.get(tid)
        if not trace:
            return {"trace_id": tid, "error": "not found"}
        try:
            context = TraceContext.from_trace_dict(trace)
            result = run_single_evaluator(evaluator, context)
            result["trace_id"] = tid
            store.add_feedback(
                trace_id=tid,
                key=evaluator.get("name", evaluator_id),
                score=result.get("score"),
                value="True" if result.get("passed", result.get("score", 0) >= 50) else "False",
                comment=result.get("reasoning", ""),
                source="judge",
            )
            evaluated_trace_ids.append(tid)
            return result
        except Exception as e:
            return {"trace_id": tid, "error": str(e)}

    results = []
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        futures = {executor.submit(_evaluate_single, tid): tid for tid in trace_ids}
        for future in as_completed(futures):
            results.append(future.result())

    for tid in evaluated_trace_ids:
        try:
            trace_doc = store.get(tid)
            if trace_doc:
                _evaluate_alert_rules_for_trace(store, tid, trace_doc)
        except Exception:
            pass

    passed = sum(1 for r in results if r.get("passed") or (r.get("score", 0) >= 50 and "error" not in r))
    logger.debug(
        "run_evaluator_on_all_traces DONE: evaluator=%s total=%d passed=%d pass_rate=%.1f%% trace_ids_sample=%s",
        evaluator.get("name"), len(results), passed,
        round(passed / len(results) * 100, 1) if results else 0,
        [r.get("trace_id", "")[:8] for r in results[:5]],
    )
    return {
        "ok": True,
        "total": len(results),
        "passed": passed,
        "pass_rate": round(passed / len(results) * 100, 1) if results else 0,
        "results": results,
    }


# ── Evaluation Runs (Evaluation Framework) ────────────────────────────

@router.post("/evaluations/run")
def trigger_evaluation_run(body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    from app.evaluation_engine import run_evaluation
    store = get_trace_store()
    trace_id = body.get("trace_id") or None
    evaluator_ids = body.get("evaluator_ids", [])
    dataset_id = body.get("dataset_id") or None
    product_id = body.get("product_id", "default")
    evaluator_configs = body.get("evaluator_configs", {})
    logger.debug(
        "trigger_evaluation_run: evaluator_ids=%s dataset_id=%s trace_id=%s evaluator_configs_keys=%s",
        evaluator_ids, dataset_id, trace_id, list(evaluator_configs.keys()) if evaluator_configs else [],
    )
    result = run_evaluation(
        store,
        trace_id=trace_id,
        evaluator_ids=evaluator_ids,
        dataset_id=dataset_id,
        product_id=product_id,
        evaluator_configs=evaluator_configs,
    )
    return result


@router.post("/evaluations/run-conversation")
def trigger_conversation_evaluation(body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    from app.evaluation_engine import run_conversation_evaluation
    store = get_trace_store()
    session_id = body.get("session_id")
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    evaluator_ids = body.get("evaluator_ids", [])
    evaluator_configs = body.get("evaluator_configs") or {}
    product_id = body.get("product_id", "default")
    logger.debug(
        "trigger_conversation_evaluation: session_id=%s evaluator_ids=%s evaluator_configs_keys=%s",
        session_id, evaluator_ids, list(evaluator_configs.keys()) if evaluator_configs else [],
    )
    result = run_conversation_evaluation(
        store,
        session_id=session_id,
        evaluator_ids=evaluator_ids,
        evaluator_configs=evaluator_configs,
        product_id=product_id,
    )
    return result


@router.get("/evaluations/runs")
def list_evaluation_runs(
    product_id: Optional[str] = Query(None),
    trace_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, le=500),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    docs = store.list_evaluation_runs(
        product_id=product_id, trace_id=trace_id, status=status, limit=limit,
    )
    return {"runs": docs, "count": len(docs)}


@router.get("/evaluations/runs/stats")
def evaluation_run_stats(
    product_id: Optional[str] = Query(None),
    days: int = Query(30, le=365),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.get_evaluation_run_stats(product_id=product_id, days=days)


@router.get("/evaluations/runs/{run_id}")
def get_evaluation_run(run_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    doc = store.get_evaluation_run(run_id)
    if not doc:
        return {"error": "not found"}
    return doc


def _evaluation_results_to_scores(run_results: list) -> dict:
    """Convert run['results'] (list of evaluator dicts) to scores dict for UI."""
    scores = {}
    for r in run_results:
        eid = r.get("evaluator_id", "")
        if not eid:
            continue
        scores[eid] = {
            "score": r.get("score", 0),
            "passed": r.get("passed"),
            "reasoning": r.get("reasoning", ""),
        }
    return scores


@router.get("/evaluations/runs/{run_id}/traces")
def get_evaluation_run_traces(run_id: str) -> dict:
    """Get traces within an evaluation run with their assessment columns."""
    from app.storage import get_trace_store
    store = get_trace_store()
    run = store.get_evaluation_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Evaluation run not found")

    run_results = run.get("results", [])
    mode = run.get("mode", "")
    aggregate_score = run.get("aggregate_score", 0)
    aggregate_passed = run.get("aggregate_passed", False)
    scores_dict = _evaluation_results_to_scores(run_results)

    # Conversation run: results are per-evaluator (no trace_id). Build rows from session traces.
    if mode == "conversation":
        session_id = run.get("session_id", "")
        if not session_id:
            return {"run_id": run_id, "traces": [], "count": 0}
        # Get trace IDs in this session (same order as evaluation)
        trace_docs = list(
            store._traces.find({"session_id": session_id})
            .sort("created_at", 1)
            .limit(200)
        )
        enriched = []
        for tdoc in trace_docs:
            tid = tdoc.get("trace_id", "")
            entry = {
                "trace_id": tid,
                "scores": scores_dict,
                "passed": aggregate_passed,
                "aggregate_score": aggregate_score,
            }
            trace = store.get(tid) if tid else None
            if trace:
                entry["request"] = store._extract_trace_request(trace)
                entry["response"] = store._extract_trace_response(trace)
                entry["status"] = trace.get("status", "ok")
                entry["latency_ms"] = trace.get("latency_ms", 0)
            else:
                entry["request"] = ""
                entry["response"] = ""
                entry["status"] = "unknown"
                entry["latency_ms"] = 0
            enriched.append(entry)
        return {"run_id": run_id, "traces": enriched, "count": len(enriched)}

    # Single-trace (on_demand) run: run has top-level trace_id, results are per-evaluator.
    if run.get("trace_id"):
        tid = run["trace_id"]
        entry = {
            "trace_id": tid,
            "scores": scores_dict,
            "passed": aggregate_passed,
            "aggregate_score": aggregate_score,
        }
        trace = store.get(tid) if tid else None
        if trace:
            entry["request"] = store._extract_trace_request(trace)
            entry["response"] = store._extract_trace_response(trace)
            entry["status"] = trace.get("status", "ok")
            entry["latency_ms"] = trace.get("latency_ms", 0)
        else:
            entry["request"] = ""
            entry["response"] = ""
            entry["status"] = "unknown"
            entry["latency_ms"] = 0
        return {"run_id": run_id, "traces": [entry], "count": 1}

    # Legacy: each result has trace_id (e.g. dataset aggregate format).
    enriched = []
    for r in run_results:
        tid = r.get("trace_id", "")
        entry = {
            "trace_id": tid,
            "scores": r.get("scores", {}) or scores_dict,
            "passed": r.get("passed", aggregate_passed),
            "aggregate_score": r.get("aggregate_score", aggregate_score),
        }
        trace = store.get(tid) if tid else None
        if trace:
            entry["request"] = store._extract_trace_request(trace)
            entry["response"] = store._extract_trace_response(trace)
            entry["status"] = trace.get("status", "ok")
            entry["latency_ms"] = trace.get("latency_ms", 0)
        else:
            entry["request"] = ""
            entry["response"] = ""
            entry["status"] = "unknown"
            entry["latency_ms"] = 0
        enriched.append(entry)
    return {"run_id": run_id, "traces": enriched, "count": len(enriched)}


@router.get("/evaluations/compare")
def compare_evaluation_runs(
    run_id_a: str = Query(...),
    run_id_b: str = Query(...),
) -> dict:
    """Compare two evaluation runs side-by-side with per-evaluator aggregates and % change."""
    from app.storage import get_trace_store
    store = get_trace_store()

    run_a = store.get_evaluation_run(run_id_a)
    run_b = store.get_evaluation_run(run_id_b)
    if not run_a or not run_b:
        raise HTTPException(status_code=404, detail="One or both runs not found")

    def aggregate_run(run):
        results = run.get("results", [])
        per_evaluator = {}
        for r in results:
            if r.get("scores") and isinstance(r["scores"], dict):
                for k, v in r["scores"].items():
                    if isinstance(v, (int, float)):
                        per_evaluator.setdefault(k, []).append(v)
            elif r.get("evaluator_name") and isinstance(r.get("score"), (int, float)):
                per_evaluator.setdefault(r["evaluator_name"], []).append(r["score"])

        aggregates = {}
        for k, vals in per_evaluator.items():
            aggregates[k] = round(sum(vals) / len(vals), 2) if vals else 0

        item_count = len(run.get("item_results", []))
        return {
            "run_id": run.get("run_id"),
            "trace_count": len(results),
            "item_count": item_count,
            "aggregate_score": run.get("aggregate_score", 0),
            "per_scorer": aggregates,
        }

    agg_a = aggregate_run(run_a)
    agg_b = aggregate_run(run_b)

    all_scorers = set(list(agg_a["per_scorer"].keys()) + list(agg_b["per_scorer"].keys()))
    comparison = {}
    for scorer in all_scorers:
        val_a = agg_a["per_scorer"].get(scorer, 0)
        val_b = agg_b["per_scorer"].get(scorer, 0)
        change = round(val_b - val_a, 2) if val_a is not None else None
        change_pct = round((val_b - val_a) / val_a * 100, 1) if val_a and val_a != 0 else None
        comparison[scorer] = {
            "run_a": val_a,
            "run_b": val_b,
            "change": change,
            "change_pct": change_pct,
        }

    item_comparisons = []
    items_a = {ir.get("item_id"): ir for ir in run_a.get("item_results", []) if ir.get("item_id")}
    items_b = {ir.get("item_id"): ir for ir in run_b.get("item_results", []) if ir.get("item_id")}
    all_item_ids = set(list(items_a.keys()) + list(items_b.keys()))
    for iid in list(all_item_ids)[:50]:
        ia = items_a.get(iid, {})
        ib = items_b.get(iid, {})

        def _item_scores(item_res):
            scores = {}
            for r in item_res.get("results", []):
                name = r.get("evaluator_name", r.get("evaluator_id", "unknown"))
                scores[name] = r.get("score", 0)
            return scores

        item_comparisons.append({
            "item_id": iid,
            "run_a_scores": _item_scores(ia),
            "run_b_scores": _item_scores(ib),
        })

    return {
        "run_a": agg_a,
        "run_b": agg_b,
        "comparison": comparison,
        "item_comparisons": item_comparisons,
    }


# ── Datasets (Evaluation Framework) ──────────────────────────────────

@router.get("/datasets")
def list_datasets(
    product_id: Optional[str] = Query(None),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    docs = store.list_datasets(product_id=product_id)
    return {"datasets": docs, "count": len(docs)}


@router.post("/datasets")
def create_dataset(body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    import uuid
    store = get_trace_store()
    body.setdefault("dataset_id", f"ds_{uuid.uuid4().hex[:10]}")
    return store.create_dataset(body)


@router.get("/datasets/{dataset_id}")
def get_dataset(dataset_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    doc = store.get_dataset(dataset_id)
    if not doc:
        return {"error": "not found"}
    return doc


@router.put("/datasets/{dataset_id}")
def update_dataset(dataset_id: str, body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.update_dataset(dataset_id, body)


@router.delete("/datasets/{dataset_id}")
def delete_dataset(dataset_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.delete_dataset(dataset_id)


@router.post("/datasets/{dataset_id}/items")
def add_dataset_items(dataset_id: str, body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    items = body.get("items", [])
    if not items:
        return {"error": "no items provided"}
    return store.add_dataset_items(dataset_id, items)


@router.delete("/datasets/{dataset_id}/items/{item_id}")
def delete_dataset_item(dataset_id: str, item_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.delete_dataset_item(dataset_id, item_id)


@router.post("/datasets/{dataset_id}/items/{item_id}/approve")
def approve_dataset_item(dataset_id: str, item_id: str, body: dict = Body(default={})) -> dict:
    """Approve or edit the expected_output of a dataset item.

    Body options:
      - {} or {"action": "approve"}  -- copy actual_output to expected_output
      - {"expected_output": "..."}   -- set explicit expected_output text
    """
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.approve_dataset_item(dataset_id, item_id, body)


@router.post("/datasets/{dataset_id}/items/bulk-approve")
def bulk_approve_dataset_items(dataset_id: str, body: dict = Body(default={})) -> dict:
    """Approve all items that have positive feedback or specific item_ids.

    Body: {"item_ids": [...]} or {"positive_feedback_only": true}
    """
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.bulk_approve_dataset_items(dataset_id, body)


# ── Dataset File Upload / Download ────────────────────────────────────

import os, uuid as _uuid, pathlib

_UPLOAD_DIR = pathlib.Path(os.getenv(
    "CLUCO_UPLOAD_DIR",
    os.path.join(os.path.dirname(os.path.dirname(__file__)), "uploads", "datasets"),
))
_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {
    ".pdf", ".docx", ".doc", ".txt", ".md",
    ".png", ".jpg", ".jpeg", ".gif",
    ".csv", ".json", ".xlsx", ".xls",
    ".rtf", ".odt",
}


@router.post("/datasets/upload")
async def upload_dataset_file(file: UploadFile = File(...)) -> dict:
    """Upload a file and return a file_ref + extracted text (if possible)."""
    ext = pathlib.Path(file.filename or "file").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type: {ext}")

    file_id = f"{_uuid.uuid4().hex[:12]}{ext}"
    dest = _UPLOAD_DIR / file_id
    content = await file.read()
    dest.write_bytes(content)

    # Extract text for evaluation purposes
    extracted_text = _extract_text(dest, ext)

    return {
        "ok": True,
        "file_ref": file_id,
        "filename": file.filename,
        "size_bytes": len(content),
        "content_type": file.content_type or "",
        "extracted_text_preview": extracted_text[:500] if extracted_text else "",
        "extracted_text_length": len(extracted_text) if extracted_text else 0,
    }


@router.get("/datasets/files/{file_ref}")
async def download_dataset_file(file_ref: str):
    """Download / serve a previously uploaded file."""
    path = _UPLOAD_DIR / file_ref
    if not path.exists() or not path.is_file():
        raise HTTPException(404, "File not found")
    return FileResponse(path, filename=file_ref, media_type="application/octet-stream")


@router.get("/datasets/files/{file_ref}/text")
def extract_file_text(file_ref: str) -> dict:
    """Return extracted text from an uploaded file (for evaluation)."""
    path = _UPLOAD_DIR / file_ref
    if not path.exists():
        raise HTTPException(404, "File not found")
    ext = pathlib.Path(file_ref).suffix.lower()
    text = _extract_text(path, ext)
    return {"file_ref": file_ref, "text": text, "length": len(text)}


@router.post("/datasets/{dataset_id}/items/upload")
async def add_dataset_item_with_files(
    dataset_id: str,
    input_file: UploadFile = File(None),
    output_file: UploadFile = File(None),
    input_text: str = Form(""),
    output_text: str = Form(""),
    metadata_json: str = Form("{}"),
) -> dict:
    """Add a single dataset item with optional file uploads for input and/or output."""
    from app.storage import get_trace_store
    import json
    store = get_trace_store()

    item = {"input": {}, "expected_output": {}, "metadata": {}}

    # Parse metadata
    try:
        item["metadata"] = json.loads(metadata_json) if metadata_json else {}
    except Exception:
        item["metadata"] = {}

    # Handle input
    if input_file and input_file.filename:
        ext = pathlib.Path(input_file.filename).suffix.lower()
        file_id = f"{_uuid.uuid4().hex[:12]}{ext}"
        dest = _UPLOAD_DIR / file_id
        content = await input_file.read()
        dest.write_bytes(content)
        extracted = _extract_text(dest, ext)
        item["input"] = {
            "file_ref": file_id,
            "filename": input_file.filename,
            "size_bytes": len(content),
            "text": extracted,
        }
    elif input_text:
        item["input"] = {"text": input_text}

    # Handle expected output
    if output_file and output_file.filename:
        ext = pathlib.Path(output_file.filename).suffix.lower()
        file_id = f"{_uuid.uuid4().hex[:12]}{ext}"
        dest = _UPLOAD_DIR / file_id
        content = await output_file.read()
        dest.write_bytes(content)
        extracted = _extract_text(dest, ext)
        item["expected_output"] = {
            "file_ref": file_id,
            "filename": output_file.filename,
            "size_bytes": len(content),
            "text": extracted,
        }
    elif output_text:
        item["expected_output"] = {"text": output_text}

    return store.add_dataset_items(dataset_id, [item])


def _extract_text(file_path: pathlib.Path, ext: str) -> str:
    """Best-effort text extraction from uploaded files."""
    try:
        if ext == ".pdf":
            from PyPDF2 import PdfReader
            reader = PdfReader(str(file_path))
            parts = []
            for page in reader.pages:
                t = page.extract_text()
                if t:
                    parts.append(t)
            return "\n".join(parts)

        if ext in (".docx",):
            from docx import Document
            doc = Document(str(file_path))
            return "\n".join(p.text for p in doc.paragraphs if p.text.strip())

        if ext in (".txt", ".md", ".csv", ".json", ".rtf"):
            return file_path.read_text(encoding="utf-8", errors="replace")

    except Exception:
        pass
    return ""


# ── Alerts ────────────────────────────────────────────────────────────

class AlertPayload(BaseModel):
    trace_id: Optional[str] = ""
    product_id: Optional[str] = "default"
    alert_type: str = "budget_exceeded"
    severity: Optional[str] = "warning"
    message: str
    details: Optional[dict] = {}


@router.post("/alerts")
def create_alert(payload: AlertPayload) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.store_alert(payload.dict())


@router.get("/alerts")
def list_alerts(
    product_id: Optional[str] = Query(None),
    alert_type: Optional[str] = Query(None),
    acknowledged: Optional[bool] = Query(None),
    days: int = Query(30, le=365),
    limit: int = Query(100, le=500),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    alerts = store.get_alerts(product_id=product_id, alert_type=alert_type,
                              acknowledged=acknowledged, days=days, limit=limit)
    return {"alerts": alerts, "count": len(alerts)}


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(alert_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    ok = store.acknowledge_alert(alert_id)
    return {"ok": ok}


@router.post("/alerts/{alert_id}/send-email")
def resend_alert_email(alert_id: str) -> dict:
    """Resend an alert as email to configured recipients."""
    from app.storage.mongodb import _get_db
    from app.email_alerts import send_email
    from bson import ObjectId
    from datetime import datetime

    db = _get_db()
    alert = db["alerts"].find_one({"_id": ObjectId(alert_id)})
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    recipients_cursor = db["email_recipients"].find({"active": True})
    to_emails = [r["email"] for r in recipients_cursor if r.get("email")]
    if not to_emails:
        raise HTTPException(status_code=400, detail="No active email recipients configured")

    stored_subject = alert.get("email_subject")
    stored_html = alert.get("email_body_html")

    if stored_subject and stored_html:
        subject = stored_subject
        html = stored_html
    else:
        subject = f"[Cluco Alert] {alert.get('severity', 'warning').upper()}: {alert.get('alert_type', 'alert')}"
        html = f"""
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: {'#dc2626' if alert.get('severity') == 'critical' else '#d97706'}; color: white; padding: 16px 24px; border-radius: 8px 8px 0 0;">
            <h2 style="margin: 0; font-size: 16px;">{alert.get('alert_type', 'Alert')} — {alert.get('severity', 'warning')}</h2>
          </div>
          <div style="background: #fff; border: 1px solid #e2e8f0; border-top: none; padding: 20px 24px; border-radius: 0 0 8px 8px;">
            <p style="color: #334155; font-size: 14px; margin: 0 0 12px;">{alert.get('message', '')}</p>
            <p style="color: #64748b; font-size: 12px; margin: 0;">Trace: {alert.get('trace_id', 'N/A')}</p>
            <p style="color: #94a3b8; font-size: 11px; margin: 12px 0 0;">Resent from Cluco Observability</p>
          </div>
        </div>
        """

    result = send_email(to_emails, subject, html)

    email_status = "sent" if result.get("ok") else "failed"
    db["alerts"].update_one(
        {"_id": ObjectId(alert_id)},
        {"$set": {
            "email_status": email_status,
            "email_error": result.get("error", "") if not result.get("ok") else "",
            "email_recipients": to_emails,
            "last_resent_at": datetime.utcnow(),
        }},
    )

    return {"ok": result.get("ok", False), "sent_to": to_emails, "email_status": email_status, "error": result.get("error", "")}


# ── Email Alert System ────────────────────────────────────────────────

class EmailRecipientPayload(BaseModel):
    name: str
    email: str
    active: bool = True
    tags: Optional[list] = []


class AlertRulePayload(BaseModel):
    name: str
    description: Optional[str] = ""
    alert_type: str = "rule_triggered"
    severity: str = "warning"
    enabled: bool = True
    condition: dict  # {metric, operator, threshold}
    recipient_ids: Optional[list] = []  # specific recipients, empty = all
    cooldown_minutes: Optional[int] = 0  # minimum minutes between repeat fires
    product_id: Optional[str] = ""


class SmtpConfigPayload(BaseModel):
    host: str
    port: int = 587
    username: Optional[str] = ""
    password: Optional[str] = ""
    from_email: str = "alerts@cluco-observability.local"
    from_name: str = "Cluco Observability"
    use_tls: bool = True
    enabled: bool = False


@router.get("/email/recipients")
def list_email_recipients() -> dict:
    from app.storage.mongodb import _get_db
    db = _get_db()
    docs = list(db["email_recipients"].find().sort("name", 1))
    for d in docs:
        d["_id"] = str(d["_id"])
    return {"recipients": docs, "count": len(docs)}


@router.post("/email/recipients")
def add_email_recipient(payload: EmailRecipientPayload) -> dict:
    from app.storage.mongodb import _get_db
    from datetime import datetime
    db = _get_db()
    doc = payload.dict()
    doc["created_at"] = datetime.utcnow()
    doc["updated_at"] = datetime.utcnow()
    result = db["email_recipients"].insert_one(doc)
    return {"ok": True, "id": str(result.inserted_id)}


@router.put("/email/recipients/{recipient_id}")
def update_email_recipient(recipient_id: str, payload: EmailRecipientPayload) -> dict:
    from app.storage.mongodb import _get_db
    from bson import ObjectId
    from datetime import datetime
    db = _get_db()
    update = payload.dict()
    update["updated_at"] = datetime.utcnow()
    result = db["email_recipients"].update_one(
        {"_id": ObjectId(recipient_id)},
        {"$set": update},
    )
    return {"ok": result.modified_count > 0}


@router.delete("/email/recipients/{recipient_id}")
def delete_email_recipient(recipient_id: str) -> dict:
    from app.storage.mongodb import _get_db
    from bson import ObjectId
    db = _get_db()
    result = db["email_recipients"].delete_one({"_id": ObjectId(recipient_id)})
    return {"ok": result.deleted_count > 0}


@router.get("/email/rules")
def list_alert_rules() -> dict:
    from app.storage.mongodb import _get_db
    db = _get_db()
    docs = list(db["alert_rules"].find().sort("name", 1))
    for d in docs:
        d["_id"] = str(d["_id"])
    return {"rules": docs, "count": len(docs)}


@router.post("/email/rules")
def create_alert_rule(payload: AlertRulePayload) -> dict:
    from app.storage.mongodb import _get_db
    from datetime import datetime
    db = _get_db()
    doc = payload.dict()
    doc["created_at"] = datetime.utcnow()
    doc["updated_at"] = datetime.utcnow()
    doc["last_triggered_at"] = None
    doc["trigger_count"] = 0
    result = db["alert_rules"].insert_one(doc)
    return {"ok": True, "id": str(result.inserted_id)}


@router.put("/email/rules/{rule_id}")
def update_alert_rule(rule_id: str, payload: AlertRulePayload) -> dict:
    from app.storage.mongodb import _get_db
    from bson import ObjectId
    from datetime import datetime
    db = _get_db()
    update = payload.dict()
    update["updated_at"] = datetime.utcnow()
    result = db["alert_rules"].update_one(
        {"_id": ObjectId(rule_id)},
        {"$set": update},
    )
    return {"ok": result.modified_count > 0}


@router.delete("/email/rules/{rule_id}")
def delete_alert_rule(rule_id: str) -> dict:
    from app.storage.mongodb import _get_db
    from bson import ObjectId
    db = _get_db()
    result = db["alert_rules"].delete_one({"_id": ObjectId(rule_id)})
    return {"ok": result.deleted_count > 0}


@router.put("/email/rules/{rule_id}/toggle")
def toggle_alert_rule(rule_id: str, enabled: bool = Body(..., embed=True)) -> dict:
    from app.storage.mongodb import _get_db
    from bson import ObjectId
    from datetime import datetime
    db = _get_db()
    result = db["alert_rules"].update_one(
        {"_id": ObjectId(rule_id)},
        {"$set": {"enabled": enabled, "updated_at": datetime.utcnow()}},
    )
    return {"ok": result.modified_count > 0}


@router.get("/email/smtp")
def get_smtp_config() -> dict:
    from app.email_alerts import get_effective_smtp_config, _get_smtp_config, _get_smtp_config_from_db
    config = get_effective_smtp_config()
    safe = {**config, "password": "••••••••" if config.get("password") else ""}
    env_cfg = _get_smtp_config()
    db_cfg = _get_smtp_config_from_db()
    source = "db" if (db_cfg and db_cfg.get("host")) else ("env" if env_cfg.get("host") else "none")
    return {"smtp": safe, "source": source}


@router.put("/email/smtp")
def save_smtp_config(payload: SmtpConfigPayload) -> dict:
    from app.email_alerts import save_smtp_config as _save
    config = payload.dict()
    # If password is masked placeholder, keep the existing one
    if config.get("password") == "••••••••":
        from app.email_alerts import get_effective_smtp_config
        existing = get_effective_smtp_config()
        config["password"] = existing.get("password", "")
    return _save(config)


@router.post("/email/test")
def send_test_email(to_email: str = Body(..., embed=True)) -> dict:
    from app.email_alerts import send_email, _build_test_email, get_effective_smtp_config
    config = get_effective_smtp_config()
    config_summary = {
        "host": config.get("host", ""),
        "port": config.get("port", ""),
        "username": config.get("username", ""),
        "password_set": bool(config.get("password")),
        "use_tls": config.get("use_tls"),
        "enabled": config.get("enabled"),
        "from_email": config.get("from_email", ""),
    }
    subject, html, text = _build_test_email()
    result = send_email([to_email], subject, html, text)
    result["smtp_config"] = config_summary
    return result


@router.get("/email/history")
def email_alert_history(
    days: int = Query(7, le=90),
    limit: int = Query(50, le=200),
) -> dict:
    """Return recent alerts that were triggered by email rules."""
    from app.storage import get_trace_store
    store = get_trace_store()
    alerts = store.get_alerts(alert_type="rule_triggered", days=days, limit=limit)
    return {"alerts": alerts, "count": len(alerts)}


# ── Prompt Versions ───────────────────────────────────────────────────

class PromptVersionPayload(BaseModel):
    prompt_hash: str
    agent_name: str
    prompt_template_name: Optional[str] = ""
    prompt_preview: Optional[str] = ""
    content: Optional[str] = ""
    product_id: Optional[str] = "default"
    model: Optional[str] = ""


@router.post("/prompt-versions")
def upsert_prompt_version(payload: PromptVersionPayload) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.upsert_prompt_version(payload.dict())


@router.get("/prompt-versions")
def list_prompt_versions(
    agent_name: Optional[str] = Query(None),
    product_id: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    versions = store.get_prompt_versions(agent_name=agent_name, product_id=product_id, limit=limit)
    return {"prompt_versions": versions, "count": len(versions)}


# ── Anomaly Detection ─────────────────────────────────────────────────

@router.get("/anomalies")
def detect_anomalies(
    product_id: Optional[str] = Query(None),
    days: int = Query(7, le=90),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    anomalies = store.detect_anomalies(product_id=product_id, days=days)
    return {"anomalies": anomalies, "count": len(anomalies)}


@router.get("/anomalies/baselines")
def anomaly_baselines(
    product_id: Optional[str] = Query(None),
    days: int = Query(30, le=365),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.get_anomaly_baselines(product_id=product_id, days=days)


# ── Data Retention ─────────────────────────────────────────────────────

@router.post("/admin/cleanup")
def cleanup_old_data(
    retention_days: int = Body(default=30),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.cleanup_old_data(retention_days=retention_days)


# ── Graph Operations ──────────────────────────────────────────────────

@router.get("/graph/operations")
def graph_operations(
    trace_id: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    all_spans = store.get_spans(trace_id=trace_id, kind=None, limit=limit * 3)
    graph_spans = [
        s for s in all_spans
        if (s.get("name") or "").startswith("graph:")
        or (s.get("attributes", {}) or {}).get("graph_operation")
    ]
    return {"graph_operations": graph_spans[:limit], "count": len(graph_spans[:limit])}


# ── Labeling Sessions ──────────────────────────────────────────────────

class CreateLabelingSessionPayload(BaseModel):
    name: str
    trace_ids: list[str] = []
    reviewer_emails: list[str] = []
    schema_id: Optional[str] = None
    description: Optional[str] = ""


class ShareLabelingSessionPayload(BaseModel):
    reviewer_emails: list[str]
    frontend_base_url: Optional[str] = "http://localhost:9411"


class LabelingReviewPayload(BaseModel):
    correctness: Optional[str] = None  # "yes" or "no"
    comment: Optional[str] = None
    custom_fields: Optional[dict] = None


class CreateLabelingSchemaPayload(BaseModel):
    name: str
    fields: list[dict[str, Any]]


@router.post("/labeling-sessions")
def create_labeling_session(payload: CreateLabelingSessionPayload) -> dict:
    import uuid
    from app.storage import get_trace_store
    store = get_trace_store()
    session_id = str(uuid.uuid4())
    return store.create_labeling_session(
        session_id=session_id,
        name=payload.name,
        trace_ids=payload.trace_ids,
        reviewer_emails=payload.reviewer_emails,
        schema_id=payload.schema_id,
        description=payload.description or "",
    )


@router.get("/labeling-sessions")
def list_labeling_sessions(
    limit: int = Query(50, le=200),
    offset: int = Query(0, ge=0),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.list_labeling_sessions(limit=limit, offset=offset)


@router.get("/labeling-sessions/{session_id}")
def get_labeling_session(session_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    session = store.get_labeling_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Labeling session not found")
    return session


@router.post("/labeling-sessions/{session_id}/traces")
def add_traces_to_session(session_id: str, payload: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    trace_ids = payload.get("trace_ids", [])
    return store.add_traces_to_labeling_session(session_id, trace_ids)


@router.post("/labeling-sessions/{session_id}/share")
def share_labeling_session(session_id: str, payload: ShareLabelingSessionPayload) -> dict:
    from app.storage import get_trace_store
    from app.email_alerts import send_email_async, get_effective_smtp_config

    store = get_trace_store()
    result = store.share_labeling_session(session_id, payload.reviewer_emails)

    smtp_cfg = get_effective_smtp_config()
    if smtp_cfg.get("enabled"):
        session = store.get_labeling_session(session_id)
        if session:
            session_name = session.get("name", "Labeling Session")
            trace_count = session.get("trace_count", 0)
            review_url = f"{payload.frontend_base_url}/labeling-review/{session_id}"

            subject = f"[Cluco] You've been invited to review: {session_name}"
            body_html = f"""
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #6d28d9 0%, #4f46e5 100%); padding: 28px 32px; border-radius: 12px 12px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 700;">Labeling Review Invitation</h1>
    <p style="color: rgba(255,255,255,0.8); margin: 6px 0 0; font-size: 14px;">You've been asked to review AI agent traces</p>
  </div>
  <div style="background: #fff; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <tr><td style="padding: 6px 0; font-size: 13px; color: #64748b; width: 130px;">Session</td><td style="padding: 6px 0; font-size: 13px; color: #1e293b; font-weight: 600;">{session_name}</td></tr>
      <tr><td style="padding: 6px 0; font-size: 13px; color: #64748b;">Traces to review</td><td style="padding: 6px 0; font-size: 13px; color: #1e293b; font-weight: 600;">{trace_count}</td></tr>
    </table>
    <p style="font-size: 13px; color: #475569; line-height: 1.6; margin: 0 0 20px;">
      Please review each trace and provide your feedback on whether the AI agent responded correctly.
    </p>
    <a href="{review_url}" style="display: inline-block; padding: 12px 24px; background: #6d28d9; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 16px;">
      Start Reviewing &rarr;
    </a>
    <p style="font-size: 11px; color: #94a3b8; margin: 12px 0 0;">
      Powered by Cluco Observability
    </p>
  </div>
</div>"""

            for email in payload.reviewer_emails:
                send_email_async(
                    to_emails=[email],
                    subject=subject,
                    html_body=body_html,
                )

    result["emails_sent"] = len(payload.reviewer_emails)
    result["smtp_enabled"] = smtp_cfg.get("enabled", False)
    return result


@router.get("/labeling-sessions/{session_id}/traces")
def get_session_traces(session_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    traces = store.get_labeling_session_traces(session_id)
    return {"traces": traces, "count": len(traces)}


@router.post("/labeling-sessions/{session_id}/traces/{trace_id}/review")
def submit_review(session_id: str, trace_id: str, payload: LabelingReviewPayload) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    review_data = {}
    if payload.correctness is not None:
        review_data["correctness"] = payload.correctness
    if payload.comment is not None:
        review_data["comment"] = payload.comment
    if payload.custom_fields:
        review_data["custom_fields"] = payload.custom_fields
    return store.submit_labeling_review(session_id, trace_id, review_data)


# ── Labeling Schemas ──────────────────────────────────────────────────

@router.get("/labeling-schemas")
def list_labeling_schemas(limit: int = Query(50, le=200)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.list_labeling_schemas(limit=limit)


@router.post("/labeling-schemas")
def create_labeling_schema(payload: CreateLabelingSchemaPayload) -> dict:
    import uuid
    from app.storage import get_trace_store
    store = get_trace_store()
    schema_id = str(uuid.uuid4())
    return store.create_labeling_schema(
        schema_id=schema_id,
        name=payload.name,
        fields=payload.fields,
    )


@router.get("/labeling-schemas/{schema_id}")
def get_labeling_schema(schema_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    schema = store.get_labeling_schema(schema_id)
    if not schema:
        raise HTTPException(status_code=404, detail="Labeling schema not found")
    return schema


# ── Trace-to-Dataset Export ────────────────────────────────────────────

class TraceToDatasetPayload(BaseModel):
    trace_ids: list[str]
    dataset_id: Optional[str] = None
    dataset_name: Optional[str] = None


@router.post("/datasets/from-traces")
def export_traces_to_dataset(payload: TraceToDatasetPayload) -> dict:
    import uuid
    from app.storage import get_trace_store
    store = get_trace_store()

    if not payload.trace_ids:
        raise HTTPException(status_code=400, detail="No trace_ids provided")

    dataset_id = payload.dataset_id
    if not dataset_id:
        if not payload.dataset_name:
            raise HTTPException(status_code=400, detail="Provide dataset_id or dataset_name")
        dataset_id = str(uuid.uuid4())
        store.create_dataset({
            "dataset_id": dataset_id,
            "name": payload.dataset_name,
            "description": f"Exported from {len(payload.trace_ids)} traces",
            "product_id": "default",
        })

    items = []
    for trace_id in payload.trace_ids:
        trace = store.get(trace_id)
        if not trace:
            continue
        request_data = store._extract_trace_request(trace)
        response_data = store._extract_trace_response(trace)
        input_val = request_data if isinstance(request_data, str) else (request_data if request_data else "")
        actual_val = response_data if isinstance(response_data, str) else (response_data if response_data else "")

        feedback_list = trace.get("feedback") or []
        feedback_summary = []
        for fb in feedback_list:
            feedback_summary.append({
                "key": fb.get("key", ""),
                "value": fb.get("value", ""),
                "score": fb.get("score"),
                "comment": fb.get("comment", ""),
            })

        has_positive = any(
            fb.get("key") == "user_feedback" and fb.get("value") == "True"
            for fb in feedback_list
        )

        items.append({
            "item_id": str(uuid.uuid4()),
            "trace_id": trace_id,
            "input": input_val,
            "expected_output": actual_val if has_positive else "",
            "actual_output": actual_val,
            "needs_review": not has_positive,
            "feedback": feedback_summary,
            "metadata": {"source_trace_id": trace_id},
            "tags": ["from-traces"],
        })

    items_added = 0
    if items:
        store.add_dataset_items(dataset_id, items)
        items_added = len(items)

    return {"ok": True, "dataset_id": dataset_id, "items_added": items_added}


# -- Prompt Templates CRUD --

class CreatePromptPayload(BaseModel):
    name: str
    content: str
    variables: list[str] = []
    agent_name: Optional[str] = ""
    product_id: Optional[str] = "default"
    tags: list[str] = []
    description: Optional[str] = ""
    prompt_id: Optional[str] = None


class CreatePromptVersionPayload(BaseModel):
    content: str
    variables: list[str] = []
    tags: list[str] = []
    model: Optional[str] = ""


@router.post("/prompts")
def create_prompt(payload: CreatePromptPayload) -> dict:
    import uuid
    from app.storage import get_trace_store
    store = get_trace_store()
    prompt_id = payload.prompt_id or str(uuid.uuid4())

    existing = store.get_prompt_template(prompt_id)
    if existing:
        store._prompt_templates.update_one(
            {"prompt_id": prompt_id},
            {"$set": {
                "name": payload.name,
                "description": payload.description or existing.get("description", ""),
                "agent_name": payload.agent_name or existing.get("agent_name", ""),
                "product_id": payload.product_id or existing.get("product_id", "default"),
                "updated_at": __import__("datetime").datetime.utcnow(),
            }},
        )
        if payload.content != existing.get("_latest_content", ""):
            store.create_prompt_version(
                prompt_id=prompt_id, content=payload.content,
                variables=payload.variables, tags=payload.tags or ["sdk"],
                model="",
            )
        return {"prompt_id": prompt_id, "status": "updated"}

    return store.create_prompt_template(
        prompt_id=prompt_id, name=payload.name, content=payload.content,
        variables=payload.variables, agent_name=payload.agent_name or "",
        product_id=payload.product_id or "default", tags=payload.tags,
        description=payload.description or "",
    )


@router.get("/prompts")
def list_prompts(
    product_id: Optional[str] = Query(None),
    limit: int = Query(100, le=500),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    templates = store.list_prompt_templates(product_id=product_id, limit=limit)
    return {"prompts": templates, "count": len(templates)}


@router.get("/prompts/{prompt_id}")
def get_prompt(prompt_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    tmpl = store.get_prompt_template(prompt_id)
    if not tmpl:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return tmpl


@router.post("/prompts/{prompt_id}/versions")
def create_prompt_version_endpoint(prompt_id: str, payload: CreatePromptVersionPayload) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    result = store.create_prompt_version(
        prompt_id=prompt_id, content=payload.content,
        variables=payload.variables, tags=payload.tags, model=payload.model or "",
    )
    if not result:
        raise HTTPException(status_code=404, detail="Prompt not found")
    return result


@router.get("/prompts/{prompt_id}/versions")
def list_prompt_template_versions(prompt_id: str, limit: int = Query(100, le=500)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    versions = store.list_prompt_versions_for_template(prompt_id, limit=limit)
    return {"versions": versions, "count": len(versions)}


@router.get("/prompts/{prompt_id}/versions/{version}")
def get_prompt_version_endpoint(prompt_id: str, version: int) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    ver = store.get_prompt_version(prompt_id, version)
    if not ver:
        raise HTTPException(status_code=404, detail="Version not found")
    return ver


@router.get("/prompts/{prompt_id}/compare")
def compare_prompt_versions_endpoint(
    prompt_id: str,
    version_a: int = Query(...),
    version_b: int = Query(...),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.compare_prompt_versions(prompt_id, version_a, version_b)


@router.post("/prompts/{prompt_id}/optimize")
def optimize_prompt(prompt_id: str, body: dict = Body(...)) -> dict:
    """Run all optimization strategies (custom + DSPy) in a background thread.
    Returns the run_id immediately so the frontend can poll for progress."""
    import threading
    from app.storage import get_trace_store
    store = get_trace_store()

    dataset_id = body.get("dataset_id")
    evaluator_id = body.get("evaluator_id")
    evaluator_ids = body.get("evaluator_ids", [])
    max_iterations = min(body.get("max_iterations", 4), 10)
    optimizer_model = body.get("optimizer_model")

    if not dataset_id:
        raise HTTPException(status_code=400, detail="dataset_id required")
    if not evaluator_id and not evaluator_ids:
        raise HTTPException(status_code=400, detail="evaluator_id or evaluator_ids required")

    import uuid as _uuid
    run_id = str(_uuid.uuid4())[:12]

    def _run_in_background():
        try:
            from app.storage import get_trace_store as _get_store
            from app.prompt_optimizer import run_all_strategies_optimization
            bg_store = _get_store()
            run_all_strategies_optimization(
                store=bg_store,
                prompt_id=prompt_id,
                dataset_id=dataset_id,
                evaluator_id=evaluator_id or (evaluator_ids[0] if evaluator_ids else ""),
                max_iterations=max_iterations,
                optimizer_model=optimizer_model,
                evaluator_ids=evaluator_ids if evaluator_ids else ([evaluator_id] if evaluator_id else []),
                run_id=run_id,
            )
        except Exception as e:
            import logging
            logging.getLogger(__name__).error("Background optimization failed: %s", e)
            try:
                bg_store._db["optimization_runs"].update_one(
                    {"_id": run_id},
                    {"$set": {"status": "failed", "error": str(e)}},
                    upsert=True,
                )
            except Exception:
                pass

    thread = threading.Thread(target=_run_in_background, daemon=True)
    thread.start()

    return {"ok": True, "run_id": run_id, "status": "started"}


@router.get("/prompts/optimization-runs/{run_id}")
def get_optimization_run(run_id: str) -> dict:
    """Get the status/result of a prompt optimization run (supports polling)."""
    from app.storage import get_trace_store
    store = get_trace_store()
    try:
        doc = store._db["optimization_runs"].find_one({"_id": run_id})
        if not doc:
            raise HTTPException(status_code=404, detail="Optimization run not found")
        doc.pop("_id", None)
        return doc
    except HTTPException:
        raise
    except Exception:
        raise HTTPException(status_code=404, detail="Optimization run not found")


# ─────────────────────────────────────────────────────────────────────────────
# SME Trace Review
# Share a trace with a Subject Matter Expert via a time-limited review link.
# ─────────────────────────────────────────────────────────────────────────────

@router.post("/traces/{trace_id}/send-review")
def send_trace_for_review(trace_id: str, body: dict = Body(...)):
    """
    Create a review token for a trace and email it to one or more SMEs.
    Body: { "emails": ["sme@example.com"], "note": "Optional context for the SME" }
    Returns: { "token": "...", "review_url": "..." }
    """
    import uuid
    import datetime
    from app.storage import get_trace_store
    from app.email_alerts import send_email_async, get_effective_smtp_config

    store = get_trace_store()
    trace = store.get(trace_id)
    if not trace:
        raise HTTPException(status_code=404, detail="Trace not found")

    emails = body.get("emails", [])
    note = body.get("note", "")
    frontend_base_url = body.get("frontend_base_url", "http://localhost:9411")

    if not emails:
        raise HTTPException(status_code=400, detail="At least one email address is required")

    token = str(uuid.uuid4()).replace("-", "")
    expires_at = (datetime.datetime.utcnow() + datetime.timedelta(days=7)).isoformat()

    review_doc = {
        "token": token,
        "trace_id": trace_id,
        "created_at": datetime.datetime.utcnow().isoformat(),
        "expires_at": expires_at,
        "note": note,
        "emails": emails,
        "comments": [],
        "status": "pending",
    }
    store._db["trace_reviews"].insert_one(review_doc)

    review_url = f"{frontend_base_url}/trace-review/{token}"

    # Send email to each SME
    smtp_cfg = get_effective_smtp_config()
    if smtp_cfg.get("enabled"):
        service = trace.get("service_name", "unknown")
        product = trace.get("product_id", "unknown")
        created = trace.get("created_at", "")
        try:
            created_fmt = created[:19].replace("T", " ") if created else "unknown"
        except Exception:
            created_fmt = str(created)

        subject = f"[Cluco] Trace Review Request – {service} / {trace_id[:12]}…"
        body_html = f"""
<div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto;">
  <div style="background: linear-gradient(135deg, #6d28d9 0%, #4f46e5 100%); padding: 28px 32px; border-radius: 12px 12px 0 0;">
    <h1 style="color: white; margin: 0; font-size: 20px; font-weight: 700;">Trace Review Request</h1>
    <p style="color: rgba(255,255,255,0.8); margin: 6px 0 0; font-size: 14px;">You've been asked to review an AI agent trace</p>
  </div>
  <div style="background: #fff; padding: 28px 32px; border: 1px solid #e2e8f0; border-top: none; border-radius: 0 0 12px 12px;">
    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
      <tr><td style="padding: 6px 0; font-size: 13px; color: #64748b; width: 130px;">Service</td><td style="padding: 6px 0; font-size: 13px; color: #1e293b; font-weight: 600;">{service}</td></tr>
      <tr><td style="padding: 6px 0; font-size: 13px; color: #64748b;">Product</td><td style="padding: 6px 0; font-size: 13px; color: #1e293b; font-weight: 600;">{product}</td></tr>
      <tr><td style="padding: 6px 0; font-size: 13px; color: #64748b;">Trace ID</td><td style="padding: 6px 0; font-size: 13px; color: #1e293b; font-family: monospace;">{trace_id}</td></tr>
      <tr><td style="padding: 6px 0; font-size: 13px; color: #64748b;">Created</td><td style="padding: 6px 0; font-size: 13px; color: #1e293b;">{created_fmt}</td></tr>
      <tr><td style="padding: 6px 0; font-size: 13px; color: #64748b;">Link expires</td><td style="padding: 6px 0; font-size: 13px; color: #1e293b;">7 days</td></tr>
    </table>
    {f'<div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 12px 16px; margin-bottom: 20px;"><p style="margin: 0; font-size: 13px; color: #0c4a6e;"><strong>Note from sender:</strong> {note}</p></div>' if note else ''}
    <a href="{review_url}" style="display: inline-block; padding: 12px 24px; background: #6d28d9; color: white; text-decoration: none; border-radius: 8px; font-weight: 600; font-size: 14px; margin-bottom: 16px;">
      Open Trace for Review →
    </a>
    <p style="font-size: 11px; color: #94a3b8; margin: 12px 0 0;">
      This link is valid for 7 days. You can view the trace details and leave your assessment and comments.
    </p>
  </div>
</div>"""

        for email in emails:
            send_email_async(
                to_emails=[email],
                subject=subject,
                html_body=body_html,
            )

    return {
        "token": token,
        "review_url": review_url,
        "expires_at": expires_at,
        "emails_sent": len(emails),
        "smtp_enabled": smtp_cfg.get("enabled", False),
    }


@router.get("/trace-reviews/{token}")
def get_trace_review(token: str):
    """Public endpoint: fetch trace data + existing comments for a review token."""
    import datetime
    from app.storage import get_trace_store

    store = get_trace_store()
    doc = store._db["trace_reviews"].find_one({"token": token})
    if not doc:
        raise HTTPException(status_code=404, detail="Review link not found or expired")

    doc.pop("_id", None)

    # Check expiry
    try:
        expires = datetime.datetime.fromisoformat(doc["expires_at"])
        if datetime.datetime.utcnow() > expires:
            raise HTTPException(status_code=410, detail="This review link has expired")
    except (KeyError, ValueError):
        pass

    trace = store.get(doc["trace_id"])
    if not trace:
        raise HTTPException(status_code=404, detail="Trace not found")

    # Return sanitized trace (spans + metadata but no internal IDs)
    safe_trace = {
        "trace_id": trace.get("trace_id"),
        "service_name": trace.get("service_name"),
        "product_id": trace.get("product_id"),
        "status": trace.get("status"),
        "created_at": trace.get("created_at"),
        "latency_ms": trace.get("latency_ms"),
        "total_tokens": trace.get("total_tokens"),
        "total_cost_usd": trace.get("total_cost_usd"),
        "spans": trace.get("spans", []),
        "flat_spans": trace.get("flat_spans", []),
        "feedback": trace.get("feedback", []),
    }

    return {
        "token": token,
        "trace_id": doc["trace_id"],
        "note": doc.get("note", ""),
        "created_at": doc.get("created_at"),
        "expires_at": doc.get("expires_at"),
        "status": doc.get("status", "pending"),
        "comments": doc.get("comments", []),
        "trace": safe_trace,
    }


@router.post("/trace-reviews/{token}/comments")
def submit_trace_review_comment(token: str, body: dict = Body(...)):
    """
    Submit a review comment for a trace. Called by the SME from the public review page.
    Body: { "reviewer_name": "John", "reviewer_email": "john@example.com", "comment": "...", "rating": "approve|flag|needs_work" }
    """
    import datetime
    from app.storage import get_trace_store

    store = get_trace_store()
    doc = store._db["trace_reviews"].find_one({"token": token})
    if not doc:
        raise HTTPException(status_code=404, detail="Review link not found")

    comment_entry = {
        "reviewer_name": body.get("reviewer_name", "Anonymous"),
        "reviewer_email": body.get("reviewer_email", ""),
        "comment": body.get("comment", ""),
        "rating": body.get("rating", ""),
        "submitted_at": datetime.datetime.utcnow().isoformat(),
    }

    store._db["trace_reviews"].update_one(
        {"token": token},
        {
            "$push": {"comments": comment_entry},
            "$set": {"status": "reviewed"},
        },
    )
    return {"success": True, "message": "Review submitted successfully"}


@router.get("/traces/{trace_id}/reviews")
def list_trace_reviews(trace_id: str):
    """List all review sessions for a trace."""
    from app.storage import get_trace_store
    store = get_trace_store()
    docs = list(store._db["trace_reviews"].find({"trace_id": trace_id}))
    for d in docs:
        d.pop("_id", None)
    return {"reviews": docs, "count": len(docs)}


# ═══════════════════════════════════════════════════════════════════════
# Phase 1-4: Score Configs, Annotation Queues, Scores, Experiments,
#            Evaluation Suites, Prompt Deployments, Scheduled Evals,
#            Dataset Versioning, CI/CD Webhook
# ═══════════════════════════════════════════════════════════════════════

# ── Score Configs ─────────────────────────────────────────────────────

@router.post("/score-configs")
def create_score_config(body: dict = Body(...)) -> dict:
    import uuid
    from app.storage import get_trace_store
    store = get_trace_store()
    body.setdefault("config_id", f"sc_{uuid.uuid4().hex[:10]}")
    return store.create_score_config(body)


@router.get("/score-configs")
def list_score_configs(product_id: Optional[str] = Query(None)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    configs = store.list_score_configs(product_id=product_id)
    return {"configs": configs, "count": len(configs)}


@router.get("/score-configs/{config_id}")
def get_score_config(config_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    doc = store.get_score_config(config_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Score config not found")
    return doc


@router.put("/score-configs/{config_id}")
def update_score_config(config_id: str, body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.update_score_config(config_id, body)


@router.delete("/score-configs/{config_id}")
def delete_score_config(config_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.delete_score_config(config_id)


# ── Scores (unified human + evaluator + API) ─────────────────────────

@router.post("/traces/{trace_id}/scores")
def add_trace_scores(trace_id: str, body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    scores = body.get("scores", [])
    if not scores:
        scores = [body]
    results = []
    for s in scores:
        s["trace_id"] = trace_id
        s.setdefault("source", "human")
        results.append(store.add_score(s))
    return {"ok": True, "added": len(results)}


@router.get("/traces/{trace_id}/scores")
def get_trace_scores(trace_id: str, source: Optional[str] = Query(None)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    scores = store.get_scores(trace_id=trace_id, source=source)
    return {"scores": scores, "count": len(scores)}


@router.get("/scores")
def list_scores(
    trace_id: Optional[str] = Query(None),
    config_id: Optional[str] = Query(None),
    source: Optional[str] = Query(None),
    limit: int = Query(200, le=1000),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    scores = store.get_scores(trace_id=trace_id, config_id=config_id,
                              source=source, limit=limit)
    return {"scores": scores, "count": len(scores)}


# ── Annotation Queues ─────────────────────────────────────────────────

@router.post("/annotation-queues")
def create_annotation_queue(body: dict = Body(...)) -> dict:
    import uuid
    from app.storage import get_trace_store
    store = get_trace_store()
    body.setdefault("queue_id", f"aq_{uuid.uuid4().hex[:10]}")
    return store.create_annotation_queue(body)


@router.get("/annotation-queues")
def list_annotation_queues(product_id: Optional[str] = Query(None)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    queues = store.list_annotation_queues(product_id=product_id)
    return {"queues": queues, "count": len(queues)}


@router.get("/annotation-queues/{queue_id}")
def get_annotation_queue(queue_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    doc = store.get_annotation_queue(queue_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Annotation queue not found")
    return doc


@router.put("/annotation-queues/{queue_id}")
def update_annotation_queue(queue_id: str, body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.update_annotation_queue(queue_id, body)


@router.delete("/annotation-queues/{queue_id}")
def delete_annotation_queue(queue_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.delete_annotation_queue(queue_id)


@router.post("/annotation-queues/{queue_id}/items")
def add_annotation_queue_items(queue_id: str, body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    trace_ids = body.get("trace_ids", [])
    items = body.get("items", [])
    if trace_ids and not items:
        for tid in trace_ids:
            trace = store.get(tid)
            if trace:
                spans = trace.get("spans", [])
                final_input, final_output = "", ""
                for s in spans:
                    if s.get("kind") in ("agent", "chain") and s.get("inputs"):
                        inp = s["inputs"]
                        final_input = inp if isinstance(inp, str) else json.dumps(inp, default=str)
                        break
                for s in reversed(spans):
                    if s.get("kind") in ("agent", "chain") and s.get("outputs"):
                        out = s["outputs"]
                        final_output = out if isinstance(out, str) else json.dumps(out, default=str)
                        break
                items.append({
                    "trace_id": tid,
                    "input": final_input,
                    "expected_output": "",
                    "actual_output": final_output,
                    "metadata": {"product_id": trace.get("product_id", ""),
                                 "service_name": trace.get("service_name", "")},
                })
    return store.add_items_to_annotation_queue(queue_id, items)


@router.post("/annotation-queues/{queue_id}/items/{item_id}/annotate")
def annotate_queue_item(queue_id: str, item_id: str, body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.annotate_queue_item(queue_id, item_id, body)


@router.post("/annotation-queues/{queue_id}/approve")
def approve_queue_items(queue_id: str, body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    item_ids = body.get("item_ids", [])
    return store.approve_queue_items(queue_id, item_ids)


# ── Dataset Versioning & Splits ───────────────────────────────────────

@router.post("/datasets/{dataset_id}/versions")
def create_dataset_version(dataset_id: str, body: dict = Body(default={})) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    desc = body.get("change_description", "Manual snapshot")
    return store.create_dataset_version(dataset_id, desc)


@router.get("/datasets/{dataset_id}/versions")
def list_dataset_versions(dataset_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    versions = store.list_dataset_versions(dataset_id)
    return {"versions": versions, "count": len(versions)}


@router.post("/datasets/{dataset_id}/versions/{version_id}/restore")
def restore_dataset_version(dataset_id: str, version_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.restore_dataset_version(dataset_id, version_id)


@router.post("/datasets/{dataset_id}/split")
def split_dataset(dataset_id: str, body: dict = Body(default={})) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.split_dataset(
        dataset_id,
        train_ratio=body.get("train_ratio", 0.7),
        test_ratio=body.get("test_ratio", 0.15),
        val_ratio=body.get("val_ratio", 0.15),
    )


@router.post("/datasets/from-feedback")
def create_dataset_from_feedback(body: dict = Body(...)) -> dict:
    """Smart Dataset Builder: create dataset from traces filtered by feedback criteria.

    Body: {"name": "...", "filters": {"feedback_key": "user_feedback", "feedback_value": "False"}}
    For negative feedback dataset: feedback_value="False". For positive: "True".
    """
    import uuid
    from app.storage import get_trace_store
    store = get_trace_store()

    dataset_name = body.get("name", "Feedback Dataset")
    product_id = body.get("product_id", "default")
    filters = body.get("filters", {})
    min_score = filters.get("min_score")
    max_score = filters.get("max_score")
    # Default to user_feedback (matches add_thumbs_feedback which stores key="user_feedback", value="True"/"False")
    feedback_key = filters.get("feedback_key", "user_feedback")
    feedback_value = filters.get("feedback_value")
    limit = body.get("limit", 100)

    filt = {}
    if feedback_key:
        filt["key"] = feedback_key
    if feedback_value is not None:
        filt["value"] = str(feedback_value)
    feedback_docs = list(store._feedback.find(filt).sort("created_at", -1).limit(limit))

    trace_ids = list({f["trace_id"] for f in feedback_docs if f.get("trace_id")})

    if min_score is not None or max_score is not None:
        score_filt = {"trace_id": {"$in": trace_ids}}
        if min_score is not None:
            score_filt.setdefault("score", {})["$gte"] = float(min_score)
        if max_score is not None:
            score_filt.setdefault("score", {})["$lte"] = float(max_score)
        filtered = list(store._feedback.find(score_filt))
        trace_ids = list({f["trace_id"] for f in filtered})

    is_positive = str(feedback_value).lower() in ("true", "1", "yes")
    fb_by_trace = {}
    for fd in feedback_docs:
        fb_by_trace.setdefault(fd.get("trace_id"), []).append({
            "key": fd.get("key", ""), "value": fd.get("value", ""),
            "score": fd.get("score"), "comment": fd.get("comment", ""),
        })

    items = []
    for tid in trace_ids[:limit]:
        trace = store.get(tid)
        if not trace:
            continue
        final_input = store._extract_trace_request(trace)
        actual_output = store._extract_trace_response(trace)
        input_val = final_input if isinstance(final_input, str) else str(final_input or "")
        actual_val = actual_output if isinstance(actual_output, str) else str(actual_output or "")
        items.append({
            "item_id": f"item_{uuid.uuid4().hex[:8]}",
            "input": input_val,
            "expected_output": actual_val if is_positive else "",
            "actual_output": actual_val,
            "needs_review": not is_positive,
            "trace_id": tid,
            "feedback": fb_by_trace.get(tid, []),
            "metadata": {"source": "feedback-builder"},
            "tags": ["from-feedback"],
        })

    dataset_id = f"ds_{uuid.uuid4().hex[:10]}"
    store.create_dataset({
        "dataset_id": dataset_id,
        "name": dataset_name,
        "description": f"Auto-built from feedback ({feedback_key}={feedback_value})",
        "product_id": product_id,
        "items": items,
        "item_count": len(items),
    })
    return {"ok": True, "dataset_id": dataset_id, "item_count": len(items)}


# ── Experiments ───────────────────────────────────────────────────────

@router.post("/experiments")
def create_experiment(body: dict = Body(...)) -> dict:
    import uuid
    from app.storage import get_trace_store
    from app.evaluation_engine import TraceContext, run_single_evaluator
    store = get_trace_store()

    experiment_id = f"exp_{uuid.uuid4().hex[:10]}"
    prompt_id = body.get("prompt_id")
    prompt_version = body.get("prompt_version")
    dataset_id = body.get("dataset_id")
    evaluator_ids = body.get("evaluator_ids", [])
    name = body.get("name", f"Experiment {experiment_id}")
    product_id = body.get("product_id", "default")
    model_config = body.get("model_config", {})

    experiment = {
        "experiment_id": experiment_id,
        "name": name,
        "product_id": product_id,
        "prompt_id": prompt_id,
        "prompt_version": prompt_version,
        "dataset_id": dataset_id,
        "evaluator_ids": evaluator_ids,
        "model_config": model_config,
        "status": "running",
        "results": [],
        "summary": {},
    }
    store.create_experiment(experiment)

    try:
        items = store.get_dataset_items(dataset_id) if dataset_id else []
        evaluators = [store.get_evaluator(eid) for eid in evaluator_ids]
        evaluators = [e for e in evaluators if e]

        evaluator_snapshots = {}
        for e in evaluators:
            eid = e.get("evaluator_id", "")
            cfg = e.get("config") or {}
            logger.info(
                "create_experiment: loaded evaluator %s type=%s rubric='%s...' output_type=%s",
                eid, e.get("type"), str(cfg.get("rubric", ""))[:80], cfg.get("output_type", "score"),
            )
            evaluator_snapshots[eid] = {
                "evaluator_id": eid,
                "name": e.get("name", eid),
                "type": e.get("type", ""),
                "config": cfg,
            }
        experiment["evaluator_snapshots"] = evaluator_snapshots

        results = []
        total_scores = []
        passed_count = 0

        for item in items[:200]:
            actual_output = item.get("actual_output", "")
            expected_output = item.get("expected_output", "")
            model_output = actual_output or expected_output

            item_result = {
                "item_id": item.get("item_id"),
                "input": str(item.get("input", "")),
                "expected_output": str(expected_output),
                "actual_output": str(actual_output),
                "evaluator_scores": {},
            }
            trace_id = item.get("trace_id")
            trace = store.get(trace_id) if trace_id else None

            for evaluator in evaluators:
                try:
                    if trace:
                        ctx = TraceContext.from_trace_dict(trace)
                    else:
                        ctx = TraceContext(
                            trace_id=trace_id or "",
                            final_input=str(item.get("input", "")),
                            final_output=str(model_output),
                        )
                    ground_truth = str(expected_output) if expected_output else None
                    result = run_single_evaluator(evaluator, ctx,
                                                  expected_output=ground_truth)
                    item_result["evaluator_scores"][evaluator["evaluator_id"]] = {
                        "score": result.get("score", 0),
                        "passed": result.get("passed", False),
                        "reasoning": result.get("reasoning", ""),
                        "output_type": result.get("output_type", "score"),
                    }
                except Exception as e:
                    item_result["evaluator_scores"][evaluator["evaluator_id"]] = {
                        "score": 0, "passed": False, "reasoning": f"Error: {e}",
                        "output_type": evaluator.get("config", {}).get("output_type", "score"),
                    }

            all_scores = [v["score"] for v in item_result["evaluator_scores"].values()]
            item_result["avg_score"] = round(sum(all_scores) / len(all_scores), 2) if all_scores else 0
            item_result["all_passed"] = all(v["passed"] for v in item_result["evaluator_scores"].values())
            total_scores.append(item_result["avg_score"])
            if item_result["all_passed"]:
                passed_count += 1
            results.append(item_result)

        evaluator_stats = {}
        for evaluator in evaluators:
            eid = evaluator["evaluator_id"]
            otype = evaluator.get("config", {}).get("output_type", "score")
            ev_scores = []
            ev_true = 0
            ev_false = 0
            for item_result in results:
                es = item_result["evaluator_scores"].get(eid)
                if not es:
                    continue
                ev_scores.append(es["score"])
                otype = es.get("output_type", otype)
                if es["passed"]:
                    ev_true += 1
                else:
                    ev_false += 1
            ev_total = ev_true + ev_false
            evaluator_stats[eid] = {
                "name": evaluator.get("name", eid),
                "output_type": otype,
                "total": ev_total,
                "true_count": ev_true,
                "false_count": ev_false,
                "pass_rate": round(ev_true / ev_total * 100, 1) if ev_total else 0,
                "avg_score": round(sum(ev_scores) / len(ev_scores), 2) if ev_scores else 0,
                "min_score": round(min(ev_scores), 2) if ev_scores else 0,
                "max_score": round(max(ev_scores), 2) if ev_scores else 0,
            }

        summary = {
            "total_items": len(results),
            "avg_score": round(sum(total_scores) / len(total_scores), 2) if total_scores else 0,
            "pass_rate": round(passed_count / len(results) * 100, 1) if results else 0,
            "passed": passed_count,
            "failed": len(results) - passed_count,
            "evaluator_stats": evaluator_stats,
        }

        store.update_experiment(experiment_id, {
            "status": "completed", "results": results, "summary": summary,
        })
        experiment.update({"status": "completed", "results": results, "summary": summary})

    except Exception as e:
        store.update_experiment(experiment_id, {"status": "failed", "error": str(e)})
        experiment["status"] = "failed"
        experiment["error"] = str(e)

    return experiment


@router.get("/experiments")
def list_experiments(
    product_id: Optional[str] = Query(None),
    prompt_id: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    experiments = store.list_experiments(product_id=product_id, prompt_id=prompt_id, limit=limit)
    return {"experiments": experiments, "count": len(experiments)}


@router.get("/experiments/compare")
def compare_experiments(
    experiment_ids: str = Query(..., description="Comma-separated experiment IDs"),
) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    ids = [eid.strip() for eid in experiment_ids.split(",")]
    experiments = []
    for eid in ids:
        exp = store.get_experiment(eid)
        if exp:
            experiments.append(exp)
    if len(experiments) < 2:
        raise HTTPException(status_code=400, detail="Need at least 2 experiments to compare")

    comparison = {
        "experiments": [],
        "item_comparison": [],
    }
    for exp in experiments:
        comparison["experiments"].append({
            "experiment_id": exp["experiment_id"],
            "name": exp.get("name", ""),
            "prompt_version": exp.get("prompt_version"),
            "summary": exp.get("summary", {}),
        })

    base_results = experiments[0].get("results", [])
    for item in base_results:
        item_id = item.get("item_id")
        row = {"item_id": item_id, "input": item.get("input", ""), "scores": {}}
        for exp in experiments:
            exp_item = next((r for r in exp.get("results", []) if r.get("item_id") == item_id), None)
            row["scores"][exp["experiment_id"]] = {
                "avg_score": exp_item.get("avg_score", 0) if exp_item else None,
                "all_passed": exp_item.get("all_passed", False) if exp_item else None,
            }
        comparison["item_comparison"].append(row)

    return comparison


@router.get("/experiments/{experiment_id}")
def get_experiment(experiment_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    doc = store.get_experiment(experiment_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Experiment not found")
    return doc


# ── Evaluation Suites ────────────────────────────────────────────────

@router.post("/evaluation-suites")
def create_evaluation_suite(body: dict = Body(...)) -> dict:
    import uuid
    from app.storage import get_trace_store
    store = get_trace_store()
    body.setdefault("suite_id", f"suite_{uuid.uuid4().hex[:10]}")
    return store.create_evaluation_suite(body)


@router.get("/evaluation-suites")
def list_evaluation_suites(product_id: Optional[str] = Query(None)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    suites = store.list_evaluation_suites(product_id=product_id)
    return {"suites": suites, "count": len(suites)}


@router.get("/evaluation-suites/{suite_id}")
def get_evaluation_suite(suite_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    doc = store.get_evaluation_suite(suite_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Evaluation suite not found")
    return doc


@router.put("/evaluation-suites/{suite_id}")
def update_evaluation_suite(suite_id: str, body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.update_evaluation_suite(suite_id, body)


@router.delete("/evaluation-suites/{suite_id}")
def delete_evaluation_suite(suite_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.delete_evaluation_suite(suite_id)


# ── Prompt Deployments (A/B Testing) ─────────────────────────────────

@router.post("/prompts/{prompt_id}/deploy")
def create_prompt_deployment(prompt_id: str, body: dict = Body(...)) -> dict:
    import uuid
    from app.storage import get_trace_store
    store = get_trace_store()
    body["prompt_id"] = prompt_id
    body.setdefault("deployment_id", f"dep_{uuid.uuid4().hex[:10]}")
    body.setdefault("product_id", "default")
    return store.create_prompt_deployment(body)


@router.get("/prompts/{prompt_id}/deployment")
def get_prompt_deployment(prompt_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    doc = store.get_active_deployment(prompt_id)
    if not doc:
        return {"deployment": None, "message": "No active deployment"}
    return doc


@router.get("/prompts/{prompt_id}/deployment/results")
def get_deployment_results(prompt_id: str) -> dict:
    """Get A/B test results for prompt deployment."""
    from app.storage import get_trace_store
    store = get_trace_store()
    deployment = store.get_active_deployment(prompt_id)
    if not deployment:
        return {"results": None, "message": "No active deployment"}

    variants = deployment.get("variants", [])
    results = []
    for variant in variants:
        ver_num = variant.get("version")
        scores = store.get_scores(config_id=None, source=None)
        variant_traces = list(store._traces.find({
            "metadata.prompt_version": ver_num,
            "metadata.prompt_id": prompt_id,
        }).limit(500))
        trace_ids = [t.get("trace_id") for t in variant_traces]
        variant_scores = store.get_scores_for_traces(trace_ids) if trace_ids else {}

        all_scores = []
        for tid_scores in variant_scores.values():
            for s in tid_scores:
                if isinstance(s.get("value"), (int, float)):
                    all_scores.append(s["value"])

        variant_feedback = list(store._feedback.find({"trace_id": {"$in": trace_ids}}).limit(500)) if trace_ids else []
        thumbs_up = sum(1 for f in variant_feedback if f.get("value") == "up")
        thumbs_down = sum(1 for f in variant_feedback if f.get("value") == "down")

        results.append({
            "version": ver_num,
            "weight": variant.get("weight", 0),
            "trace_count": len(trace_ids),
            "avg_score": round(sum(all_scores) / len(all_scores), 2) if all_scores else None,
            "thumbs_up": thumbs_up,
            "thumbs_down": thumbs_down,
        })

    return {"deployment_id": deployment["deployment_id"], "variants": results}


@router.put("/prompts/{prompt_id}/deployment/{deployment_id}")
def update_prompt_deployment(prompt_id: str, deployment_id: str, body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.update_prompt_deployment(deployment_id, body)


@router.get("/prompts/{prompt_id}/resolve")
def resolve_prompt(prompt_id: str) -> dict:
    """Resolve which prompt version to serve, accounting for A/B deployments."""
    from app.storage import get_trace_store
    store = get_trace_store()
    resolved = store.resolve_prompt_version(prompt_id)
    if not resolved:
        raise HTTPException(status_code=404, detail="Prompt not found")
    version = store.get_prompt_version(prompt_id, resolved["version_number"])
    return {
        "prompt_id": prompt_id,
        "version_number": resolved["version_number"],
        "deployment_id": resolved.get("deployment_id"),
        "variant": resolved.get("variant", "default"),
        "content": version.get("content", "") if version else "",
        "variables": version.get("variables", []) if version else [],
    }


# ── CI/CD Evaluation Webhook ─────────────────────────────────────────

@router.post("/evaluations/ci-run")
def ci_evaluation_run(body: dict = Body(...)) -> dict:
    """Run evaluation suite for CI/CD pipelines. Returns pass/fail with scores."""
    import uuid
    from app.storage import get_trace_store
    from app.evaluation_engine import TraceContext, run_single_evaluator
    store = get_trace_store()

    dataset_id = body.get("dataset_id")
    suite_id = body.get("suite_id")
    evaluator_ids = body.get("evaluator_ids", [])
    prompt_id = body.get("prompt_id")
    prompt_version = body.get("prompt_version")
    threshold = body.get("threshold", 70.0)

    if suite_id:
        suite = store.get_evaluation_suite(suite_id)
        if suite:
            evaluator_ids = suite.get("evaluator_ids", [])

    if not evaluator_ids:
        raise HTTPException(status_code=400, detail="No evaluators specified")
    if not dataset_id:
        raise HTTPException(status_code=400, detail="dataset_id is required")

    items = store.get_dataset_items(dataset_id)
    evaluators = [store.get_evaluator(eid) for eid in evaluator_ids]
    evaluators = [e for e in evaluators if e]

    all_scores = []
    all_passed = 0
    per_evaluator = {e["evaluator_id"]: {"scores": [], "passed": 0, "total": 0}
                     for e in evaluators}

    for item in items[:200]:
        trace_id = item.get("trace_id")
        trace = store.get(trace_id) if trace_id else None
        for evaluator in evaluators:
            try:
                if trace:
                    ctx = TraceContext.from_trace_dict(trace)
                else:
                    ctx = TraceContext(
                        trace_id=trace_id or "",
                        final_input=str(item.get("input", "")),
                        final_output=str(item.get("expected_output", "")),
                    )
                result = run_single_evaluator(evaluator, ctx,
                                              expected_output=str(item.get("expected_output", "")))
                score = result.get("score", 0)
                passed = result.get("passed", False)
                all_scores.append(score)
                if passed:
                    all_passed += 1
                eid = evaluator["evaluator_id"]
                per_evaluator[eid]["scores"].append(score)
                per_evaluator[eid]["total"] += 1
                if passed:
                    per_evaluator[eid]["passed"] += 1
            except Exception:
                eid = evaluator["evaluator_id"]
                per_evaluator[eid]["scores"].append(0)
                per_evaluator[eid]["total"] += 1

    total_evals = len(all_scores)
    avg_score = round(sum(all_scores) / total_evals, 2) if total_evals else 0
    pass_rate = round(all_passed / total_evals * 100, 1) if total_evals else 0
    overall_passed = pass_rate >= threshold

    evaluator_summary = {}
    for eid, data in per_evaluator.items():
        s = data["scores"]
        evaluator_summary[eid] = {
            "avg_score": round(sum(s) / len(s), 2) if s else 0,
            "pass_rate": round(data["passed"] / data["total"] * 100, 1) if data["total"] else 0,
            "total": data["total"],
        }

    return {
        "passed": overall_passed,
        "avg_score": avg_score,
        "pass_rate": pass_rate,
        "threshold": threshold,
        "total_evaluations": total_evals,
        "evaluator_summary": evaluator_summary,
        "gate_status": "PASS" if overall_passed else "FAIL",
    }


# ── Evaluation Results Export ─────────────────────────────────────────

@router.get("/evaluations/runs/{run_id}/export")
def export_evaluation_run(run_id: str, format: str = Query("json")) -> Any:
    from app.storage import get_trace_store
    store = get_trace_store()
    run = store.get_evaluation_run(run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")

    if format == "csv":
        import csv
        import io
        output = io.StringIO()
        results = run.get("results", [])
        if not results:
            return StreamingResponse(io.BytesIO(b"No results"), media_type="text/csv")
        fieldnames = list(results[0].keys()) if results else ["trace_id", "score", "passed"]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            row = {}
            for k in fieldnames:
                v = r.get(k, "")
                row[k] = json.dumps(v, default=str) if isinstance(v, (dict, list)) else v
            writer.writerow(row)
        csv_bytes = output.getvalue().encode("utf-8")
        return StreamingResponse(
            io.BytesIO(csv_bytes), media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=eval_run_{run_id}.csv"},
        )

    run.pop("_id", None)
    return run


@router.get("/experiments/{experiment_id}/export")
def export_experiment(experiment_id: str, format: str = Query("json")) -> Any:
    from app.storage import get_trace_store
    store = get_trace_store()
    exp = store.get_experiment(experiment_id)
    if not exp:
        raise HTTPException(status_code=404, detail="Experiment not found")

    if format == "csv":
        import csv
        import io
        output = io.StringIO()
        results = exp.get("results", [])
        if not results:
            return StreamingResponse(io.BytesIO(b"No results"), media_type="text/csv")
        fieldnames = ["item_id", "input", "expected_output", "avg_score", "all_passed"]
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for r in results:
            writer.writerow({k: r.get(k, "") for k in fieldnames})
        csv_bytes = output.getvalue().encode("utf-8")
        return StreamingResponse(
            io.BytesIO(csv_bytes), media_type="text/csv",
            headers={"Content-Disposition": f"attachment; filename=experiment_{experiment_id}.csv"},
        )

    exp.pop("_id", None)
    return exp


# ── Scheduled Evaluations ────────────────────────────────────────────

@router.post("/scheduled-evaluations")
def create_scheduled_evaluation(body: dict = Body(...)) -> dict:
    import uuid
    from app.storage import get_trace_store
    store = get_trace_store()
    body.setdefault("schedule_id", f"sched_{uuid.uuid4().hex[:10]}")
    return store.create_scheduled_evaluation(body)


@router.get("/scheduled-evaluations")
def list_scheduled_evaluations(product_id: Optional[str] = Query(None)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    schedules = store.list_scheduled_evaluations(product_id=product_id)
    return {"schedules": schedules, "count": len(schedules)}


@router.get("/scheduled-evaluations/{schedule_id}")
def get_scheduled_evaluation(schedule_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    doc = store.get_scheduled_evaluation(schedule_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Scheduled evaluation not found")
    return doc


@router.put("/scheduled-evaluations/{schedule_id}")
def update_scheduled_evaluation(schedule_id: str, body: dict = Body(...)) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.update_scheduled_evaluation(schedule_id, body)


@router.delete("/scheduled-evaluations/{schedule_id}")
def delete_scheduled_evaluation(schedule_id: str) -> dict:
    from app.storage import get_trace_store
    store = get_trace_store()
    return store.delete_scheduled_evaluation(schedule_id)
