"""
Prompt Optimization Engine -- DSPy-inspired iterative prompt improvement.

Key design principles (DSPy-style):
  1. Generate multiple candidate prompts per iteration (temperature diversity)
  2. Re-run the LLM with each candidate on every dataset item to get ACTUAL outputs
  3. Evaluate actual outputs (not pre-existing traces) with the judge
  4. Select the best candidate via metric-driven comparison
  5. Early-stop when no improvement for consecutive iterations

Strategies:
  1. failure_driven -- Analyze failed items, rewrite prompt to address failure patterns
  2. few_shot -- Auto-select best examples and inject as few-shot demonstrations
  3. instruction_refinement -- Iteratively refine system instructions based on eval feedback
  4. variable_optimization -- Optimize template structure around variables
  5. model_aware -- Adjust prompt style for target model characteristics

Each iteration creates a real experiment for full auditability.
"""
import json
import os
import re
import uuid
import logging
from datetime import datetime
from typing import Optional

logger = logging.getLogger(__name__)

OPTIMIZER_SYSTEM_PROMPT = """You are an expert prompt engineer specializing in failure-driven prompt optimization.

You will receive:
1. The current prompt (system instructions for an AI agent)
2. FAILED test cases: each has Input, Actual Output (what the agent produced), Expected Output (the correct answer), and Judge Reasoning (why it failed)
3. PASSED test cases: input/output pairs where the agent succeeded

Your optimization process:
1. FIRST, identify the EXACT mismatch between actual and expected outputs in each failure. Be precise: is the agent producing the wrong category? Wrong format? Hallucinating content? Ignoring constraints?
2. SECOND, look for PATTERNS across failures. Group failures by root cause (e.g., "3 of 4 failures involve billing queries being misclassified as general inquiries").
3. THIRD, write an improved prompt that:
   - Adds explicit rules/constraints that prevent each identified failure pattern
   - Uses unambiguous language (avoid "may", "could", "generally")
   - Lists exact categories/options when the task involves classification
   - Includes decision boundaries (e.g., "If the query mentions pricing, fees, or charges -> billing")
   - Preserves ALL behaviors that currently succeed

CRITICAL: The improved prompt must produce DIFFERENT outputs from the current prompt on the failed cases. If the failures are about classification, add explicit category definitions with examples.

Return ONLY valid JSON:
{
  "improved_prompt": "<the COMPLETE improved prompt text — include everything, not just changes>",
  "changes_summary": "<describe each failure pattern found and the specific fix applied>",
  "confidence": <0-100>
}"""

FEW_SHOT_SYSTEM_PROMPT = """You are an expert prompt engineer. Your job is to enhance a prompt by embedding the most effective few-shot examples.

You will receive:
1. The current prompt
2. Successful test cases (input -> correct output) 
3. Failed test cases (input -> wrong output vs expected)

Your process:
1. From the successes, select 3-5 examples that cover DIFFERENT types of inputs and demonstrate the full range of correct behaviors.
2. From the failures, identify what types of inputs are missing from examples — add synthetic examples for those edge cases using the expected outputs.
3. Embed the examples directly in the prompt using a clear format like:
   "Examples:
   Input: <example input>
   Output: <correct output>"
4. Place examples BEFORE the main instruction for maximum effectiveness.
5. If the task involves classification, include at least one example for each category.

Return ONLY valid JSON:
{
  "improved_prompt": "<the COMPLETE prompt with few-shot examples embedded>",
  "changes_summary": "<which examples were selected, which edge cases were covered>",
  "confidence": <0-100>
}"""

INSTRUCTION_REFINEMENT_PROMPT = """You are an expert prompt engineer specializing in precise instruction writing.

You will receive:
1. The current prompt
2. Failed test cases with judge reasoning showing WHERE instructions broke down
3. Successful test cases showing what works

Your refinement process:
1. Map each failure to the specific instruction (or missing instruction) that caused it.
2. For each problematic instruction:
   - Replace vague terms with specific ones (e.g., "handle appropriately" -> "respond with the exact category name from the list below")
   - Add explicit output format requirements (e.g., "Respond with ONLY the category name, nothing else")
   - Add boundary conditions and edge cases as explicit rules
3. Restructure the prompt for clarity:
   - Put the most important constraint FIRST
   - Use numbered rules for classification/routing
   - Add a "DO NOT" section for common mistakes observed in failures

Return ONLY valid JSON:
{
  "improved_prompt": "<the COMPLETE refined prompt>",
  "changes_summary": "<which instructions were ambiguous, what was refined>",
  "confidence": <0-100>
}"""

VARIABLE_OPTIMIZATION_PROMPT = """You are an expert prompt engineer. Your job is to optimize a prompt template that uses variables.

You will be given:
1. The current prompt template with {{variable}} placeholders
2. Test cases showing how variables are filled and the resulting quality
3. Failed cases showing where the template structure caused issues

Optimize the template structure around the variables to improve output quality. Keep all {{variable}} placeholders intact.

Return ONLY valid JSON:
{
  "improved_prompt": "<the optimized template (keep {{variables}} intact)>",
  "changes_summary": "<what structural changes were made around variables>",
  "confidence": <0-100>
}"""

