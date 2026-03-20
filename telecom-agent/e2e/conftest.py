"""
Pytest configuration for E2E tests with Playwright.
Uses pytest-playwright for page fixture.
Enables video recording for demo capture.
"""

import pytest
from pathlib import Path

from playwright_config import TELECOM_CHAT_URL, VIDEO_DIR


@pytest.fixture(scope="session")
def browser_context_args(browser_context_args):
    """Configure browser context (viewport, base URL, video recording)."""
    e2e_dir = Path(__file__).resolve().parent
    video_dir = e2e_dir / VIDEO_DIR
    video_dir.mkdir(parents=True, exist_ok=True)
    return {
        **browser_context_args,
        "viewport": {"width": 1280, "height": 720},
        "ignore_https_errors": True,
        "record_video_dir": str(video_dir),
        "record_video_size": {"width": 1280, "height": 720},
    }


@pytest.fixture(scope="session")
def base_url():
    """Base URL for relative navigations (telecom chat)."""
    return TELECOM_CHAT_URL
