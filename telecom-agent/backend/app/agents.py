"""
LangGraph telecom agent with router + sub-agents.
State graph: START -> router -> {billing, product, support} -> response_formatter -> END
"""
import os
from typing import TypedDict, Literal
from dotenv import load_dotenv

from langgraph.graph import StateGraph, END
from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage, SystemMessage

from app.pinecone_setup import query_knowledge_base, query_multiple_namespaces
from app.prompts import (
    ROUTER_PROMPT_V1,
    ROUTER_PROMPT_V2,
    BILLING_AGENT_PROMPT,
    PRODUCT_AGENT_PROMPT,
    SUPPORT_AGENT_PROMPT,
    RESPONSE_FORMATTER_PROMPT,
)

load_dotenv()


class AgentState(TypedDict):
    query: str
    category: str
    context_docs: list[dict]
    specialist_response: str
    final_response: str
    agent_version: str
    routing_confidence: str
    trace_metadata: dict
    token_usage: dict


def _get_llm(model: str = "gpt-4o-mini", temperature: float = 0.0) -> ChatOpenAI:
    return ChatOpenAI(
        model=model,
        temperature=temperature,
        api_key=os.getenv("OPENAI_API_KEY"),
    )


def _extract_token_usage(response) -> dict:
    """Extract token counts from a LangChain AIMessage response_metadata."""
    meta = getattr(response, "response_metadata", {}) or {}
    usage = meta.get("token_usage") or meta.get("usage") or {}
    return {
        "input_tokens": usage.get("prompt_tokens", 0) or usage.get("input_tokens", 0),
        "output_tokens": usage.get("completion_tokens", 0) or usage.get("output_tokens", 0),
        "total_tokens": usage.get("total_tokens", 0),
        "model": meta.get("model_name") or meta.get("model", ""),
    }


def router_node(state: AgentState) -> AgentState:
    """Classify the query into billing/products/support."""
    llm = _get_llm(temperature=0.0)
    version = state.get("agent_version", "v1")
    prompt_template = ROUTER_PROMPT_V1 if version == "v1" else ROUTER_PROMPT_V2
    prompt = prompt_template.format(query=state["query"])

    response = llm.invoke([HumanMessage(content=prompt)])
    router_usage = _extract_token_usage(response)
    category = response.content.strip().lower()

    if category not in ("billing", "products", "support"):
        category = "support"

    state["category"] = category
    state["routing_confidence"] = "high"
    state["trace_metadata"] = {
        **state.get("trace_metadata", {}),
        "routing_decision": category,
        "agent_version": version,
        "router_prompt_version": version,
    }
    token_usage = state.get("token_usage") or {}
    token_usage["router"] = router_usage
    state["token_usage"] = token_usage
    return state


def route_to_agent(state: AgentState) -> Literal["billing_agent", "product_agent", "support_agent"]:
    """Conditional edge: route to the appropriate sub-agent."""
    category = state["category"]
    if category == "billing":
        return "billing_agent"
    elif category == "products":
        return "product_agent"
    else:
        return "support_agent"


def billing_agent_node(state: AgentState) -> AgentState:
    """RAG over billing namespace to answer billing questions."""
    llm = _get_llm(model="gpt-4o-mini", temperature=0.2)
    docs = query_knowledge_base(state["query"], "billing", top_k=3)
    state["context_docs"] = docs

    context = "\n\n".join(
        f"[{d['title']}]: {d['content']}" for d in docs
    )
    prompt = BILLING_AGENT_PROMPT.format(context=context, query=state["query"])
    response = llm.invoke([HumanMessage(content=prompt)])
    state["specialist_response"] = response.content
    token_usage = state.get("token_usage") or {}
    token_usage["specialist"] = _extract_token_usage(response)
    state["token_usage"] = token_usage
    return state


def product_agent_node(state: AgentState) -> AgentState:
    """RAG over products namespace to answer product questions."""
    llm = _get_llm(model="gpt-4o-mini", temperature=0.2)
    version = state.get("agent_version", "v1")

    if version == "v2":
        docs = query_multiple_namespaces(
            state["query"], ["products", "billing"], top_k=4
        )
    else:
        docs = query_knowledge_base(state["query"], "products", top_k=3)

    state["context_docs"] = docs
    context = "\n\n".join(
        f"[{d['title']}]: {d['content']}" for d in docs
    )
    prompt = PRODUCT_AGENT_PROMPT.format(context=context, query=state["query"])
    response = llm.invoke([HumanMessage(content=prompt)])
    state["specialist_response"] = response.content
    token_usage = state.get("token_usage") or {}
    token_usage["specialist"] = _extract_token_usage(response)
    state["token_usage"] = token_usage
    return state


