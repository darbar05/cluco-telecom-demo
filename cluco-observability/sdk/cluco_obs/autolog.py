"""One-line auto-instrumentation for popular AI/ML frameworks.

Usage:
    import cluco_obs
    cluco_obs.autolog()
"""

import importlib
import logging
import os

logger = logging.getLogger("cluco_obs.autolog")

_autolog_initialized = False


def autolog(
    backend_url: str = None,
    product_id: str = None,
    service_name: str = None,
    environment: str = None,
    enabled: bool = True,
    sample_rate: float = 1.0,
    pii_masking: bool = False,
):
    """Enable automatic tracing with a single line of code.

    Auto-detects installed frameworks (LangChain, OpenAI, etc.) and instruments them.

    Args:
        backend_url: CLUCO backend URL. Falls back to CLUCO_OBS_BACKEND_URL env var.
        product_id: Product identifier. Falls back to CLUCO_OBS_PRODUCT_ID env var.
        service_name: Service name. Falls back to CLUCO_OBS_SERVICE_NAME env var.
        environment: Environment (dev/staging/prod). Falls back to CLUCO_OBS_ENVIRONMENT env var.
        enabled: Whether tracing is enabled.
        sample_rate: Fraction of traces to capture (0.0-1.0).
        pii_masking: Whether to mask PII in traces.
    """
    global _autolog_initialized
    if _autolog_initialized:
        logger.debug("autolog already initialized, skipping")
        return

    from cluco_obs.config import ClucoConfig
    from cluco_obs.tracer import init_tracer

    config = ClucoConfig(
        enabled=enabled,
        backend_url=backend_url or os.environ.get("CLUCO_OBS_BACKEND_URL", os.environ.get("AGENT_OBS_BACKEND_URL", "http://localhost:9410")),
        product_id=product_id or os.environ.get("CLUCO_OBS_PRODUCT_ID", os.environ.get("AGENT_OBS_PRODUCT_ID", "default")),
        service_name=service_name or os.environ.get("CLUCO_OBS_SERVICE_NAME", os.environ.get("AGENT_OBS_SERVICE_NAME", "agent")),
        environment=environment or os.environ.get("CLUCO_OBS_ENVIRONMENT", os.environ.get("AGENT_OBS_ENVIRONMENT", "development")),
        sample_rate=sample_rate,
        pii_masking_enabled=pii_masking,
    )

    tracer = init_tracer(config)

    _detected = []

    if _detect_framework("langchain"):
        _setup_langchain(tracer)
        _detected.append("langchain")

    if _detect_framework("openai"):
        _setup_openai(tracer)
        _detected.append("openai")

    if _detect_framework("anthropic"):
        _detected.append("anthropic")

    if _detect_framework("litellm"):
        _detected.append("litellm")

    _autolog_initialized = True

    if _detected:
        logger.info("cluco_obs.autolog() initialized with frameworks: %s", ", ".join(_detected))
    else:
        logger.info("cluco_obs.autolog() initialized (no frameworks auto-detected, manual tracing available)")


def _detect_framework(name: str) -> bool:
    """Check if a framework is installed."""
    spec = importlib.util.find_spec(name)
    return spec is not None