MODEL_AWARE_PROMPT = """You are an expert prompt engineer who understands the nuances of different LLM models.

You will be given:
1. The current prompt
2. The target model (e.g. GPT-4, Claude, Llama)
3. Test results

Adapt the prompt style for the target model:
- GPT-4: responds well to structured formats, step-by-step reasoning
- Claude: responds well to XML tags, detailed context, role-playing
- Llama: responds well to concise instructions, clear examples

Return ONLY valid JSON:
{
  "improved_prompt": "<the model-adapted prompt>",
  "changes_summary": "<what was adapted for the target model>",
  "confidence": <0-100>
}"""

MULTI_CANDIDATE_PROMPT = """You are an expert prompt engineer. Generate {n_candidates} DIFFERENT improved versions of the given prompt.

Each version should take a different approach to fixing the failures:
- Version 1: Focus on adding explicit constraints/rules
- Version 2: Focus on restructuring and clarifying instructions
- Version 3: Focus on adding context and examples

You will be given the current prompt and failure cases with ACTUAL outputs and judge reasoning.

Return ONLY valid JSON:
{{
  "candidates": [
    {{"improved_prompt": "<version 1>", "changes_summary": "<what changed>", "approach": "<approach name>"}},
    {{"improved_prompt": "<version 2>", "changes_summary": "<what changed>", "approach": "<approach name>"}},
    {{"improved_prompt": "<version 3>", "changes_summary": "<what changed>", "approach": "<approach name>"}}
  ]
}}"""

STRATEGY_PROMPTS = {
    "failure_driven": OPTIMIZER_SYSTEM_PROMPT,
    "few_shot": FEW_SHOT_SYSTEM_PROMPT,
    "instruction_refinement": INSTRUCTION_REFINEMENT_PROMPT,
    "variable_optimization": VARIABLE_OPTIMIZATION_PROMPT,
    "model_aware": MODEL_AWARE_PROMPT,
}


STRATEGY_ROTATION_ORDER = ["failure_driven", "instruction_refinement", "few_shot"]


def _call_optimizer_llm(system_prompt: str, user_message: str, model: str = None,
                        temperature: float = 0.3) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage

    model = model or os.getenv("CLUCO_OPTIMIZER_MODEL", "gpt-4o")
    llm = ChatOpenAI(
        model=model,
        temperature=temperature,
        max_tokens=3000,
        api_key=api_key,
        model_kwargs={"response_format": {"type": "json_object"}},
    )
    result = llm.invoke([
        SystemMessage(content=system_prompt),
        HumanMessage(content=user_message),
    ])
    content = result.content or "{}"
    try:
        return json.loads(content)
    except json.JSONDecodeError:
        match = re.search(r'\{[\s\S]*\}', content)
        if match:
            return json.loads(match.group())
        raise


def _run_prompt_on_input(prompt_text: str, user_input: str, model: str = None) -> str:
    """Run an LLM with the given prompt as system message and user_input as the user message.
    Returns the actual model output text. This simulates what the agent would produce."""
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage

    target_model = model or os.getenv("CLUCO_OPTIMIZER_TARGET_MODEL", "gpt-4o-mini")
    llm = ChatOpenAI(
        model=target_model,
        temperature=0.1,
        max_tokens=1500,
        api_key=api_key,
    )
    result = llm.invoke([
        SystemMessage(content=prompt_text),
        HumanMessage(content=user_input),
    ])
    return result.content or ""


def _evaluate_candidate(candidate_prompt: str, items: list, evaluator_obj: dict,
                         store, target_model: str = None) -> dict:
    """Evaluate a candidate prompt by re-running it on dataset items and scoring outputs.
    Returns dict with pass_rate, passed_cases, failed_cases, and avg_score."""
    from app.evaluation_engine import TraceContext, run_single_evaluator

    passed_cases = []
    failed_cases = []
    target = target_model or os.getenv("CLUCO_OPTIMIZER_TARGET_MODEL", "gpt-4o-mini")

    for item in items:
        user_input = str(item.get("input", ""))
        expected_output = str(item.get("expected_output", ""))

        try:
            actual_output = _run_prompt_on_input(candidate_prompt, user_input, target)
        except Exception as e:
            logger.warning("Failed to run prompt on input: %s", e)
            failed_cases.append({
                "trace_id": item.get("trace_id", "synthetic"),
                "input": user_input[:1000],
                "actual_output": f"[LLM ERROR: {e}]",
                "expected_output": expected_output[:1000],
                "score": 0, "passed": False,
                "reasoning": f"LLM invocation failed: {e}",
            })
            continue

        llm_span = {
            "span_id": "opt_llm_0",
            "kind": "llm",
            "name": f"LLM ({target})",
            "status": "ok",
            "latency_ms": 0,
            "llm": {
                "model": target,
                "prompt_messages": [
                    {"role": "system", "content": candidate_prompt},
                    {"role": "user", "content": user_input},
                ],
                "completion": actual_output,
                "input_tokens": 0,
                "output_tokens": 0,
            },
        }

        ctx = TraceContext(
            trace_id=item.get("trace_id", "optimizer_synthetic"),
            final_input=user_input,
            final_output=actual_output,
            spans=[llm_span],
            llm_spans=[llm_span],
        )

        try:
            result = run_single_evaluator(
                evaluator_obj, ctx,
                expected_output=expected_output,
            )
            entry = {
                "trace_id": item.get("trace_id", "synthetic"),
                "input": user_input[:1000],
                "actual_output": actual_output[:1000],
                "expected_output": expected_output[:1000],
                "score": result.get("score", 0),
                "passed": result.get("passed", False),
                "reasoning": result.get("reasoning", ""),
            }
            if result.get("passed") or result.get("score", 0) >= 50:
                passed_cases.append(entry)
            else:
                failed_cases.append(entry)
        except Exception as e:
            logger.warning("Error evaluating item: %s", e)
            failed_cases.append({
                "trace_id": item.get("trace_id", "synthetic"),
                "input": user_input[:1000],
                "actual_output": actual_output[:1000],
                "expected_output": expected_output[:1000],
                "score": 0, "passed": False,
                "reasoning": f"Evaluation error: {e}",
            })

    total = len(passed_cases) + len(failed_cases)
    pass_rate = round(len(passed_cases) / total * 100, 1) if total else 0
    avg_score = round(
        sum(c["score"] for c in passed_cases + failed_cases) / total, 1
    ) if total else 0

    return {
        "pass_rate": pass_rate,
        "avg_score": avg_score,
        "total": total,
        "passed": len(passed_cases),
        "failed": len(failed_cases),
        "passed_cases": passed_cases,
        "failed_cases": failed_cases,
    }


