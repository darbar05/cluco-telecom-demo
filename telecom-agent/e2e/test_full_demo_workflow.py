"""
E2E Test: Full Demo Workflow

Bad prompt -> Response -> Feedback -> Evaluation -> AI Assistant ->
Shift traces to SME -> Prompt Optimizer -> Run evals and compare old vs optimized.

Flow:
1. Telecom chat: send query, get bad response, thumbs down
2. Cluco traces: filter by negative feedback, export to dataset
3. Create routing judge (if needed), run evaluation on dataset
4. Trace detail: open AI Assistant, run root cause analysis
5. Shift traces to labeling session (SME feedback)
6. Prompt registry: run prompt optimizer
7. Run evaluation with optimized prompt, compare old vs new

Prerequisites:
- All services: Cluco (9410, 9411), Telecom (9412, 9413)
- Pinecone seeded, prompts/judges registered (setup_kb.py)

Run with headed browser to watch the demo:
  pytest telecom-agent/e2e/test_full_demo_workflow.py -v --headed

Run with screenshots:
  pytest telecom-agent/e2e/test_full_demo_workflow.py -v -s
"""

import re
import pytest
from pathlib import Path

from playwright.sync_api import Page

from playwright_config import (
    TELECOM_CHAT_URL,
    CLUCO_UI_URL,
    CLUCO_TRACES_URL,
    NAVIGATION_TIMEOUT,
    RESPONSE_WAIT_TIMEOUT,
    SCREENSHOTS_DIR,
)

# Query that typically misroutes (device upgrade -> billing instead of products)
DEVICE_UPGRADE_QUERY = "Can I upgrade my device without increasing my bill?"


def _screenshot(page: Page, name: str, screenshots_dir: Path) -> None:
    """Take screenshot and save."""
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    path = screenshots_dir / name
    page.screenshot(path=str(path))
    print(f"  Screenshot: {path}")


def _wait(page: Page, ms: int = 1500) -> None:
    """Short wait for UI to stabilize."""
    page.wait_for_timeout(ms)


@pytest.fixture(scope="module")
def screenshots_dir():
    return Path(__file__).resolve().parent / SCREENSHOTS_DIR


