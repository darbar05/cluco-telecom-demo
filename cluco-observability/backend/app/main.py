"""Cluco Observability Backend — traces, dashboards, metrics API. MongoDB storage."""

import asyncio
import json
import logging
import os
from collections import defaultdict
from logging.handlers import RotatingFileHandler
from pathlib import Path

# Load .env before anything else so OPENAI_API_KEY and SMTP vars are available
try:
    from dotenv import load_dotenv
    _env_path = Path(__file__).resolve().parent.parent / ".env"
    load_dotenv(dotenv_path=_env_path, override=False)
except ImportError:
    pass  # python-dotenv not installed; env vars must be set via OS environment

from fastapi import FastAPI, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.routes import router

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_DIR.mkdir(exist_ok=True)

LOG_FMT = "%(asctime)s [%(levelname)s] %(name)s: %(message)s"
LOG_LEVEL = getattr(logging, os.getenv("LOG_LEVEL", "INFO").upper(), logging.INFO)

def _make_file_handler():
    fh = RotatingFileHandler(
        LOG_DIR / "cluco_backend.log",
        maxBytes=5 * 1024 * 1024,
        backupCount=5,
        encoding="utf-8",
    )
    fh.setFormatter(logging.Formatter(LOG_FMT))
    fh.setLevel(LOG_LEVEL)
    return fh

_file_handler = _make_file_handler()

root = logging.getLogger()
root.setLevel(LOG_LEVEL)
root.addHandler(_file_handler)

for _name in ("uvicorn", "uvicorn.access", "uvicorn.error", "fastapi"):
    _lg = logging.getLogger(_name)
    _lg.addHandler(_file_handler)

