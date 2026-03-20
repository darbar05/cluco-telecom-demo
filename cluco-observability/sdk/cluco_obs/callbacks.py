"""LangChain callback handler for automatic LLM/tool/retriever tracing."""

import time
import logging
from typing import Any, Optional
from cluco_obs.spans import SpanKind

logger = logging.getLogger("cluco_obs.callbacks")

try:
    from langchain_core.callbacks import BaseCallbackHandler as _LCBase
except ImportError:
    _LCBase = object


class ClucoCallbackHandler(_LCBase):
    def __init__(self, tracer=None, on_span_end=None):
        # When tracer is None, do NOT cache get_tracer() so each request uses the current global
        # (avoids LLM spans attaching to a previous request's trace).
        self.tracer = tracer
        self._active_spans: dict[str, Any] = {}
        self._on_span_end = on_span_end  # optional: callable(span) to stream span when LLM ends

    def _get_tracer(self):
        if self.tracer is not None:
            return self.tracer
        from cluco_obs.tracer import get_tracer
        return get_tracer()

    def on_llm_start(self, serialized: dict, prompts: list, *, run_id=None, **kwargs) -> None:
        tracer = self._get_tracer()
        if not tracer:
            return
        model = serialized.get("kwargs", {}).get("model_name") or serialized.get("id", [""])[-1] or "unknown"
        span = tracer.start_span(f"llm:{model}", kind=SpanKind.LLM, inputs={"prompts": prompts[:3]})
        span.model = model
        span.prompt_messages = [{"role": "user", "content": p[:2000]} for p in prompts[:5]]
        key = str(run_id) if run_id else str(id(span))
        self._active_spans[key] = span

    def _message_role(self, msg) -> str:
        """Normalize LangChain message type to human/system/ai string for storage."""
        t = getattr(msg, "type", None)
        if isinstance(t, str) and t:
            return t.lower() if t.lower() in ("human", "system", "ai", "user", "assistant") else t
        if t is not None:
            name = getattr(t, "__name__", None) or str(t)
            if "human" in name.lower() or "user" in name.lower():
                return "human"
            if "system" in name.lower():
                return "system"
            if "ai" in name.lower() or "assistant" in name.lower():
                return "ai"
        return "unknown"

    def on_chat_model_start(self, serialized: dict, messages: list, *, run_id=None, **kwargs) -> None:
        tracer = self._get_tracer()
        if not tracer:
            logger.debug("on_chat_model_start: no tracer, skipping")
            return
        logger.info("on_chat_model_start fired: run_id=%s, msg_count=%d", run_id, len(messages) if messages else 0)
        model = serialized.get("kwargs", {}).get("model_name") or serialized.get("kwargs", {}).get("model") or "unknown"
        flat_msgs = []
        for msg_list in messages[:5]:
            if isinstance(msg_list, list):
                for m in msg_list[:15]:
                    role = self._message_role(m)
                    content = getattr(m, "content", None)
                    if content is None:
                        content = ""
                    content = str(content)[:8000]
                    flat_msgs.append({"role": role, "content": content})
            else:
                role = self._message_role(msg_list)
                content = str(getattr(msg_list, "content", ""))[:8000]
                flat_msgs.append({"role": role, "content": content})

        span = tracer.start_span(f"llm:{model}", kind=SpanKind.LLM, inputs={"messages": flat_msgs[:3]})
        span.model = model
        span.prompt_messages = flat_msgs
        key = str(run_id) if run_id else str(id(span))
        self._active_spans[key] = span

    def _finish_llm_span(self, span, response, tracer):
        """Extract token usage and completion from response; set LLM data and end span.
        Handles both: (1) AIMessage / list of AIMessage (on_chat_model_end), (2) legacy .generations (on_llm_end)."""
        inp_tokens, out_tokens = 0, 0
        completion_text = ""
        model = getattr(span, "model", None) or "unknown"

        # Chat models: response is AIMessage or list of AIMessage
        if response is not None and not hasattr(response, "generations"):
            messages = response if isinstance(response, list) else [response]
            for msg in messages:
                if msg is None:
                    continue
                content = getattr(msg, "content", None)
                if content:
                    completion_text += str(content)[:10000]
                um = getattr(msg, "usage_metadata", None)
                if um is not None:
                    if hasattr(um, "input_tokens"):
                        inp_tokens += getattr(um, "input_tokens", 0) or 0
                        out_tokens += getattr(um, "output_tokens", 0) or 0
                    elif isinstance(um, dict):
                        inp_tokens += um.get("input_tokens", um.get("prompt_tokens", 0)) or 0
                        out_tokens += um.get("output_tokens", um.get("completion_tokens", 0)) or 0
                meta = getattr(msg, "response_metadata", None) or {}
                if isinstance(meta, dict):
                    usage = meta.get("token_usage") or meta.get("usage") or {}
                    if usage:
                        inp_tokens = inp_tokens or usage.get("input_tokens", usage.get("prompt_tokens", 0))
                        out_tokens = out_tokens or usage.get("output_tokens", usage.get("completion_tokens", 0))

        if response and hasattr(response, "generations"):
            for gen_list in (response.generations or []):
                for g in gen_list:
                    msg = getattr(g, "message", None)
                    if msg:
                        um = getattr(msg, "usage_metadata", None)
                        if um:
                            inp_tokens += getattr(um, "input_tokens", 0) or 0
                            out_tokens += getattr(um, "output_tokens", 0) or 0
                        content = str(getattr(msg, "content", "") or "")
                        if content:
                            completion_text += content

        if hasattr(response, "llm_output") and response and response.llm_output:
            usage = response.llm_output.get("token_usage", {})
            if usage:
                inp_tokens = inp_tokens or usage.get("prompt_tokens", 0)
                out_tokens = out_tokens or usage.get("completion_tokens", 0)
            model = response.llm_output.get("model_name", model)

        from cluco_obs.tracer import _estimate_cost
        logger.info(
            "LLM span data: model=%s, inp=%d, out=%d, completion_len=%d",
            model, inp_tokens, out_tokens, len(completion_text),
        )
        span.set_llm_data(
            model=model,
            provider="openai",
            input_tokens=inp_tokens,
            output_tokens=out_tokens,
            cost_usd=_estimate_cost(model, inp_tokens, out_tokens),
            prompt_messages=getattr(span, "prompt_messages", None) or [],
            completion=completion_text[:5000] if completion_text else None,
        )
        tracer.end_span(span, outputs={"completion": completion_text[:1000]} if completion_text else None)
        if callable(getattr(self, "_on_span_end", None)):
            try:
                self._on_span_end(span)
            except Exception as e:
                logger.warning("on_span_end (stream LLM span) failed: %s", e)

    def _pop_llm_span(self, run_id=None):
        """Pop the LLM span for this run; if run_id is missing, pop the most recently added (fallback)."""
        key = str(run_id) if run_id else None
        span = self._active_spans.pop(key, None) if key else None
        if span is None and self._active_spans:
            # LangChain may not pass run_id to end in some versions; pop last inserted (LIFO).
            last_key = next(reversed(self._active_spans))
            span = self._active_spans.pop(last_key, None)
        return span

    def on_llm_end(self, response, *, run_id=None, **kwargs) -> None:
        tracer = self._get_tracer()
        if not tracer:
            return
        run_id = run_id or kwargs.get("run_id")
        span = self._pop_llm_span(run_id)
        if not span:
            return
        self._finish_llm_span(span, response, tracer)

    def on_chat_model_end(self, response, *, run_id=None, **kwargs) -> None:
        """Chat models (e.g. ChatOpenAI) call this instead of on_llm_end; must end span and set LLM data."""
        tracer = self._get_tracer()
        if not tracer:
            logger.debug("on_chat_model_end: no tracer, skipping")
            return
        run_id = run_id or kwargs.get("run_id")
        span = self._pop_llm_span(run_id)
        if not span:
            logger.warning("on_chat_model_end: no active span for run_id=%s (active keys=%d)", run_id, len(self._active_spans))
            return
        logger.info("on_chat_model_end fired: run_id=%s, span=%s, model=%s", run_id, getattr(span, 'span_id', '?')[:12], getattr(span, 'model', '?'))
        self._finish_llm_span(span, response, tracer)

    def on_chat_model_error(self, error: Exception, *, run_id=None, **kwargs) -> None:
        tracer = self._get_tracer()
        if not tracer:
            return
        run_id = run_id or kwargs.get("run_id")
        span = self._pop_llm_span(run_id)
        if span:
            tracer.end_span(span, error=error)
            if callable(getattr(self, "_on_span_end", None)):
                try:
                    self._on_span_end(span)
                except Exception as e:
                    logger.warning("on_span_end (stream LLM span) failed: %s", e)

    def on_llm_error(self, error: Exception, *, run_id=None, **kwargs) -> None:
        tracer = self._get_tracer()
        if not tracer:
            return
        run_id = run_id or kwargs.get("run_id")
        span = self._pop_llm_span(run_id)
        if span:
            tracer.end_span(span, error=error)
            if callable(getattr(self, "_on_span_end", None)):
                try:
                    self._on_span_end(span)
                except Exception as e:
                    logger.warning("on_span_end (stream LLM span) failed: %s", e)

    def on_tool_start(self, serialized: dict, input_str: str, *, run_id=None, **kwargs) -> None:
        tracer = self._get_tracer()
        if not tracer:
            return
        tool_name = serialized.get("name", "unknown_tool")
        span = tracer.start_span(f"tool:{tool_name}", kind=SpanKind.TOOL)
        span.tool_name = tool_name
        span.tool_input = input_str[:2000] if input_str else None
        key = str(run_id) if run_id else str(id(span))
        self._active_spans[key] = span

    def on_tool_end(self, output: str, *, run_id=None, **kwargs) -> None:
        tracer = self._get_tracer()
        if not tracer:
            return
        key = str(run_id) if run_id else None
        span = self._active_spans.pop(key, None) if key else None
        if span:
            span.tool_output = str(output)[:5000] if output else None
            tracer.end_span(span, outputs={"output": str(output)[:1000]} if output else None)

    def on_tool_error(self, error: Exception, *, run_id=None, **kwargs) -> None:
        tracer = self._get_tracer()
        if not tracer:
            return
        key = str(run_id) if run_id else None
        span = self._active_spans.pop(key, None) if key else None
        if span:
            tracer.end_span(span, error=error)

    def on_retriever_start(self, serialized: dict, query: str, *, run_id=None, **kwargs) -> None:
        tracer = self._get_tracer()
        if not tracer:
            return
        name = serialized.get("name", "retriever")
        span = tracer.start_span(f"retriever:{name}", kind=SpanKind.RETRIEVER)
        span.query = query[:1000] if query else ""
        key = str(run_id) if run_id else str(id(span))
        self._active_spans[key] = span

    def on_retriever_end(self, documents, *, run_id=None, **kwargs) -> None:
        tracer = self._get_tracer()
        if not tracer:
            return
        key = str(run_id) if run_id else None
        span = self._active_spans.pop(key, None) if key else None
        if span:
            docs = documents or []
            span.retrieved_documents = [
                {"content": str(getattr(d, "page_content", ""))[:300], "metadata": str(getattr(d, "metadata", {}))[:200]}
                for d in docs[:20]
            ]
            tracer.end_span(span)

    def on_chain_start(self, serialized: dict, inputs: dict, *, run_id=None, **kwargs) -> None:
        pass

    def on_chain_end(self, outputs: dict, *, run_id=None, **kwargs) -> None:
        pass

    def on_chain_error(self, error: Exception, *, run_id=None, **kwargs) -> None:
        pass


def get_langchain_handler(tracer=None, on_span_end=None):
    try:
        from langchain_core.callbacks import BaseCallbackHandler

        # CRITICAL: ClucoCallbackHandler MUST come first in MRO so its
        # on_chat_model_start / on_chat_model_end / on_llm_start / on_llm_end
        # methods take priority over BaseCallbackHandler's empty no-ops.
        # Previous order (BaseCallbackHandler, ClucoCallbackHandler) caused
        # Python to resolve BaseCallbackHandler's stubs first, silently
        # swallowing all LLM callback events.
        class _LangChainClucoHandler(ClucoCallbackHandler, BaseCallbackHandler):
            def __init__(self, tracer=None, on_span_end=None):
                BaseCallbackHandler.__init__(self)
                ClucoCallbackHandler.__init__(self, tracer=tracer, on_span_end=on_span_end)

        return _LangChainClucoHandler(tracer=tracer, on_span_end=on_span_end)
    except ImportError:
        return ClucoCallbackHandler(tracer=tracer, on_span_end=on_span_end)
