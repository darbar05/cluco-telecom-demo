"""
E2E test configuration for telecom-agent + Cluco.
"""

# Base URLs for services (must be running before tests)
TELECOM_CHAT_URL = "http://localhost:9413"
CLUCO_UI_URL = "http://localhost:9411"
CLUCO_TRACES_URL = "http://localhost:9411/traces"

# Timeouts (ms)
NAVIGATION_TIMEOUT = 30000
RESPONSE_WAIT_TIMEOUT = 60000  # Agent responses can take time
ACTION_TIMEOUT = 10000

# Screenshot output directory (relative to e2e/)
SCREENSHOTS_DIR = "screenshots"

# Video output directory (for demo recording)
VIDEO_DIR = "videos"
