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

OPTIMIZER_SYSTEM_PROMPT = """You are an expert prompt engineer. Your job is to improve prompts for AI agents based on evaluation failures.

You will be given:
1. The current prompt template
2. A list of test cases where the agent failed (with inputs, ACTUAL agent outputs, and judge reasoning)
3. A list of test cases where the agent succeeded

Analyze the failure patterns carefully. The "Output" field shows what the agent ACTUALLY produced with the current prompt. The "Expected" field shows what the correct output should be. The judge reasoning explains why the output was scored poorly.

Propose an improved version of the prompt that addresses the identified failure patterns while preserving the successful behaviors.

Return ONLY valid JSON with these fields:
{
  "improved_prompt": "<the full improved prompt text>",
  "changes_summary": "<brief description of what changed and why>",
  "confidence": <0-100 number indicating your confidence this will improve results>
}"""

FEW_SHOT_SYSTEM_PROMPT = """You are an expert prompt engineer. Your job is to enhance a prompt by selecting the best few-shot examples from successful test cases.

You will be given:
1. The current prompt template
2. A list of successful test cases (input/output pairs)
3. A list of failed test cases

Select 3-5 of the best examples that demonstrate ideal behavior and create an enhanced prompt with those examples embedded.

Return ONLY valid JSON:
{
  "improved_prompt": "<the full prompt with few-shot examples included>",
  "changes_summary": "<which examples were selected and why>",
  "confidence": <0-100>
}"""

INSTRUCTION_REFINEMENT_PROMPT = """You are an expert prompt engineer specializing in precise instruction writing.

You will be given:
1. The current prompt template  
2. Evaluation feedback showing which instructions were followed/ignored
3. Failed test cases with judge reasoning

Refine the instructions to be clearer, more specific, and better structured. Focus on:
- Making ambiguous instructions explicit
- Adding constraints that prevent observed failures
- Improving the logical flow of instructions

Return ONLY valid JSON:
{
  "improved_prompt": "<the refined prompt>",
  "changes_summary": "<which instructions were refined and why>",
  "confidence": <0-100>
}"""