def _generate_candidates(strategy: str, current_prompt: str, failures: list,
                          successes: list, n_candidates: int = 3,
                          optimizer_model: str = None,
                          target_model: str = None) -> list:
    """Generate multiple candidate prompts using temperature diversity (DSPy-style bootstrapping)."""
    candidates = []
    system_prompt = STRATEGY_PROMPTS.get(strategy, OPTIMIZER_SYSTEM_PROMPT)

    temperatures = [0.2, 0.5, 0.8][:n_candidates]

    for i, temp in enumerate(temperatures):
        user_msg = _build_strategy_message(strategy, current_prompt, failures,
                                           successes, target_model)
        try:
            response = _call_optimizer_llm(system_prompt, user_msg, optimizer_model,
                                           temperature=temp)
            improved = response.get("improved_prompt", "")
            if improved and improved.strip() != current_prompt.strip():
                candidates.append({
                    "prompt": improved,
                    "changes_summary": response.get("changes_summary", ""),
                    "confidence": response.get("confidence", 50),
                    "temperature": temp,
                    "approach": f"temp_{temp}",
                })
        except Exception as e:
            logger.warning("Candidate generation failed at temp %.1f: %s", temp, e)
            continue

    seen = set()
    unique = []
    for c in candidates:
        key = c["prompt"].strip()[:200]
        if key not in seen:
            seen.add(key)
            unique.append(c)

    return unique


def _upsert_run_progress(store, run_id: str, data: dict):
    """Write incremental progress to MongoDB so the frontend can poll status."""
    try:
        store._db["optimization_runs"].update_one(
            {"_id": run_id},
            {"$set": data},
            upsert=True,
        )
    except Exception as e:
        logger.debug("Could not upsert optimization run progress: %s", e)


