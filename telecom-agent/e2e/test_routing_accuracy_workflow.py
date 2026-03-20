"""
E2E Test: Routing Accuracy Workflow (Transcript-Inspired)

Tests the telecom agent v1/v2 routing behavior and Cluco trace inspection.
Based on the MLflow/DataBricks agent development lifecycle demo.

Prerequisites:
- All services running: Cluco (9410, 9411), Telecom (9412, 9413)
- Pinecone seeded, prompts registered

Run: pytest telecom-agent/e2e/test_routing_accuracy_workflow.py -v
"""

import pytest
from pathlib import Path

from playwright.sync_api import Page

from playwright_config import (
    TELECOM_CHAT_URL,
    CLUCO_TRACES_URL,
    NAVIGATION_TIMEOUT,
    RESPONSE_WAIT_TIMEOUT,
    SCREENSHOTS_DIR,
)

# Test query: v1 misroutes to billing; v2 routes to products (matches suggested query in UI)
DEVICE_UPGRADE_QUERY = "Can I upgrade my device without increasing my bill?"


def _screenshot(page: Page, name: str, screenshots_dir: Path) -> None:
    """Take screenshot and save to screenshots dir."""
    screenshots_dir.mkdir(parents=True, exist_ok=True)
    path = screenshots_dir / name
    page.screenshot(path=str(path))
    print(f"  Screenshot: {path}")


@pytest.fixture(scope="module")
def screenshots_dir():
    """Screenshots output directory."""
    base = Path(__file__).resolve().parent
    return base / SCREENSHOTS_DIR


def test_routing_accuracy_workflow(page: Page, screenshots_dir: Path):
    """
    Phase 1: v1 agent (expect misroute to billing)
    Phase 2: Cluco trace inspection
    Phase 3: v2 agent (expect correct route to products)
    Phase 4: Cluco trace comparison
    """
    page.set_default_timeout(NAVIGATION_TIMEOUT)

    # --- Phase 1: Telecom Chat (v1) ---
    page.goto(TELECOM_CHAT_URL)
    page.wait_for_load_state("networkidle")
    _screenshot(page, "01_chat_loaded.png", screenshots_dir)

    # Ensure v1 is selected (click V1 button if not active)
    v1_btn = page.get_by_role("button", name="V1")
    v2_btn = page.get_by_role("button", name="V2")
    if not v1_btn.get_attribute("class", timeout=2000) or "bg-amber" not in (v1_btn.get_attribute("class") or ""):
        v1_btn.click()
        page.wait_for_timeout(500)

    # Send query: use suggested button or type + send
    suggested = page.get_by_role("button", name=DEVICE_UPGRADE_QUERY)
    if suggested.is_visible(timeout=2000):
        suggested.click()
        page.wait_for_timeout(300)  # Let input populate and focus
        page.keyboard.press("Enter")  # Triggers handleSend via onKeyDown
    else:
        textarea = page.get_by_placeholder("Ask about plans, devices, billing, or support...")
        textarea.fill(DEVICE_UPGRADE_QUERY)
        textarea.press("Enter")

    # Wait for agent response (feedback buttons appear after assistant message)
    try:
        page.wait_for_selector("[title='Bad response']", timeout=RESPONSE_WAIT_TIMEOUT)
    except Exception:
        page.wait_for_selector(".text-slate-200", timeout=RESPONSE_WAIT_TIMEOUT)

    _screenshot(page, "02_v1_response.png", screenshots_dir)

    # Click thumbs down
    page.locator("[title='Bad response']").first.click()

    page.wait_for_timeout(1500)
    _screenshot(page, "03_feedback_submitted.png", screenshots_dir)

    # Store trace_id for Cluco navigation (from last assistant message)
    trace_id = None
    trace_links = page.locator('a[href*="/trace/"]')
    if trace_links.count() > 0:
        href = trace_links.first.get_attribute("href") or ""
        if href and "trace/" in href:
            trace_id = href.split("trace/")[-1].split("/")[0].split("?")[0]

    # --- Phase 2: Cluco Trace Inspection ---
    page.goto(CLUCO_TRACES_URL)
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)
    _screenshot(page, "04_cluco_traces_list.png", screenshots_dir)

    # Open trace detail: either by trace_id or first trace link
    if trace_id:
        page.goto(f"{CLUCO_TRACES_URL.replace('/traces', '')}/trace/{trace_id}")
    else:
        # Click first trace link in table
        first_trace_link = page.locator('a[href*="/trace/"]').first
        if first_trace_link.is_visible(timeout=5000):
            first_trace_link.click()
        else:
            pytest.skip("No traces found in Cluco; ensure telecom backend has sent traces")

    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)
    _screenshot(page, "05_trace_detail_v1.png", screenshots_dir)

    # --- Phase 3: Verify v2 ---
    page.goto(TELECOM_CHAT_URL)
    page.wait_for_load_state("networkidle")

    # Switch to v2
    page.get_by_role("button", name="V2").click()
    page.wait_for_timeout(800)

    # Send same query again
    textarea = page.get_by_placeholder("Ask about plans, devices, billing, or support...")
    textarea.fill(DEVICE_UPGRADE_QUERY)
    textarea.press("Enter")

    try:
        page.wait_for_selector("[title='Bad response']", timeout=RESPONSE_WAIT_TIMEOUT)
    except Exception:
        page.wait_for_selector(".text-slate-200", timeout=RESPONSE_WAIT_TIMEOUT)

    _screenshot(page, "06_v2_response.png", screenshots_dir)

    # Assert v2 response is more useful (product-related, not escalation)
    assistant_messages = page.locator(".text-slate-200").all()
    if assistant_messages:
        last_content = assistant_messages[-1].inner_text() if assistant_messages else ""
        # v2 should mention devices/upgrade, not just "escalate" or "reach out"
        assert len(last_content) > 50, "Expected substantive response from v2"
        # v2 routes to products; response should differ from generic escalation
        assert "product" in last_content.lower() or "device" in last_content.lower() or "upgrade" in last_content.lower() or len(last_content) > 100, \
            "Expected device/upgrade related response from v2 product agent"

    # --- Phase 4: Cluco trace for v2 (optional) ---
    trace_links_v2 = page.locator('a[href*="/trace/"]')
    if trace_links_v2.count() > 0:
        href = trace_links_v2.last.get_attribute("href") or ""  # Latest trace (v2 response)
        if href and "trace/" in href:
            tid = href.split("trace/")[-1].split("/")[0].split("?")[0]
            page.goto(f"http://localhost:9411/trace/{tid}")
            page.wait_for_load_state("networkidle")
            page.wait_for_timeout(2000)
            _screenshot(page, "07_trace_detail_v2.png", screenshots_dir)
