"""
DSPy library integration for prompt optimization.

Provides run_dspy_strategy() which uses real DSPy optimizers
(MIPROv2, BootstrapFewShotWithRandomSearch) to compile prompt modules.
"""
import os
import logging
from typing import Callable, Optional

logger = logging.getLogger(__name__)

DSPY_AVAILABLE = False
try:
    import dspy
    DSPY_AVAILABLE = True
except ImportError:
    logger.info("dspy package not installed — DSPy strategies will be skipped")


def _extract_optimized_prompt(compiled_module) -> str:
    """Extract the full prompt text (instructions + few-shot demos) from a compiled DSPy module."""
    parts = []

    predictor = None
    if hasattr(compiled_module, 'predict'):
        predictor = compiled_module.predict
    elif hasattr(compiled_module, 'module'):
        predictor = compiled_module.module
    else:
        for attr_name in dir(compiled_module):
            attr = getattr(compiled_module, attr_name, None)
            if hasattr(attr, 'signature'):
                predictor = attr
                break

    if predictor is None:
        predictor = compiled_module

    sig = getattr(predictor, 'signature', None)
    if sig:
        instructions = getattr(sig, 'instructions', '')
        if instructions:
            parts.append(instructions.strip())

    demos = getattr(predictor, 'demos', [])
    if demos:
        parts.append("\n--- Examples ---")
        for i, demo in enumerate(demos[:8], 1):
            demo_dict = demo.toDict() if hasattr(demo, 'toDict') else dict(demo)
            lines = [f"\nExample {i}:"]
            for k, v in demo_dict.items():
                if not k.startswith('dspy_') and not k.startswith('_'):
                    lines.append(f"  {k}: {v}")
            parts.append("\n".join(lines))

    return "\n\n".join(parts) if parts else str(compiled_module)


def run_dspy_strategy(
    strategy: str,
    prompt_text: str,
    eval_items: list,
    evaluator_obj: dict,
    target_model: str = "gpt-4o-mini",
    optimizer_model: str = "gpt-4o",
    progress_callback: Optional[Callable] = None,
) -> dict:
    """
    Run a DSPy optimization strategy on the given prompt and dataset.

    Returns dict with keys: pass_rate, prompt_text, changes_summary, status
    """
    if not DSPY_AVAILABLE:
        return {
            "status": "skipped",
            "pass_rate": 0,
            "prompt_text": "",
            "changes_summary": "dspy package not installed",
        }

    from app.evaluation_engine import TraceContext, run_single_evaluator

    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        return {
            "status": "error",
            "pass_rate": 0,
            "prompt_text": "",
            "changes_summary": "OPENAI_API_KEY not set",
        }

    try:
        target_lm = dspy.LM(f"openai/{target_model}", api_key=api_key, max_tokens=1500)
        teacher_lm = dspy.LM(f"openai/{optimizer_model}", api_key=api_key, max_tokens=3000)
        dspy.configure(lm=target_lm)
    except Exception as e:
        logger.error("Failed to configure DSPy LMs: %s", e)
        return {
            "status": "error",
            "pass_rate": 0,
            "prompt_text": "",
            "changes_summary": f"LM config failed: {e}",
        }

    if progress_callback:
        progress_callback("configuring_dspy")

    train_examples = []
    for item in eval_items:
        ex = dspy.Example(
            input=str(item.get("input", "")),
            expected_output=str(item.get("expected_output", "")),
        ).with_inputs("input")
        train_examples.append(ex)

    if not train_examples:
        return {
            "status": "error",
            "pass_rate": 0,
            "prompt_text": "",
            "changes_summary": "No dataset items to train on",
        }

    signature = dspy.Signature(
        "input -> output",
        instructions=prompt_text,
    )
    module = dspy.ChainOfThought(signature)

    def metric(example, pred, trace=None):
        try:
            pred_output = getattr(pred, 'output', '') or ''
            ctx = TraceContext(
                trace_id="dspy_opt",
                final_input=example.input,
                final_output=str(pred_output),
            )
            result = run_single_evaluator(
                evaluator_obj, ctx,
                expected_output=example.expected_output,
            )
            passed = result.get("passed", False) or result.get("score", 0) >= 50
            if trace is not None:
                return passed
            return result.get("score", 0) / 100.0
        except Exception as e:
            logger.debug("DSPy metric eval error: %s", e)
            return False if trace is not None else 0.0

    if progress_callback:
        progress_callback("compiling")

    try:
        if strategy == "dspy_mipro":
            optimizer = dspy.MIPROv2(
                metric=metric,
                auto="light",
                num_threads=2,
                teacher_settings=dict(lm=teacher_lm),
                prompt_model=teacher_lm,
                max_errors=50,
            )
            compiled = optimizer.compile(
                module,
                trainset=train_examples,
                max_bootstrapped_demos=3,
                max_labeled_demos=3,
            )
        elif strategy == "dspy_bootstrap":
            optimizer = dspy.BootstrapFewShotWithRandomSearch(
                metric=metric,
                max_bootstrapped_demos=4,
                max_labeled_demos=4,
                num_candidate_programs=6,
                num_threads=2,
                max_errors=50,
            )
            compiled = optimizer.compile(
                module,
                trainset=train_examples,
            )
        else:
            return {
                "status": "error",
                "pass_rate": 0,
                "prompt_text": "",
                "changes_summary": f"Unknown DSPy strategy: {strategy}",
            }
    except Exception as e:
        logger.error("DSPy compilation failed for strategy %s: %s", strategy, e)
        return {
            "status": "error",
            "pass_rate": 0,
            "prompt_text": "",
            "changes_summary": f"Compilation failed: {e}",
        }

    if progress_callback:
        progress_callback("extracting_prompt")

    optimized_prompt = _extract_optimized_prompt(compiled)

    if progress_callback:
        progress_callback("evaluating_result")

    passed_count = 0
    total_count = 0
    for item in eval_items:
        try:
            pred = compiled(input=str(item.get("input", "")))
            pred_output = getattr(pred, 'output', '') or ''
            ctx = TraceContext(
                trace_id="dspy_eval",
                final_input=str(item.get("input", "")),
                final_output=str(pred_output),
            )
            result = run_single_evaluator(
                evaluator_obj, ctx,
                expected_output=str(item.get("expected_output", "")),
            )
            total_count += 1
            if result.get("passed", False) or result.get("score", 0) >= 50:
                passed_count += 1
        except Exception as e:
            logger.debug("DSPy eval item error: %s", e)
            total_count += 1

    pass_rate = round(passed_count / total_count * 100, 1) if total_count else 0

    strategy_label = "MIPROv2" if strategy == "dspy_mipro" else "BootstrapFewShot"
    changes_summary = (
        f"DSPy {strategy_label} optimization: "
        f"{passed_count}/{total_count} passed ({pass_rate}%)"
    )

    return {
        "status": "done",
        "pass_rate": pass_rate,
        "prompt_text": optimized_prompt,
        "changes_summary": changes_summary,
        "passed": passed_count,
        "failed": total_count - passed_count,
        "total": total_count,
    }