def run_optimization(
    store,
    prompt_id: str,
    dataset_id: str,
    evaluator_id: str,
    max_iterations: int = 4,
    optimizer_model: str = None,
    strategy: str = "failure_driven",
    evaluator_ids: list = None,
    run_id: str = None,
) -> dict:
    """
    DSPy-inspired prompt optimization loop with experiment tracking.

    Each iteration:
      1. Generate N candidate prompts (temperature diversity)
      2. Re-run the LLM with each candidate on every dataset item
      3. Evaluate actual outputs with the judge
      4. Select the best candidate (metric-driven)
      5. Save as new prompt version if better than current best
      6. Rotate strategy on plateau, stop after exhausting all strategies
    """

    prompt = store.get_prompt_template(prompt_id)
    if not prompt:
        return {"ok": False, "error": "Prompt not found"}

    dataset = store.get_dataset(dataset_id)
    if not dataset:
        return {"ok": False, "error": "Dataset not found"}

    all_evaluator_ids = evaluator_ids or ([evaluator_id] if evaluator_id else [])
    evaluator_objs = [store.get_evaluator(eid) for eid in all_evaluator_ids]
    evaluator_objs = [e for e in evaluator_objs if e]
    if not evaluator_objs:
        return {"ok": False, "error": "No valid evaluators found"}

    primary_evaluator = evaluator_objs[0]

    items = store.get_dataset_items(dataset_id)
    if not items:
        return {"ok": False, "error": "Dataset has no items"}

    eval_items = items[:50]

    if not run_id:
        run_id = str(uuid.uuid4())[:12]

    if len(eval_items) < 5:
        logger.warning("Dataset has only %d items — optimization results may be unreliable "
                        "(recommend 10+ items)", len(eval_items))

    latest_versions = store.list_prompt_versions_for_template(prompt_id, limit=1)
    if latest_versions:
        current_prompt_text = latest_versions[0].get("content", "")
    else:
        current_prompt_text = ""

    if not current_prompt_text:
        return {"ok": False, "error": "Prompt has no version content"}

    target_model = os.getenv("CLUCO_OPTIMIZER_TARGET_MODEL", "gpt-4o-mini")

    logger.info("Starting DSPy-style optimization for prompt %s with %d items",
                prompt_id, len(eval_items))

    _upsert_run_progress(store, run_id, {
        "status": "running",
        "prompt_id": prompt_id,
        "dataset_id": dataset_id,
        "evaluator_ids": all_evaluator_ids,
        "strategy": strategy,
        "max_iterations": max_iterations,
        "dataset_item_count": len(eval_items),
        "current_iteration": 0,
        "current_phase": "evaluating_baseline",
        "created_at": datetime.utcnow(),
    })

    # --- Baseline evaluation with the original prompt ---
    logger.info("Evaluating baseline prompt...")
    baseline = _evaluate_candidate(
        current_prompt_text, eval_items, primary_evaluator, store, target_model
    )
    best_pass_rate = baseline["pass_rate"]
    best_prompt = current_prompt_text
    best_avg_score = baseline["avg_score"]

    iterations = []
    experiments_created = []
    no_improvement_count = 0
    n_candidates = 3

    # Track last iteration's failures/successes in standalone variables
    # so they survive the clean_result stripping applied to `iterations`
    last_failed_cases = baseline["failed_cases"]
    last_passed_cases = baseline["passed_cases"]

    baseline_result = {
        "iteration": 0,
        "strategy": "baseline",
        "pass_rate": baseline["pass_rate"],
        "avg_score": baseline["avg_score"],
        "total": baseline["total"],
        "passed": baseline["passed"],
        "failed": baseline["failed"],
        "prompt_text": current_prompt_text[:500],
    }
    iterations.append(baseline_result)

    _upsert_run_progress(store, run_id, {
        "iterations": iterations,
        "initial_pass_rate": baseline["pass_rate"],
        "current_iteration": 0,
        "current_phase": "baseline_complete",
    })

    _create_experiment_record(
        store, run_id, 0, prompt_id, dataset_id, all_evaluator_ids,
        primary_evaluator, baseline, prompt, experiments_created
    )

    # Strategy rotation: track which strategies have been tried without improvement
    current_strategy = strategy
    strategies_tried_without_improvement = set()

    for iteration in range(1, max_iterations + 1):
        logger.info("Optimization iteration %d/%d [%s] for prompt %s",
                     iteration, max_iterations, current_strategy, prompt_id)

        _upsert_run_progress(store, run_id, {
            "current_iteration": iteration,
            "current_phase": "generating_candidates",
            "current_strategy": current_strategy,
        })

        if best_pass_rate >= 95:
            logger.info("Target pass rate reached (%.1f%%). Stopping.", best_pass_rate)
            iterations.append({
                "iteration": iteration,
                "strategy": current_strategy,
                "stopped_reason": "target_reached",
                "pass_rate": best_pass_rate,
                "avg_score": best_avg_score,
            })
            break

        candidates = _generate_candidates(
            current_strategy, best_prompt,
            last_failed_cases[:10], last_passed_cases[:5],
            n_candidates=n_candidates,
            optimizer_model=optimizer_model,
            target_model=target_model,
        )

        if not candidates:
            logger.warning("No candidates generated at iteration %d", iteration)
            iterations.append({
                "iteration": iteration,
                "strategy": current_strategy,
                "stopped_reason": "no_candidates_generated",
                "pass_rate": best_pass_rate,
                "avg_score": best_avg_score,
            })
            break

        # --- Evaluate each candidate (DSPy-style metric-driven selection) ---
        _upsert_run_progress(store, run_id, {
            "current_phase": "evaluating_candidates",
            "candidates_count": len(candidates),
        })

        candidate_results = []
        for ci, cand in enumerate(candidates):
            logger.info("Evaluating candidate %d/%d (approach=%s, temp=%.1f)...",
                         ci + 1, len(candidates), cand["approach"], cand["temperature"])
            eval_result = _evaluate_candidate(
                cand["prompt"], eval_items, primary_evaluator, store, target_model
            )
            candidate_results.append({
                "candidate": cand,
                "eval": eval_result,
            })

        # --- Select best candidate ---
        best_candidate = max(
            candidate_results,
            key=lambda x: (x["eval"]["pass_rate"], x["eval"]["avg_score"])
        )
        cand_pass_rate = best_candidate["eval"]["pass_rate"]
        cand_avg_score = best_candidate["eval"]["avg_score"]

        iteration_result = {
            "iteration": iteration,
            "strategy": current_strategy,
            "candidates_evaluated": len(candidates),
            "pass_rate": cand_pass_rate,
            "avg_score": cand_avg_score,
            "total": best_candidate["eval"]["total"],
            "passed": best_candidate["eval"]["passed"],
            "failed": best_candidate["eval"]["failed"],
            "prompt_text": best_candidate["candidate"]["prompt"][:500],
            "changes_summary": best_candidate["candidate"]["changes_summary"],
            "confidence": best_candidate["candidate"]["confidence"],
            "approach": best_candidate["candidate"]["approach"],
        }

        # Update the standalone feedback variables for the NEXT iteration
        last_failed_cases = best_candidate["eval"]["failed_cases"]
        last_passed_cases = best_candidate["eval"]["passed_cases"]

        if cand_pass_rate > best_pass_rate or (
            cand_pass_rate == best_pass_rate and cand_avg_score > best_avg_score
        ):
            best_pass_rate = cand_pass_rate
            best_avg_score = cand_avg_score
            best_prompt = best_candidate["candidate"]["prompt"]
            no_improvement_count = 0
            strategies_tried_without_improvement.clear()

            ver_result = store.create_prompt_version(
                prompt_id=prompt_id,
                content=best_prompt,
                tags=[f"optimization-{run_id}", f"iter-{iteration}",
                      f"strategy-{current_strategy}", f"pass_rate-{cand_pass_rate}"],
            )
            version_number = ver_result.get("version_number") if ver_result else None
            iteration_result["new_version"] = version_number
            iteration_result["improvement"] = True

            logger.info("Improvement found! Pass rate: %.1f%% -> %.1f%% (v%s)",
                         iterations[-1]["pass_rate"], cand_pass_rate, version_number)
        else:
            no_improvement_count += 1
            iteration_result["improvement"] = False
            strategies_tried_without_improvement.add(current_strategy)
            logger.info("No improvement (%.1f%% vs best %.1f%%). Streak: %d, strategy: %s",
                         cand_pass_rate, best_pass_rate, no_improvement_count, current_strategy)

            # Rotate to next untried strategy
            next_strategy = None
            for s in STRATEGY_ROTATION_ORDER:
                if s not in strategies_tried_without_improvement:
                    next_strategy = s
                    break

            if next_strategy:
                logger.info("Rotating strategy: %s -> %s", current_strategy, next_strategy)
                current_strategy = next_strategy
                iteration_result["strategy_rotated_to"] = next_strategy
            else:
                logger.info("All strategies exhausted without improvement. Stopping.")
                iteration_result["stopped_reason"] = "all_strategies_exhausted"
                iterations.append(iteration_result)

                _upsert_run_progress(store, run_id, {
                    "iterations": iterations,
                    "current_phase": "completed",
                })
                break

        _create_experiment_record(
            store, run_id, iteration, prompt_id, dataset_id, all_evaluator_ids,
            primary_evaluator, best_candidate["eval"], prompt, experiments_created
        )

        iterations.append(iteration_result)

        _upsert_run_progress(store, run_id, {
            "iterations": iterations,
            "current_phase": "iteration_complete",
            "best_pass_rate": best_pass_rate,
        })

    initial_pass_rate = iterations[0]["pass_rate"] if iterations else 0
    final_pass_rate = best_pass_rate
    uplift = round(final_pass_rate - initial_pass_rate, 1)

    report = {
        "ok": True,
        "run_id": run_id,
        "prompt_id": prompt_id,
        "dataset_id": dataset_id,
        "evaluator_ids": all_evaluator_ids,
        "strategy": strategy,
        "iterations": iterations,
        "experiments": experiments_created,
        "initial_pass_rate": initial_pass_rate,
        "final_pass_rate": final_pass_rate,
        "uplift": uplift,
        "total_iterations": len(iterations),
        "completed_at": datetime.utcnow().isoformat(),
        "status": "completed",
    }

    _upsert_run_progress(store, run_id, {
        **report,
        "current_phase": "completed",
    })

    return report


