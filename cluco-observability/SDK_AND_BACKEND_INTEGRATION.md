# SDK and backend integration — implementation review

## 1. SDK (cluco_obs) — implementation summary

### 1.1 Config (`config.py`)
- **ClucoConfig**: `enabled`, `backend_url`, `product_id`, `service_name`, `environment`, batch/flush/queue, `capture_inputs`/`capture_outputs`, `sample_rate`, `tags`, `metadata`.
- **from_env()**: Reads `CLUCO_OBS_*` and falls back to `AGENT_OBS_BACKEND_URL` for `backend_url`. Service overrides in code (see below).

### 1.2 Tracer (`tracer.py`)
- **Context**: `_current_span`, `_current_trace_id`, `_current_session_id` (contextvars); single `_global_tracer`.
- **ClucoTracer**:
  - `start_session` / `start_trace`: set context.
  - `start_span`: creates `Span` with `trace_id` from context, `parent_span_id` from `_current_span`; appends to parent’s `children` or sets as root in `_root_spans`; sets `_current_span`.
  - `end_span`: clears/outputs, calls `span.end()`; if span has parent, restores `_current_span` to parent; if root, calls `_export_trace(root_span)`.
  - `_export_trace`: builds one trace payload with `spans: [root_span.to_dict()]` (tree in `children`), enqueues to exporter.
  - **record_llm_call** / **record_tool_call** / **record_retrieval** / **record_embedding**: start span, set kind-specific data, end span (no streaming; streaming is service responsibility via callbacks).
- **init_tracer(config)**: sets `_global_tracer = ClucoTracer(config)`.
- **get_tracer()**: returns `_global_tracer`.
- **Cost**: `MODEL_COSTS_PER_1K` for common models; `_estimate_cost(model, in_tok, out_tok)`; `_aggregate_tokens(span)` recurses over `span.children` for totals.

### 1.3 Spans (`spans.py`)
- **SpanKind**: CHAIN, AGENT, LLM, TOOL, RETRIEVER, EMBEDDING, GUARDRAIL.
- **Span**: `__slots__` for all fields; `set_llm_data`, `set_tool_data`, `set_retriever_data`, `set_embedding_data`; `end()` sets `end_time_ns`, status, outputs.
- **to_dict()**:
  - Always includes: `span_id`, `trace_id`, `parent_span_id`, `name`, `kind`, `status`, times, `metadata`, `tags`, `events`, `error` (if set).
  - **LLM**: `d["llm"]` with `model`, `provider`, `input_tokens`, `output_tokens`, `total_tokens`, `cost_usd`, **`prompt_messages`**, **`completion`** (and inputs/outputs when set).
  - **Embedding**: `d["embedding"]` with `model`, `dimensions`, `count`, **`input_tokens`**, **`cost_usd`**.
  - Tool/retriever: tool/retriever dicts.
  - **children**: recursive `[c.to_dict() for c in self.children]`.
- Serialization uses `_safe_serialize` and `_truncate` for large strings so payloads are JSON-safe.

### 1.4 Callbacks (`callbacks.py`)
- **ClucoCallbackHandler(tracer=None, on_span_end=None)**:
  - **tracer=None**: `_get_tracer()` always calls `get_tracer()` (no caching) so each request uses the current global tracer.
  - **on_span_end**: optional callable(span) used to stream the span when an LLM span ends.
  - **on_chat_model_start**: builds `prompt_messages` from messages (role + content), creates LLM span, stores in `_active_spans` by run_id.
  - **on_chat_model_end** / **on_llm_end**: `_finish_llm_span` — extracts completion and token usage from AIMessage/response, calls `span.set_llm_data(..., prompt_messages, completion)`, `tracer.end_span(span)`, then **`on_span_end(span)`** if set.
  - **on_llm_error** / **on_chat_model_error**: pop span, end with error, call `on_span_end(span)` if set.
  - ** _pop_llm_span(run_id)**: fallback when run_id missing: pop last inserted span so start/end still match.
- **get_langchain_handler(tracer=None, on_span_end=None)**: returns a handler (LangChain BaseCallbackHandler + ClucoCallbackHandler when available) with the same signature.

### 1.5 Exporter (`exporter.py`)
- **AsyncHTTPExporter**: queue + background thread; **POST** to `backend_url + "/api/v1/traces/ingest"` with body `{"traces": [trace_data, ...]}`.
- **trace_data**: `type: "trace"`, `trace_id`, `session_id`, `product_id`, `service_name`, `environment`, times, `status`, `total_tokens`, `total_cost_usd`, **`spans`: [root_span.to_dict()]** (single root; tree in `children`).
- Batch size and flush interval control how many traces are sent per request.

---

## 2. Backend service (demand-draft) — integration summary

### 2.1 Initialization (`observability.py`)
- **init_tracer(backend_url, enabled)** (called when `agent_obs_enabled`):
  - Builds **ClucoConfig** from env, then **overrides**: `enabled`, `product_id="demand-draft"`, `service_name="demand-draft-service"`, `backend_url`.
  - Calls SDK **init_tracer(config)** → sets global tracer and starts exporter.
  - Resets ** _cached_handler = None** so next get_callbacks() gets a handler bound to the new tracer (and current-tracer semantics).
  - Optionally GETs backend `/api/v1/products` to confirm reachability.

### 2.2 Callbacks and streaming
- **get_callbacks()**:
  - Returns `[]` if `get_tracer()` is None.
  - Builds handler once: **get_langchain_handler(None, on_span_end=_stream_span_to_backend)** so LLM spans use current tracer and are streamed when they end.
  - Returns `[handler]` for use in LangChain/LangGraph.
