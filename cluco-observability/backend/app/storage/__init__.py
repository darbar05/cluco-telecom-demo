"""Storage backends for traces and dashboards. MongoDB only."""

import os
from typing import Optional, Any


class TraceRow:
    """Row-like object for trace records (compatible with both Postgres ORM and Mongo docs)."""
    def __init__(self, trace_id: str, session_id: str, product_id: str, service_name: str,
                 start_time_ns: int, end_time_ns: int, latency_ms: float, total_tokens: int,
                 payload: dict, created_at: Any = None, total_cost_usd: float = 0.0):
        self.trace_id = trace_id
        self.session_id = session_id or ""
        self.product_id = product_id or "default"
        self.service_name = service_name or "agent"
        self.start_time_ns = start_time_ns
        self.end_time_ns = end_time_ns
        self.latency_ms = latency_ms
        self.total_tokens = total_tokens
        self.payload = payload or {}
        self.created_at = created_at
        self.total_cost_usd = total_cost_usd


_storage: Optional["TraceStore"] = None


def get_trace_store() -> "TraceStore":
    global _storage
    if _storage is None:
        from app.storage.mongodb import MongoTraceStore
        _storage = MongoTraceStore()
    return _storage


_dashboard_storage: Optional["DashboardStore"] = None


def get_dashboard_store() -> "DashboardStore":
    global _dashboard_storage
    if _dashboard_storage is None:
        from app.storage.mongodb import MongoDashboardStore
        _dashboard_storage = MongoDashboardStore()
    return _dashboard_storage


_pipeline_storage: Optional["MongoPipelineStore"] = None


def get_pipeline_store():
    global _pipeline_storage
    if _pipeline_storage is None:
        from app.storage.mongodb import MongoPipelineStore
        _pipeline_storage = MongoPipelineStore()
    return _pipeline_storage


class DashboardStore:
    """Abstract interface for dashboard storage."""

    def list_dashboards(self, product_id: Optional[str] = None) -> list:
        raise NotImplementedError

    def create_dashboard(self, name: str, product_id: str, description: Optional[str], layout: dict) -> dict:
        raise NotImplementedError

    def get_dashboard(self, dashboard_id: str) -> Optional[dict]:
        raise NotImplementedError

    def update_dashboard(self, dashboard_id: str, name: Optional[str], layout: Optional[dict], description: Optional[str]) -> bool:
        raise NotImplementedError

    def delete_dashboard(self, dashboard_id: str) -> bool:
        raise NotImplementedError


class TraceStore:
    """Abstract interface for trace storage."""

    def ingest(self, trace_id: str, payload: dict) -> dict:
        """Ingest a trace. Returns {ok, trace_id, status?}."""
        raise NotImplementedError

    def get(self, trace_id: str) -> Optional[dict]:
        """Get full trace by ID. Returns None if not found."""
        raise NotImplementedError

    def list_traces(
        self,
        product_id: Optional[str] = None,
        session_id: Optional[str] = None,
        service_name: Optional[str] = None,
        status: Optional[str] = None,
        environment: Optional[str] = None,
        assessment_name: Optional[str] = None,
        assessment_value: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> dict:
        """List traces with filters. Returns {traces, count, total}."""
        raise NotImplementedError

    def get_all_traces(self, product_id: Optional[str] = None, session_id: Optional[str] = None) -> list:
        """Get all trace rows for metrics aggregation."""
        raise NotImplementedError