def _create_experiment_record(store, run_id, iteration, prompt_id, dataset_id,
                               all_evaluator_ids, primary_evaluator, eval_result,
                               prompt, experiments_created):
    """Create an experiment record for audit trail."""
    try:
        exp_id = f"exp_{uuid.uuid4().hex[:10]}"
        exp_results = []
        for c in eval_result["passed_cases"] + eval_result["failed_cases"]:
            exp_results.append({
                "item_id": c.get("trace_id", ""),
                "input": c["input"],
                "actual_output": c.get("actual_output", ""),
                "expected_output": c.get("expected_output", ""),
                "avg_score": c["score"],
                "all_passed": c["passed"],
                "evaluator_scores": {primary_evaluator["evaluator_id"]: {
                    "score": c["score"], "passed": c["passed"],
                    "reasoning": c["reasoning"],
                }},
            })
        store.create_experiment({
            "experiment_id": exp_id,
            "name": f"Optimization {run_id} iter {iteration}",
            "product_id": prompt.get("product_id", "default"),
            "prompt_id": prompt_id,
            "dataset_id": dataset_id,
            "evaluator_ids": all_evaluator_ids,
            "status": "completed",
            "results": exp_results,
            "summary": {
                "total_items": eval_result["total"],
                "avg_score": eval_result["avg_score"],
                "pass_rate": eval_result["pass_rate"],
                "passed": eval_result["passed"],
                "failed": eval_result["failed"],
            },
        })
        experiments_created.append(exp_id)
    except Exception as e:
        logger.warning("Failed to create experiment record: %s", e)


