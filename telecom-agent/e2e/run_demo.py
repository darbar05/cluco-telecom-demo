"""
Run Full Demo Workflow: Start services (if needed), health check, run E2E test.
Produces screenshots + video for demo use.

Usage:
  python run_demo.py              # Assumes services already running
  python run_demo.py --start      # Start services first, then run (Windows)
  python run_demo.py --setup-kb   # Run setup_kb.py before test
"""

import argparse
import subprocess
import sys
import time
from pathlib import Path

# Service URLs and health endpoints
SERVICES = [
    ("Cluco Backend", "http://localhost:9410/api/v1/health", 9410),
    ("Cluco UI", "http://localhost:9411", 9411),
    ("Telecom Backend", "http://localhost:9412/health", 9412),
    ("Telecom Chat UI", "http://localhost:9413", 9413),
]

SCRIPT_DIR = Path(__file__).resolve().parent
DEMO_ROOT = SCRIPT_DIR.parent.parent  # demo/


def check_port(port: int) -> bool:
    """Check if a port is open on localhost."""
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.settimeout(2)
        r = s.connect_ex(("127.0.0.1", port))
        s.close()
        return r == 0
    except Exception:
        return False


def check_http(url: str) -> bool:
    """Check if HTTP endpoint responds."""
    try:
        from urllib.request import urlopen
        with urlopen(url, timeout=3) as _:
            return True
    except Exception:
        return False


def wait_for_services(max_wait_sec: int = 120) -> bool:
    """Wait for all services to be ready."""
    print("Waiting for services...")
    start = time.time()
    last_status = []
    while (time.time() - start) < max_wait_sec:
        all_up = True
        status = []
        for name, url, port in SERVICES:
            # Try HTTP first, fallback to port check
            up = check_http(url) if "http" in url else check_port(port)
            status.append((name, up))
            if not up:
                all_up = False
        if all_up:
            print("\nAll services are ready!")
            return True
        # Print status every 5 sec
        if status != last_status:
            line = "  " + " | ".join(f"{n}: {'OK' if u else '---'}" for n, u in status)
            print(line)
            last_status = status
        time.sleep(3)
    print("\nTimeout: not all services became ready.")
    return False


def start_services():
    """Start services via start-local.bat (spawns new windows)."""
    bat = DEMO_ROOT / "start-local.bat"
    if not bat.exists():
        print(f"start-local.bat not found at {bat}")
        return False
    print("Starting services (new windows will open)...")
    subprocess.Popen(
        ["cmd", "/c", "start", "Local Services", str(bat)],
        cwd=str(DEMO_ROOT),
        shell=True,
    )
    return True


def run_setup_kb() -> bool:
    """Run setup_kb.py to seed Pinecone, prompts, judges."""
    setup = DEMO_ROOT / "telecom-agent" / "backend" / "setup_kb.py"
    if not setup.exists():
        print(f"setup_kb.py not found at {setup}")
        return False
    print("Running setup_kb.py...")
    venv_python = DEMO_ROOT / "telecom-agent" / "backend" / "venv" / "Scripts" / "python.exe"
    python = str(venv_python) if venv_python.exists() else sys.executable
    r = subprocess.run(
        [python, str(setup)],
        cwd=str(setup.parent),
        capture_output=True,
        text=True,
        timeout=120,
    )
    if r.returncode != 0:
        print("setup_kb failed:", r.stderr or r.stdout)
        return False
    print("setup_kb completed.")
    return True


def run_pytest() -> int:
    """Run the full demo E2E test with video recording."""
    print("\nRunning E2E test (screenshots + video)...")
    screenshots = SCRIPT_DIR / "screenshots"
    videos = SCRIPT_DIR / "videos"
    screenshots.mkdir(parents=True, exist_ok=True)
    videos.mkdir(parents=True, exist_ok=True)

    r = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            str(SCRIPT_DIR / "test_full_demo_workflow.py"),
            "-v",
            "-s",
            "--headed",
        ],
        cwd=str(SCRIPT_DIR),
        timeout=300,
    )
    print(f"\nScreenshots: {screenshots}")
    print(f"Videos: {videos}")
    return r.returncode


def main():
    ap = argparse.ArgumentParser(description="Run full demo E2E test")
    ap.add_argument("--start", action="store_true", help="Start services before running")
    ap.add_argument("--setup-kb", action="store_true", help="Run setup_kb.py before test")
    ap.add_argument("--skip-wait", action="store_true", help="Skip health check (assume services up)")
    args = ap.parse_args()

    if args.start:
        start_services()
        print("Waiting 15s for services to initialize...")
        time.sleep(15)

    if not args.skip_wait and not wait_for_services():
        print("\nStart services manually: run start-local.bat (or start-docker.bat)")
        print("Then run: python run_demo.py --skip-wait")
        return 1

    if args.setup_kb:
        if not run_setup_kb():
            return 1
        time.sleep(2)

    return run_pytest()


if __name__ == "__main__":
    sys.exit(main())
