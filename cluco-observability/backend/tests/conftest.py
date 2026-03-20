"""Pytest configuration and fixtures for Cluco Observability tests."""
import os
import socket

import pytest


def _check_port(host: str, port: int) -> bool:
    """Check if a port is reachable."""
    try:
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        sock.settimeout(2)
        result = sock.connect_ex((host, port))
        sock.close()
        return result == 0
    except Exception:
        return False


@pytest.fixture(scope="session")
def services_available():
    """Check if MongoDB is available for integration tests."""
    mongo_uri = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
    host = "localhost"
    port = 27017
    if "://" in mongo_uri:
        parts = mongo_uri.split("://", 1)[1].split("/", 1)[0]
        if ":" in parts:
            host, port_str = parts.rsplit(":", 1)
            try:
                port = int(port_str)
            except ValueError:
                port = 27017
        else:
            host = parts
    return _check_port(host, port)


def pytest_configure(config):
    """Register custom markers."""
    config.addinivalue_line(
        "markers", "integration: mark test as integration test (requires MongoDB)"
    )