- **_stream_span_to_backend(span)**:
  - Serializes **span_data = span.to_dict()** (includes `llm.prompt_messages`, `llm.completion` for LLM spans).
  - **POST** to **`_backend_url + "/api/v1/spans/stream"`** with `{ trace_id, product_id, service_name, session_id, span: span_data }` in a **daemon thread** (non-blocking).
  - Logs success for LLM spans and warnings on HTTP/errors.

### 2.3 Trace lifecycle
- **start_trace(name, session_id)**:
  - Sets ** _current_session**; ** _reset_span_context()**; **tracer.start_session** / **tracer.start_trace()**; **tracer.start_span(name, kind=CHAIN)** as root.
  - Returns `(trace_id, root_span)`.
- **end_trace(span, outputs, error)**:
  - **tracer.end_span(root_span)** → triggers ** _export_trace(root_span)** (full tree to ingest queue).
  - ** _stream_span_to_backend(root_span)** (root span also streamed for consistency).
  - **tracer.flush()** to drain exporter queue.
  - ** _finalize_trace_status(trace_id)** → POST **`/api/v1/traces/{trace_id}/finalize`** with status/session_id.

### 2.4 Other integrations
- **start_agent_span** / **end_agent_span**: create/end agent span and ** _stream_span_to_backend(span)**.
- **record_rag_query**: **tracer.record_retrieval(...)** then ** _stream_span_to_backend(span)**.
- **record_embedding**: **tracer.record_embedding(...)** then ** _stream_embedding_span** (same stream endpoint, with extra `input_tokens`/`cost_usd` in payload).
- Graph nodes use **get_callbacks()** for every LLM and **graph.invoke(initial, config={"callbacks": get_callbacks()})** so nested runnables get callbacks.

---

## 3. Backend (Cluco observability API) — contract

### 3.1 Stream span
- **POST /api/v1/spans/stream**
- Body: **SpanStreamPayload**: `trace_id`, `product_id`, `service_name`, `session_id`, **`span`** (dict from `Span.to_dict()`).
- **mongodb.stream_span**:
  - Upserts **trace** (trace_id, product_id, service_name, session_id, status=running, etc.).
  - Builds **span_doc** from `span` (including **llm**, **tool**, **retriever**, **embedding**).
  - **Copies `llm.prompt_messages` and `llm.completion` to top level** of span_doc for storage/API.
  - Upserts **span** by `(span_id, trace_id)`.
  - Increments trace **total_tokens** and **total_cost_usd** from llm/embedding in span.

### 3.2 Batch ingest
- **POST /api/v1/traces/ingest**
- Body: **BatchIngestPayload**: `traces: [{ type, trace_id, session_id, product_id, service_name, ..., spans: [root_span_dict] }]`.
- **mongodb.ingest_batch**: for each trace, **ingest(trace_id, t)**.
- **ingest(trace_id, payload)**:
  - Writes trace document (trace_id, session_id, product_id, ...).
  - ** _flatten_and_store_spans(trace_id, payload["spans"])**: for each span in the list, builds span_doc (including **llm**, prompt_messages, completion), upserts span; then **recurses on span_data["children"]** with parent_span_id. So the SDK’s `spans: [root_span.to_dict()]` (with nested `children`) is supported.

### 3.3 Finalize
- **POST /api/v1/traces/{trace_id}/finalize**: updates trace status and recomputes **total_tokens** / **total_cost_usd** from all stored spans (llm + embedding).

### 3.4 Read path
- **GET /api/v1/traces/{trace_id}**: loads trace + **flat_spans** from DB, ** _enrich_flat_span** (copies llm → prompt_messages, completion, etc. to top level), builds **spans** tree from parent_span_id for UI.
- **GET /api/v1/llm-calls**: **get_llm_calls** with `query: { kind: "llm" }`, enriched.

---

## 4. Consistency check

| Concern | SDK | Service | Backend |
|--------|-----|---------|--------|
| Tracer per request | Replaced by init_tracer each run | init_tracer(backend_url) each request | — |
| Handler tracer | tracer=None → always get_tracer() | get_langchain_handler(None, on_span_end=…) | — |
| LLM prompt/response in span | to_dict() has llm.prompt_messages, completion | Streams same via span.to_dict() | stream_span stores llm + top-level; ingest same |
| Stream URL | — | _backend_url + /api/v1/spans/stream | POST /api/v1/spans/stream |
| Ingest URL | exporter: /api/v1/traces/ingest | — | POST /api/v1/traces/ingest, ingest_batch |
| Trace tree | spans: [root_span.to_dict()], children nested | — | _flatten_and_store_spans(trace_id, spans) recurses children |
| Session/trace_id | Context vars | start_trace sets session, trace_id; _current_session for stream | Stored on trace doc and span stream |

---

## 5. Conclusion

- **SDK**: Config, tracer (context, start/end span, export tree to ingest), spans (to_dict with llm/embedding/tool/retriever and safe serialization), callbacks (LLM start/end, on_span_end for streaming), exporter (batch ingest) are implemented and aligned.
- **Service**: Init overrides config and sets global tracer; handler uses `None` tracer and streams each completed LLM span; trace start/end and finalize are used; graph and LLM calls use get_callbacks() and invoke config.
- **Backend**: Stream and ingest accept the SDK payload shapes; prompt_messages and completion are stored at top level for spans; trace get and llm-calls return enriched data.

No code changes are required for the reviewed flow. If LLM spans still do not appear, verify: (1) AGENT_OBS_ENABLED and AGENT_OBS_BACKEND_URL, (2) service logs for `[stream] LLM span streamed` or stream errors, (3) backend logs for 200 on POST /api/v1/spans/stream, (4) MongoDB spans with `kind: "llm"`.
