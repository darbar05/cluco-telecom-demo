"""
AI Trace Debugging Assistant -- Analyzes traces and provides root cause analysis.
Uses LangChain OpenAI (ChatOpenAI) for streaming analysis.
"""
import json
import os
from typing import AsyncGenerator

SYSTEM_PROMPT = """You are the Cluco Observability AI Assistant — an expert debugger for multi-agent AI systems.

## Your Role in the Observability Workflow
You are a critical component of the agent quality lifecycle:
1. **Traces with negative feedback** are surfaced to developers and SME reviewers.
2. **You analyze those traces** to find root causes — routing errors, retrieval failures, prompt gaps, hallucinations, tool misuse.
3. Developers use your analysis to **create custom LLM judges** that automatically detect the same class of issue at scale.
4. Those judges run on evaluation datasets to **quantify the problem** across all affected traces.
5. A **prompt optimizer** then uses the judge scores plus the dataset to iteratively improve prompts.

## Analysis Framework
Structure every analysis with these sections:

### **Query Intent**
What the user asked and what they expected.

### **Execution Path**
Step-by-step what the agent did — which spans executed, in what order, with what inputs/outputs. Reference specific span names.

### **Routing Decision Analysis**
If the agent has a router/supervisor:
- Which sub-agent or tool was selected?
- What was the routing rationale (from the LLM completion)?
- Was it the correct choice given the user's intent?
- What would the correct routing have been?

### **Error & Failure Identification**
- Explicit errors in any span
- Incorrect or unhelpful outputs
- Missing context from retrieval
- Hallucinations vs. grounded responses
- Performance bottlenecks (latency, excessive token usage)

### **User Feedback Correlation**
Relate the trace issues to any user/SME feedback present. Why did the user give negative feedback? Does the trace evidence support their assessment?

### **Root Cause**
One clear statement of the underlying issue, with specific evidence from span data.

### **Actionable Fix**
Concrete recommendations:
- Which prompt to modify and how
- Which routing logic to adjust
- Which retrieval/knowledge base to update
- Specific file or component references where applicable

### **Judge Criteria Suggestion**
Suggest what automated judge criteria would catch this class of issue. For example:
- "A routing accuracy judge should verify the selected sub-agent matches the query topic"
- "A relevance judge should check that the response addresses the specific question asked"

Be precise. Reference specific span names, agent names, model outputs, and routing decisions from the trace data."""


