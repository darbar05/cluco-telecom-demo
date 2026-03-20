# LLM tracing – where it’s implemented and why it might not show

This doc lists **all files** involved in getting LLM calls (prompts + completions) into the Cluco observability UI and MongoDB, and a short **checklist** if they don’t appear.

---

## 1. Flow overview

```
Demand-draft pipeline runs
    → init_tracer() (once per request)
    → start_trace() → root span on current tracer
    → graph.invoke() with callbacks=get_callbacks()
        → LangChain calls LLM
        → on_chat_model_start  → create LLM span, store in _active_spans
        → on_chat_model_end    → set prompt_messages + completion, end span, call on_span_end(span)
    → on_span_end = _stream_span_to_backend(span)
        → span.to_dict() (includes llm.prompt_messages, llm.completion)
        → POST /api/v1/spans/stream
    → Backend stream_span() → store in MongoDB (spans + prompt_messages/completion at top level)
    → end_trace() → finalize trace
```

If **any** of these break (no tracer, wrong tracer, no callbacks, stream fails, backend not storing), LLM calls won’t show in UI or MongoDB.

---

## 2. Relevant files by layer

### A. SDK (cluco-observability/sdk) – create and serialize LLM spans

| File | Role |
|------|------|
| **`cluco_obs/callbacks.py`** | **Main LLM integration.** `ClucoCallbackHandler`: `on_chat_model_start` creates span and sets `prompt_messages`; `on_chat_model_end` → `_finish_llm_span` sets tokens/cost/completion, ends span, then calls `_on_span_end(span)` to stream. `get_langchain_handler(tracer=None, on_span_end=...)` builds the handler; **tracer=None** so handler always uses current global tracer. |
| **`cluco_obs/spans.py`** | Span model. `SpanKind.LLM`; `set_llm_data(..., prompt_messages, completion)`; **`to_dict()`** puts `llm: { model, input_tokens, output_tokens, cost_usd, prompt_messages, completion }` so stream payload has prompts and completion. |
| **`cluco_obs/tracer.py`** | `start_span(..., kind=SpanKind.LLM)`, `end_span`, `get_tracer()`, `init_tracer(config)`. Global tracer used by callbacks. |
| **`cluco_obs/config.py`** | `ClucoConfig`: backend_url, enabled, product_id, service_name. |
| **`cluco_obs/exporter.py`** | Sends full trace to `/api/v1/traces/ingest` when root span ends (batch). LLM data can also arrive via **stream** (see below). |

### B. Demand-draft-service – wire tracer and stream LLM spans

| File | Role |
|------|------|
| **`app/observability.py`** | **Critical.** `init_tracer(backend_url, enabled)` sets SDK global tracer. **`get_callbacks()`** returns `[get_langchain_handler(None, on_span_end=_stream_span_to_backend)]` so every finished LLM span is streamed. **`_stream_span_to_backend(span)`** builds `span_data = span.to_dict()`, POSTs to `AGENT_OBS_BACKEND_URL + "/api/v1/spans/stream"`. Logs `[stream] LLM span streamed` on success, warnings on failure. |
| **`app/config.py`** | `Settings.agent_obs_enabled`, `agent_obs_backend_url` – must be True and correct URL. |
| **`app/agents/graph.py`** | Uses `get_callbacks()` for every LLM: `_create_llm(..., callbacks=get_callbacks())`, and nodes that invoke the graph use `callbacks=get_callbacks()`. **`run_demand_draft`** calls `init_tracer(get_settings().agent_obs_backend_url)` when `agent_obs_enabled` then `start_trace` / `end_trace`. |

### C. Cluco backend – store spans and expose to API/UI

| File | Role |
|------|------|
| **`app/storage/mongodb.py`** | **`stream_span(trace_id, span_data, ...)`**: builds `span_doc` from `span_data`, including **`llm: span_data.get("llm")`**; **copies `llm.prompt_messages` and `llm.completion` to top level** so they’re in the stored document. Upserts into `_spans`. **`_flatten_and_store_spans`** (used by ingest) also copies prompt_messages/completion for batch payloads. **`_enrich_flat_span`** ensures API responses expose `prompt_messages` and `completion` from `llm` or top level. |
| **`app/routes.py`** | `POST /spans/stream` → `store.stream_span(...)`. `GET /traces/{trace_id}` → store.get() (uses enriched spans). `GET /llm-calls` → store.get_llm_calls(). |
| **`app/cost.py`** | Cost/token aggregation for LLM spans. |

### D. Cluco UI – show LLM data

| File | Role |
|------|------|
| **`ui/src/pages/LLMCallsPage.jsx`** | LLM Calls page: uses `getLLMCalls()`; shows `prompt_messages` and `completion` (from `call.prompt_messages ?? call.llm?.prompt_messages` and `call.completion ?? call.llm?.completion`). |
| **`ui/src/components/TraceContent.jsx`** | Trace detail → Span tab: for `kind === 'llm'` shows prompt (from `prompt_messages`) and completion (from `completion` or `llm.completion` or `outputs.completion`). |
| **`ui/src/api.js`** | `getLLMCalls(params)`, `getTrace(id)` – API base URL from env. |

---

## 3. Why LLM calls might not appear – checklist

1. **Observability off or wrong URL**
   - In **demand-draft-service** `.env`: `AGENT_OBS_ENABLED=true` and `AGENT_OBS_BACKEND_URL=http://localhost:9410` (or your backend URL).
   - If `get_tracer()` is None, `get_callbacks()` returns `[]` and no LLM spans are created.

