"""Server-side cost estimation for LLM and embedding spans.

Loads model pricing from a configurable JSON file (config/model_pricing.json).
Supports hot-reload: if the file changes on disk, pricing is refreshed automatically.
Falls back to a minimal built-in default if the config file is missing.
"""

import json
import logging
import os
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger("cluco.cost")

_CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
_PRICING_FILE = _CONFIG_DIR / "model_pricing.json"

_model_costs: dict = {}
_pricing_file_mtime: float = 0.0
_last_check_time: float = 0.0
_CHECK_INTERVAL_SECONDS = 30

_FALLBACK_COSTS = {
    "gpt-4o": {"input": 0.0025, "output": 0.01},
    "gpt-4o-mini": {"input": 0.00015, "output": 0.0006},
    "gpt-3.5-turbo": {"input": 0.0005, "output": 0.0015},
    "text-embedding-3-small": {"input": 0.00002, "output": 0.0},
    "text-embedding-3-large": {"input": 0.00013, "output": 0.0},
    "text-embedding-ada-002": {"input": 0.0001, "output": 0.0},
}


def _load_pricing_from_file() -> dict:
    global _model_costs, _pricing_file_mtime
    try:
        if not _PRICING_FILE.exists():
            logger.warning("Pricing config not found at %s — using fallback defaults", _PRICING_FILE)
            _model_costs = dict(_FALLBACK_COSTS)
            return _model_costs

        mtime = _PRICING_FILE.stat().st_mtime
        if mtime == _pricing_file_mtime and _model_costs:
            return _model_costs

        with open(_PRICING_FILE, "r") as f:
            data = json.load(f)

        models = data.get("models", {})
        costs = {}
        for model_name, info in models.items():
            costs[model_name] = {
                "input": info.get("input", 0.0),
                "output": info.get("output", 0.0),
            }

        _model_costs = costs
        _pricing_file_mtime = mtime
        logger.info("Loaded pricing for %d models from %s", len(costs), _PRICING_FILE)
        return _model_costs
    except Exception as e:
        logger.warning("Failed to load pricing config: %s — using fallback", e)
        if not _model_costs:
            _model_costs = dict(_FALLBACK_COSTS)
        return _model_costs


def get_model_costs() -> dict:
    global _last_check_time
    now = time.time()
    if now - _last_check_time > _CHECK_INTERVAL_SECONDS or not _model_costs:
        _last_check_time = now
        _load_pricing_from_file()
    return _model_costs


def get_pricing_config() -> dict:
    try:
        if _PRICING_FILE.exists():
            with open(_PRICING_FILE, "r") as f:
                return json.load(f)
    except Exception as e:
        logger.warning("Failed to read pricing config: %s", e)
    return {"models": {k: {"input": v["input"], "output": v["output"], "provider": "unknown", "type": "llm"} for k, v in _FALLBACK_COSTS.items()}}


def estimate_cost(model: str, input_tokens: int, output_tokens: int) -> float:
    if not model or (input_tokens == 0 and output_tokens == 0):
        return 0.0
    costs_map = get_model_costs()
    costs = costs_map.get(model)
    if not costs:
        for key, val in costs_map.items():
            if key in model or model in key:
                costs = val
                break
    if not costs:
        return 0.0
    return (input_tokens / 1000) * costs["input"] + (output_tokens / 1000) * costs["output"]


def _extract_model_from_span(span: dict) -> str:
    llm = span.get("llm") or {}
    model = llm.get("model") or ""
    if not model or model == "unknown":
        name = span.get("name", "")
        if name.startswith("llm:"):
            model = name.split("llm:", 1)[1].split(":")[0].strip()
        elif ":llm:" in name:
            model = name.split(":llm:", 1)[1].strip()
    if not model or model == "unknown":
        model = span.get("model") or span.get("metadata", {}).get("model", "")
    return model


def compute_span_cost(span: dict) -> float:
    kind = span.get("kind", "")

    if kind == "llm":
        llm = span.get("llm") or {}
        existing_cost = llm.get("cost_usd", 0) or 0
        if existing_cost > 0:
            return existing_cost
        model = _extract_model_from_span(span)
        inp = (llm.get("input_tokens", 0) or span.get("input_tokens", 0) or 0)
        out = (llm.get("output_tokens", 0) or span.get("output_tokens", 0) or 0)
        return estimate_cost(model, inp, out)

    if kind == "embedding":
        emb = span.get("embedding") or {}
        existing_cost = emb.get("cost_usd", 0) or 0
        if existing_cost > 0:
            return existing_cost
        model = emb.get("model", "")
        if not model:
            name = span.get("name", "")
            if "embedding:" in name:
                model = name.split("embedding:", 1)[1].strip()
        tokens = (emb.get("input_tokens", 0)
                  or emb.get("token_count", 0)
                  or span.get("input_tokens", 0)
                  or 0)
        return estimate_cost(model, tokens, 0)

    return 0.0


def enrich_spans_with_cost(spans: list) -> tuple:
    total_cost = 0.0
    total_tokens = 0

    for span in spans:
        cost = compute_span_cost(span)
        kind = span.get("kind", "")

        if kind == "llm":
            llm = span.get("llm") or {}
            if cost > 0 and not (llm.get("cost_usd") or 0):
                llm["cost_usd"] = round(cost, 8)
                span["llm"] = llm
            inp = llm.get("input_tokens", 0) or 0
            out = llm.get("output_tokens", 0) or 0
            total_tokens += inp + out
            total_cost += cost

        elif kind == "embedding":
            emb = span.get("embedding") or {}
            if cost > 0 and not (emb.get("cost_usd") or 0):
                emb["cost_usd"] = round(cost, 8)
                span["embedding"] = emb
            tokens = (emb.get("input_tokens", 0)
                      or emb.get("token_count", 0)
                      or span.get("input_tokens", 0)
                      or 0)
            total_tokens += tokens
            total_cost += cost

        children = span.get("children", [])
        if children:
            _, child_cost, child_tokens = enrich_spans_with_cost(children)
            total_cost += child_cost
            total_tokens += child_tokens

    return spans, round(total_cost, 8), total_tokens


def compute_trace_cost(payload: dict) -> dict:
    spans = payload.get("spans", [])
    if not spans:
        return payload

    enriched_spans, computed_cost, computed_tokens = enrich_spans_with_cost(spans)
    payload["spans"] = enriched_spans

    existing_cost = payload.get("total_cost_usd") or 0
    existing_tokens = payload.get("total_tokens") or 0

    if computed_cost > 0 and existing_cost == 0:
        payload["total_cost_usd"] = round(computed_cost, 8)
        logger.info("Computed trace cost from spans: $%.6f (%d tokens)", computed_cost, computed_tokens)
    elif computed_cost > 0 and abs(computed_cost - existing_cost) > 0.0001:
        payload["total_cost_usd"] = round(computed_cost, 8)
        logger.info("Corrected trace cost: SDK=$%.6f -> computed=$%.6f", existing_cost, computed_cost)

    if computed_tokens > 0 and existing_tokens == 0:
        payload["total_tokens"] = computed_tokens

    return payload
