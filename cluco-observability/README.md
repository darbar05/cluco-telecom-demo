# Cluco Observability Platform

**Product-agnostic observability for AI agents** — LECO (legal), or any Cluco product. Uses OpenTelemetry, MongoDB, and observes LLMs, RAG, fine-tuning, and infrastructure.

## Quick Start

```bash
# 1. Start MongoDB (and optional OTLP collector)
docker compose up -d mongo

# 2. Backend (traces + API)
cd cluco-observability/backend && pip install -r requirements.txt && python run.py

# 3. UI (port 9411)
cd cluco-observability/ui && npm install && npm run dev
```

Open http://localhost:9411 for the UI.

## Config

| Env | Default | Description |
|-----|---------|-------------|
| `MONGODB_URI` | `mongodb://localhost:27017` | MongoDB connection |
| `MONGODB_DB` | `cluco_observability` | MongoDB database name |
| `MONGODB_TRACES_COLLECTION` | `traces` | MongoDB collection for traces |

Storage uses **MongoDB only** for traces and dashboards (PostgreSQL removed). MongoDB supports documents up to 16MB, so full prompts, responses, and tool I/O are stored without truncation.

## Product Integration (2–3 config values)

### LECO (legal)

**Option A — env vars**
```bash
export AGENT_OBS_PRODUCT_ID=leco
export AGENT_OBS_SERVICE_NAME=leco-legal-agent
export AGENT_OBS_EXPORTER=http
export AGENT_OBS_BACKEND_URL=http://localhost:9410
```

**Option B — properties**
```properties
# config/leco.properties
cluco.observability.product_id=leco
cluco.observability.service_name=leco-legal-agent
cluco.observability.exporter=http
cluco.observability.backend_url=http://localhost:9410
```

**Option C — Python**
```python
from agent_observability import AgentTracer, ObservabilityConfig

config = ObservabilityConfig.builder() \
    .product_id("leco") \
    .service_name("leco-legal-agent") \
    .exporter("http") \
    .backend_url("http://localhost:9410") \
    .build()
tracer = AgentTracer(config)
```

### Any other product

Set `product_id` and `service_name`; keep the rest:

```python
config = ObservabilityConfig.from_env()
config.product_id = "my-product"   # e.g. future-product
config.service_name = "my-agent"
tracer = AgentTracer(config)
```

Or use `config/product-template.properties.example` — copy, set `YOUR_PRODUCT_ID` and `YOUR_SERVICE_NAME`.

## Minimal Required Config

| Key | Example | Purpose |
|-----|---------|---------|
| `product_id` | `leco` | Filter in UI, multi-product dashboards |
| `service_name` | `leco-legal-agent` | Identify the agent |
| `exporter` | `http` | Send to Cluco backend |
| `backend_url` | `http://localhost:9410` | Cluco API URL |

## UI Features (AgentCore-style)

- **Agents** — overview metrics (sessions, traces, errors), agents table with P95 latency
- **Sessions** — session list with trace count and latency, drill into traces
- **Traces** — list, filter, trace detail with timeline (Gantt) and span hierarchy
- **Trace detail** — Gantt timeline, span tree, events with prompts, responses, tokens, tool calls
- **Agent metrics** — per-agent sessions, traces, token usage, errors and latency by span
- **Dashboard** — trace count, latency, tokens, tool usage, custom dashboards

## Dependencies

- **agent-observability** (Python SDK) — `pip install agent-observability` or use from repo
- **Cluco backend** — runs on port 9410
- **Cluco UI** — runs on port 9411

## Run Order

1. Start MongoDB: `docker compose up -d mongo`
2. Start Cluco backend: `cd backend && python run.py` (9410)
3. Start Cluco UI: `cd ui && npm run dev` (9411)
4. Run a product that uses the SDK (e.g. `multi-agent-demo` service)
5. Traces appear in the UI