def _build_strategy_message(strategy: str, current_prompt: str,
                             failures: list, successes: list,
                             target_model: str = None) -> str:
    parts = ["## Current Prompt\n```\n" + current_prompt + "\n```\n"]

    if strategy == "model_aware" and target_model:
        parts.append(f"## Target Model: {target_model}\n")

    if failures:
        parts.append(f"## Failed Test Cases ({len(failures)} failures — agent produced wrong output)\n")

        # Synthesize failure patterns before showing individual cases
        pattern_analysis = _synthesize_failure_patterns(failures)
        if pattern_analysis:
            parts.append("### Failure Pattern Analysis")
            parts.append(pattern_analysis)
            parts.append("")

        for i, f in enumerate(failures[:10], 1):
            parts.append(f"### Failure {i}")
            parts.append(f"**Input:** {f['input']}")
            parts.append(f"**Actual Output:** {f.get('actual_output', f.get('output', ''))}")
            if f.get("expected_output"):
                parts.append(f"**Expected Output:** {f['expected_output']}")
            parts.append(f"**Score:** {f['score']}")
            parts.append(f"**Judge Reasoning:** {f['reasoning']}")
            parts.append("")

    if successes:
        parts.append(f"\n## Successful Test Cases ({len(successes)} passed — preserve these behaviors)")
        for i, s in enumerate(successes[:5], 1):
            parts.append(f"\n### Success {i}")
            parts.append(f"**Input:** {s['input']}")
            parts.append(f"**Output:** {s.get('actual_output', s.get('output', ''))}")
            if s.get("expected_output"):
                parts.append(f"**Expected Output:** {s['expected_output']}")

    strategy_instructions = {
        "failure_driven": (
            "Analyze the failure patterns above. For EACH failure, determine the root cause "
            "(wrong category, wrong format, missing constraint, hallucination, etc.). "
            "Then write an improved prompt that adds explicit rules preventing each failure pattern. "
            "The improved prompt MUST produce different outputs on the failed inputs."
        ),
        "few_shot": (
            "Select the best 3-5 examples from successes that cover the most diverse input types. "
            "Also add synthetic examples for input types that appear in failures but not successes. "
            "Embed examples directly in the prompt before the main instructions."
        ),
        "instruction_refinement": (
            "Map each failure to the specific instruction that caused it. "
            "Replace vague language with precise rules. Add explicit output format requirements. "
            "Add a DO NOT section listing common mistakes from the failures."
        ),
        "variable_optimization": (
            "Optimize the template structure around any {{variable}} placeholders. "
            "Keep variables intact but improve surrounding text."
        ),
        "model_aware": (
            f"Adapt the prompt style for optimal performance with {target_model or 'the target model'}."
        ),
    }

    parts.append("\n## Task")
    parts.append(strategy_instructions.get(strategy, strategy_instructions["failure_driven"]))
    parts.append("\nReturn ONLY valid JSON as specified in the system message.")

    return "\n".join(parts)


def _synthesize_failure_patterns(failures: list) -> str:
    """Analyze failures and produce a structured summary of common error patterns."""
    if not failures:
        return ""

    lines = []

    # Build confusion matrix: expected -> actual mappings
    confusion = {}
    for f in failures:
        expected = str(f.get("expected_output", "")).strip().lower()[:100]
        actual = str(f.get("actual_output", f.get("output", ""))).strip().lower()[:100]
        if expected and actual:
            key = (expected, actual)
            confusion[key] = confusion.get(key, 0) + 1

    if confusion:
        lines.append("**Confusion matrix (Expected -> Actual, count):**")
        for (exp, act), count in sorted(confusion.items(), key=lambda x: -x[1]):
            lines.append(f"  - Expected '{exp}' but got '{act}' ({count}x)")

    # Group by common reasoning themes
    reasoning_keywords = {}
    for f in failures:
        reasoning = str(f.get("reasoning", "")).lower()
        for keyword in ["format", "category", "classif", "rout", "missing", "wrong",
                         "hallucin", "incomplete", "incorrect", "irrelevant"]:
            if keyword in reasoning:
                reasoning_keywords[keyword] = reasoning_keywords.get(keyword, 0) + 1

    if reasoning_keywords:
        top_issues = sorted(reasoning_keywords.items(), key=lambda x: -x[1])[:5]
        lines.append(f"\n**Top failure themes:** {', '.join(f'{k} ({v}x)' for k, v in top_issues)}")

    lines.append(f"\n**Total failures:** {len(failures)}")
    avg_score = sum(f.get("score", 0) for f in failures) / len(failures) if failures else 0
    lines.append(f"**Average failure score:** {avg_score:.1f}/100")

    return "\n".join(lines)


def _build_optimizer_message(current_prompt: str, failures: list, successes: list) -> str:
    return _build_strategy_message("failure_driven", current_prompt, failures, successes)


# ─────────────────────────────────────────────────────────────────────────────
# Auto-Best Orchestrator: runs ALL strategies and picks the winner
# ─────────────────────────────────────────────────────────────────────────────

