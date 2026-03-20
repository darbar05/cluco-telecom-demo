"""
v2 Agent configuration.
Uses the improved router prompt (ROUTER_PROMPT_V2) with explicit disambiguation rules.
Cross-namespace retrieval for product queries that also touch billing.
Example: "Can I upgrade my device without increasing my bill?" -> routed to products (correct)
         because the prompt recognizes device upgrade as primary intent.
"""
from app.agents import run_agent


def run_v2(query: str) -> dict:
    return run_agent(query, version="v2")
