"""MongoDB storage for traces, spans, feedback, and dashboards."""

import json
import os
import logging
from datetime import datetime, timedelta
from typing import Optional, List
from collections import defaultdict

from bson import ObjectId

from app.storage import TraceRow

logger = logging.getLogger("cluco.storage.mongodb")

try:
    from pymongo import MongoClient
    _MONGO_AVAILABLE = True
except ImportError:
    _MONGO_AVAILABLE = False

_mongo_client = None


def _get_db():
    global _mongo_client
    if _mongo_client is None:
        if not _MONGO_AVAILABLE:
            raise RuntimeError("pymongo not installed")
        uri = (os.getenv("MONGODB_URI") or "mongodb://localhost:27017").strip()
        _mongo_client = MongoClient(uri, serverSelectionTimeoutMS=3000)
    db_name = (os.getenv("MONGODB_DB") or "cluco_observability").strip()
    return _mongo_client[db_name]


class MongoTraceStore:
    def __init__(self):
        db = _get_db()
        self._db = db
        self._traces = db["traces"]
        self._spans = db["spans"]
        self._feedback = db["feedback"]
        self._evaluations = db["evaluations"]
        self._alerts = db["alerts"]
        self._prompt_versions = db["prompt_versions"]
        self._evaluators = db["evaluators"]
        self._datasets = db["datasets"]
        self._evaluation_runs = db["evaluation_runs"]
        self._labeling_sessions = db["labeling_sessions"]
        self._labeling_schemas = db["labeling_schemas"]
        self._judge_monitor_config = db["judge_monitor_config"]
        self._prompt_templates = db["prompt_templates"]
        self._prompt_template_versions = db["prompt_template_versions"]
        # Phase 1-4 new collections
        self._score_configs = db["score_configs"]
        self._scores = db["scores"]
        self._annotation_queues = db["annotation_queues"]
        self._dataset_versions = db["dataset_versions"]
        self._experiments = db["experiments"]
        self._evaluation_suites = db["evaluation_suites"]
        self._prompt_deployments = db["prompt_deployments"]
        self._scheduled_evaluations = db["scheduled_evaluations"]
        self._ensure_indexes()
        self._seed_builtin_evaluators()
        self._cleanup_legacy_seed_prompts()

    def _ensure_indexes(self):
        try:
            self._traces.create_index("trace_id", unique=True)
            self._traces.create_index([("product_id", 1), ("created_at", -1)])
            self._traces.create_index("session_id")
            self._traces.create_index("service_name")
            self._traces.create_index("status")
            self._spans.create_index("trace_id")
            self._spans.create_index([("span_id", 1), ("trace_id", 1)])
            self._spans.create_index("kind")
            self._spans.create_index("parent_span_id")
            self._feedback.create_index("trace_id")
            self._feedback.create_index([("key", 1), ("value", 1), ("trace_id", 1)])
            self._evaluations.create_index("trace_id")
            self._evaluations.create_index([("agent_name", 1), ("created_at", -1)])
            self._evaluations.create_index([("product_id", 1), ("created_at", -1)])
            self._alerts.create_index("trace_id")
            self._alerts.create_index([("product_id", 1), ("created_at", -1)])
            self._alerts.create_index("alert_type")
            self._prompt_versions.create_index([("prompt_hash", 1), ("agent_name", 1)], unique=True)
            self._prompt_versions.create_index([("agent_name", 1), ("last_seen", -1)])
            # Evaluation framework collections
            self._evaluators.create_index("evaluator_id", unique=True)
            self._evaluators.create_index("type")
            self._datasets.create_index("dataset_id", unique=True)
            self._datasets.create_index([("product_id", 1), ("created_at", -1)])
            self._evaluation_runs.create_index("run_id", unique=True)
            self._evaluation_runs.create_index([("product_id", 1), ("created_at", -1)])
            self._evaluation_runs.create_index("trace_id")
            self._evaluation_runs.create_index("status")
            self._labeling_sessions.create_index("session_id", unique=True)
            self._labeling_sessions.create_index("created_at")
            self._labeling_schemas.create_index("schema_id", unique=True)
            self._judge_monitor_config.create_index("evaluator_id", unique=True)
            self._prompt_templates.create_index("prompt_id", unique=True)
            self._prompt_template_versions.create_index([("prompt_id", 1), ("version_number", 1)], unique=True)
            # Phase 1-4 indexes
            self._score_configs.create_index("config_id", unique=True)
            self._score_configs.create_index("product_id")
            self._scores.create_index([("trace_id", 1), ("config_id", 1)])
            self._scores.create_index("source")
            self._scores.create_index("created_at")
            self._annotation_queues.create_index("queue_id", unique=True)
            self._annotation_queues.create_index("product_id")
            self._dataset_versions.create_index([("dataset_id", 1), ("version_id", 1)], unique=True)
            self._experiments.create_index("experiment_id", unique=True)
            self._experiments.create_index([("product_id", 1), ("created_at", -1)])
            self._evaluation_suites.create_index("suite_id", unique=True)
            self._prompt_deployments.create_index("deployment_id", unique=True)
            self._prompt_deployments.create_index([("prompt_id", 1), ("status", 1)])
            self._scheduled_evaluations.create_index("schedule_id", unique=True)
        except Exception as e:
            logger.debug("Index creation: %s", e)

    # ── Seed built-in evaluators ──────────────────────────────────────
    def _seed_builtin_evaluators(self):
        """Populate built-in evaluator definitions on first boot (idempotent)."""
        try:
            from app.evaluation_engine import get_builtin_evaluator_definitions
            for defn in get_builtin_evaluator_definitions():
                self._evaluators.update_one(
                    {"evaluator_id": defn["evaluator_id"]},
                    {"$setOnInsert": {**defn, "created_at": datetime.utcnow()}},
                    upsert=True,
                )
        except Exception as e:
            logger.debug("Evaluator seeding: %s", e)

    def _cleanup_legacy_seed_prompts(self):
        """Remove hardcoded TravelMind seed prompts so the registry is dynamic."""
        try:
            r1 = self._prompt_templates.delete_many({"product_id": "travelmind"})
            r2 = self._prompt_template_versions.delete_many({
                "prompt_id": {"$regex": "^travelmind-"}
            })
            if r1.deleted_count or r2.deleted_count:
                logger.info(
                    "Cleaned legacy seed prompts: %d templates, %d versions",
                    r1.deleted_count, r2.deleted_count,
                )
        except Exception as e:
            logger.debug("Legacy prompt cleanup: %s", e)

    # ── Seed default prompt templates (TravelMind agents + ReAct wrapper) ──
    def _seed_default_prompt_templates(self):
        """Idempotently seed TravelMind agent prompts into the prompt registry."""
        try:
            _SEED_PROMPTS = {
                "travelmind-orchestrator": {
                    "name": "TravelMind Orchestrator",
                    "agent_name": "orchestrator",
                    "description": "Classifies intent, extracts travel parameters, enforces guardrails",
                    "content": (
                        "You are TravelMind, a friendly AI travel assistant. You ONLY help with travel-related queries.\n\n"
                        "IMPORTANT RULES:\n"
                        "- If the user greets you, set intent = \"greeting\"\n"
                        "- If the user asks what you can do or asks for help, set intent = \"capabilities\"\n"
                        "- If the query is NOT related to travel, set intent = \"off_topic\"\n"
                        "- If a multi-step task is in progress and the user confirms, set intent = \"resume_task\"\n"
                        "- If a multi-step task is in progress and the user wants changes, set intent = \"modify_task\"\n"
                        "- For travel queries, classify as: flight, hotel, attraction, weather, plan, clarify, web_search\n\n"
                        "Extract: intent, destination, origin, dates, budget, interests, travelers, needs_clarification, clarification_question, detected_topic.\n"
                        "Return valid JSON only."
                    ),
                },
                "travelmind-flight": {
                    "name": "TravelMind Flight Agent",
                    "agent_name": "flight",
                    "description": "Searches flights via Amadeus API",
                    "content": (
                        "You are a flight search specialist. Use the search_flights tool to find flights.\n"
                        "Extract origin/destination IATA codes from the conversation context.\n"
                        "Common codes: NYC=JFK, London=LHR, Paris=CDG, Tokyo=NRT, Barcelona=BCN, Rome=FCO, LA=LAX, SF=SFO.\n"
                        "Present results clearly with price, airline, duration, and stops.\n\n"
                        "CRITICAL: NEVER assume or fabricate departure dates, return dates, or origin airports. "
                        "The search_flights tool requires origin, destination, and departure_date. If any of these "
                        "are NOT provided in the context, do NOT call the tool. Instead, write a Final Answer "
                        "politely asking the user for the missing information."
                    ),
                },
                "travelmind-hotel": {
                    "name": "TravelMind Hotel Agent",
                    "agent_name": "hotel",
                    "description": "Searches hotels via Amadeus API",
                    "content": (
                        "You are a hotel search specialist. Use the search_hotels tool.\n"
                        "Common IATA city codes: Barcelona=BCN, Paris=PAR, Tokyo=TYO, Rome=ROM, London=LON, NYC=NYC.\n"
                        "Present results with name, rating, price per night.\n\n"
                        "CRITICAL: NEVER assume or fabricate check-in/check-out dates. The search_hotels tool "
                        "requires check_in and check_out dates. If dates are NOT provided in the context, "
                        "do NOT call the tool. Instead, write a Final Answer politely asking the user for "
                        "their check-in and check-out dates."
                    ),
                },
                "travelmind-attraction": {
                    "name": "TravelMind Attraction Agent",
                    "agent_name": "attraction",
                    "description": "Finds attractions via OpenTripMap",
                    "content": (
                        "You are a tourist attraction specialist. Search for interesting places and combine results "
                        "from the OpenTripMap API and any uploaded travel guides. Highlight must-see attractions, "
                        "hidden gems, and food spots."
                    ),
                },
                "travelmind-web-search": {
                    "name": "TravelMind Web Search Agent",
                    "agent_name": "web_search",
                    "description": "Answers general travel questions via web search",
                    "content": (
                        "You are a travel information specialist. Use web search to answer questions about visa requirements, "
                        "local customs, safety tips, transportation, and general travel advice. Provide concise, actionable "
                        "answers with sources."
                    ),
                },
                "travelmind-planner": {
                    "name": "TravelMind Planner",
                    "agent_name": "planner",
                    "description": "Generates day-by-day itineraries",
                    "content": (
                        "You are an expert travel itinerary planner. Given flight, hotel, attraction, and weather data, "
                        "compose a detailed day-by-day itinerary.\n\n"
                        "Format your response as JSON with this structure:\n"
                        '{"destination":"city","days":[{"day":1,"date":"YYYY-MM-DD","title":"Arrival & Exploration",'
                        '"morning":{"activity":"...","location":"...","notes":"..."},'
                        '"afternoon":{"activity":"...","location":"...","notes":"..."},'
                        '"evening":{"activity":"...","location":"...","notes":"..."}}],'
                        '"tips":["..."],"estimated_budget":{"flights":"...","hotel_total":"...","daily_spending":"...","total":"..."}}\n\n'
                        "Consider weather when planning outdoor activities. Include restaurant recommendations."
                    ),
                },
                "travelmind-compose": {
                    "name": "TravelMind Compose",
                    "agent_name": "compose",
                    "description": "Composes final user-facing response from agent data",
                    "content": (
                        "You are a friendly travel assistant. Synthesize the following travel data into a helpful, "
                        "conversational response. Use markdown formatting. Be enthusiastic but concise."
                    ),
                },
                "travelmind-greeting": {
                    "name": "TravelMind Greeting",
                    "agent_name": "greeting",
                    "description": "Handles user greetings with warm welcome",
                    "content": (
                        "You are TravelMind, a warm and friendly AI travel planning assistant. "
                        "Greet the user warmly, introduce yourself briefly, list your capabilities, "
                        "and offer sample prompts they can try."
                    ),
                },
                "travelmind-react-wrapper": {
                    "name": "TravelMind ReAct Wrapper",
                    "agent_name": "react_executor",
                    "description": "ReAct reasoning+acting loop wrapper that frames tool-use for all agents",
                    "content": (
                        "You solve problems step-by-step using the following format:\n\n"
                        "Thought: [your reasoning about what to do next]\n"
                        "Action: tool_name(key1=\"value1\", key2=\"value2\", num_key=123)\n"
                        "Observation: [result -- filled by system, do NOT write this yourself]\n"
                        "... (repeat Thought/Action/Observation as needed)\n"
                        "Thought: I now have enough information to answer.\n"
                        "Final Answer: [your complete response to the user]\n\n"
                        "RULES:\n"
                        "- Always start with a Thought.\n"
                        "- If you need data, use an Action to call a tool.\n"
                        "- Use keyword arguments: tool_name(key=\"string_value\", num_key=42). Strings must be quoted.\n"
                        "- IMPORTANT: All dates MUST be in the future. Never use past dates.\n"
                        "- After an Action, STOP and wait for the Observation.\n"
                        "- When you have enough information, write \"Final Answer:\" with your response.\n"
                        "- Never fabricate Observations.\n"
                        "- NEVER invent, assume, or fabricate values for required tool parameters that the user has not provided."
                    ),
                },
            }

            now = datetime.utcnow()
            for prompt_id, seed in _SEED_PROMPTS.items():
                existing = self._prompt_templates.find_one({"prompt_id": prompt_id})
                if existing:
                    continue
                tmpl = {
                    "prompt_id": prompt_id,
                    "name": seed["name"],
                    "agent_name": seed.get("agent_name", ""),
                    "product_id": "travelmind",
                    "description": seed.get("description", ""),
                    "version_count": 1,
                    "created_at": now,
                    "updated_at": now,
                }
                self._prompt_templates.insert_one(tmpl)
                ver = {
                    "prompt_id": prompt_id,
                    "version_number": 1,
                    "content": seed["content"],
                    "variables": [],
                    "tags": ["seed", "default"],
                    "aliases": ["latest"],
                    "model": "",
                    "created_at": now,
                }
                self._prompt_template_versions.insert_one(ver)
                logger.info("Seeded prompt template: %s", prompt_id)

        except Exception as e:
            logger.debug("Prompt template seeding: %s", e)

    def ingest(self, trace_id: str, payload: dict) -> dict:
        from app.cost import compute_trace_cost
        payload = compute_trace_cost(payload)
        now = datetime.utcnow()
        trace_doc = {
            "trace_id": trace_id,
            "session_id": payload.get("session_id") or "",
            "product_id": payload.get("product_id") or "default",
            "service_name": payload.get("service_name") or "agent",
            "environment": payload.get("environment", "development"),
            "start_time_ns": payload.get("start_time_ns") or 0,
            "end_time_ns": payload.get("end_time_ns") or 0,
            "latency_ms": payload.get("latency_ms") or 0.0,
            "status": payload.get("status", "ok"),
            "total_tokens": payload.get("total_tokens") or 0,
            "total_cost_usd": payload.get("total_cost_usd") or 0.0,
            "error": payload.get("error"),
            "metadata": payload.get("metadata", {}),
            "tags": payload.get("tags", []),
            "payload": payload,
            "created_at": now,
            "updated_at": now,
        }
        self._traces.update_one(
            {"trace_id": trace_id},
            {"$set": trace_doc},
            upsert=True,
        )
        spans = payload.get("spans", [])
        if spans:
            self._flatten_and_store_spans(trace_id, spans)
            req_preview = self._extract_preview_from_payload(payload, "request")
            resp_preview = self._extract_preview_from_payload(payload, "response")
            if req_preview or resp_preview:
                self._traces.update_one(
                    {"trace_id": trace_id},
                    {"$set": {"request_preview": req_preview[:200] if req_preview else "",
                              "response_preview": resp_preview[:200] if resp_preview else ""}},
                )
            try:
                self.finalize_trace(trace_id, status=payload.get("status", "ok"),
                                    session_id=payload.get("session_id"))
            except Exception as e:
                logger.warning("Auto-finalize after ingest failed for %s: %s", trace_id, e)
        return {"ok": True, "trace_id": trace_id, "status": "ingested"}

    def ingest_batch(self, traces: list) -> dict:
        ingested = 0
        feedback_count = 0
        span_streamed = 0
        for t in traces:
            trace_type = t.get("type", "trace")
            if trace_type == "feedback":
                self._store_feedback(t)
                feedback_count += 1
            elif trace_type == "span_stream":
                trace_id = t.get("trace_id", "")
                span_data = t.get("span") or {}
                if trace_id and span_data:
                    self.stream_span(
                        trace_id,
                        span_data,
                        product_id=t.get("product_id", "default"),
                        service_name=t.get("service_name", "agent"),
                        session_id=t.get("session_id", ""),
                    )
                    span_streamed += 1
            else:
                trace_id = t.get("trace_id", "")
                if trace_id:
                    self.ingest(trace_id, t)
                    ingested += 1
        return {"ok": True, "ingested": ingested, "feedback": feedback_count, "span_streamed": span_streamed}

    def stream_span(self, trace_id: str, span_data: dict,
                    product_id: str = "default", service_name: str = "agent",
                    session_id: str = "") -> dict:
        now = datetime.utcnow()
        update_ops: dict = {
            "$setOnInsert": {
                "trace_id": trace_id,
                "product_id": product_id,
                "service_name": service_name,
                "environment": "development",
                "status": "running",
                "start_time_ns": span_data.get("start_time_ns", 0),
                "total_tokens": 0,
                "total_cost_usd": 0.0,
                "metadata": {},
                "tags": [],
                "payload": {},
                "created_at": now,
            },
            "$set": {
                "updated_at": now,
                "session_id": session_id or "",
            },
        }
        self._traces.update_one(
            {"trace_id": trace_id},
            update_ops,
            upsert=True,
        )
        span_doc = {
            "trace_id": trace_id,
            "span_id": span_data.get("span_id", ""),
            "parent_span_id": span_data.get("parent_span_id"),
            "name": span_data.get("name", ""),
            "kind": span_data.get("kind", "chain"),
            "status": span_data.get("status", "ok"),
            "start_time_ns": span_data.get("start_time_ns", 0),
            "end_time_ns": span_data.get("end_time_ns", 0),
            "duration_ms": span_data.get("duration_ms", 0),
            "inputs": span_data.get("inputs"),
            "outputs": span_data.get("outputs"),
            "metadata": span_data.get("metadata", {}),
            "tags": span_data.get("tags", []),
            "events": span_data.get("events", []),
            "error": span_data.get("error"),
            "llm": span_data.get("llm"),
            "tool": span_data.get("tool"),
            "retriever": span_data.get("retriever"),
            "embedding": span_data.get("embedding"),
            "streamed_at": now,
        }
        # Store LLM prompt/response at top level (same as ingest) so they appear in DB and UI
        llm = span_data.get("llm")
        if isinstance(llm, dict):
            if llm.get("prompt_messages") is not None:
                span_doc["prompt_messages"] = llm["prompt_messages"]
            if llm.get("completion") is not None:
                span_doc["completion"] = llm["completion"]
        self._spans.update_one(
            {"span_id": span_doc["span_id"], "trace_id": trace_id},
            {"$set": span_doc},
            upsert=True,
        )
        inc_tokens = 0
        inc_cost = 0.0
        llm = span_data.get("llm")
        if isinstance(llm, dict):
            inc_tokens += llm.get("total_tokens", 0) or 0
            inc_cost += llm.get("cost_usd", 0.0) or 0.0
        emb = span_data.get("embedding")
        if isinstance(emb, dict):
            inc_tokens += emb.get("input_tokens", 0) or 0
            inc_cost += emb.get("cost_usd", 0.0) or 0.0
        if inc_tokens or inc_cost:
            self._traces.update_one(
                {"trace_id": trace_id},
                {
                    "$inc": {
                        "total_tokens": inc_tokens,
                        "total_cost_usd": inc_cost,
                    },
                },
            )
        return {"ok": True, "trace_id": trace_id, "span_id": span_doc["span_id"], "status": "streamed"}

    def _flatten_and_store_spans(self, trace_id: str, spans: list, parent_id: str = None):
        for span_data in spans:
            llm = span_data.get("llm")
            if not isinstance(llm, dict):
                llm = None
            span_doc = {
                "trace_id": trace_id,
                "span_id": span_data.get("span_id", ""),
                "parent_span_id": span_data.get("parent_span_id") or parent_id,
                "name": span_data.get("name", ""),
                "kind": span_data.get("kind", "chain"),
                "status": span_data.get("status", "ok"),
                "start_time_ns": span_data.get("start_time_ns", 0),
                "end_time_ns": span_data.get("end_time_ns", 0),
                "duration_ms": span_data.get("duration_ms", 0),
                "inputs": span_data.get("inputs"),
                "outputs": span_data.get("outputs"),
                "metadata": span_data.get("metadata", {}),
                "tags": span_data.get("tags", []),
                "events": span_data.get("events", []),
                "error": span_data.get("error"),
                "llm": span_data.get("llm"),
                "tool": span_data.get("tool"),
                "retriever": span_data.get("retriever"),
                "embedding": span_data.get("embedding"),
            }
            # Store LLM prompt and response at top level so they are visible in MongoDB and not dropped
            if llm:
                if llm.get("prompt_messages") is not None:
                    span_doc["prompt_messages"] = llm["prompt_messages"]
                if llm.get("completion") is not None:
                    span_doc["completion"] = llm["completion"]
            self._spans.update_one(
                {"span_id": span_doc["span_id"], "trace_id": trace_id},
                {"$set": span_doc},
                upsert=True,
            )
            children = span_data.get("children", [])
            if children:
                self._flatten_and_store_spans(trace_id, children, span_doc["span_id"])

    def _store_feedback(self, data: dict):
        fb = data.get("feedback", {})
        doc = {
            "trace_id": data.get("trace_id", ""),
            "span_id": fb.get("span_id", ""),
            "key": fb.get("key", ""),
            "score": fb.get("score"),
            "value": fb.get("value"),
            "comment": fb.get("comment"),
            "source": fb.get("source", "sdk"),
            "product_id": data.get("product_id", "default"),
            "timestamp_ns": fb.get("timestamp_ns", 0),
            "created_at": datetime.utcnow(),
        }
        self._feedback.insert_one(doc)

    @staticmethod
    def _enrich_flat_span(s: dict) -> dict:
        s["_id"] = str(s["_id"])
        llm = s.get("llm")
        if isinstance(llm, dict):
            s.setdefault("model", llm.get("model"))
            s.setdefault("provider", llm.get("provider"))
            s.setdefault("input_tokens", llm.get("input_tokens", 0))
            s.setdefault("output_tokens", llm.get("output_tokens", 0))
            s.setdefault("total_tokens", llm.get("total_tokens", 0))
            s.setdefault("cost_usd", llm.get("cost_usd", 0))
            if "prompt_messages" in llm:
                s.setdefault("prompt_messages", llm["prompt_messages"])
            if "completion" in llm:
                s.setdefault("completion", llm["completion"])
        retriever = s.get("retriever")
        if isinstance(retriever, dict):
            s.setdefault("query", retriever.get("query"))
            if retriever.get("documents"):
                s.setdefault("documents", retriever["documents"])
                s.setdefault("retrieved_documents", retriever["documents"])
            if retriever.get("scores"):
                s.setdefault("retrieval_scores", retriever["scores"])
        tool_data = s.get("tool")
        if isinstance(tool_data, dict):
            s.setdefault("tool_name", tool_data.get("name"))
            s.setdefault("tool_input", tool_data.get("input"))
            s.setdefault("tool_output", tool_data.get("output"))
        emb = s.get("embedding")
        if isinstance(emb, dict):
            s.setdefault("embedding_model", emb.get("model"))
            s.setdefault("embedding_dimensions", emb.get("dimensions"))
            s.setdefault("embedding_count", emb.get("count"))
            if emb.get("input_tokens") is not None:
                s.setdefault("input_tokens", emb["input_tokens"])
            if emb.get("cost_usd") is not None:
                s.setdefault("cost_usd", emb["cost_usd"])
        dur_ms = s.get("duration_ms")
        if not dur_ms:
            start = s.get("start_time_ns", 0) or 0
            end = s.get("end_time_ns", 0) or 0
            if start and end:
                s["duration_ms"] = (end - start) / 1e6
            s.setdefault("latency_ms", s.get("duration_ms", 0))
        else:
            s.setdefault("latency_ms", dur_ms)
        return s

    def get(self, trace_id: str) -> Optional[dict]:
        doc = self._traces.find_one({"trace_id": trace_id})
        if not doc:
            return None
        payload = doc.get("payload") or {}
        if isinstance(payload, dict) and payload:
            result = dict(payload)
        else:
            result = {
                "trace_id": doc["trace_id"],
                "session_id": doc.get("session_id", ""),
                "product_id": doc.get("product_id", "default"),
                "latency_ms": doc.get("latency_ms", 0),
                "total_tokens": doc.get("total_tokens", 0),
                "spans": [],
            }
        result["total_cost_usd"] = doc.get("total_cost_usd", 0)
        result["status"] = doc.get("status", "ok")
        result["environment"] = doc.get("environment", "")
        result["created_at"] = doc["created_at"].isoformat() if doc.get("created_at") else None
        feedback = list(self._feedback.find({"trace_id": trace_id}))
        for fb in feedback:
            fb["_id"] = str(fb["_id"])
        result["feedback"] = feedback
        flat_spans = list(self._spans.find({"trace_id": trace_id}))
        span_by_id = {}
        for s in flat_spans:
            self._enrich_flat_span(s)
            span_by_id[s.get("span_id", "")] = s
        for s in flat_spans:
            pid = s.get("parent_span_id")
            if pid and pid in span_by_id:
                parent = span_by_id[pid]
                pname = parent.get("name", "")
                pkind = parent.get("kind", "")
                if pkind == "agent" or pname.startswith("agent:"):
                    agent_label = pname.replace("agent:", "").strip() or pname
                    s.setdefault("parent_agent", agent_label)
        result["flat_spans"] = flat_spans

        if flat_spans:
            import copy
            tree_spans = [copy.deepcopy(s) for s in flat_spans]
            root_spans = []
            children_map = {}
            for s in tree_spans:
                pid = s.get("parent_span_id")
                if pid:
                    children_map.setdefault(pid, []).append(s)
                else:
                    root_spans.append(s)
            def attach_children(span):
                sid = span.get("span_id", "")
                kids = children_map.get(sid, [])
                kids.sort(key=lambda x: x.get("start_time_ns", 0))
                if kids:
                    span["children"] = kids
                    for k in kids:
                        attach_children(k)
            for rs in root_spans:
                attach_children(rs)
            root_spans.sort(key=lambda x: x.get("start_time_ns", 0))
            result["spans"] = root_spans

        return result

    def list_traces(self, product_id=None, session_id=None, service_name=None,
                    status=None, environment=None,
                    assessment_name=None, assessment_value=None,
                    limit=50, offset=0) -> dict:
        query = {}
        if product_id:
            query["product_id"] = product_id
        if session_id:
            query["session_id"] = session_id
        if service_name:
            query["service_name"] = service_name
        if status:
            query["status"] = status
        if environment:
            query["environment"] = environment

        if assessment_name:
            fb_query = {"key": assessment_name}
            if assessment_value is not None:
                fb_query["value"] = assessment_value
            matching_tids = list({fb["trace_id"] for fb in self._feedback.find(fb_query, {"trace_id": 1})})
            query["trace_id"] = {"$in": matching_tids}

        total = self._traces.count_documents(query)
        docs = list(
            self._traces.find(query)
            .sort("created_at", -1)
            .skip(offset)
            .limit(limit)
        )
        traces = []
        for d in docs:
            req = d.get("request_preview", "")
            resp = d.get("response_preview", "")
            if not req and not resp:
                payload = d.get("payload") or {}
                req = self._extract_preview_from_payload(payload, "request")
                resp = self._extract_preview_from_payload(payload, "response")
            traces.append({
                "trace_id": d["trace_id"],
                "session_id": d.get("session_id", ""),
                "product_id": d.get("product_id", "default"),
                "service_name": d.get("service_name", "agent"),
                "latency_ms": d.get("latency_ms", 0),
                "total_tokens": d.get("total_tokens", 0),
                "total_cost_usd": d.get("total_cost_usd", 0),
                "llm_tokens": d.get("llm_tokens", 0),
                "llm_cost_usd": d.get("llm_cost_usd", 0),
                "llm_calls": d.get("llm_calls", 0),
                "embedding_tokens": d.get("embedding_tokens", 0),
                "embedding_cost_usd": d.get("embedding_cost_usd", 0),
                "embedding_calls": d.get("embedding_calls", 0),
                "status": d.get("status", "ok"),
                "environment": d.get("environment", ""),
                "created_at": d["created_at"].isoformat() if d.get("created_at") else None,
                "request": req,
                "response": resp,
            })
        return {"traces": traces, "count": len(traces), "total": total}

    def get_all_traces(self, product_id=None, session_id=None) -> List[TraceRow]:
        filt = {}
        if product_id:
            filt["product_id"] = product_id
        if session_id:
            filt["session_id"] = session_id
        cursor = self._traces.find(filt).sort("created_at", -1).limit(1000)
        return [
            TraceRow(
                doc["trace_id"], doc.get("session_id", ""), doc.get("product_id", "default"),
                doc.get("service_name", "agent"), doc.get("start_time_ns", 0), doc.get("end_time_ns", 0),
                doc.get("latency_ms", 0), doc.get("total_tokens", 0),
                doc.get("payload") or {}, doc.get("created_at"),
                total_cost_usd=doc.get("total_cost_usd") or (doc.get("payload") or {}).get("total_cost_usd", 0) or 0,
            )
            for doc in cursor
        ]

    def get_spans(self, trace_id=None, kind=None, limit=200) -> list:
        query = {}
        if trace_id:
            query["trace_id"] = trace_id
        if kind:
            query["kind"] = kind
        docs = list(self._spans.find(query).sort("start_time_ns", 1).limit(limit))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    def _resolve_parent_agents(self, docs: list):
        parent_ids = set()
        for d in docs:
            pid = d.get("parent_span_id")
            if pid:
                parent_ids.add(pid)
        if not parent_ids:
            return
        parents = {p["span_id"]: p for p in self._spans.find(
            {"span_id": {"$in": list(parent_ids)}},
            {"span_id": 1, "name": 1, "kind": 1}
        )}
        for d in docs:
            pid = d.get("parent_span_id")
            if pid and pid in parents:
                p = parents[pid]
                pname = p.get("name", "")
                pkind = p.get("kind", "")
                if pkind == "agent" or pname.startswith("agent:"):
                    d["parent_agent"] = pname.replace("agent:", "").strip() or pname

    def get_llm_calls(self, trace_id=None, product_id=None, limit=100) -> list:
        query = {"kind": "llm"}
        if trace_id:
            query["trace_id"] = trace_id
        if product_id:
            trace_ids = [t["trace_id"] for t in self._traces.find({"product_id": product_id}, {"trace_id": 1}).limit(500)]
            query["trace_id"] = {"$in": trace_ids}
        docs = list(self._spans.find(query).sort("start_time_ns", -1).limit(limit))
        for d in docs:
            self._enrich_flat_span(d)
        self._resolve_parent_agents(docs)
        return docs

    def get_tool_calls(self, trace_id=None, limit=100) -> list:
        query = {"kind": "tool"}
        if trace_id:
            query["trace_id"] = trace_id
        docs = list(self._spans.find(query).sort("start_time_ns", -1).limit(limit))
        for d in docs:
            self._enrich_flat_span(d)
        return docs

    def get_retriever_calls(self, trace_id=None, limit=100) -> list:
        query = {"kind": "retriever"}
        if trace_id:
            query["trace_id"] = trace_id
        docs = list(self._spans.find(query).sort("start_time_ns", -1).limit(limit))
        for d in docs:
            self._enrich_flat_span(d)
        return docs

    def get_embedding_calls(self, trace_id=None, limit=100) -> list:
        query = {"kind": "embedding"}
        if trace_id:
            query["trace_id"] = trace_id
        docs = list(self._spans.find(query).sort("start_time_ns", -1).limit(limit))
        for d in docs:
            self._enrich_flat_span(d)
        return docs

    def get_feedback(self, trace_id=None, key=None, limit=100) -> list:
        query = {}
        if trace_id:
            query["trace_id"] = trace_id
        if key:
            query["key"] = key
        docs = list(self._feedback.find(query).sort("created_at", -1).limit(limit))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    def add_feedback(self, trace_id: str, key: str, score=None, value=None,
                     comment=None, source="api", span_id="") -> dict:
        doc = {
            "trace_id": trace_id,
            "span_id": span_id,
            "key": key,
            "score": score,
            "value": value,
            "comment": comment,
            "source": source,
            "created_at": datetime.utcnow(),
        }
        r = self._feedback.insert_one(doc)
        return {"ok": True, "id": str(r.inserted_id)}

    def get_trace_assessments(self, trace_id: str) -> dict:
        """Get all assessments (feedback + judge results) for a trace, grouped by key."""
        feedback = list(self._feedback.find({"trace_id": trace_id}).sort("created_at", -1))
        by_key = {}
        for fb in feedback:
            fb["_id"] = str(fb["_id"])
            key = fb.get("key", "unknown")
            if key not in by_key:
                by_key[key] = {"key": key, "entries": [], "summary": {}}
            by_key[key]["entries"].append(fb)
        for key, data in by_key.items():
            entries = data["entries"]
            true_count = sum(1 for e in entries if e.get("value") == "True" or e.get("score", 0) >= 0.5)
            false_count = len(entries) - true_count
            total = len(entries)
            data["summary"] = {
                "total": total,
                "true_count": true_count,
                "false_count": false_count,
                "true_pct": round(true_count / total * 100) if total else 0,
                "false_pct": round(false_count / total * 100) if total else 0,
            }
        return {"trace_id": trace_id, "assessments": by_key}

    def get_assessments_for_traces(self, trace_ids: list) -> dict:
        """Get assessment summaries for multiple traces (for the traces list view).

        Uses only the MOST RECENT feedback per trace+key. Previously, all feedback
        was aggregated, so re-running an evaluator would mix old and new results
        (e.g. routing accuracy showed all True if any prior run had True).
        """
        if not trace_ids:
            return {}
        pipeline = [
            {"$match": {"trace_id": {"$in": trace_ids}}},
            {"$sort": {"created_at": -1}},
            {"$group": {
                "_id": {"trace_id": "$trace_id", "key": "$key"},
                "latest_value": {"$first": "$value"},
                "latest_score": {"$first": "$score"},
            }},
            {"$project": {
                "trace_id": "$_id.trace_id",
                "key": "$_id.key",
                "true_count": {
                    "$cond": [
                        {"$or": [
                            {"$eq": ["$latest_value", "True"]},
                            {"$gte": [{"$ifNull": ["$latest_score", 0]}, 0.5]}
                        ]},
                        1, 0
                    ]
                },
            }},
        ]
        results = {}
        try:
            for doc in self._feedback.aggregate(pipeline):
                tid = doc["trace_id"]
                key = doc["key"]
                true_count = doc["true_count"]
                false_count = 1 - true_count
                if tid not in results:
                    results[tid] = {}
                results[tid][key] = {
                    "total": 1,
                    "true_count": true_count,
                    "false_count": false_count,
                    "true_pct": round(true_count * 100),
                    "false_pct": round(false_count * 100),
                }
        except Exception:
            pass
        return results

    @staticmethod
    def _span_duration_ms(s: dict) -> float:
        d = s.get("duration_ms", 0) or 0
        if d:
            return float(d)
        st = s.get("start_time_ns", 0) or 0
        en = s.get("end_time_ns", 0) or 0
        if st and en and en > st:
            return (en - st) / 1_000_000
        return 0.0

    def get_metrics_advanced(self, product_id=None, service_name=None, days=30) -> dict:
        query = {}
        if product_id:
            query["product_id"] = product_id
        if service_name:
            query["service_name"] = service_name
        cutoff = datetime.utcnow() - timedelta(days=days)
        query["created_at"] = {"$gte": cutoff}

        try:
            traces = list(self._traces.find(query).sort("created_at", -1).limit(5000))
        except Exception as e:
            logger.warning("get_metrics_advanced: failed to query traces: %s", e)
            return self._empty_metrics()
        if not traces:
            return self._empty_metrics()

        latencies = [t.get("latency_ms", 0) for t in traces if t.get("latency_ms")]
        total_tokens = sum(t.get("total_tokens", 0) or 0 for t in traces)
        total_cost = sum(t.get("total_cost_usd", 0) or 0 for t in traces)
        errors = sum(1 for t in traces if t.get("status") == "error")
        sessions = len(set(t.get("session_id", "") for t in traces if t.get("session_id")))
        products = sorted(set(t.get("product_id", "default") for t in traces))

        sorted_lats = sorted(latencies) if latencies else [0]
        p50 = sorted_lats[len(sorted_lats) // 2] if sorted_lats else 0
        p95 = sorted_lats[int(len(sorted_lats) * 0.95)] if sorted_lats else 0
        p99 = sorted_lats[int(len(sorted_lats) * 0.99)] if sorted_lats else 0

        trace_ids = [t["trace_id"] for t in traces]
        try:
            llm_spans = list(self._spans.find({"trace_id": {"$in": trace_ids}, "kind": "llm"}).limit(10000))
            tool_spans = list(self._spans.find({"trace_id": {"$in": trace_ids}, "kind": "tool"}).limit(10000))
            rag_spans = list(self._spans.find({"trace_id": {"$in": trace_ids}, "kind": "retriever"}).limit(10000))
        except Exception as e:
            logger.warning("get_metrics_advanced: failed to query spans: %s", e)
            llm_spans, tool_spans, rag_spans = [], [], []
        try:
            emb_spans = list(self._spans.find({"trace_id": {"$in": trace_ids}, "kind": "embedding"}).limit(10000))
        except Exception as e:
            logger.warning("get_metrics_advanced: failed to query embedding spans: %s", e)
            emb_spans = []

        from app.cost import compute_span_cost
        model_usage = defaultdict(lambda: {"calls": 0, "input_tokens": 0, "output_tokens": 0, "cost_usd": 0.0, "latencies": []})
        for s in llm_spans:
            llm_data = s.get("llm") or {}
            model = llm_data.get("model") or "unknown"
            model_usage[model]["calls"] += 1
            model_usage[model]["input_tokens"] += llm_data.get("input_tokens", 0) or 0
            model_usage[model]["output_tokens"] += llm_data.get("output_tokens", 0) or 0
            span_cost = llm_data.get("cost_usd", 0) or 0
            if span_cost == 0:
                span_cost = compute_span_cost(s)
            model_usage[model]["cost_usd"] += span_cost
            model_usage[model]["latencies"].append(self._span_duration_ms(s))

        embedding_cost_total = 0.0
        embedding_tokens_total = 0
        embedding_usage = defaultdict(lambda: {"calls": 0, "tokens": 0, "cost_usd": 0.0, "latencies": []})
        for s in emb_spans:
            emb_data = s.get("embedding") or {}
            model = emb_data.get("model") or "unknown"
            embedding_usage[model]["calls"] += 1
            tokens = (emb_data.get("input_tokens", 0)
                      or emb_data.get("token_count", 0)
                      or s.get("input_tokens", 0)
                      or 0)
            embedding_usage[model]["tokens"] += tokens
            span_cost = emb_data.get("cost_usd", 0) or 0
            if span_cost == 0:
                span_cost = compute_span_cost(s)
            embedding_usage[model]["cost_usd"] += span_cost
            embedding_usage[model]["latencies"].append(self._span_duration_ms(s))
            embedding_cost_total += span_cost
            embedding_tokens_total += tokens

        model_breakdown = []
        for model, data in sorted(model_usage.items(), key=lambda x: x[0] or ""):
            lats = sorted(data["latencies"]) if data["latencies"] else [0]
            model_breakdown.append({
                "model": model,
                "calls": data["calls"],
                "input_tokens": data["input_tokens"],
                "output_tokens": data["output_tokens"],
                "total_tokens": data["input_tokens"] + data["output_tokens"],
                "cost_usd": round(data["cost_usd"], 6),
                "avg_latency_ms": round(sum(lats) / len(lats), 2) if lats else 0,
                "p95_latency_ms": round(lats[int(len(lats) * 0.95)], 2) if lats else 0,
            })

        embedding_breakdown = []
        for model, data in sorted(embedding_usage.items(), key=lambda x: x[0] or ""):
            lats = sorted(data["latencies"]) if data["latencies"] else [0]
            embedding_breakdown.append({
                "model": model,
                "calls": data["calls"],
                "tokens": data["tokens"],
                "cost_usd": round(data["cost_usd"], 6),
                "avg_latency_ms": round(sum(lats) / len(lats), 2) if lats else 0,
            })

        tool_usage = defaultdict(lambda: {"calls": 0, "errors": 0, "latencies": []})
        for s in tool_spans:
            tool_data = s.get("tool") or {}
            tn = tool_data.get("name") or s.get("name") or "unknown"
            tool_usage[tn]["calls"] += 1
            if s.get("status") == "error":
                tool_usage[tn]["errors"] += 1
            tool_usage[tn]["latencies"].append(self._span_duration_ms(s))

        tool_breakdown = []
        for tn, data in sorted(tool_usage.items(), key=lambda x: x[0] or ""):
            lats = sorted(data["latencies"]) if data["latencies"] else [0]
            tool_breakdown.append({
                "name": tn, "calls": data["calls"], "errors": data["errors"],
                "error_rate": round(data["errors"] / max(data["calls"], 1) * 100, 2),
                "avg_latency_ms": round(sum(lats) / len(lats), 2) if lats else 0,
                "p95_latency_ms": round(lats[int(len(lats) * 0.95)], 2) if len(lats) > 1 else round(lats[0], 2),
            })

        rag_usage = defaultdict(lambda: {"queries": 0, "total_docs": 0, "latencies": []})
        for s in rag_spans:
            ret = s.get("retriever") or {}
            meta = s.get("metadata") or {}
            source = ret.get("source") or meta.get("source") or (s.get("name") or "unknown").replace("retriever:", "")
            rag_usage[source]["queries"] += 1
            docs = ret.get("documents") or s.get("documents") or []
            rag_usage[source]["total_docs"] += len(docs) if isinstance(docs, list) else 0
            rag_usage[source]["latencies"].append(self._span_duration_ms(s))

        rag_breakdown = []
        for src, data in sorted(rag_usage.items(), key=lambda x: x[0] or ""):
            lats = sorted(data["latencies"]) if data["latencies"] else [0]
            rag_breakdown.append({
                "source": src, "queries": data["queries"],
                "total_docs_retrieved": data["total_docs"],
                "avg_latency_ms": round(sum(lats) / len(lats), 2) if lats else 0,
            })

        by_date = defaultdict(lambda: {"traces": 0, "tokens": 0, "cost": 0.0, "errors": 0, "latencies": []})
        for t in traces:
            dt = t.get("created_at")
            d = dt.strftime("%Y-%m-%d") if dt and hasattr(dt, "strftime") else "unknown"
            by_date[d]["traces"] += 1
            by_date[d]["tokens"] += t.get("total_tokens", 0) or 0
            by_date[d]["cost"] += t.get("total_cost_usd", 0) or 0
            if t.get("status") == "error":
                by_date[d]["errors"] += 1
            if t.get("latency_ms"):
                by_date[d]["latencies"].append(t["latency_ms"])

        timeline = []
        for d in sorted(by_date.keys()):
            data = by_date[d]
            lats = data["latencies"]
            timeline.append({
                "date": d, "traces": data["traces"], "tokens": data["tokens"],
                "cost_usd": round(data["cost"], 6), "errors": data["errors"],
                "avg_latency_ms": round(sum(lats) / len(lats), 2) if lats else 0,
            })

        llm_cost_total = sum(d["cost_usd"] for d in model_breakdown)
        llm_tokens_total = sum(d["input_tokens"] + d["output_tokens"] for d in model_breakdown)
        computed_total_cost = total_cost if total_cost > 0 else round(llm_cost_total + embedding_cost_total, 6)

        # Fall back to trace-level token/cost fields when span aggregation yields 0
        # (traces may have been finalized with these fields even if spans are absent)
        if llm_tokens_total == 0 and total_tokens > 0:
            llm_tokens_total = sum(t.get("llm_tokens", 0) or 0 for t in traces)
        if embedding_tokens_total == 0 and total_tokens > 0:
            embedding_tokens_total = sum(t.get("embedding_tokens", 0) or 0 for t in traces)
        if llm_cost_total == 0 and computed_total_cost > 0:
            llm_cost_total = sum(t.get("llm_cost_usd", 0) or 0 for t in traces)
        if embedding_cost_total == 0 and computed_total_cost > 0:
            embedding_cost_total = sum(t.get("embedding_cost_usd", 0) or 0 for t in traces)

        return {
            "trace_count": len(traces),
            "session_count": sessions,
            "error_count": errors,
            "error_rate": round(errors / len(traces) * 100, 2) if traces else 0,
            "total_tokens": total_tokens,
            "total_cost_usd": round(computed_total_cost, 6),
            "llm_cost_usd": round(llm_cost_total, 6),
            "llm_tokens": llm_tokens_total,
            "embedding_cost_usd": round(embedding_cost_total, 6),
            "embedding_tokens": embedding_tokens_total,
            "latency": {
                "avg_ms": round(sum(latencies) / len(latencies), 2) if latencies else 0,
                "p50_ms": round(p50, 2),
                "p95_ms": round(p95, 2),
                "p99_ms": round(p99, 2),
            },
            "llm_calls": len(llm_spans),
            "tool_calls": len(tool_spans),
            "rag_queries": len(rag_spans),
            "embedding_calls": len(emb_spans),
            "model_breakdown": model_breakdown,
            "embedding_breakdown": embedding_breakdown,
            "tool_breakdown": tool_breakdown,
            "rag_breakdown": rag_breakdown,
            "timeline": timeline,
            "products": products,
        }

    def get_per_agent_breakdown(self, product_id=None, trace_id=None, service_name=None, days=30) -> dict:
        query = {}
        if trace_id:
            query["trace_id"] = trace_id
        else:
            t_query = {}
            if product_id:
                t_query["product_id"] = product_id
            if service_name:
                t_query["service_name"] = service_name
            cutoff = datetime.utcnow() - timedelta(days=days)
            t_query["created_at"] = {"$gte": cutoff}
            trace_ids = [t["trace_id"] for t in self._traces.find(t_query, {"trace_id": 1}).limit(2000)]
            if not trace_ids:
                return {"agents": [], "summary": {}}
            query["trace_id"] = {"$in": trace_ids}

        all_spans = list(self._spans.find(query).limit(50000))

        agent_spans = [s for s in all_spans if s.get("kind") == "agent"]
        child_index = {}
        for s in all_spans:
            pid = s.get("parent_span_id")
            if pid:
                child_index.setdefault(pid, []).append(s)

        def _collect_descendants(span_id):
            result = []
            stack = list(child_index.get(span_id, []))
            while stack:
                ch = stack.pop()
                result.append(ch)
                ch_id = ch.get("span_id")
                if ch_id:
                    stack.extend(child_index.get(ch_id, []))
            return result

        from app.cost import compute_span_cost

        agents = {}
        for a_span in agent_spans:
            name = (a_span.get("name") or "unknown").replace("agent:", "")
            sid = a_span.get("span_id")
            children = _collect_descendants(sid) if sid else []

            entry = agents.setdefault(name, {
                "name": name, "invocations": 0,
                "input_tokens": 0, "output_tokens": 0, "total_tokens": 0,
                "cost_usd": 0.0, "latencies": [],
                "llm_calls": 0, "tool_calls": 0, "tool_errors": 0,
                "rag_queries": 0, "embedding_calls": 0, "embedding_tokens": 0,
                "tools_used": set(), "reasoning_steps": [],
                "errors": 0,
            })
            entry["invocations"] += 1

            dur = self._span_duration_ms(a_span)
            if dur:
                entry["latencies"].append(dur)

            if a_span.get("status") == "error":
                entry["errors"] += 1

            meta = a_span.get("metadata") or {}
            if meta.get("reasoning_steps"):
                entry["reasoning_steps"].append(meta["reasoning_steps"])
            if meta.get("tools_sequence"):
                for t in meta["tools_sequence"]:
                    entry["tools_used"].add(t)

            for ch in children:
                ck = ch.get("kind", "")
                if ck == "llm":
                    entry["llm_calls"] += 1
                    llm = ch.get("llm") or {}
                    inp = llm.get("input_tokens", 0) or 0
                    out = llm.get("output_tokens", 0) or 0
                    entry["input_tokens"] += inp
                    entry["output_tokens"] += out
                    entry["total_tokens"] += inp + out
                    cost = llm.get("cost_usd", 0) or 0
                    if cost == 0:
                        cost = compute_span_cost(ch)
                    entry["cost_usd"] += cost
                elif ck == "tool":
                    entry["tool_calls"] += 1
                    tool = ch.get("tool") or {}
                    tn = tool.get("name") or ch.get("name", "")
                    entry["tools_used"].add(tn)
                    if ch.get("status") == "error":
                        entry["tool_errors"] += 1
                elif ck == "retriever":
                    entry["rag_queries"] += 1
                elif ck == "embedding":
                    entry["embedding_calls"] += 1
                    emb = ch.get("embedding") or {}
                    entry["embedding_tokens"] += (
                        emb.get("input_tokens", 0) or emb.get("token_count", 0) or 0
                    )

        result = []
        for name, data in sorted(agents.items(), key=lambda x: x[0] or ""):
            lats = sorted(data["latencies"]) if data["latencies"] else [0]
            result.append({
                "name": name,
                "invocations": data["invocations"],
                "input_tokens": data["input_tokens"],
                "output_tokens": data["output_tokens"],
                "total_tokens": data["total_tokens"],
                "cost_usd": round(data["cost_usd"], 6),
                "avg_latency_ms": round(sum(lats) / len(lats), 1) if lats else 0,
                "p95_latency_ms": round(lats[int(len(lats) * 0.95)], 1) if len(lats) > 1 else round(lats[0], 1),
                "llm_calls": data["llm_calls"],
                "tool_calls": data["tool_calls"],
                "tool_errors": data["tool_errors"],
                "tool_error_rate": round(data["tool_errors"] / max(data["tool_calls"], 1) * 100, 2),
                "rag_queries": data["rag_queries"],
                "embedding_calls": data["embedding_calls"],
                "embedding_tokens": data["embedding_tokens"],
                "tools_used": sorted(data["tools_used"]),
                "avg_reasoning_steps": round(sum(data["reasoning_steps"]) / len(data["reasoning_steps"]), 1) if data["reasoning_steps"] else 0,
                "errors": data["errors"],
                "error_rate": round(data["errors"] / max(data["invocations"], 1) * 100, 2),
            })

        summary = {
            "total_agents": len(result),
            "total_invocations": sum(a["invocations"] for a in result),
            "total_tokens": sum(a["total_tokens"] for a in result),
            "total_cost_usd": round(sum(a["cost_usd"] for a in result), 6),
            "total_llm_calls": sum(a["llm_calls"] for a in result),
            "total_tool_calls": sum(a["tool_calls"] for a in result),
            "total_rag_queries": sum(a["rag_queries"] for a in result),
            "total_embedding_calls": sum(a["embedding_calls"] for a in result),
            "total_errors": sum(a["errors"] for a in result),
        }

        return {"agents": result, "summary": summary}

    def _empty_metrics(self):
        return {
            "trace_count": 0, "session_count": 0, "error_count": 0, "error_rate": 0,
            "total_tokens": 0, "total_cost_usd": 0,
            "llm_cost_usd": 0, "embedding_cost_usd": 0, "embedding_tokens": 0,
            "latency": {"avg_ms": 0, "p50_ms": 0, "p95_ms": 0, "p99_ms": 0},
            "llm_calls": 0, "tool_calls": 0, "rag_queries": 0, "embedding_calls": 0,
            "model_breakdown": [], "embedding_breakdown": [], "tool_breakdown": [],
            "timeline": [], "products": [],
        }

    def recalculate_cost(self, trace_id: str) -> dict:
        from app.cost import compute_span_cost
        doc = self._traces.find_one({"trace_id": trace_id})
        if not doc:
            return {"ok": False, "error": "trace not found"}
        spans = list(self._spans.find({"trace_id": trace_id}))
        total_cost = 0.0
        total_tokens = 0
        llm_tokens = 0
        llm_cost = 0.0
        llm_calls = 0
        embedding_tokens = 0
        embedding_cost = 0.0
        embedding_calls = 0
        updated_spans = 0
        for s in spans:
            cost = compute_span_cost(s)
            kind = s.get("kind", "")
            if kind == "llm":
                llm = s.get("llm") or {}
                old_cost = llm.get("cost_usd", 0) or 0
                inp = llm.get("input_tokens", 0) or 0
                out = llm.get("output_tokens", 0) or 0
                tok = inp + out
                total_tokens += tok
                llm_tokens += tok
                llm_calls += 1
                if cost > 0 and old_cost == 0:
                    llm["cost_usd"] = round(cost, 8)
                    self._spans.update_one(
                        {"_id": s["_id"]},
                        {"$set": {"llm": llm}},
                    )
                    updated_spans += 1
                span_cost = cost if cost > 0 else old_cost
                total_cost += span_cost
                llm_cost += span_cost
            elif kind == "embedding":
                emb = s.get("embedding") or {}
                old_cost = emb.get("cost_usd", 0) or 0
                tokens = emb.get("input_tokens", 0) or emb.get("token_count", 0) or 0
                total_tokens += tokens
                embedding_tokens += tokens
                embedding_calls += 1
                if cost > 0 and old_cost == 0:
                    emb["cost_usd"] = round(cost, 8)
                    self._spans.update_one(
                        {"_id": s["_id"]},
                        {"$set": {"embedding": emb}},
                    )
                    updated_spans += 1
                span_cost = cost if cost > 0 else old_cost
                total_cost += span_cost
                embedding_cost += span_cost
        self._traces.update_one(
            {"trace_id": trace_id},
            {"$set": {
                "total_cost_usd": round(total_cost, 8),
                "total_tokens": total_tokens if total_tokens > (doc.get("total_tokens") or 0) else doc.get("total_tokens", 0),
                "llm_tokens": llm_tokens,
                "llm_cost_usd": round(llm_cost, 8),
                "llm_calls": llm_calls,
                "embedding_tokens": embedding_tokens,
                "embedding_cost_usd": round(embedding_cost, 8),
                "embedding_calls": embedding_calls,
            }},
        )
        return {
            "ok": True,
            "trace_id": trace_id,
            "total_cost_usd": round(total_cost, 8),
            "total_tokens": total_tokens,
            "spans_updated": updated_spans,
        }

    def finalize_trace(self, trace_id: str, status: str = "ok",
                       session_id: Optional[str] = None) -> dict:
        """Finalize a trace: update status and aggregate tokens/cost from all spans."""
        from app.cost import compute_span_cost
        doc = self._traces.find_one({"trace_id": trace_id})
        if not doc:
            return {"ok": False, "error": "trace not found"}

        spans = list(self._spans.find({"trace_id": trace_id}))
        total_tokens = 0
        total_cost = 0.0
        llm_tokens = 0
        llm_cost = 0.0
        llm_calls = 0
        embedding_tokens = 0
        embedding_cost = 0.0
        embedding_calls = 0
        max_end_ns = 0
        min_start_ns = float("inf")
        for s in spans:
            kind = s.get("kind", "")
            if kind == "llm":
                llm = s.get("llm") or {}
                tok = (llm.get("input_tokens", 0) or 0) + (llm.get("output_tokens", 0) or 0)
                total_tokens += tok
                llm_tokens += tok
                llm_calls += 1
                span_cost = llm.get("cost_usd", 0) or 0
                if span_cost <= 0:
                    span_cost = compute_span_cost(s)
                total_cost += span_cost
                llm_cost += span_cost
            elif kind == "embedding":
                emb = s.get("embedding") or {}
                tok = emb.get("input_tokens", 0) or emb.get("token_count", 0) or 0
                total_tokens += tok
                embedding_tokens += tok
                embedding_calls += 1
                span_cost = emb.get("cost_usd", 0) or 0
                if span_cost <= 0:
                    span_cost = compute_span_cost(s)
                total_cost += span_cost
                embedding_cost += span_cost
            start_ns = s.get("start_time_ns", 0) or 0
            end_ns = s.get("end_time_ns", 0) or 0
            if start_ns and start_ns < min_start_ns:
                min_start_ns = start_ns
            if end_ns and end_ns > max_end_ns:
                max_end_ns = end_ns

        latency_ms = round((max_end_ns - min_start_ns) / 1e6, 1) if max_end_ns > min_start_ns else 0
        update = {
            "status": status,
            "total_tokens": max(total_tokens, doc.get("total_tokens", 0)),
            "total_cost_usd": round(max(total_cost, doc.get("total_cost_usd", 0)), 8),
            "llm_tokens": llm_tokens,
            "llm_cost_usd": round(llm_cost, 8),
            "llm_calls": llm_calls,
            "embedding_tokens": embedding_tokens,
            "embedding_cost_usd": round(embedding_cost, 8),
            "embedding_calls": embedding_calls,
            "updated_at": datetime.utcnow(),
        }
        if session_id:
            update["session_id"] = session_id
        elif not doc.get("session_id"):
            update["session_id"] = ""
        if latency_ms > 0:
            update["latency_ms"] = latency_ms
            update["start_time_ns"] = int(min_start_ns)
            update["end_time_ns"] = int(max_end_ns)
        self._traces.update_one({"trace_id": trace_id}, {"$set": update})
        logger.info("Trace finalized: %s status=%s tokens=%d (llm=%d emb=%d) cost=%.6f latency=%.1fms",
                     trace_id, status, update["total_tokens"], llm_tokens, embedding_tokens,
                     update["total_cost_usd"], latency_ms)
        return {"ok": True, "trace_id": trace_id, "status": status, "total_tokens": update["total_tokens"],
                "total_cost_usd": update["total_cost_usd"], "latency_ms": latency_ms,
                "llm_tokens": llm_tokens, "embedding_tokens": embedding_tokens,
                "llm_cost_usd": round(llm_cost, 8), "embedding_cost_usd": round(embedding_cost, 8)}

    def recalculate_all_costs(self) -> dict:
        traces = list(self._traces.find({}, {"trace_id": 1}).limit(5000))
        results = {"recalculated": 0, "errors": 0, "total_cost_usd": 0.0}
        for t in traces:
            try:
                r = self.recalculate_cost(t["trace_id"])
                if r.get("ok"):
                    results["recalculated"] += 1
                    results["total_cost_usd"] += r.get("total_cost_usd", 0)
            except Exception as e:
                logger.warning("Recalculate failed for %s: %s", t["trace_id"], e)
                results["errors"] += 1
        results["total_cost_usd"] = round(results["total_cost_usd"], 6)
        return results

    def delete_trace(self, trace_id: str) -> bool:
        r = self._traces.delete_one({"trace_id": trace_id})
        self._spans.delete_many({"trace_id": trace_id})
        self._feedback.delete_many({"trace_id": trace_id})
        self._evaluations.delete_many({"trace_id": trace_id})
        return r.deleted_count > 0

    # ── Evaluations ──────────────────────────────────────────────────

    def store_evaluation(self, data: dict) -> dict:
        now = datetime.utcnow()
        doc = {
            "trace_id": data.get("trace_id", ""),
            "product_id": data.get("product_id", "default"),
            "agent_name": data.get("agent_name", ""),
            "section": data.get("section", ""),
            "overall_score": data.get("overall_score", 0),
            "pass_fail": data.get("pass_fail", True),
            "category_scores": data.get("category_scores", []),
            "revision_count": data.get("revision_count", 0),
            "deficiencies": data.get("deficiencies", []),
            "strengths": data.get("strengths", []),
            "summary": data.get("summary", ""),
            "created_at": now,
        }
        self._evaluations.insert_one(doc)
        return {"ok": True}

    def get_evaluations(self, agent_name=None, product_id=None, trace_id=None,
                        days=30, limit=200) -> list:
        filt = {}
        if agent_name:
            filt["agent_name"] = agent_name
        if product_id:
            filt["product_id"] = product_id
        if trace_id:
            filt["trace_id"] = trace_id
        if days and not trace_id:
            filt["created_at"] = {"$gte": datetime.utcnow() - timedelta(days=days)}
        docs = list(self._evaluations.find(filt).sort("created_at", -1).limit(limit))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    def get_evaluation_trends(self, product_id=None, days=30) -> dict:
        filt = {}
        if product_id:
            filt["product_id"] = product_id
        if days:
            filt["created_at"] = {"$gte": datetime.utcnow() - timedelta(days=days)}
        docs = list(self._evaluations.find(filt).sort("created_at", -1).limit(2000))
        by_agent = defaultdict(lambda: {"scores": [], "pass_count": 0, "fail_count": 0, "total": 0})
        by_date = defaultdict(lambda: {"scores": [], "pass_count": 0, "fail_count": 0})
        for d in docs:
            agent = d.get("agent_name", "unknown")
            score = d.get("overall_score", 0)
            passed = d.get("pass_fail", True)
            by_agent[agent]["scores"].append(score)
            by_agent[agent]["total"] += 1
            if passed:
                by_agent[agent]["pass_count"] += 1
            else:
                by_agent[agent]["fail_count"] += 1
            dt = d.get("created_at")
            day = dt.strftime("%Y-%m-%d") if dt and hasattr(dt, "strftime") else "unknown"
            by_date[day]["scores"].append(score)
            if passed:
                by_date[day]["pass_count"] += 1
            else:
                by_date[day]["fail_count"] += 1

        agent_summary = []
        for agent, data in sorted(by_agent.items(), key=lambda x: x[0] or ""):
            scores = data["scores"]
            agent_summary.append({
                "agent_name": agent,
                "avg_score": round(sum(scores) / len(scores), 1) if scores else 0,
                "min_score": min(scores) if scores else 0,
                "max_score": max(scores) if scores else 0,
                "pass_rate": round(data["pass_count"] / data["total"] * 100, 1) if data["total"] else 0,
                "total_evaluations": data["total"],
            })

        timeline = []
        for day in sorted(by_date.keys()):
            data = by_date[day]
            scores = data["scores"]
            total = len(scores)
            timeline.append({
                "date": day,
                "avg_score": round(sum(scores) / len(scores), 1) if scores else 0,
                "pass_count": data["pass_count"],
                "fail_count": data["fail_count"],
                "total": total,
                "pass_rate": round(data["pass_count"] / total * 100, 1) if total else 0,
            })

        return {
            "agent_summary": agent_summary,
            "timeline": timeline,
            "total_evaluations": len(docs),
        }

    # ── Evaluators (Evaluation Framework) ─────────────────────────────

    def list_evaluators(self, evaluator_type=None, enabled_only=True, category=None) -> list:
        filt = {}
        if evaluator_type:
            filt["type"] = evaluator_type
        if enabled_only:
            filt["enabled"] = True
        if category:
            filt["category"] = category
        docs = list(self._evaluators.find(filt).sort("evaluator_id", 1))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    def get_evaluator(self, evaluator_id: str) -> Optional[dict]:
        doc = self._evaluators.find_one({"evaluator_id": evaluator_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def create_evaluator(self, data: dict) -> dict:
        data["created_at"] = datetime.utcnow()
        data.setdefault("enabled", True)
        data.setdefault("is_builtin", False)
        self._evaluators.insert_one(data)
        return {"ok": True, "evaluator_id": data.get("evaluator_id")}

    def update_evaluator(self, evaluator_id: str, data: dict) -> dict:
        doc = self._evaluators.find_one({"evaluator_id": evaluator_id})
        if not doc:
            logger.warning("update_evaluator: evaluator_id=%s NOT FOUND", evaluator_id)
            return {"ok": False, "error": "not found"}

        old_rubric = (doc.get("config") or {}).get("rubric", "")[:80]
        new_rubric = (data.get("config") or {}).get("rubric", "")[:80]
        logger.info(
            "update_evaluator: id=%s is_builtin=%s old_rubric='%s...' new_rubric='%s...'",
            evaluator_id, doc.get("is_builtin"), old_rubric, new_rubric,
        )
        logger.debug(
            "update_evaluator: id=%s config_keys=%s new_config_keys=%s",
            evaluator_id,
            list((doc.get("config") or {}).keys()),
            list((data.get("config") or {}).keys()),
        )

        if doc.get("is_builtin"):
            allowed_fields = {"config", "enabled", "description", "category"}
            filtered = {k: v for k, v in data.items() if k in allowed_fields}
            if not filtered:
                return {"ok": False, "error": "only config, enabled, description, and category can be modified on built-in evaluators"}
            filtered["updated_at"] = datetime.utcnow()
            result = self._evaluators.update_one({"evaluator_id": evaluator_id}, {"$set": filtered})
            logger.info("update_evaluator (builtin): matched=%s modified=%s", result.matched_count, result.modified_count)
            return {"ok": True, "note": "built-in evaluator config updated"}

        data.pop("evaluator_id", None)
        data.pop("is_builtin", None)
        data["updated_at"] = datetime.utcnow()
        result = self._evaluators.update_one({"evaluator_id": evaluator_id}, {"$set": data})
        logger.info("update_evaluator: matched=%s modified=%s", result.matched_count, result.modified_count)
        return {"ok": True}

    def delete_evaluator(self, evaluator_id: str) -> dict:
        doc = self._evaluators.find_one({"evaluator_id": evaluator_id})
        if not doc:
            return {"ok": False, "error": "not found"}
        if doc.get("is_builtin"):
            return {"ok": False, "error": "cannot delete built-in evaluator"}
        self._evaluators.delete_one({"evaluator_id": evaluator_id})
        return {"ok": True}

    # ── Datasets (Evaluation Framework) ────────────────────────────────

    def list_datasets(self, product_id=None) -> list:
        filt = {}
        if product_id:
            filt["product_id"] = product_id
        docs = list(self._datasets.find(filt, {"items": 0}).sort("created_at", -1))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    def get_dataset(self, dataset_id: str) -> Optional[dict]:
        doc = self._datasets.find_one({"dataset_id": dataset_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def create_dataset(self, data: dict) -> dict:
        now = datetime.utcnow()
        data["created_at"] = now
        data["updated_at"] = now
        data.setdefault("items", [])
        data["item_count"] = len(data["items"])
        self._datasets.insert_one(data)
        return {"ok": True, "dataset_id": data.get("dataset_id")}

    def update_dataset(self, dataset_id: str, data: dict) -> dict:
        doc = self._datasets.find_one({"dataset_id": dataset_id})
        if not doc:
            return {"ok": False, "error": "not found"}
        data.pop("dataset_id", None)
        data.pop("items", None)
        data["updated_at"] = datetime.utcnow()
        self._datasets.update_one({"dataset_id": dataset_id}, {"$set": data})
        return {"ok": True}

    def delete_dataset(self, dataset_id: str) -> dict:
        res = self._datasets.delete_one({"dataset_id": dataset_id})
        return {"ok": res.deleted_count > 0}

    def add_dataset_items(self, dataset_id: str, items: list) -> dict:
        doc = self._datasets.find_one({"dataset_id": dataset_id})
        if not doc:
            return {"ok": False, "error": "not found"}
        # Assign item IDs if missing
        import uuid as _uuid
        for item in items:
            if not item.get("item_id"):
                item["item_id"] = f"item_{_uuid.uuid4().hex[:8]}"
        self._datasets.update_one(
            {"dataset_id": dataset_id},
            {"$push": {"items": {"$each": items}},
             "$inc": {"item_count": len(items)},
             "$set": {"updated_at": datetime.utcnow()}},
        )
        return {"ok": True, "added": len(items)}

    def delete_dataset_item(self, dataset_id: str, item_id: str) -> dict:
        res = self._datasets.update_one(
            {"dataset_id": dataset_id},
            {"$pull": {"items": {"item_id": item_id}},
             "$inc": {"item_count": -1},
             "$set": {"updated_at": datetime.utcnow()}},
        )
        return {"ok": res.modified_count > 0}

    def approve_dataset_item(self, dataset_id: str, item_id: str, body: dict) -> dict:
        ds = self._datasets.find_one({"dataset_id": dataset_id})
        if not ds:
            return {"ok": False, "error": "dataset not found"}
        items = ds.get("items", [])
        for i, item in enumerate(items):
            if item.get("item_id") == item_id:
                if "expected_output" in body and body["expected_output"]:
                    item["expected_output"] = body["expected_output"]
                elif item.get("actual_output"):
                    item["expected_output"] = item["actual_output"]
                item["needs_review"] = False
                self._datasets.update_one(
                    {"dataset_id": dataset_id},
                    {"$set": {f"items.{i}": item, "updated_at": datetime.utcnow()}},
                )
                return {"ok": True, "item_id": item_id}
        return {"ok": False, "error": "item not found"}

    def bulk_approve_dataset_items(self, dataset_id: str, body: dict) -> dict:
        ds = self._datasets.find_one({"dataset_id": dataset_id})
        if not ds:
            return {"ok": False, "error": "dataset not found"}
        items = ds.get("items", [])
        item_ids = body.get("item_ids")
        positive_only = body.get("positive_feedback_only", False)
        approved = 0
        for i, item in enumerate(items):
            if not item.get("needs_review"):
                continue
            should_approve = False
            if item_ids and item.get("item_id") in item_ids:
                should_approve = True
            elif positive_only:
                fb = item.get("feedback") or []
                should_approve = any(
                    f.get("key") == "user_feedback" and f.get("value") == "True"
                    for f in fb
                )
            if should_approve and item.get("actual_output"):
                item["expected_output"] = item["actual_output"]
                item["needs_review"] = False
                self._datasets.update_one(
                    {"dataset_id": dataset_id},
                    {"$set": {f"items.{i}": item, "updated_at": datetime.utcnow()}},
                )
                approved += 1
        return {"ok": True, "approved": approved}

    # ── Evaluation Runs (Evaluation Framework) ─────────────────────────

    def create_evaluation_run(self, data: dict) -> dict:
        self._evaluation_runs.insert_one(data)
        return {"ok": True, "run_id": data.get("run_id")}

    def update_evaluation_run(self, run_id: str, data: dict) -> dict:
        data_copy = {k: v for k, v in data.items() if k != "_id"}
        self._evaluation_runs.update_one({"run_id": run_id}, {"$set": data_copy})
        return {"ok": True}

    def get_evaluation_run(self, run_id: str) -> Optional[dict]:
        doc = self._evaluation_runs.find_one({"run_id": run_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def list_evaluation_runs(self, product_id=None, trace_id=None,
                             status=None, limit=50) -> list:
        filt = {}
        if product_id:
            filt["product_id"] = product_id
        if trace_id:
            filt["trace_id"] = trace_id
        if status:
            filt["status"] = status
        docs = list(self._evaluation_runs.find(filt).sort("created_at", -1).limit(limit))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    def get_evaluation_run_stats(self, product_id=None, days=30) -> dict:
        """Aggregate stats for the evaluations hub dashboard."""
        base_filt: dict = {}
        if product_id:
            base_filt["product_id"] = product_id
        if days:
            base_filt["created_at"] = {"$gte": datetime.utcnow() - timedelta(days=days)}

        all_docs = list(self._evaluation_runs.find(base_filt).sort("created_at", -1).limit(500))
        total_all = len(all_docs)
        if total_all == 0:
            return {"total_runs": 0, "completed_runs": 0, "failed_runs": 0,
                    "avg_score": 0, "pass_rate": 0, "timeline": []}

        completed = [d for d in all_docs if d.get("status") == "completed"]
        failed = [d for d in all_docs if d.get("status") == "failed"]
        completed_count = len(completed)
        scores = [d.get("aggregate_score", 0) for d in completed]
        passed = sum(1 for d in completed if d.get("aggregate_passed"))

        by_date = defaultdict(lambda: {"scores": [], "pass_count": 0, "total": 0, "failed": 0})
        for d in all_docs:
            dt = d.get("created_at")
            day = dt.strftime("%Y-%m-%d") if dt and hasattr(dt, "strftime") else "unknown"
            by_date[day]["total"] += 1
            if d.get("status") == "completed":
                by_date[day]["scores"].append(d.get("aggregate_score", 0))
                if d.get("aggregate_passed"):
                    by_date[day]["pass_count"] += 1
            elif d.get("status") == "failed":
                by_date[day]["failed"] += 1
        timeline = []
        for day in sorted(by_date.keys()):
            data = by_date[day]
            s = data["scores"]
            timeline.append({
                "date": day,
                "avg_score": round(sum(s) / len(s), 1) if s else 0,
                "pass_rate": round(data["pass_count"] / len(s) * 100, 1) if s else 0,
                "total": data["total"],
                "failed": data["failed"],
            })
        return {
            "total_runs": total_all,
            "completed_runs": completed_count,
            "failed_runs": len(failed),
            "avg_score": round(sum(scores) / completed_count, 1) if completed_count else 0,
            "pass_rate": round(passed / completed_count * 100, 1) if completed_count else 0,
            "timeline": timeline,
        }

    # ── Alerts ────────────────────────────────────────────────────────

    def store_alert(self, data: dict) -> dict:
        now = datetime.utcnow()
        doc = {
            "trace_id": data.get("trace_id", ""),
            "product_id": data.get("product_id", "default"),
            "alert_type": data.get("alert_type", "budget_exceeded"),
            "severity": data.get("severity", "warning"),
            "message": data.get("message", ""),
            "details": data.get("details", {}),
            "acknowledged": False,
            "created_at": now,
            "email_subject": data.get("email_subject", ""),
            "email_body_html": data.get("email_body_html", ""),
            "email_body_text": data.get("email_body_text", ""),
            "email_status": data.get("email_status", ""),
            "email_error": data.get("email_error", ""),
            "email_recipients": data.get("email_recipients", []),
        }
        self._alerts.insert_one(doc)
        return {"ok": True}

    def get_alerts(self, product_id=None, alert_type=None, acknowledged=None,
                   days=30, limit=100) -> list:
        filt = {}
        if product_id:
            filt["product_id"] = product_id
        if alert_type:
            filt["alert_type"] = alert_type
        if acknowledged is not None:
            filt["acknowledged"] = acknowledged
        if days:
            filt["created_at"] = {"$gte": datetime.utcnow() - timedelta(days=days)}
        docs = list(self._alerts.find(filt).sort("created_at", -1).limit(limit))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    def acknowledge_alert(self, alert_id: str) -> bool:
        try:
            oid = ObjectId(alert_id)
        except Exception:
            return False
        r = self._alerts.update_one({"_id": oid}, {"$set": {"acknowledged": True}})
        return r.modified_count > 0

    # ── Prompt Versions ───────────────────────────────────────────────

    def upsert_prompt_version(self, data: dict) -> dict:
        now = datetime.utcnow()
        prompt_hash = data.get("prompt_hash", "")
        agent_name = data.get("agent_name", "")
        update_set = {
            "prompt_template_name": data.get("prompt_template_name", ""),
            "prompt_preview": data.get("prompt_preview", "")[:500],
            "product_id": data.get("product_id", "default"),
            "last_seen": now,
            "model": data.get("model", ""),
        }
        if data.get("content"):
            update_set["content"] = data["content"][:4000]
        self._prompt_versions.update_one(
            {"prompt_hash": prompt_hash, "agent_name": agent_name},
            {
                "$set": update_set,
                "$inc": {"usage_count": 1},
                "$setOnInsert": {"first_seen": now},
            },
            upsert=True,
        )
        return {"ok": True}

    def get_prompt_versions(self, agent_name=None, product_id=None, limit=100) -> list:
        filt = {}
        if agent_name:
            filt["agent_name"] = agent_name
        if product_id:
            filt["product_id"] = product_id
        docs = list(self._prompt_versions.find(filt).sort("last_seen", -1).limit(limit))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    # ── Trace Comparison ──────────────────────────────────────────────

    def compare_traces(self, trace_id_a: str, trace_id_b: str) -> dict:
        trace_a = self.get_trace(trace_id_a)
        trace_b = self.get_trace(trace_id_b)
        if not trace_a or not trace_b:
            return {"error": "One or both traces not found"}
        spans_a = self.get_spans(trace_id=trace_id_a, limit=1000)
        spans_b = self.get_spans(trace_id=trace_id_b, limit=1000)

        def _agent_summary(spans):
            agents = {}
            for s in spans:
                kind = s.get("kind", "")
                name = s.get("name", "")
                if kind == "agent" or name.startswith("agent:"):
                    agent_name = name.replace("agent:", "")
                    llm = s.get("llm") or {}
                    agents[agent_name] = {
                        "tokens": (s.get("input_tokens") or llm.get("input_tokens", 0) or 0) +
                                  (s.get("output_tokens") or llm.get("output_tokens", 0) or 0),
                        "cost_usd": s.get("cost_usd") or llm.get("cost_usd", 0) or 0,
                        "duration_ms": s.get("duration_ms", 0) or 0,
                        "status": s.get("status", "ok"),
                    }
            return agents

        def _llm_summary(spans):
            llms = []
            for s in spans:
                kind = s.get("kind", "")
                name = s.get("name", "")
                if kind == "llm" or name.startswith("llm:"):
                    llm = s.get("llm") or {}
                    llms.append({
                        "name": name,
                        "model": s.get("model") or llm.get("model", ""),
                        "input_tokens": s.get("input_tokens") or llm.get("input_tokens", 0),
                        "output_tokens": s.get("output_tokens") or llm.get("output_tokens", 0),
                        "cost_usd": s.get("cost_usd") or llm.get("cost_usd", 0),
                        "duration_ms": s.get("duration_ms", 0),
                        "prompt_preview": (s.get("prompt_messages") or llm.get("prompt_messages") or [{}])[0].get("content", "")[:200] if (s.get("prompt_messages") or llm.get("prompt_messages")) else "",
                    })
            return llms

        return {
            "trace_a": {
                "trace_id": trace_id_a,
                "status": trace_a.get("status", ""),
                "total_tokens": trace_a.get("total_tokens", 0),
                "total_cost_usd": trace_a.get("total_cost_usd", 0),
                "latency_ms": trace_a.get("latency_ms", 0),
                "span_count": len(spans_a),
                "agents": _agent_summary(spans_a),
                "llm_calls": _llm_summary(spans_a),
            },
            "trace_b": {
                "trace_id": trace_id_b,
                "status": trace_b.get("status", ""),
                "total_tokens": trace_b.get("total_tokens", 0),
                "total_cost_usd": trace_b.get("total_cost_usd", 0),
                "latency_ms": trace_b.get("latency_ms", 0),
                "span_count": len(spans_b),
                "agents": _agent_summary(spans_b),
                "llm_calls": _llm_summary(spans_b),
            },
            "diff": {
                "tokens_diff": (trace_a.get("total_tokens", 0) or 0) - (trace_b.get("total_tokens", 0) or 0),
                "cost_diff": round((trace_a.get("total_cost_usd", 0) or 0) - (trace_b.get("total_cost_usd", 0) or 0), 6),
                "latency_diff": round((trace_a.get("latency_ms", 0) or 0) - (trace_b.get("latency_ms", 0) or 0), 2),
            },
        }

    # ── Anomaly Detection ──────────────────────────────────────────────

    def get_anomaly_baselines(self, product_id=None, days=30) -> dict:
        filt = {}
        if product_id:
            filt["product_id"] = product_id
        if days:
            filt["created_at"] = {"$gte": datetime.utcnow() - timedelta(days=days)}
        traces = list(self._traces.find(filt, {
            "total_tokens": 1, "total_cost_usd": 1, "latency_ms": 1, "status": 1
        }).limit(5000))
        if not traces:
            return {"baselines": {}, "count": 0}
        tokens_list = [t.get("total_tokens", 0) or 0 for t in traces]
        cost_list = [t.get("total_cost_usd", 0) or 0 for t in traces]
        latency_list = [t.get("latency_ms", 0) or 0 for t in traces if t.get("latency_ms")]
        import math

        def _stats(vals):
            if not vals:
                return {"mean": 0, "stddev": 0, "threshold_high": 0}
            mean = sum(vals) / len(vals)
            variance = sum((x - mean) ** 2 for x in vals) / len(vals)
            stddev = math.sqrt(variance)
            return {"mean": round(mean, 4), "stddev": round(stddev, 4), "threshold_high": round(mean + 2 * stddev, 4)}

        return {
            "baselines": {
                "tokens": _stats(tokens_list),
                "cost_usd": _stats(cost_list),
                "latency_ms": _stats(latency_list),
            },
            "count": len(traces),
        }

    def detect_anomalies(self, product_id=None, days=7) -> list:
        baselines = self.get_anomaly_baselines(product_id=product_id, days=90)
        b = baselines.get("baselines", {})
        if not b:
            return []
        filt = {}
        if product_id:
            filt["product_id"] = product_id
        if days:
            filt["created_at"] = {"$gte": datetime.utcnow() - timedelta(days=days)}
        traces = list(self._traces.find(filt).sort("created_at", -1).limit(500))
        anomalies = []
        for t in traces:
            reasons = []
            tid = t.get("trace_id", "")
            tokens = t.get("total_tokens", 0) or 0
            cost = t.get("total_cost_usd", 0) or 0
            latency = t.get("latency_ms", 0) or 0
            if b.get("tokens", {}).get("threshold_high") and tokens > b["tokens"]["threshold_high"]:
                reasons.append(f"tokens={tokens} > threshold={b['tokens']['threshold_high']:.0f}")
            if b.get("cost_usd", {}).get("threshold_high") and cost > b["cost_usd"]["threshold_high"]:
                reasons.append(f"cost=${cost:.4f} > threshold=${b['cost_usd']['threshold_high']:.4f}")
            if b.get("latency_ms", {}).get("threshold_high") and latency > b["latency_ms"]["threshold_high"]:
                reasons.append(f"latency={latency:.0f}ms > threshold={b['latency_ms']['threshold_high']:.0f}ms")
            if reasons:
                anomalies.append({
                    "trace_id": tid,
                    "reasons": reasons,
                    "tokens": tokens,
                    "cost_usd": cost,
                    "latency_ms": latency,
                    "created_at": t.get("created_at"),
                })
        return anomalies

    # ── Data Retention ─────────────────────────────────────────────────

    def cleanup_old_data(self, retention_days: int = 30) -> dict:
        cutoff = datetime.utcnow() - timedelta(days=retention_days)
        traces_result = self._traces.delete_many({"created_at": {"$lt": cutoff}})
        spans_result = self._spans.delete_many({"streamed_at": {"$lt": cutoff}})
        evals_result = self._evaluations.delete_many({"created_at": {"$lt": cutoff}})
        alerts_result = self._alerts.delete_many({"created_at": {"$lt": cutoff}})
        return {
            "traces_deleted": traces_result.deleted_count,
            "spans_deleted": spans_result.deleted_count,
            "evaluations_deleted": evals_result.deleted_count,
            "alerts_deleted": alerts_result.deleted_count,
            "retention_days": retention_days,
        }

    # ── Labeling Sessions ──────────────────────────────────────────────
    def create_labeling_session(self, session_id, name, trace_ids, reviewer_emails=None, schema_id=None, description=""):
        now = datetime.utcnow()
        doc = {
            "session_id": session_id,
            "name": name,
            "description": description,
            "trace_ids": trace_ids or [],
            "reviewer_emails": reviewer_emails or [],
            "schema_id": schema_id or "",
            "reviews": {},
            "created_at": now,
            "updated_at": now,
        }
        self._labeling_sessions.insert_one(doc)
        return {"ok": True, "session_id": session_id}

    def list_labeling_sessions(self, limit=50, offset=0):
        total = self._labeling_sessions.count_documents({})
        docs = list(self._labeling_sessions.find().sort("created_at", -1).skip(offset).limit(limit))
        sessions = []
        for d in docs:
            d["_id"] = str(d["_id"])
            reviews = d.get("reviews", {})
            total_traces = len(d.get("trace_ids", []))
            reviewed = len(reviews)
            d["review_progress"] = round(reviewed / total_traces * 100) if total_traces else 0
            d["trace_count"] = total_traces
            d["reviewed_count"] = reviewed
            if d.get("created_at"):
                d["created_at"] = d["created_at"].isoformat()
            if d.get("updated_at"):
                d["updated_at"] = d["updated_at"].isoformat()
            sessions.append(d)
        return {"sessions": sessions, "total": total}

    def get_labeling_session(self, session_id):
        doc = self._labeling_sessions.find_one({"session_id": session_id})
        if not doc:
            return None
        doc["_id"] = str(doc["_id"])
        reviews = doc.get("reviews", {})
        total_traces = len(doc.get("trace_ids", []))
        doc["review_progress"] = round(len(reviews) / total_traces * 100) if total_traces else 0
        doc["trace_count"] = total_traces
        doc["reviewed_count"] = len(reviews)
        if doc.get("created_at"):
            doc["created_at"] = doc["created_at"].isoformat()
        if doc.get("updated_at"):
            doc["updated_at"] = doc["updated_at"].isoformat()
        return doc

    def add_traces_to_labeling_session(self, session_id, trace_ids):
        result = self._labeling_sessions.update_one(
            {"session_id": session_id},
            {"$addToSet": {"trace_ids": {"$each": trace_ids}}, "$set": {"updated_at": datetime.utcnow()}},
        )
        return {"ok": result.modified_count > 0}

    def share_labeling_session(self, session_id, reviewer_emails):
        result = self._labeling_sessions.update_one(
            {"session_id": session_id},
            {"$addToSet": {"reviewer_emails": {"$each": reviewer_emails}}, "$set": {"updated_at": datetime.utcnow()}},
        )
        return {"ok": True}

    def submit_labeling_review(self, session_id, trace_id, review_data):
        key = f"reviews.{trace_id}"
        review_data["reviewed_at"] = datetime.utcnow().isoformat()
        result = self._labeling_sessions.update_one(
            {"session_id": session_id},
            {"$set": {key: review_data, "updated_at": datetime.utcnow()}},
        )
        if review_data.get("correctness") is not None:
            score = 1.0 if review_data["correctness"] in ("yes", True) else 0.0
            value = "True" if review_data["correctness"] in ("yes", True) else "False"
            self.add_feedback(
                trace_id=trace_id,
                key="labeling_correctness",
                score=score,
                value=value,
                comment=review_data.get("comment", ""),
                source="labeling_session",
            )
        corrected = review_data.get("corrected_output")
        if corrected:
            self.add_feedback(
                trace_id=trace_id,
                key="corrected_output",
                score=1.0,
                value=str(corrected),
                comment="SME-provided ground truth from labeling session",
                source="labeling_session",
            )
        return {"ok": result.modified_count > 0}

    def get_labeling_session_traces(self, session_id):
        session = self._labeling_sessions.find_one({"session_id": session_id})
        if not session:
            return []
        trace_ids = session.get("trace_ids", [])
        reviews = session.get("reviews", {})
        traces_data = []
        for tid in trace_ids:
            trace = self.get(tid)
            if trace:
                trace_entry = {
                    "trace_id": tid,
                    "request": self._extract_trace_request(trace),
                    "response": self._extract_trace_response(trace),
                    "reviewed": tid in reviews,
                    "review": reviews.get(tid),
                }
                traces_data.append(trace_entry)
        return traces_data

    def _extract_trace_request(self, trace):
        spans = trace.get("flat_spans") or trace.get("spans") or []
        for s in spans:
            llm = s.get("llm")
            if isinstance(llm, dict) and llm.get("prompt_messages"):
                return llm["prompt_messages"]
            if s.get("prompt_messages"):
                return s["prompt_messages"]
            inp = s.get("inputs") or s.get("input") or s.get("attributes", {}).get("input")
            if inp:
                return inp if isinstance(inp, str) else json.dumps(inp, default=str)
        payload = trace.get("payload", {}) or {}
        meta = payload.get("metadata", {}) or trace.get("metadata", {}) or {}
        return meta.get("request") or payload.get("request") or trace.get("request") or ""

    def _extract_trace_response(self, trace):
        spans = trace.get("flat_spans") or trace.get("spans") or []
        for s in reversed(spans):
            llm = s.get("llm")
            if isinstance(llm, dict) and llm.get("completion"):
                return llm["completion"]
            if s.get("completion"):
                return s["completion"]
            out = s.get("outputs") or s.get("output") or s.get("attributes", {}).get("output")
            if out:
                return out if isinstance(out, str) else json.dumps(out, default=str)
        payload = trace.get("payload", {}) or {}
        meta = payload.get("metadata", {}) or trace.get("metadata", {}) or {}
        return meta.get("response") or payload.get("response") or trace.get("response") or ""

    def _extract_preview_from_payload(self, payload: dict, kind: str) -> str:
        """Extract a short text preview from a trace payload (for list view)."""
        def _flatten_spans(spans):
            out = []
            for s in (spans or []):
                out.append(s)
                out.extend(_flatten_spans(s.get("children", [])))
            return out

        spans = _flatten_spans(payload.get("spans", []))
        if kind == "request":
            for s in spans:
                inp = s.get("inputs")
                if isinstance(inp, str) and inp.strip():
                    return inp.strip()[:200]
                if isinstance(inp, dict):
                    for v in inp.values():
                        if isinstance(v, str) and v.strip():
                            return v.strip()[:200]
            return str(payload.get("metadata", {}).get("request", ""))[:200]
        else:
            for s in reversed(spans):
                out = s.get("outputs")
                if isinstance(out, str) and out.strip():
                    return out.strip()[:200]
                if isinstance(out, dict):
                    for v in out.values():
                        if isinstance(v, str) and v.strip():
                            return v.strip()[:200]
            return str(payload.get("metadata", {}).get("response", ""))[:200]

    # ── Labeling Schemas ───────────────────────────────────────────────
    def create_labeling_schema(self, schema_id, name, fields):
        now = datetime.utcnow()
        doc = {
            "schema_id": schema_id,
            "name": name,
            "fields": fields,
            "created_at": now,
        }
        self._labeling_schemas.insert_one(doc)
        return {"ok": True, "schema_id": schema_id}

    def list_labeling_schemas(self, limit=50):
        docs = list(self._labeling_schemas.find().sort("created_at", -1).limit(limit))
        for d in docs:
            d["_id"] = str(d["_id"])
            if d.get("created_at"):
                d["created_at"] = d["created_at"].isoformat()
        return {"schemas": docs}

    def get_labeling_schema(self, schema_id):
        doc = self._labeling_schemas.find_one({"schema_id": schema_id})
        if doc:
            doc["_id"] = str(doc["_id"])
            if doc.get("created_at"):
                doc["created_at"] = doc["created_at"].isoformat()
        return doc


    # ── Judge Monitor Config ───────────────────────────────────────────
    def get_judge_monitor_config(self, evaluator_id):
        doc = self._judge_monitor_config.find_one({"evaluator_id": evaluator_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def set_judge_monitor_config(self, evaluator_id, enabled, sample_rate=100, filters=None, evaluator_config=None):
        now = datetime.utcnow()
        doc = {
            "evaluator_id": evaluator_id,
            "enabled": enabled,
            "sample_rate": sample_rate,
            "filters": filters or {},
            "updated_at": now,
        }
        if evaluator_config is not None and isinstance(evaluator_config, dict) and evaluator_config:
            doc["evaluator_config"] = evaluator_config
        elif evaluator_config is not None and not evaluator_config:
            doc["evaluator_config"] = None  # Explicit clear
        self._judge_monitor_config.update_one(
            {"evaluator_id": evaluator_id},
            {"$set": doc, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        return {"ok": True}

    def get_active_judge_monitors(self):
        docs = list(self._judge_monitor_config.find({"enabled": True}))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs


    # -- Prompt Templates CRUD --
    def create_prompt_template(self, prompt_id, name, content, variables=None, agent_name="", product_id="default", tags=None, description=""):
        now = datetime.utcnow()
        tmpl = {
            "prompt_id": prompt_id,
            "name": name,
            "agent_name": agent_name,
            "product_id": product_id,
            "description": description,
            "version_count": 1,
            "_latest_content": content,
            "created_at": now,
            "updated_at": now,
        }
        self._prompt_templates.insert_one(tmpl)
        ver = {
            "prompt_id": prompt_id,
            "version_number": 1,
            "content": content,
            "variables": variables or [],
            "tags": tags or [],
            "aliases": [],
            "model": "",
            "created_at": now,
        }
        self._prompt_template_versions.insert_one(ver)
        return {"ok": True, "prompt_id": prompt_id}

    def list_prompt_templates(self, product_id=None, limit=100):
        query = {}
        if product_id:
            query["product_id"] = product_id
        docs = list(self._prompt_templates.find(query).sort("updated_at", -1).limit(limit))
        for d in docs:
            d["_id"] = str(d["_id"])
            if d.get("created_at"):
                d["created_at"] = d["created_at"].isoformat()
            if d.get("updated_at"):
                d["updated_at"] = d["updated_at"].isoformat()
        return docs

    def get_prompt_template(self, prompt_id):
        doc = self._prompt_templates.find_one({"prompt_id": prompt_id})
        if doc:
            doc["_id"] = str(doc["_id"])
            if doc.get("created_at"):
                doc["created_at"] = doc["created_at"].isoformat()
            if doc.get("updated_at"):
                doc["updated_at"] = doc["updated_at"].isoformat()
        return doc

    def create_prompt_version(self, prompt_id, content, variables=None, tags=None, model=""):
        now = datetime.utcnow()
        tmpl = self._prompt_templates.find_one({"prompt_id": prompt_id})
        if not tmpl:
            return None
        next_version = (tmpl.get("version_count", 0) or 0) + 1
        ver = {
            "prompt_id": prompt_id,
            "version_number": next_version,
            "content": content,
            "variables": variables or [],
            "tags": tags or [],
            "aliases": [],
            "model": model,
            "created_at": now,
        }
        self._prompt_template_versions.insert_one(ver)
        self._prompt_templates.update_one(
            {"prompt_id": prompt_id},
            {"$set": {"version_count": next_version, "updated_at": now}},
        )
        return {"ok": True, "version_number": next_version}

    def list_prompt_versions_for_template(self, prompt_id, limit=100):
        docs = list(self._prompt_template_versions.find({"prompt_id": prompt_id}).sort("version_number", -1).limit(limit))
        for d in docs:
            d["_id"] = str(d["_id"])
            if d.get("created_at"):
                d["created_at"] = d["created_at"].isoformat()
        return docs

    def get_prompt_version(self, prompt_id, version_number):
        doc = self._prompt_template_versions.find_one({"prompt_id": prompt_id, "version_number": version_number})
        if doc:
            doc["_id"] = str(doc["_id"])
            if doc.get("created_at"):
                doc["created_at"] = doc["created_at"].isoformat()
        return doc

    def compare_prompt_versions(self, prompt_id, version_a, version_b):
        a = self.get_prompt_version(prompt_id, version_a)
        b = self.get_prompt_version(prompt_id, version_b)
        return {"version_a": a, "version_b": b}

    # ── Prompt Template / Version CRUD ────────────────────────────────

    def _sync_prompt_template_from_versions(self, prompt_id: str):
        """Recompute version_count and _latest_content from remaining versions."""
        now = datetime.utcnow()
        cursor = list(
            self._prompt_template_versions
            .find({"prompt_id": prompt_id})
            .sort("version_number", -1)
            .limit(1)
        )
        if not cursor:
            self._prompt_templates.update_one(
                {"prompt_id": prompt_id},
                {"$set": {"version_count": 0, "_latest_content": "", "updated_at": now}},
            )
            return
        latest = cursor[0]
        max_ver = latest.get("version_number", 1)
        self._prompt_templates.update_one(
            {"prompt_id": prompt_id},
            {"$set": {
                "version_count": max_ver,
                "_latest_content": latest.get("content", ""),
                "updated_at": now,
            }},
        )

    def update_prompt_template(self, prompt_id: str, name=None, description=None,
                               agent_name=None, product_id=None) -> dict:
        tmpl = self._prompt_templates.find_one({"prompt_id": prompt_id})
        if not tmpl:
            return None
        updates = {"updated_at": datetime.utcnow()}
        if name is not None:
            updates["name"] = name
        if description is not None:
            updates["description"] = description
        if agent_name is not None:
            updates["agent_name"] = agent_name
        if product_id is not None:
            updates["product_id"] = product_id
        self._prompt_templates.update_one({"prompt_id": prompt_id}, {"$set": updates})
        return {"ok": True, "prompt_id": prompt_id}

    def delete_prompt_template(self, prompt_id: str) -> dict:
        self._prompt_template_versions.delete_many({"prompt_id": prompt_id})
        r = self._prompt_templates.delete_one({"prompt_id": prompt_id})
        return {"ok": r.deleted_count > 0}

    def update_prompt_version(self, prompt_id: str, version_number: int,
                              content=None, tags=None, variables=None, model=None) -> dict:
        if not self.get_prompt_version(prompt_id, version_number):
            return None
        updates = {}
        if content is not None:
            updates["content"] = content
        if tags is not None:
            updates["tags"] = tags
        if variables is not None:
            updates["variables"] = variables
        if model is not None:
            updates["model"] = model
        if not updates:
            return {"ok": True, "prompt_id": prompt_id, "version_number": version_number}
        self._prompt_template_versions.update_one(
            {"prompt_id": prompt_id, "version_number": version_number},
            {"$set": updates},
        )
        self._sync_prompt_template_from_versions(prompt_id)
        return {"ok": True, "prompt_id": prompt_id, "version_number": version_number}

    def delete_prompt_version(self, prompt_id: str, version_number: int) -> dict:
        n = self._prompt_template_versions.count_documents({"prompt_id": prompt_id})
        if n <= 1:
            return {"ok": False, "error": "Cannot delete the only version. Delete the prompt template instead."}
        r = self._prompt_template_versions.delete_one(
            {"prompt_id": prompt_id, "version_number": version_number}
        )
        if r.deleted_count == 0:
            return {"ok": False, "error": "Version not found"}
        self._sync_prompt_template_from_versions(prompt_id)
        return {"ok": True}

    # ── Score Configs ─────────────────────────────────────────────────
    def create_score_config(self, data: dict) -> dict:
        now = datetime.utcnow()
        data["created_at"] = now
        data["updated_at"] = now
        self._score_configs.insert_one(data)
        return {"ok": True, "config_id": data.get("config_id")}

    def list_score_configs(self, product_id=None) -> list:
        filt = {}
        if product_id:
            filt["product_id"] = product_id
        docs = list(self._score_configs.find(filt).sort("created_at", -1))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    def get_score_config(self, config_id: str) -> Optional[dict]:
        doc = self._score_configs.find_one({"config_id": config_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def update_score_config(self, config_id: str, data: dict) -> dict:
        data.pop("config_id", None)
        data["updated_at"] = datetime.utcnow()
        r = self._score_configs.update_one({"config_id": config_id}, {"$set": data})
        return {"ok": r.matched_count > 0}

    def delete_score_config(self, config_id: str) -> dict:
        r = self._score_configs.delete_one({"config_id": config_id})
        return {"ok": r.deleted_count > 0}

    # ── Scores (unified: human + evaluator + API) ────────────────────
    def add_score(self, data: dict) -> dict:
        import uuid as _uuid
        data.setdefault("score_id", f"sc_{_uuid.uuid4().hex[:10]}")
        data["created_at"] = datetime.utcnow()
        self._scores.insert_one(data)
        return {"ok": True, "score_id": data["score_id"]}

    def get_scores(self, trace_id=None, span_id=None, config_id=None,
                   source=None, limit=200) -> list:
        filt = {}
        if trace_id:
            filt["trace_id"] = trace_id
        if span_id:
            filt["span_id"] = span_id
        if config_id:
            filt["config_id"] = config_id
        if source:
            filt["source"] = source
        docs = list(self._scores.find(filt).sort("created_at", -1).limit(limit))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    def get_scores_for_traces(self, trace_ids: list) -> dict:
        if not trace_ids:
            return {}
        docs = list(self._scores.find({"trace_id": {"$in": trace_ids}}))
        result = defaultdict(list)
        for d in docs:
            d["_id"] = str(d["_id"])
            result[d["trace_id"]].append(d)
        return dict(result)

    # ── Annotation Queues ────────────────────────────────────────────
    def create_annotation_queue(self, data: dict) -> dict:
        now = datetime.utcnow()
        data["created_at"] = now
        data["updated_at"] = now
        data.setdefault("items", [])
        data.setdefault("status", "active")
        self._annotation_queues.insert_one(data)
        return {"ok": True, "queue_id": data.get("queue_id")}

    def list_annotation_queues(self, product_id=None) -> list:
        filt = {}
        if product_id:
            filt["product_id"] = product_id
        docs = list(self._annotation_queues.find(filt, {"items": 0}).sort("created_at", -1))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    def get_annotation_queue(self, queue_id: str) -> Optional[dict]:
        doc = self._annotation_queues.find_one({"queue_id": queue_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def update_annotation_queue(self, queue_id: str, data: dict) -> dict:
        data.pop("queue_id", None)
        data["updated_at"] = datetime.utcnow()
        r = self._annotation_queues.update_one({"queue_id": queue_id}, {"$set": data})
        return {"ok": r.matched_count > 0}

    def delete_annotation_queue(self, queue_id: str) -> dict:
        r = self._annotation_queues.delete_one({"queue_id": queue_id})
        return {"ok": r.deleted_count > 0}

    def add_items_to_annotation_queue(self, queue_id: str, items: list) -> dict:
        import uuid as _uuid
        for item in items:
            item.setdefault("item_id", f"aqi_{_uuid.uuid4().hex[:8]}")
            item.setdefault("status", "pending")
            item.setdefault("annotations", [])
        r = self._annotation_queues.update_one(
            {"queue_id": queue_id},
            {"$push": {"items": {"$each": items}},
             "$set": {"updated_at": datetime.utcnow()}},
        )
        return {"ok": r.matched_count > 0, "added": len(items)}

    def annotate_queue_item(self, queue_id: str, item_id: str, annotation: dict) -> dict:
        annotation["created_at"] = datetime.utcnow().isoformat()
        r = self._annotation_queues.update_one(
            {"queue_id": queue_id, "items.item_id": item_id},
            {"$push": {"items.$.annotations": annotation},
             "$set": {"items.$.status": "reviewed", "updated_at": datetime.utcnow()}},
        )
        return {"ok": r.modified_count > 0}

    def approve_queue_items(self, queue_id: str, item_ids: list) -> dict:
        r = self._annotation_queues.update_one(
            {"queue_id": queue_id},
            {"$set": {
                "updated_at": datetime.utcnow(),
            }},
        )
        queue = self.get_annotation_queue(queue_id)
        if not queue:
            return {"ok": False, "error": "Queue not found"}
        approved = []
        for item in queue.get("items", []):
            if item.get("item_id") in item_ids:
                approved.append(item)
                self._annotation_queues.update_one(
                    {"queue_id": queue_id, "items.item_id": item["item_id"]},
                    {"$set": {"items.$.status": "approved"}},
                )
        target_dataset_id = queue.get("target_dataset_id")
        if target_dataset_id and approved:
            import uuid as _uuid
            ds_items = []
            for item in approved:
                ds_item = {
                    "item_id": f"item_{_uuid.uuid4().hex[:8]}",
                    "input": item.get("input", ""),
                    "expected_output": item.get("expected_output", ""),
                    "trace_id": item.get("trace_id", ""),
                    "span_id": item.get("span_id", ""),
                    "annotations": item.get("annotations", []),
                    "metadata": item.get("metadata", {}),
                    "tags": ["from-annotation-queue"],
                }
                ds_items.append(ds_item)
            self.add_dataset_items(target_dataset_id, ds_items)
        return {"ok": True, "approved_count": len(approved)}

    # ── Dataset Versions ─────────────────────────────────────────────
    def create_dataset_version(self, dataset_id: str, change_description: str = "") -> dict:
        import uuid as _uuid
        dataset = self.get_dataset(dataset_id)
        if not dataset:
            return {"ok": False, "error": "Dataset not found"}
        version_id = f"dsv_{_uuid.uuid4().hex[:8]}"
        items = dataset.get("items", [])
        item_ids = [it.get("item_id") for it in items]
        doc = {
            "version_id": version_id,
            "dataset_id": dataset_id,
            "item_ids": item_ids,
            "item_snapshot": items,
            "item_count": len(items),
            "change_description": change_description,
            "created_at": datetime.utcnow(),
        }
        self._dataset_versions.insert_one(doc)
        return {"ok": True, "version_id": version_id}

    def list_dataset_versions(self, dataset_id: str) -> list:
        docs = list(self._dataset_versions.find(
            {"dataset_id": dataset_id}).sort("created_at", -1))
        for d in docs:
            d["_id"] = str(d["_id"])
            d.pop("item_snapshot", None)
        return docs

    def get_dataset_version(self, dataset_id: str, version_id: str) -> Optional[dict]:
        doc = self._dataset_versions.find_one(
            {"dataset_id": dataset_id, "version_id": version_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def restore_dataset_version(self, dataset_id: str, version_id: str) -> dict:
        version = self.get_dataset_version(dataset_id, version_id)
        if not version:
            return {"ok": False, "error": "Version not found"}
        items = version.get("item_snapshot", [])
        self._datasets.update_one(
            {"dataset_id": dataset_id},
            {"$set": {"items": items, "item_count": len(items),
                      "updated_at": datetime.utcnow()}},
        )
        self.create_dataset_version(dataset_id, f"Restored from {version_id}")
        return {"ok": True, "restored_items": len(items)}

    def split_dataset(self, dataset_id: str, train_ratio=0.7, test_ratio=0.15, val_ratio=0.15) -> dict:
        import random
        dataset = self.get_dataset(dataset_id)
        if not dataset:
            return {"ok": False, "error": "Dataset not found"}
        items = dataset.get("items", [])
        random.shuffle(items)
        n = len(items)
        train_end = int(n * train_ratio)
        test_end = train_end + int(n * test_ratio)
        for i, item in enumerate(items):
            if i < train_end:
                item["split"] = "train"
            elif i < test_end:
                item["split"] = "test"
            else:
                item["split"] = "validation"
        self._datasets.update_one(
            {"dataset_id": dataset_id},
            {"$set": {"items": items, "updated_at": datetime.utcnow()}},
        )
        return {"ok": True, "train": train_end, "test": test_end - train_end, "validation": n - test_end}

    def get_dataset_items(self, dataset_id: str, split=None) -> list:
        dataset = self.get_dataset(dataset_id)
        if not dataset:
            return []
        items = dataset.get("items", [])
        if split:
            items = [i for i in items if i.get("split") == split]
        return items

    # ── Experiments ──────────────────────────────────────────────────
    def create_experiment(self, data: dict) -> dict:
        now = datetime.utcnow()
        data["created_at"] = now
        data["updated_at"] = now
        data.setdefault("status", "running")
        self._experiments.insert_one(data)
        return {"ok": True, "experiment_id": data.get("experiment_id")}

    def list_experiments(self, product_id=None, prompt_id=None, limit=50) -> list:
        filt = {}
        if product_id:
            filt["product_id"] = product_id
        if prompt_id:
            filt["prompt_id"] = prompt_id
        docs = list(self._experiments.find(filt).sort("created_at", -1).limit(limit))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    def get_experiment(self, experiment_id: str) -> Optional[dict]:
        doc = self._experiments.find_one({"experiment_id": experiment_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def update_experiment(self, experiment_id: str, data: dict) -> dict:
        data.pop("experiment_id", None)
        data["updated_at"] = datetime.utcnow()
        r = self._experiments.update_one({"experiment_id": experiment_id}, {"$set": data})
        return {"ok": r.matched_count > 0}

    # ── Evaluation Suites ────────────────────────────────────────────
    def create_evaluation_suite(self, data: dict) -> dict:
        now = datetime.utcnow()
        data["created_at"] = now
        data["updated_at"] = now
        self._evaluation_suites.insert_one(data)
        return {"ok": True, "suite_id": data.get("suite_id")}

    def list_evaluation_suites(self, product_id=None) -> list:
        filt = {}
        if product_id:
            filt["product_id"] = product_id
        docs = list(self._evaluation_suites.find(filt).sort("created_at", -1))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    def get_evaluation_suite(self, suite_id: str) -> Optional[dict]:
        doc = self._evaluation_suites.find_one({"suite_id": suite_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def update_evaluation_suite(self, suite_id: str, data: dict) -> dict:
        data.pop("suite_id", None)
        data["updated_at"] = datetime.utcnow()
        r = self._evaluation_suites.update_one({"suite_id": suite_id}, {"$set": data})
        return {"ok": r.matched_count > 0}

    def delete_evaluation_suite(self, suite_id: str) -> dict:
        r = self._evaluation_suites.delete_one({"suite_id": suite_id})
        return {"ok": r.deleted_count > 0}

    # ── Prompt Deployments (A/B Testing) ─────────────────────────────
    def create_prompt_deployment(self, data: dict) -> dict:
        now = datetime.utcnow()
        data["created_at"] = now
        data["started_at"] = now
        data.setdefault("status", "active")
        self._prompt_deployments.update_one(
            {"prompt_id": data["prompt_id"], "status": "active"},
            {"$set": {"status": "paused", "ended_at": now}},
        )
        self._prompt_deployments.insert_one(data)
        return {"ok": True, "deployment_id": data.get("deployment_id")}

    def get_active_deployment(self, prompt_id: str) -> Optional[dict]:
        doc = self._prompt_deployments.find_one(
            {"prompt_id": prompt_id, "status": "active"})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def get_prompt_deployment(self, deployment_id: str) -> Optional[dict]:
        doc = self._prompt_deployments.find_one({"deployment_id": deployment_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def update_prompt_deployment(self, deployment_id: str, data: dict) -> dict:
        data.pop("deployment_id", None)
        r = self._prompt_deployments.update_one(
            {"deployment_id": deployment_id}, {"$set": data})
        return {"ok": r.matched_count > 0}

    def resolve_prompt_version(self, prompt_id: str) -> Optional[dict]:
        """Resolve which prompt version to serve based on active A/B deployment."""
        import random
        deployment = self.get_active_deployment(prompt_id)
        if not deployment or not deployment.get("variants"):
            latest = self.list_prompt_versions_for_template(prompt_id, limit=1)
            if latest:
                return {"version_number": latest[0]["version_number"],
                        "deployment_id": None, "variant": "default"}
            return None
        variants = deployment["variants"]
        roll = random.random()
        cumulative = 0.0
        for v in variants:
            cumulative += v.get("weight", 0)
            if roll <= cumulative:
                return {"version_number": v["version"],
                        "deployment_id": deployment["deployment_id"],
                        "variant": f"v{v['version']}"}
        last = variants[-1]
        return {"version_number": last["version"],
                "deployment_id": deployment["deployment_id"],
                "variant": f"v{last['version']}"}

    # ── Scheduled Evaluations ────────────────────────────────────────
    def create_scheduled_evaluation(self, data: dict) -> dict:
        now = datetime.utcnow()
        data["created_at"] = now
        data["updated_at"] = now
        data.setdefault("enabled", True)
        self._scheduled_evaluations.insert_one(data)
        return {"ok": True, "schedule_id": data.get("schedule_id")}

    def list_scheduled_evaluations(self, product_id=None) -> list:
        filt = {}
        if product_id:
            filt["product_id"] = product_id
        docs = list(self._scheduled_evaluations.find(filt).sort("created_at", -1))
        for d in docs:
            d["_id"] = str(d["_id"])
        return docs

    def get_scheduled_evaluation(self, schedule_id: str) -> Optional[dict]:
        doc = self._scheduled_evaluations.find_one({"schedule_id": schedule_id})
        if doc:
            doc["_id"] = str(doc["_id"])
        return doc

    def update_scheduled_evaluation(self, schedule_id: str, data: dict) -> dict:
        data.pop("schedule_id", None)
        data["updated_at"] = datetime.utcnow()
        r = self._scheduled_evaluations.update_one(
            {"schedule_id": schedule_id}, {"$set": data})
        return {"ok": r.matched_count > 0}

    def delete_scheduled_evaluation(self, schedule_id: str) -> dict:
        r = self._scheduled_evaluations.delete_one({"schedule_id": schedule_id})
        return {"ok": r.deleted_count > 0}


class MongoDashboardStore:
    def __init__(self):
        db = _get_db()
        self._coll = db["dashboards"]
        try:
            self._coll.create_index("product_id")
        except Exception:
            pass

    def list_dashboards(self, product_id=None) -> list:
        filt = {}
        if product_id:
            filt["product_id"] = product_id
        docs = list(self._coll.find(filt).sort("updated_at", -1))
        return [{"id": str(d["_id"]), "name": d.get("name", ""), "product_id": d.get("product_id", "default"),
                 "description": d.get("description", "")} for d in docs]

    def create_dashboard(self, name, product_id, description=None, layout=None):
        doc = {"name": name, "product_id": product_id or "default", "description": description or "",
               "layout": layout or {}, "created_at": datetime.utcnow(), "updated_at": datetime.utcnow()}
        r = self._coll.insert_one(doc)
        return {"id": str(r.inserted_id), "name": name}

    def get_dashboard(self, dashboard_id):
        try:
            oid = ObjectId(dashboard_id)
        except Exception:
            return None
        doc = self._coll.find_one({"_id": oid})
        if not doc:
            return None
        return {"id": str(doc["_id"]), "name": doc.get("name", ""), "product_id": doc.get("product_id", "default"),
                "layout": doc.get("layout", {}), "description": doc.get("description", "")}

    def update_dashboard(self, dashboard_id, name=None, layout=None, description=None):
        try:
            oid = ObjectId(dashboard_id)
        except Exception:
            return False
        updates = {"updated_at": datetime.utcnow()}
        if name is not None:
            updates["name"] = name
        if layout is not None:
            updates["layout"] = layout
        if description is not None:
            updates["description"] = description
        r = self._coll.update_one({"_id": oid}, {"$set": updates})
        return r.modified_count > 0 or r.matched_count > 0

    def delete_dashboard(self, dashboard_id):
        try:
            oid = ObjectId(dashboard_id)
        except Exception:
            return False
        r = self._coll.delete_one({"_id": oid})
        return r.deleted_count > 0


class MongoPipelineStore:
    def __init__(self):
        db = _get_db()
        self._coll = db["pipelines"]
        self._ensure_indexes()

    def _ensure_indexes(self):
        try:
            self._coll.create_index("product_id", unique=True)
        except Exception as e:
            logger.debug("Pipeline index creation: %s", e)

    def upsert_pipeline(self, product_id: str, pipeline: dict) -> dict:
        now = datetime.utcnow()
        doc = {
            "product_id": product_id,
            "nodes": pipeline.get("nodes", []),
            "edges": pipeline.get("edges", []),
            "parallel_groups": pipeline.get("parallel_groups", []),
            "updated_at": now,
        }
        self._coll.update_one(
            {"product_id": product_id},
            {"$set": doc, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        return {"product_id": product_id, "status": "ok"}

    def get_pipeline(self, product_id: str) -> Optional[dict]:
        doc = self._coll.find_one({"product_id": product_id})
        if not doc:
            return None
        return {
            "product_id": doc["product_id"],
            "nodes": doc.get("nodes", []),
            "edges": doc.get("edges", []),
            "parallel_groups": doc.get("parallel_groups", []),
        }

    def list_pipelines(self) -> list:
        return [
            {
                "product_id": doc["product_id"],
                "nodes": doc.get("nodes", []),
                "edges": doc.get("edges", []),
                "parallel_groups": doc.get("parallel_groups", []),
            }
            for doc in self._coll.find({}, {"_id": 0})
        ]