def test_full_demo_workflow(page: Page, screenshots_dir: Path):
    """
    End-to-end: Bad prompt -> Feedback -> Evaluation -> AI Assistant ->
    SME labeling -> Prompt Optimizer -> Compare old vs optimized.
    """
    page.set_default_timeout(NAVIGATION_TIMEOUT)

    # -------------------------------------------------------------------------
    # Phase 1: Bad prompt -> Response -> Feedback
    # -------------------------------------------------------------------------
    page.goto(TELECOM_CHAT_URL)
    page.wait_for_load_state("networkidle")
    _wait(page, 1500)
    _screenshot(page, "01_telecom_chat_loaded.png", screenshots_dir)

    # Ensure V1 (bad routing) is selected
    v1_btn = page.get_by_role("button", name="V1")
    if v1_btn.is_visible(timeout=3000):
        v1_btn.click()
        _wait(page, 800)

    # Send query
    textarea = page.get_by_placeholder("Ask about plans, devices, billing, or support...")
    textarea.fill(DEVICE_UPGRADE_QUERY)
    textarea.press("Enter")

    # Wait for response
    page.wait_for_selector("[title='Bad response']", timeout=RESPONSE_WAIT_TIMEOUT)
    _wait(page, 1000)
    _screenshot(page, "02_bad_response.png", screenshots_dir)

    # Thumbs down
    page.locator("[title='Bad response']").first.click()
    _wait(page, 1500)
    _screenshot(page, "03_feedback_submitted.png", screenshots_dir)

    # Extract trace_id for later
    trace_id = None
    trace_links = page.locator('a[href*="/trace/"]')
    if trace_links.count() > 0:
        href = trace_links.first.get_attribute("href") or ""
        if "trace/" in href:
            trace_id = href.split("trace/")[-1].split("/")[0].split("?")[0]

    # Wait for trace to be ingested in Cluco
    _wait(page, 5000)

    # -------------------------------------------------------------------------
    # Phase 2: Cluco traces -> filter negative -> export to dataset
    # -------------------------------------------------------------------------
    page.goto(CLUCO_TRACES_URL)
    page.wait_for_load_state("networkidle")
    _wait(page, 3000)
    _screenshot(page, "04_traces_list.png", screenshots_dir)

    # Open filter panel (button text is "Filters" or "Filters (1)")
    filter_btn = page.locator("button").filter(has_text="Filter")
    if filter_btn.first.is_visible(timeout=3000):
        filter_btn.first.click()
        _wait(page, 800)

    # Filter by user_feedback = False
    # Filter panel has 3 selects: [0]=Column(disabled), [1]=Name, [2]=Value
    selects = page.locator(".rounded-lg.border.border-slate-200 select")
    if selects.count() >= 3:
        selects.nth(1).select_option(value="user_feedback")
        _wait(page, 300)
        selects.nth(2).select_option(value="False")
        _wait(page, 300)
    apply_btn = page.get_by_role("button", name="Apply filters")
    if apply_btn.is_visible(timeout=2000):
        apply_btn.click()
    _wait(page, 3000)
    _screenshot(page, "05_filtered_negative_feedback.png", screenshots_dir)

    # Select first trace checkbox
    first_checkbox = page.locator("table tbody input[type='checkbox']").first
    if first_checkbox.is_visible(timeout=5000):
        first_checkbox.check()
        _wait(page, 500)

    # Actions -> Add to evaluation dataset
    actions_btn = page.locator("button").filter(has_text="Actions")
    if actions_btn.is_visible(timeout=5000):
        actions_btn.first.click()
        _wait(page, 500)
        add_dataset_btn = page.locator("button").filter(has_text="evaluation dataset")
        if add_dataset_btn.is_visible(timeout=3000):
            add_dataset_btn.first.click()
    _wait(page, 800)

    # In modal: Create new dataset
    dataset_input = page.locator('input[placeholder="Dataset name"]')
    if dataset_input.is_visible(timeout=5000):
        dataset_input.fill("Routing Failures Demo")
        create_btn = page.locator("button").filter(has_text="Create & Export")
        if create_btn.is_visible(timeout=3000):
            create_btn.click()
    _wait(page, 3000)
    _screenshot(page, "06_dataset_created.png", screenshots_dir)

    # -------------------------------------------------------------------------
    # Phase 3: Run Evaluation
    # -------------------------------------------------------------------------
    page.goto(f"{CLUCO_UI_URL}/evaluations/run")
    page.wait_for_load_state("networkidle")
    _wait(page, 2000)
    _screenshot(page, "07_run_evaluation.png", screenshots_dir)

    # Step 0: Select mode "Evaluate against Dataset"
    mode_card = page.locator('[role="button"][aria-label="Evaluate against Dataset"]')
    if mode_card.is_visible(timeout=5000):
        mode_card.click()
        _wait(page, 500)
    _screenshot(page, "08_evaluation_mode_selected.png", screenshots_dir)

    # Click Next to advance to Step 1 (Select Target)
    next_btn = page.get_by_role("button", name="Next")
    if next_btn.is_visible(timeout=3000):
        next_btn.click()
        _wait(page, 1000)

    # Step 1: Select dataset (use .first in case duplicates exist)
    ds_card = page.locator('[role="button"][aria-label="Routing Failures Demo"]').first
    if not ds_card.is_visible(timeout=3000):
        ds_card = page.locator('[role="button"]').filter(has_text="Routing Failures").first
    if ds_card.is_visible(timeout=5000):
        ds_card.click()
        _wait(page, 500)

    # Click Next to advance to Step 2 (Pick Evaluators)
    next_btn2 = page.get_by_role("button", name="Next")
    if next_btn2.is_visible(timeout=3000):
        next_btn2.click()
        _wait(page, 1000)

    # Step 2: Select evaluator (pick one with "routing" in name, or first available)
    ev_card = page.locator('[role="button"]').filter(has_text="routing_accuracy")
    if not ev_card.first.is_visible(timeout=3000):
        ev_card = page.locator('[role="button"]').filter(has_text="Routing")
    if not ev_card.first.is_visible(timeout=3000):
        ev_card = page.locator('div[role="button"][aria-label]').first
    if ev_card.first.is_visible(timeout=5000):
        ev_card.first.click()
        _wait(page, 500)

    # Click Next to advance to Step 3 (Review & Run)
    next_btn3 = page.get_by_role("button", name="Next")
    if next_btn3.is_visible(timeout=3000):
        next_btn3.click()
        _wait(page, 1000)

    # Step 3: Click "Run Evaluation"
    run_eval_btn = page.get_by_role("button", name="Run Evaluation")
    if run_eval_btn.is_visible(timeout=5000):
        run_eval_btn.click()
        _wait(page, 5000)
    _screenshot(page, "09_evaluation_running.png", screenshots_dir)

    # Wait for eval to complete
    page.wait_for_timeout(20000)
    _screenshot(page, "10_evaluation_results.png", screenshots_dir)

    # -------------------------------------------------------------------------
    # Phase 4: AI Assistant (root cause analysis)
    # -------------------------------------------------------------------------
    if trace_id:
        page.goto(f"{CLUCO_UI_URL}/trace/{trace_id}")
    else:
        page.goto(CLUCO_TRACES_URL)
        page.wait_for_load_state("networkidle")
        _wait(page, 2000)
        first_link = page.locator('a[href*="/trace/"]').first
        if first_link.is_visible(timeout=5000):
            first_link.click()

    page.wait_for_load_state("networkidle")
    _wait(page, 2000)
    _screenshot(page, "11_trace_detail.png", screenshots_dir)

    # Open Debug with AI
    debug_btn = page.get_by_role("button", name="Debug with AI")
    if debug_btn.is_visible(timeout=5000):
        debug_btn.click()
        _wait(page, 1000)
        # Click suggested question about routing (target only <button> elements, not SVG graph nodes)
        suggested = page.locator("button").filter(has_text=re.compile(r"query routed", re.IGNORECASE))
        if suggested.first.is_visible(timeout=5000):
            suggested.first.click()
        else:
            ask_input = page.locator('input[placeholder*="Ask"]')
            if ask_input.is_visible(timeout=3000):
                ask_input.fill("What is the root cause of the routing issue?")
                ask_input.press("Enter")
        _wait(page, 15000)
    _screenshot(page, "12_ai_assistant_root_cause.png", screenshots_dir)

    # -------------------------------------------------------------------------
    # Phase 5: Shift traces to SME (labeling session)
    # -------------------------------------------------------------------------
    page.goto(CLUCO_TRACES_URL)
    page.wait_for_load_state("networkidle")
    _wait(page, 2000)

    # Re-locate filter elements (previous refs are stale after navigation)
    filter_btn5 = page.locator("button").filter(has_text="Filter")
    if filter_btn5.first.is_visible(timeout=3000):
        filter_btn5.first.click()
        _wait(page, 800)
    selects5 = page.locator(".rounded-lg.border.border-slate-200 select")
    if selects5.count() >= 3:
        selects5.nth(1).select_option(value="user_feedback")
        _wait(page, 300)
        selects5.nth(2).select_option(value="False")
        _wait(page, 300)
    apply_btn5 = page.get_by_role("button", name="Apply filters")
    if apply_btn5.is_visible(timeout=2000):
        apply_btn5.click()
    _wait(page, 3000)

    cb5 = page.locator("table tbody input[type='checkbox']").first
    if cb5.is_visible(timeout=5000):
        cb5.check()
        _wait(page, 500)
    actions_btn5 = page.locator("button").filter(has_text="Actions")
    if actions_btn5.first.is_visible(timeout=5000):
        actions_btn5.first.click()
        _wait(page, 500)
        labeling_btn = page.locator("button").filter(has_text="labeling session")
        if labeling_btn.first.is_visible(timeout=3000):
            labeling_btn.first.click()
    _wait(page, 800)

    session_input = page.locator('input[placeholder="Session name"]')
    if session_input.is_visible(timeout=5000):
        session_input.fill("SME Review - Routing Failures")
        create_add_btn = page.locator("button").filter(has_text="Create & Add")
        if create_add_btn.is_visible(timeout=3000):
            create_add_btn.click()
        _wait(page, 2500)
    _screenshot(page, "13_labeling_session_created.png", screenshots_dir)

    # -------------------------------------------------------------------------
    # Phase 6: Prompt Optimizer
    # -------------------------------------------------------------------------
    page.goto(f"{CLUCO_UI_URL}/prompt-registry")
    page.wait_for_load_state("networkidle")
    _wait(page, 2000)
    _screenshot(page, "14_prompt_registry.png", screenshots_dir)

    # Open routing prompt (first row or one with "router" in name)
    prompt_row = page.locator('tr').filter(has_text="Router").first
    if not prompt_row.is_visible(timeout=5000):
        prompt_row = page.locator("tbody tr").first
    if prompt_row.is_visible(timeout=5000):
        prompt_row.click()
        _wait(page, 2000)
    _screenshot(page, "15_prompt_selected.png", screenshots_dir)

    # Click Optimize to open modal
    optimize_btn = page.get_by_role("button", name="Optimize")
    if optimize_btn.is_visible(timeout=5000):
        optimize_btn.click()
        _wait(page, 1500)

        # Modal has <select> dropdowns for dataset and evaluator
        modal_selects = page.locator(".fixed select")
        if modal_selects.count() >= 2:
            # First select: Evaluation Dataset -- pick one containing "Routing Failures"
            modal_selects.nth(0).select_option(index=1)
            _wait(page, 300)
            # Second select: Judge (Evaluator) -- pick first available
            modal_selects.nth(1).select_option(index=1)
            _wait(page, 300)
        _screenshot(page, "15b_optimize_modal_configured.png", screenshots_dir)

        # Click "Start Optimization"
        start_opt_btn = page.get_by_role("button", name="Start Optimization")
        if start_opt_btn.is_visible(timeout=3000):
            start_opt_btn.click()

        # Wait for optimization to complete (can take 30-90s)
        _wait(page, 60000)
    _screenshot(page, "16_optimization_complete.png", screenshots_dir)

    # -------------------------------------------------------------------------
    # Phase 7: Run evals and compare old vs optimized
    # -------------------------------------------------------------------------
    page.goto(f"{CLUCO_UI_URL}/evaluations/run")
    page.wait_for_load_state("networkidle")
    _wait(page, 2000)
    _screenshot(page, "17_run_eval_with_optimized.png", screenshots_dir)

    # Re-locate all elements (previous refs are stale after navigation)
    # Step 0: Select mode
    mode7 = page.locator('[role="button"][aria-label="Evaluate against Dataset"]')
    if mode7.is_visible(timeout=5000):
        mode7.click()
        _wait(page, 500)

    # Step 0 -> Step 1
    nxt7a = page.get_by_role("button", name="Next")
    if nxt7a.is_visible(timeout=3000):
        nxt7a.click()
        _wait(page, 1000)

    # Step 1: Select dataset
    ds7 = page.locator('[role="button"]').filter(has_text="Routing Failures").first
    if ds7.is_visible(timeout=5000):
        ds7.click()
        _wait(page, 500)

    # Step 1 -> Step 2
    nxt7b = page.get_by_role("button", name="Next")
    if nxt7b.is_visible(timeout=3000):
        nxt7b.click()
        _wait(page, 1000)

    # Step 2: Select evaluator
    ev7 = page.locator('[role="button"]').filter(has_text="routing_accuracy")
    if not ev7.first.is_visible(timeout=3000):
        ev7 = page.locator('[role="button"]').filter(has_text="Routing")
    if not ev7.first.is_visible(timeout=3000):
        ev7 = page.locator('div[role="button"][aria-label]').first
    if ev7.first.is_visible(timeout=5000):
        ev7.first.click()
        _wait(page, 500)

    # Step 2 -> Step 3
    nxt7c = page.get_by_role("button", name="Next")
    if nxt7c.is_visible(timeout=3000):
        nxt7c.click()
        _wait(page, 1000)

    # Step 3: Run Evaluation
    run7 = page.get_by_role("button", name="Run Evaluation")
    if run7.is_visible(timeout=5000):
        run7.click()
        _wait(page, 5000)

    # Wait for eval to complete
    page.wait_for_timeout(20000)
    _screenshot(page, "18_eval_optimized_results.png", screenshots_dir)

    # Navigate to Experiments page
    page.goto(f"{CLUCO_UI_URL}/evaluations/experiments")
    page.wait_for_load_state("networkidle")
    _wait(page, 3000)
    _screenshot(page, "19_experiments.png", screenshots_dir)

    # Select the first 2 experiments for comparison
    exp_checkboxes = page.locator("table tbody input[type='checkbox']")
    if exp_checkboxes.count() >= 2:
        exp_checkboxes.nth(0).check()
        _wait(page, 300)
        exp_checkboxes.nth(1).check()
        _wait(page, 500)

    # Click "Compare Selected (2)"
    compare_btn = page.locator("button").filter(has_text="Compare Selected")
    if compare_btn.is_visible(timeout=5000):
        compare_btn.click()
        _wait(page, 3000)
    _screenshot(page, "20_compare_old_vs_optimized.png", screenshots_dir)