ALL_STRATEGY_ORDER = [
    ("failure_driven", "Failure-Driven", "custom"),
    ("instruction_refinement", "Instruction Refinement", "custom"),
    ("few_shot", "Few-Shot", "custom"),
    ("dspy_bootstrap", "DSPy Bootstrap", "dspy"),
    ("dspy_mipro", "DSPy MIPROv2", "dspy"),
]


def run_all_strategies_optimization(
    store,
    prompt_id: str,
    dataset_id: str,
    evaluator_id: str,
    max_iterations: int = 4,
    optimizer_model: str = None,
    evaluator_ids: list = None,
    run_id: str = None,
) -> dict:
    """
    Run ALL optimization strategies (custom + DSPy) sequentially,
    pick the best result, and save the winning prompt as a new version.
    Progress is upserted after every step for frontend polling.
    """
    prompt = store.get_prompt_template(prompt_id)
    if not prompt:
        return {"ok": False, "error": "Prompt not found"}

    dataset = store.get_dataset(dataset_id)
    if not dataset:
        return {"ok": False, "error": "Dataset not found"}

    all_evaluator_ids = evaluator_ids or ([evaluator_id] if evaluator_id else [])
    evaluator_objs = [store.get_evaluator(eid) for eid in all_evaluator_ids]
    evaluator_objs = [e for e in evaluator_objs if e]
    if not evaluator_objs:
        return {"ok": False, "error": "No valid evaluators found"}

    primary_evaluator = evaluator_objs[0]

    items = store.get_dataset_items(dataset_id)
    if not items:
        return {"ok": False, "error": "Dataset has no items"}

    eval_items = items[:50]

    if not run_id:
        run_id = str(uuid.uuid4())[:12]

    if len(eval_items) < 5:
        logger.warning("Dataset has only %d items — results may be unreliable", len(eval_items))

    latest_versions = store.list_prompt_versions_for_template(prompt_id, limit=1)
    current_prompt_text = latest_versions[0].get("content", "") if latest_versions else ""
    if not current_prompt_text:
        return {"ok": False, "error": "Prompt has no version content"}

    target_model = os.getenv("CLUCO_OPTIMIZER_TARGET_MODEL", "gpt-4o-mini")
    opt_model = optimizer_model or os.getenv("CLUCO_OPTIMIZER_MODEL", "gpt-4o")

    _upsert_run_progress(store, run_id, {
        "status": "running",
        "prompt_id": prompt_id,
        "dataset_id": dataset_id,
        "evaluator_ids": all_evaluator_ids,
        "max_iterations": max_iterations,
        "dataset_item_count": len(eval_items),
        "current_phase": "baseline",
        "current_strategy": None,
        "strategies_completed": [],
        "created_at": datetime.utcnow(),
    })

    # --- Baseline ---
    logger.info("Auto-best: evaluating baseline for prompt %s with %d items", prompt_id, len(eval_items))
    baseline = _evaluate_candidate(current_prompt_text, eval_items, primary_evaluator, store, target_model)
    baseline_pass_rate = baseline["pass_rate"]

    baseline_item_results = []
    for c in baseline["passed_cases"] + baseline["failed_cases"]:
        baseline_item_results.append({
            "input": c["input"][:500],
            "expected": c["expected_output"][:500],
            "actual": c["actual_output"][:500],
            "score": c["score"],
            "passed": c["passed"],
            "reasoning": c["reasoning"][:500],
        })

    _upsert_run_progress(store, run_id, {
        "current_phase": "baseline_complete",
        "baseline_pass_rate": baseline_pass_rate,
        "baseline_avg_score": baseline["avg_score"],
        "baseline_total": baseline["total"],
        "baseline_passed": baseline["passed"],
        "baseline_failed": baseline["failed"],
        "baseline_items": baseline_item_results,
    })

    strategies_completed = []
    best_overall_rate = baseline_pass_rate
    best_overall_prompt = current_prompt_text
    best_overall_strategy = "baseline"
    best_overall_summary = "Original prompt"
    experiments_created = []

    iters_per_custom = max(1, min(max_iterations, 2))

    for strategy_id, strategy_label, strategy_type in ALL_STRATEGY_ORDER:
        logger.info("Auto-best: running strategy '%s' (%s)", strategy_id, strategy_type)

        _upsert_run_progress(store, run_id, {
            "current_phase": "strategy_running",
            "current_strategy": strategy_id,
            "strategies_completed": strategies_completed,
        })

        entry = {
            "strategy": strategy_id,
            "label": strategy_label,
            "type": strategy_type,
            "status": "running",
            "pass_rate": None,
            "changes_summary": "",
        }

        try:
            if strategy_type == "custom":
                result = _run_single_custom_strategy(
                    store=store,
                    strategy=strategy_id,
                    prompt_text=best_overall_prompt,
                    eval_items=eval_items,
                    primary_evaluator=primary_evaluator,
                    target_model=target_model,
                    optimizer_model=opt_model,
                    max_iterations=iters_per_custom,
                    baseline_failed=baseline["failed_cases"],
                    baseline_passed=baseline["passed_cases"],
                    baseline_pass_rate=baseline_pass_rate,
                )
            else:
                from app.dspy_optimizer import run_dspy_strategy

                def dspy_progress(phase):
                    _upsert_run_progress(store, run_id, {
                        "dspy_phase": phase,
                    })

                result = run_dspy_strategy(
                    strategy=strategy_id,
                    prompt_text=best_overall_prompt,
                    eval_items=eval_items,
                    evaluator_obj=primary_evaluator,
                    target_model=target_model,
                    optimizer_model=opt_model,
                    progress_callback=dspy_progress,
                    prompt_name=prompt.get("name", ""),
                    prompt_description=prompt.get("description", ""),
                )

            entry["status"] = result.get("status", "done")
            entry["pass_rate"] = result.get("pass_rate", 0)
            entry["changes_summary"] = result.get("changes_summary", "")
            entry["passed"] = result.get("passed")
            entry["failed"] = result.get("failed")
            entry["total"] = result.get("total")
            entry["item_results"] = result.get("item_results", [])
            entry["prompt_text"] = result.get("prompt_text", "")

            if entry["status"] == "done" and entry["pass_rate"] > best_overall_rate:
                best_overall_rate = entry["pass_rate"]
                best_overall_prompt = result.get("prompt_text", best_overall_prompt)
                best_overall_strategy = strategy_id
                best_overall_summary = result.get("changes_summary", "")
                entry["is_best"] = True
                logger.info("Auto-best: new leader '%s' with %.1f%%", strategy_id, entry["pass_rate"])

        except Exception as e:
            logger.error("Auto-best: strategy '%s' failed: %s", strategy_id, e)
            entry["status"] = "error"
            entry["changes_summary"] = str(e)

        strategies_completed.append(entry)

        _upsert_run_progress(store, run_id, {
            "strategies_completed": strategies_completed,
            "best_strategy": best_overall_strategy,
            "best_pass_rate": best_overall_rate,
        })

    # No auto-save: the user picks which strategy prompt to save from the UI

    uplift = round(best_overall_rate - baseline_pass_rate, 1)

    report = {
        "ok": True,
        "run_id": run_id,
        "prompt_id": prompt_id,
        "dataset_id": dataset_id,
        "evaluator_ids": all_evaluator_ids,
        "strategies_completed": strategies_completed,
        "baseline_pass_rate": baseline_pass_rate,
        "best_strategy": best_overall_strategy,
        "best_pass_rate": best_overall_rate,
        "initial_pass_rate": baseline_pass_rate,
        "final_pass_rate": best_overall_rate,
        "uplift": uplift,
        "experiments": [],
        "completed_at": datetime.utcnow().isoformat(),
        "status": "completed",
    }

    _upsert_run_progress(store, run_id, {
        **report,
        "current_phase": "completed",
        "current_strategy": None,
    })

    return report