VARIABLE_OPTIMIZATION_PROMPT = """You are an expert prompt engineer. Your job is to optimize a prompt template that uses variables.

You will be given:
1. The current prompt template with {{variable}} placeholders
2. Test cases showing how variables are filled and the resulting quality
3. Failed cases showing where the template structure caused issues

Optimize the template structure around the variables to improve output quality.

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


def _call_optimizer_llm(system_prompt: str, user_message: str, model: str = None,
                        temperature: float = 0.3) -> dict:
    api_key = os.getenv("OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    from langchain_openai import ChatOpenAI
    from langchain_core.messages import SystemMessage, HumanMessage

    model = model or os.getenv("CLUCO_OPTIMIZER_MODEL", "gpt-4o-mini")
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

    for item in items:
        user_input = str(item.get("input", ""))
        expected_output = str(item.get("expected_output", ""))

        try:
            actual_output = _run_prompt_on_input(candidate_prompt, user_input, target_model)
        except Exception as e:
            logger.warning("Failed to run prompt on input: %s", e)
            continue

        ctx = TraceContext(
            trace_id=item.get("trace_id", "optimizer_synthetic"),
            final_input=user_input,
            final_output=actual_output,
        )

        try:
            result = run_single_evaluator(
                evaluator_obj, ctx,
                expected_output=expected_output,
            )
            entry = {
                "trace_id": item.get("trace_id", "synthetic"),
                "input": user_input[:300],
                "actual_output": actual_output[:300],
                "expected_output": expected_output[:300],
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
            continue

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


def run_optimization(
    store,
    prompt_id: str,
    dataset_id: str,
    evaluator_id: str,
    max_iterations: int = 4,
    optimizer_model: str = None,
    strategy: str = "failure_driven",
    evaluator_ids: list = None,
) -> dict:
    """
    DSPy-inspired prompt optimization loop with experiment tracking.

    Each iteration:
      1. Generate N candidate prompts (temperature diversity)
      2. Re-run the LLM with each candidate on every dataset item
      3. Evaluate actual outputs with the judge
      4. Select the best candidate (metric-driven)
      5. Save as new prompt version if better than current best
      6. Early-stop if no improvement for 2 consecutive iterations
    """
    from app.evaluation_engine import TraceContext, run_single_evaluator

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

    run_id = str(uuid.uuid4())[:12]

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

    _create_experiment_record(
        store, run_id, 0, prompt_id, dataset_id, all_evaluator_ids,
        primary_evaluator, baseline, prompt, experiments_created
    )

    for iteration in range(1, max_iterations + 1):
        logger.info("Optimization iteration %d/%d [%s] for prompt %s",
                     iteration, max_iterations, strategy, prompt_id)

        if best_pass_rate >= 95:
            logger.info("Target pass rate reached (%.1f%%). Stopping.", best_pass_rate)
            iterations.append({
                "iteration": iteration,
                "strategy": strategy,
                "stopped_reason": "target_reached",
                "pass_rate": best_pass_rate,
                "avg_score": best_avg_score,
            })
            break

        prev_failures = baseline["failed_cases"] if iteration == 1 else \
            iterations[-1].get("_failed_cases", baseline["failed_cases"])
        prev_successes = baseline["passed_cases"] if iteration == 1 else \
            iterations[-1].get("_passed_cases", baseline["passed_cases"])

        candidates = _generate_candidates(
            strategy, best_prompt,
            prev_failures[:10], prev_successes[:5],
            n_candidates=n_candidates,
            optimizer_model=optimizer_model,
            target_model=target_model,
        )

        if not candidates:
            logger.warning("No candidates generated at iteration %d", iteration)
            iterations.append({
                "iteration": iteration,
                "strategy": strategy,
                "stopped_reason": "no_candidates_generated",
                "pass_rate": best_pass_rate,
                "avg_score": best_avg_score,
            })
            break

        # --- Evaluate each candidate (DSPy-style metric-driven selection) ---
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
            "strategy": strategy,
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
            "_failed_cases": best_candidate["eval"]["failed_cases"],
            "_passed_cases": best_candidate["eval"]["passed_cases"],
        }

        if cand_pass_rate > best_pass_rate or (
            cand_pass_rate == best_pass_rate and cand_avg_score > best_avg_score
        ):
            best_pass_rate = cand_pass_rate
            best_avg_score = cand_avg_score
            best_prompt = best_candidate["candidate"]["prompt"]
            no_improvement_count = 0

            ver_result = store.create_prompt_version(
                prompt_id=prompt_id,
                content=best_prompt,
                tags=[f"optimization-{run_id}", f"iter-{iteration}",
                      f"strategy-{strategy}", f"pass_rate-{cand_pass_rate}"],
            )
            version_number = ver_result.get("version_number") if ver_result else None
            iteration_result["new_version"] = version_number
            iteration_result["improvement"] = True

            logger.info("Improvement found! Pass rate: %.1f%% -> %.1f%% (v%s)",
                         iterations[-1]["pass_rate"], cand_pass_rate, version_number)
        else:
            no_improvement_count += 1
            iteration_result["improvement"] = False
            logger.info("No improvement (%.1f%% vs best %.1f%%). Streak: %d",
                         cand_pass_rate, best_pass_rate, no_improvement_count)

        _create_experiment_record(
            store, run_id, iteration, prompt_id, dataset_id, all_evaluator_ids,
            primary_evaluator, best_candidate["eval"], prompt, experiments_created
        )

        clean_result = {k: v for k, v in iteration_result.items()
                        if not k.startswith("_")}
        iterations.append(clean_result)

        if no_improvement_count >= 2:
            logger.info("No improvement for %d consecutive iterations. Stopping.",
                         no_improvement_count)
            clean_result["stopped_reason"] = "no_improvement_plateau"
            break

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
    }

    try:
        store._db["optimization_runs"].insert_one({
            **report,
            "_id": run_id,
            "created_at": datetime.utcnow(),
        })
    except Exception:
        pass

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
        parts.append("## Failed Test Cases (agent produced wrong output)")
        for i, f in enumerate(failures[:10], 1):
            parts.append(f"\n### Failure {i}")
            parts.append(f"Input: {f['input']}")
            parts.append(f"Actual Output: {f.get('actual_output', f.get('output', ''))}")
            if f.get("expected_output"):
                parts.append(f"Expected Output: {f['expected_output']}")
            parts.append(f"Score: {f['score']}")
            parts.append(f"Judge Reasoning: {f['reasoning']}")

    if successes:
        parts.append("\n## Successful Test Cases (preserve these behaviors)")
        for i, s in enumerate(successes[:5], 1):
            parts.append(f"\n### Success {i}")
            parts.append(f"Input: {s['input']}")
            parts.append(f"Output: {s.get('actual_output', s.get('output', ''))}")

    strategy_instructions = {
        "failure_driven": "Propose an improved version that fixes the failures while preserving successful behaviors.",
        "few_shot": "Select the best 3-5 examples from successes and create an enhanced prompt with them embedded as demonstrations.",
        "instruction_refinement": "Refine the instructions to be clearer and more specific. Focus on preventing the observed failure patterns.",
        "variable_optimization": "Optimize the template structure around any {{variable}} placeholders. Keep variables intact but improve surrounding text.",
        "model_aware": f"Adapt the prompt style for optimal performance with {target_model or 'the target model'}.",
    }

    parts.append("\n## Task")
    parts.append(strategy_instructions.get(strategy, strategy_instructions["failure_driven"]))
    parts.append("Return ONLY valid JSON as specified.")

    return "\n".join(parts)


def _build_optimizer_message(current_prompt: str, failures: list, successes: list) -> str:
    return _build_strategy_message("failure_driven", current_prompt, failures, successes)
