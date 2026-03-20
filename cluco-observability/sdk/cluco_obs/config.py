"""Configuration for Cluco Observability SDK."""

import os
from dataclasses import dataclass, field
from typing import Optional


@dataclass
class ClucoConfig:
    enabled: bool = True
    backend_url: str = "http://localhost:9410"
    product_id: str = "default"
    service_name: str = "agent"
    environment: str = "development"
    batch_size: int = 10
    flush_interval_seconds: float = 5.0
    max_queue_size: int = 1000
    capture_inputs: bool = True
    capture_outputs: bool = True
    sample_rate: float = 1.0
    tags: list = field(default_factory=list)
    metadata: dict = field(default_factory=dict)
    # Cost guardrails — 0 means unlimited
    max_trace_tokens: int = 0
    max_trace_cost_usd: float = 0.0
    max_span_tokens: int = 0
    # PII masking
    pii_masking_enabled: bool = False
    pii_patterns: list = field(default_factory=list)

    @classmethod
    def from_env(cls) -> "ClucoConfig":
        # AGENT_OBS_BACKEND_URL: used by demand-draft-service .env; SDK falls back to it if CLUCO_OBS_BACKEND_URL unset
        return cls(
            enabled=os.getenv("CLUCO_OBS_ENABLED", "true").lower() in ("true", "1", "yes"),
            backend_url=os.getenv("CLUCO_OBS_BACKEND_URL", os.getenv("AGENT_OBS_BACKEND_URL", "http://localhost:9410")),
            product_id=os.getenv("CLUCO_OBS_PRODUCT_ID", "default"),
            service_name=os.getenv("CLUCO_OBS_SERVICE_NAME", "agent"),
            environment=os.getenv("CLUCO_OBS_ENVIRONMENT", "development"),
            batch_size=int(os.getenv("CLUCO_OBS_BATCH_SIZE", "10")),
            flush_interval_seconds=float(os.getenv("CLUCO_OBS_FLUSH_INTERVAL", "5.0")),
            max_queue_size=int(os.getenv("CLUCO_OBS_MAX_QUEUE_SIZE", "1000")),
            capture_inputs=os.getenv("CLUCO_OBS_CAPTURE_INPUTS", "true").lower() in ("true", "1"),
            capture_outputs=os.getenv("CLUCO_OBS_CAPTURE_OUTPUTS", "true").lower() in ("true", "1"),
            sample_rate=float(os.getenv("CLUCO_OBS_SAMPLE_RATE", "1.0")),
            max_trace_tokens=int(os.getenv("CLUCO_OBS_MAX_TRACE_TOKENS", "0")),
            max_trace_cost_usd=float(os.getenv("CLUCO_OBS_MAX_TRACE_COST_USD", "0")),
            max_span_tokens=int(os.getenv("CLUCO_OBS_MAX_SPAN_TOKENS", "0")),
            pii_masking_enabled=os.getenv("CLUCO_OBS_PII_MASKING", "false").lower() in ("true", "1"),
        )