2. **Handler using wrong tracer (fixed in code, needs restart)**
   - Handler must be created with **`get_langchain_handler(None, on_span_end=_stream_span_to_backend)`** so it uses the **current** global tracer. If an old handler is cached with a previous tracer, LLM spans attach to the wrong trace.
   - **Restart demand-draft-service** after pulling the fix so the new handler is used.

3. **Callbacks not passed to the LLM**
   - In **`app/agents/graph.py`**, every place that creates or invokes the chat model must use `callbacks=get_callbacks()` (e.g. `_create_llm(..., callbacks=get_callbacks())` and graph invoke with those callbacks). If any path omits callbacks, that LLM run won’t be traced.

4. **Stream never reaches backend**
   - **demand-draft-service** logs: look for `[stream] LLM span streamed: trace_id=...` (success) or `[stream] Span stream error: ...` / `Span stream failed: HTTP ...` (failure).
   - **Backend** must be up and reachable at `AGENT_OBS_BACKEND_URL`. Check backend logs for `POST /api/v1/spans/stream` 200.

5. **Backend not storing or not exposing**
   - In **MongoDB**, collection for spans: each document should have `kind: "llm"`, and either `llm.prompt_messages` / `llm.completion` or top-level `prompt_messages` / `completion` (both set in `stream_span`).
   - **API**: trace payload and LLM-calls endpoint should return those fields (handled in `_enrich_flat_span` and route handlers).

6. **UI not showing**
   - **LLM Calls page** uses `getLLMCalls()` and displays `prompt_messages` / `completion` from the response.
   - **Trace detail → Span** uses the trace’s spans and shows LLM content from `prompt_messages` / `completion` / `llm` / `outputs.completion`.

---

## 4. Why agent/retriever spans have `llm: null` (and where LLM data lives)

- **Agent** and **retriever** spans are not LLM calls: they are the “container” for a step (e.g. `agent:planner`, `retriever:planner:multi_source`). So in MongoDB they correctly have **`llm: null`**; their `inputs`/`outputs` are agent-level (e.g. plan keys, reasoning steps) or retriever-level (query, documents).
- **LLM prompts and responses** are stored in **separate span documents** with **`kind: "llm"`**. Those spans have `parent_span_id` pointing to the agent (or chain) that made the call. So for each agent you get:
  - One span: `kind: "agent"`, `name: "agent:planner"`, `llm: null`
  - One or more spans: `kind: "llm"`, `name: "llm:gpt-4o-mini"`, `llm: { prompt_messages, completion }`, `parent_span_id: <agent span_id>`

**In MongoDB**

- To see **all LLM calls** (prompts and completions), query the **spans** collection with:
  - `{ "kind": "llm" }`
- To see LLM calls for one trace:
  - `{ "trace_id": "<your_trace_id>", "kind": "llm" }`
- Each document should have `prompt_messages` (array) and `completion` (string) at top level or under `llm`.

**In the UI**

- **Traces → [trace] → Spans tab:** The tree is built from `parent_span_id`. Expand an agent (e.g. “agent:planner”); its **children** include the **LLM** spans. Click an LLM span to see Prompt Messages and Completion in the detail panel.
- **LLM Calls page:** Lists every span with `kind: "llm"` (from the `/llm-calls` API). Each row shows prompt/completion and which agent it belongs to (`parent_agent`).

If you only see agent/retriever spans and **no** spans with `kind: "llm"`, then LLM spans are not being created or streamed (see checklist in section 3 and tracer/handler fix below).

---

## 5. Quick verification

- **Demand-draft-service log (after a run):**
  - `[observability] Trace started: trace_id=...`
  - `[stream] LLM span streamed: trace_id=... span_id=...` (one per LLM call)
  - `[observability] Trace finalized: trace_id=...`
- **Backend log:** `POST /api/v1/spans/stream HTTP/1.1" 200` (many times per run).
- **MongoDB:** In the spans collection, filter `kind: "llm"`; documents should have `prompt_messages` and `completion` (or inside `llm`).

---

## 6. File paths (relative to repo)

```
leco-pi/
├── cluco-observability/
│   ├── sdk/cluco_obs/
│   │   ├── callbacks.py    # LLM start/end, on_span_end streaming
│   │   ├── spans.py        # Span.to_dict() with llm.prompt_messages, completion
│   │   ├── tracer.py       # start_span, end_span, get_tracer, init_tracer
│   │   ├── config.py
│   │   └── exporter.py     # batch ingest
│   ├── backend/app/
│   │   ├── storage/mongodb.py  # stream_span, _flatten_and_store_spans, _enrich_flat_span
│   │   ├── routes.py          # POST /spans/stream, GET /traces/:id, GET /llm-calls
│   │   └── cost.py
│   └── ui/src/
│       ├── pages/LLMCallsPage.jsx
│       ├── components/TraceContent.jsx
│       └── api.js
└── demand-draft-service/app/
    ├── observability.py   # init_tracer, get_callbacks, _stream_span_to_backend
    ├── config.py          # agent_obs_enabled, agent_obs_backend_url
    └── agents/graph.py    # get_callbacks(), init_tracer in run_demand_draft
```

All of the above are the relevant files where LLM tracing is implemented. If LLM calls still don’t show in the UI or MongoDB, work through the checklist in section 3 and the verification in section 4 using these files.
