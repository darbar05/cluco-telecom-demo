"""
v1 Agent configuration.
Uses the vague router prompt (ROUTER_PROMPT_V1) that misroutes cross-category queries.
Example: "Can I upgrade my device without increasing my bill?" -> routed to billing (wrong)
         because the prompt sees "bill" and classifies as billing.
"""
from app.agents import run_agent


def run_v1(query: str) -> dict:
    return run_agent(query, version="v1")