def _setup_langchain(tracer):
    """Auto-instrument LangChain by registering the CLUCO callback handler globally."""
    try:
        from cluco_obs.callbacks import ClucoCallbackHandler

        def _stream_span(span_data):
            """Stream completed span to backend. span_data may be a Span object or a dict."""
            if not tracer._exporter:
                return
            # Handle both Span objects and raw dicts
            if isinstance(span_data, dict):
                trace_id = span_data.get("trace_id", "")
                span_payload = span_data
            else:
                # Span object -- call to_dict() if available, otherwise extract attrs
                trace_id = getattr(span_data, "trace_id", "") or ""
                if hasattr(span_data, "to_dict"):
                    span_payload = span_data.to_dict()
                else:
                    span_payload = {
                        "span_id": getattr(span_data, "span_id", ""),
                        "trace_id": trace_id,
                        "name": getattr(span_data, "name", ""),
                        "kind": str(getattr(span_data, "kind", "llm")),
                    }
            product_id = tracer.config.product_id
            service_name = tracer.config.service_name
            data = {
                "type": "span_stream",
                "trace_id": trace_id,
                "product_id": product_id,
                "service_name": service_name,
                "span": span_payload,
            }
            tracer._exporter.enqueue(data)

        handler = ClucoCallbackHandler(
            tracer=tracer,
            on_span_end=_stream_span,
        )

        registered = False

        # Modern LangChain 0.3+: patch BaseChatModel to inject callback
        try:
            from langchain_core.language_models.chat_models import BaseChatModel

            _original_generate = BaseChatModel.generate

            def _patched_generate(self, messages, stop=None, callbacks=None, **kwargs):
                cb_list = list(callbacks or [])
                if handler not in cb_list:
                    cb_list.append(handler)
                return _original_generate(self, messages, stop=stop, callbacks=cb_list, **kwargs)

            BaseChatModel.generate = _patched_generate

            _original_invoke = BaseChatModel.invoke

            def _patched_invoke(self, input, config=None, **kwargs):
                config = dict(config or {})
                cb_list = list(config.get("callbacks") or [])
                if handler not in cb_list:
                    cb_list.append(handler)
                config["callbacks"] = cb_list
                return _original_invoke(self, input, config=config, **kwargs)

            BaseChatModel.invoke = _patched_invoke

            # Also patch ainvoke for async paths
            if hasattr(BaseChatModel, "ainvoke"):
                _original_ainvoke = BaseChatModel.ainvoke

                async def _patched_ainvoke(self, input, config=None, **kwargs):
                    config = dict(config or {})
                    cb_list = list(config.get("callbacks") or [])
                    if handler not in cb_list:
                        cb_list.append(handler)
                    config["callbacks"] = cb_list
                    return await _original_ainvoke(self, input, config=config, **kwargs)

                BaseChatModel.ainvoke = _patched_ainvoke

            registered = True
            logger.info("LangChain BaseChatModel patched for auto-instrumentation")
        except Exception as e:
            logger.warning("BaseChatModel patch failed: %s", e)

        # Fallback: legacy langchain.globals (pre-0.3)
        if not registered:
            try:
                import langchain.globals
                existing = langchain.globals.get_llm_callbacks() or []
                langchain.globals.set_llm_callbacks([*existing, handler])
                registered = True
            except Exception:
                pass

        if registered:
            logger.info("LangChain auto-instrumentation enabled")
        else:
            logger.warning("LangChain auto-instrumentation: could not register callback handler")
    except ImportError:
        logger.debug("LangChain callback setup failed (missing langchain_core)")
    except Exception as e:
        logger.warning("LangChain auto-instrumentation error: %s", e)


def _setup_openai(tracer):
    """Auto-instrument OpenAI by monkey-patching the completions API."""
    try:
        import openai
        import time

        _original_create = None
        _target_cls = None

        try:
            _target_cls = openai.chat.completions.Completions
            _original_create = _target_cls.create
        except AttributeError:
            try:
                _target_cls = openai.ChatCompletion
                _original_create = _target_cls.create
            except AttributeError:
                pass

        if _original_create is None:
            logger.debug("OpenAI: could not find completions API to patch")
            return

        def _patched_create(self_or_cls, *args, **kwargs):
            model = kwargs.get("model", "unknown")
            messages = kwargs.get("messages", [])

            span = tracer.start_span(
                name=f"openai:{model}",
                kind="llm",
            )

            try:
                result = _original_create(self_or_cls, *args, **kwargs)

                usage = {}
                completion_text = ""
                if hasattr(result, "usage") and result.usage:
                    usage = {
                        "input_tokens": getattr(result.usage, "prompt_tokens", 0),
                        "output_tokens": getattr(result.usage, "completion_tokens", 0),
                        "total_tokens": getattr(result.usage, "total_tokens", 0),
                    }
                if hasattr(result, "choices") and result.choices:
                    msg = result.choices[0].message
                    completion_text = getattr(msg, "content", "") or ""

                if span:
                    span.input_tokens = usage.get("input_tokens", 0)
                    span.output_tokens = usage.get("output_tokens", 0)
                    span.total_tokens = usage.get("total_tokens", 0)
                    span.inputs = messages
                    span.outputs = completion_text
                    span.metadata = span.metadata or {}
                    span.metadata["model"] = model
                    span.metadata["provider"] = "openai"

                tracer.end_span(span)
                return result

            except Exception as e:
                if span:
                    span.metadata = span.metadata or {}
                    span.metadata["error"] = str(e)
                tracer.end_span(span, error=e)
                raise

        _patched_create.__name__ = "create"
        _patched_create.__qualname__ = getattr(_original_create, "__qualname__", "Completions.create")

        if _target_cls:
            _target_cls.create = _patched_create

        logger.debug("OpenAI auto-instrumentation enabled")
    except ImportError:
        logger.debug("OpenAI not installed, skipping auto-instrumentation")
    except Exception as e:
        logger.warning("OpenAI auto-instrumentation error: %s", e)


class langchain:
    @staticmethod
    def autolog(**kwargs):
        """Enable auto-instrumentation specifically for LangChain."""
        autolog(**kwargs)


class openai_autolog:
    @staticmethod
    def autolog(**kwargs):
        """Enable auto-instrumentation specifically for OpenAI."""
        autolog(**kwargs)