app = FastAPI(
    title="Cluco Observability",
    description="Product-agnostic observability for AI agents — LECO, and any Cluco product",
    version="0.2.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(router, prefix="/api/v1")


@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    """Return JSON 500 with CORS headers so browser errors are visible."""
    origin = request.headers.get("origin", "*")
    return JSONResponse(
        status_code=500,
        content={"detail": str(exc)},
        headers={
            "Access-Control-Allow-Origin": origin,
            "Access-Control-Allow-Credentials": "true",
        },
    )


# ── WebSocket Live Trace Monitor ───────────────────────────────────────
# Clients connect to /ws/traces/{trace_id}/live to receive span events
# as they stream in. The span/stream POST endpoint notifies connected clients.

_live_connections: dict[str, list[WebSocket]] = defaultdict(list)

# ── Global live feed: broadcasts ALL span events to every connected client ──
_global_live_connections: list[tuple[WebSocket, dict]] = []  # (ws, filters)


async def notify_live_clients(trace_id: str, span_data: dict):
    """Push span event to all WebSocket clients watching this trace."""
    clients = _live_connections.get(trace_id, [])
    if not clients:
        return
    message = json.dumps({"type": "span", "trace_id": trace_id, "span": span_data})
    dead = []
    for ws in clients:
        try:
            await ws.send_text(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        try:
            clients.remove(ws)
        except ValueError:
            pass


async def notify_global_live_clients(
    trace_id: str, span_data: dict, trace_meta: dict | None = None
):
    """Push span event to ALL global live WebSocket clients (with optional filter matching)."""
    if not _global_live_connections:
        return
    meta = trace_meta or {}
    message = json.dumps({
        "type": "span",
        "trace_id": trace_id,
        "product_id": meta.get("product_id", ""),
        "service_name": meta.get("service_name", ""),
        "session_id": meta.get("session_id", ""),
        "span": span_data,
    })
    dead: list[tuple[WebSocket, dict]] = []
    for ws, filters in _global_live_connections:
        # Apply optional filters
        if filters.get("product_id") and meta.get("product_id") != filters["product_id"]:
            continue
        if filters.get("service_name") and meta.get("service_name") != filters["service_name"]:
            continue
        try:
            await ws.send_text(message)
        except Exception:
            dead.append((ws, filters))
    for entry in dead:
        try:
            _global_live_connections.remove(entry)
        except ValueError:
            pass


async def notify_global_trace_finalized(trace_id: str, trace_meta: dict | None = None):
    """Notify global live clients that a trace has been finalized."""
    if not _global_live_connections:
        return
    meta = trace_meta or {}
    message = json.dumps({
        "type": "trace_finalized",
        "trace_id": trace_id,
        "product_id": meta.get("product_id", ""),
        "service_name": meta.get("service_name", ""),
        "status": meta.get("status", "ok"),
    })
    dead: list[tuple[WebSocket, dict]] = []
    for ws, filters in _global_live_connections:
        if filters.get("product_id") and meta.get("product_id") != filters["product_id"]:
            continue
        if filters.get("service_name") and meta.get("service_name") != filters["service_name"]:
            continue
        try:
            await ws.send_text(message)
        except Exception:
            dead.append((ws, filters))
    for entry in dead:
        try:
            _global_live_connections.remove(entry)
        except ValueError:
            pass


@app.websocket("/ws/traces/{trace_id}/live")
async def websocket_live_trace(websocket: WebSocket, trace_id: str):
    await websocket.accept()
    _live_connections[trace_id].append(websocket)
    try:
        while True:
            # Keep connection alive; client can send pings
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    finally:
        try:
            _live_connections[trace_id].remove(websocket)
        except ValueError:
            pass
        if not _live_connections[trace_id]:
            _live_connections.pop(trace_id, None)


@app.websocket("/ws/live")
async def websocket_global_live(websocket: WebSocket):
    """Global live WebSocket — streams ALL incoming spans to connected clients.
    Optional query params: product_id, service_name for server-side filtering."""
    await websocket.accept()
    params = dict(websocket.query_params)
    filters = {
        "product_id": params.get("product_id", ""),
        "service_name": params.get("service_name", ""),
    }
    entry = (websocket, filters)
    _global_live_connections.append(entry)
    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
    except WebSocketDisconnect:
        pass
    finally:
        try:
            _global_live_connections.remove(entry)
        except ValueError:
            pass


# SSE alternative for simpler clients
from fastapi.responses import StreamingResponse


@app.get("/api/v1/traces/{trace_id}/events")
async def sse_trace_events(trace_id: str):
    """Server-Sent Events endpoint for live trace monitoring."""
    async def event_generator():
        yield f"data: {json.dumps({'type': 'connected', 'trace_id': trace_id})}\n\n"
        # Poll for new spans every 2 seconds
        last_count = 0
        for _ in range(300):  # max 10 minutes
            await asyncio.sleep(2)
            try:
                from app.storage import get_trace_store
                store = get_trace_store()
                spans = store.get_spans(trace_id=trace_id, limit=500)
                if len(spans) > last_count:
                    new_spans = spans[last_count:]
                    for span in new_spans:
                        yield f"data: {json.dumps({'type': 'span', 'span': span})}\n\n"
                    last_count = len(spans)
            except Exception:
                pass
        yield f"data: {json.dumps({'type': 'done'})}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")


# Make notification helpers accessible from routes
app.state.notify_live_clients = notify_live_clients
app.state.notify_global_live_clients = notify_global_live_clients
app.state.notify_global_trace_finalized = notify_global_trace_finalized


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "cluco-observability"}




if __name__ == "__main__":
    import copy
    import uvicorn
    log_config = copy.deepcopy(uvicorn.config.LOGGING_CONFIG)
    log_config["handlers"]["file"] = {
        "class": "logging.handlers.RotatingFileHandler",
        "filename": str(LOG_DIR / "cluco_backend.log"),
        "maxBytes": 5 * 1024 * 1024,
        "backupCount": 5,
        "formatter": "default",
        "encoding": "utf-8",
    }
    for handler_list in log_config["loggers"].values():
        if "handlers" in handler_list:
            handler_list["handlers"].append("file")
    port = int(os.environ.get("PORT", 9410))
    uvicorn.run(app, host="0.0.0.0", port=port, log_config=log_config)