def support_agent_node(state: AgentState) -> AgentState:
    """RAG over support namespace to answer support questions."""
    llm = _get_llm(model="gpt-4o-mini", temperature=0.2)
    docs = query_knowledge_base(state["query"], "support", top_k=3)
    state["context_docs"] = docs

    context = "\n\n".join(
        f"[{d['title']}]: {d['content']}" for d in docs
    )
    prompt = SUPPORT_AGENT_PROMPT.format(context=context, query=state["query"])
    response = llm.invoke([HumanMessage(content=prompt)])
    state["specialist_response"] = response.content
    token_usage = state.get("token_usage") or {}
    token_usage["specialist"] = _extract_token_usage(response)
    state["token_usage"] = token_usage
    return state


def response_formatter_node(state: AgentState) -> AgentState:
    """Polish the specialist response into a customer-friendly reply."""
    llm = _get_llm(model="gpt-4o-mini", temperature=0.3)
    prompt = RESPONSE_FORMATTER_PROMPT.format(
        specialist_response=state["specialist_response"],
        query=state["query"],
    )
    response = llm.invoke([HumanMessage(content=prompt)])
    state["final_response"] = response.content
    token_usage = state.get("token_usage") or {}
    token_usage["formatter"] = _extract_token_usage(response)
    state["token_usage"] = token_usage
    return state


def build_telecom_agent(version: str = "v1") -> StateGraph:
    """Build the LangGraph state graph for the telecom agent."""
    graph = StateGraph(AgentState)

    graph.add_node("router", router_node)
    graph.add_node("billing_agent", billing_agent_node)
    graph.add_node("product_agent", product_agent_node)
    graph.add_node("support_agent", support_agent_node)
    graph.add_node("response_formatter", response_formatter_node)

    graph.set_entry_point("router")

    graph.add_conditional_edges(
        "router",
        route_to_agent,
        {
            "billing_agent": "billing_agent",
            "product_agent": "product_agent",
            "support_agent": "support_agent",
        },
    )

    graph.add_edge("billing_agent", "response_formatter")
    graph.add_edge("product_agent", "response_formatter")
    graph.add_edge("support_agent", "response_formatter")
    graph.add_edge("response_formatter", END)

    return graph.compile()


# Pre-compiled agents
_agents = {}


def get_agent(version: str = "v1"):
    if version not in _agents:
        _agents[version] = build_telecom_agent(version)
    return _agents[version]


def extract_graph_architecture(compiled_graph) -> dict:
    """Extract nodes and edges from a compiled LangGraph for SDK registration.

    Works generically with any LangGraph ``CompiledGraph`` — reads the
    internal graph representation so no hardcoding is needed.
    """
    nodes = []
    edges = []
    node_ids = set()

    try:
        graph_data = compiled_graph.get_graph()

        graph_nodes = graph_data.nodes
        if isinstance(graph_nodes, dict):
            graph_nodes = graph_nodes.values()

        for node in graph_nodes:
            nid = str(getattr(node, "id", node) if not isinstance(node, str) else node)
            if nid in ("__start__", "__end__"):
                continue
            node_ids.add(nid)
            label = nid.replace("_", " ").title()
            nodes.append({"id": nid, "label": label, "type": "agent"})

        for edge in graph_data.edges:
            src = str(getattr(edge, "source", ""))
            tgt = str(getattr(edge, "target", ""))
            is_conditional = getattr(edge, "conditional", False)

            if src == "__start__" or tgt == "__end__":
                continue

            if src in node_ids and tgt in node_ids:
                edges.append({
                    "source": src,
                    "target": tgt,
                    "type": "conditional" if is_conditional else "sequential",
                })
    except Exception as e:
        print(f"Warning: could not extract graph from compiled agent: {e}")

    parallel_groups = []
    sources_in_edges = {}
    for e in edges:
        sources_in_edges.setdefault(e["source"], []).append(e["target"])
    for src, targets in sources_in_edges.items():
        if len(targets) >= 2:
            parallel_groups.append(targets)

    return {
        "nodes": nodes,
        "edges": edges,
        "parallel_groups": parallel_groups,
    }


def run_agent(query: str, version: str = "v1") -> dict:
    """Run the telecom agent and return the full state."""
    agent = get_agent(version)
    initial_state: AgentState = {
        "query": query,
        "category": "",
        "context_docs": [],
        "specialist_response": "",
        "final_response": "",
        "agent_version": version,
        "routing_confidence": "",
        "trace_metadata": {},
        "token_usage": {},
    }
    result = agent.invoke(initial_state)
    return result