def _run_single_custom_strategy(
    store,
    strategy: str,
    prompt_text: str,
    eval_items: list,
    primary_evaluator: dict,
    target_model: str,
    optimizer_model: str,
    max_iterations: int,
    baseline_failed: list,
    baseline_passed: list,
    baseline_pass_rate: float = 0,
) -> dict:
    """Run a single custom strategy for a fixed number of iterations.
    Returns dict with pass_rate, prompt_text, changes_summary, status."""

    best_prompt = prompt_text
    best_rate = baseline_pass_rate
    best_summary = ""
    last_failed = baseline_failed
    last_passed = baseline_passed
    n_candidates = 3
    improved = False

    for iteration in range(1, max_iterations + 1):
        candidates = _generate_candidates(
            strategy, best_prompt,
            last_failed[:10], last_passed[:5],
            n_candidates=n_candidates,
            optimizer_model=optimizer_model,
            target_model=target_model,
        )
        if not candidates:
            break

        candidate_results = []
        for cand in candidates:
            eval_result = _evaluate_candidate(
                cand["prompt"], eval_items, primary_evaluator, store, target_model
            )
            candidate_results.append({"candidate": cand, "eval": eval_result})

        winner = max(candidate_results, key=lambda x: (x["eval"]["pass_rate"], x["eval"]["avg_score"]))
        rate = winner["eval"]["pass_rate"]

        last_failed = winner["eval"]["failed_cases"]
        last_passed = winner["eval"]["passed_cases"]

        if rate > best_rate:
            best_rate = rate
            best_prompt = winner["candidate"]["prompt"]
            best_summary = winner["candidate"]["changes_summary"]
            improved = True

    item_results = []
    for c in (last_passed or []) + (last_failed or []):
        item_results.append({
            "input": c.get("input", "")[:500],
            "expected": c.get("expected_output", "")[:500],
            "actual": c.get("actual_output", "")[:500],
            "score": c.get("score", 0),
            "passed": c.get("passed", False),
            "reasoning": c.get("reasoning", "")[:500],
        })

    return {
        "status": "done",
        "pass_rate": best_rate,
        "prompt_text": best_prompt,
        "changes_summary": best_summary if improved else "No improvement over baseline",
        "passed": len(last_passed) if last_passed else 0,
        "failed": len(last_failed) if last_failed else 0,
        "total": (len(last_passed) + len(last_failed)) if last_passed is not None else 0,
        "item_results": item_results,
    }