def build_trace_context(trace: dict) -> str:
    """Build a comprehensive text representation of a trace for LLM analysis."""
    parts = []

    parts.append(f"# Trace: {trace.get('trace_id', 'unknown')}")
    parts.append(f"Status: {trace.get('status', 'unknown')}")
    parts.append(f"Latency: {trace.get('latency_ms', 0):.1f}ms")
    parts.append(f"Total tokens: {trace.get('total_tokens', 0)}")
    parts.append(f"Total cost: ${trace.get('total_cost_usd', 0):.6f}")
    parts.append(f"Service: {trace.get('service_name', 'unknown')}")
    parts.append(f"Product: {trace.get('product_id', 'unknown')}")
    if trace.get("environment"):
        parts.append(f"Environment: {trace['environment']}")
    if trace.get("error"):
        parts.append(f"Error: {trace['error']}")
    parts.append("")

    flat_spans = trace.get("flat_spans") or []
    spans = trace.get("spans") or []

    routing_decisions = []

    def _format_spans(span_list, depth=0):
        for s in (span_list or []):
            indent = "  " * depth
            name = s.get("name", "unnamed")
            kind = s.get("kind", "unknown")
            latency = s.get("latency_ms") or s.get("duration_ms") or 0
            status = s.get("status", "ok")

            parts.append(f"{indent}[{kind.upper()}] {name} ({latency:.1f}ms) status={status}")

            inp = s.get("inputs") or s.get("input")
            if inp:
                inp_str = inp if isinstance(inp, str) else json.dumps(inp, default=str)
                parts.append(f"{indent}  Input: {inp_str[:2000]}")

            out = s.get("outputs") or s.get("output")
            if out:
                out_str = out if isinstance(out, str) else json.dumps(out, default=str)
                parts.append(f"{indent}  Output: {out_str[:2000]}")

            llm = s.get("llm") or {}
            if llm.get("prompt_messages"):
                msgs = llm["prompt_messages"]
                if isinstance(msgs, list):
                    for m in msgs[:5]:
                        role = m.get("role", "?") if isinstance(m, dict) else "?"
                        content = m.get("content", str(m)) if isinstance(m, dict) else str(m)
                        parts.append(f"{indent}  [{role}]: {str(content)[:1000]}")
            if llm.get("completion"):
                comp_text = str(llm['completion'])[:1500]
                parts.append(f"{indent}  Completion: {comp_text}")

                if kind in ("agent", "chain") or "route" in name.lower() or "supervisor" in name.lower():
                    routing_decisions.append({
                        "span": name,
                        "completion": comp_text[:500],
                        "input": (inp_str[:300] if inp else ""),
                    })

            if s.get("prompt_messages"):
                for m in s["prompt_messages"][:5]:
                    role = m.get("role", "?") if isinstance(m, dict) else "?"
                    content = m.get("content", str(m)) if isinstance(m, dict) else str(m)
                    parts.append(f"{indent}  [{role}]: {str(content)[:1000]}")
            if s.get("completion"):
                comp_text = str(s['completion'])[:1500]
                parts.append(f"{indent}  Completion: {comp_text}")

                if kind in ("agent", "chain") or "route" in name.lower() or "supervisor" in name.lower():
                    routing_decisions.append({
                        "span": name,
                        "completion": comp_text[:500],
                        "input": (inp_str[:300] if inp else ""),
                    })

            if s.get("error"):
                parts.append(f"{indent}  ERROR: {s['error']}")

            model = s.get("model") or llm.get("model")
            if model:
                in_tok = s.get("input_tokens", 0) or 0
                out_tok = s.get("output_tokens", 0) or 0
                tokens = s.get("total_tokens") or (in_tok + out_tok)
                parts.append(f"{indent}  Model: {model}, Tokens: {tokens}")

            retriever = s.get("retriever") or {}
            if retriever.get("documents"):
                docs = retriever["documents"]
                parts.append(f"{indent}  Retrieved {len(docs)} documents:")
                for d in docs[:5]:
                    text = d.get("text", d.get("page_content", ""))[:300] if isinstance(d, dict) else str(d)[:300]
                    parts.append(f"{indent}    - {text}")

            _format_spans(s.get("children", []), depth + 1)

    parts.append("## Span Tree")
    if spans:
        _format_spans(spans)
    elif flat_spans:
        _format_spans(flat_spans)
    else:
        parts.append("(no spans available)")

    if routing_decisions:
        parts.append("\n## Routing Decisions Detected")
        for rd in routing_decisions:
            parts.append(f"  Span: {rd['span']}")
            if rd['input']:
                parts.append(f"  Query: {rd['input']}")
            parts.append(f"  Decision: {rd['completion']}")
            parts.append("")

    feedback = trace.get("feedback") or []
    if feedback:
        parts.append("\n## Assessments / Feedback")

        negative = [fb for fb in feedback if fb.get("value") in ("False", "false", False) or fb.get("score", 1) < 0.5]
        positive = [fb for fb in feedback if fb not in negative]

        if negative:
            parts.append(f"\n### Negative Feedback ({len(negative)} entries)")
            for fb in negative:
                parts.append(f"  - {fb.get('key', '?')}: {fb.get('value', '?')} (source: {fb.get('source', '?')})")
                if fb.get("comment"):
                    parts.append(f"    Comment: {fb['comment'][:500]}")
                if fb.get("reasoning"):
                    parts.append(f"    Reasoning: {fb['reasoning'][:500]}")
                if fb.get("evaluator_name"):
                    parts.append(f"    Judge: {fb['evaluator_name']}, Score: {fb.get('score', 'N/A')}")

        if positive:
            parts.append(f"\n### Positive Feedback ({len(positive)} entries)")
            for fb in positive:
                parts.append(f"  - {fb.get('key', '?')}: {fb.get('value', '?')} (source: {fb.get('source', '?')})")
                if fb.get("comment"):
                    parts.append(f"    Comment: {fb['comment'][:500]}")

    assessments = trace.get("assessments") or []
    if assessments:
        parts.append("\n## Evaluation Assessments")
        for a in assessments[:15]:
            name = a.get("evaluator_name", a.get("key", "?"))
            score = a.get("score", "N/A")
            passed = a.get("passed", "N/A")
            parts.append(f"  - {name}: score={score}, passed={passed}")
            if a.get("reasoning"):
                parts.append(f"    Reasoning: {a['reasoning'][:500]}")

    return "\n".join(parts)


def analyze_trace_sync(trace: dict, question: str = None) -> str:
    """Synchronous trace analysis (non-streaming) using LangChain OpenAI."""
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return "Error: OPENAI_API_KEY not set. Configure it to use the AI debugging assistant."

    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage

        model = os.getenv("CLUCO_ASSISTANT_MODEL", "gpt-4o-mini")
        llm = ChatOpenAI(model=model, temperature=0.2, max_tokens=3000, api_key=api_key)

        trace_context = build_trace_context(trace)
        user_msg = f"## Trace Data\n{trace_context}\n\n"
        if question:
            user_msg += f"## Question\n{question}"
        else:
            user_msg += "## Task\nAnalyze this trace and identify any issues, root causes, and provide recommendations."

        result = llm.invoke([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=user_msg),
        ])
        return result.content or "No analysis generated."

    except ImportError:
        return "Error: langchain-openai not installed. Run: pip install langchain-openai langchain-core"
    except Exception as e:
        return f"Error during analysis: {str(e)}"


async def stream_trace_analysis(trace: dict, question: str = None):
    """Generator that yields chunks of the AI analysis for SSE streaming."""
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        yield "Error: OPENAI_API_KEY not set."
        return

    try:
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import SystemMessage, HumanMessage

        model = os.getenv("CLUCO_ASSISTANT_MODEL", "gpt-4o-mini")
        llm = ChatOpenAI(model=model, temperature=0.2, max_tokens=3000, api_key=api_key, streaming=True)

        trace_context = build_trace_context(trace)
        user_msg = f"## Trace Data\n{trace_context}\n\n"
        if question:
            user_msg += f"## Question\n{question}"
        else:
            user_msg += "## Task\nAnalyze this trace and identify any issues, root causes, and provide recommendations."

        async for chunk in llm.astream([
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=user_msg),
        ]):
            if chunk.content:
                yield chunk.content

    except ImportError:
        yield "Error: langchain-openai not installed."
    except Exception as e:
        yield f"Error: {str(e)}"
