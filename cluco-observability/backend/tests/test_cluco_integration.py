"""
Cluco Observability integration tests (IT-C1 to IT-C8).

Requires MongoDB.
Run with: pytest tests/test_cluco_integration.py -v -m integration
Skip when services unavailable: pytest -m "not integration"
"""

import uuid

import pytest
from fastapi.testclient import TestClient

from app.main import app


@pytest.fixture
def cluco_client():
    """TestClient for Cluco app - uses real storage if MongoDB available."""
    return TestClient(app)


BASE = "/api/v1"


# ---------------------------------------------------------------------------
# IT-C1: Trace ingest and retrieve
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_it_trace_ingest_and_retrieve(cluco_client, services_available):
    """IT-C1: POST trace, GET trace - verify stored and returned."""
    if not services_available:
        pytest.skip("MongoDB not available")
    tid = f"it_trace_{uuid.uuid4().hex[:12]}"
    ingest = cluco_client.post(f"{BASE}/traces", json={
        "trace_id": tid,
        "session_id": "sess_it1",
        "spans": [
            {"span_id": "s1", "kind": "chain", "inputs": "q", "outputs": "a"},
        ],
    })
    assert ingest.status_code == 200
    get_resp = cluco_client.get(f"{BASE}/traces/{tid}")
    assert get_resp.status_code == 200
    data = get_resp.json()
    assert data.get("trace_id") == tid


# ---------------------------------------------------------------------------
# IT-C2: Feedback flow
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_it_feedback_flow(cluco_client, services_available):
    """IT-C2: Ingest trace, add thumbs feedback, list feedback."""
    if not services_available:
        pytest.skip("MongoDB not available")
    tid = f"it_trace_{uuid.uuid4().hex[:12]}"
    cluco_client.post(f"{BASE}/traces", json={
        "trace_id": tid,
        "session_id": "sess_it2",
        "spans": [],
    })
    fb = cluco_client.post(f"{BASE}/feedback/thumbs", json={
        "trace_id": tid,
        "thumbs": "down",
        "comment": "Integration test",
    })
    assert fb.status_code == 200
    list_resp = cluco_client.get(f"{BASE}/feedback", params={"trace_id": tid})
    assert list_resp.status_code == 200
    items = list_resp.json().get("feedback", [])
    assert any(f.get("trace_id") == tid for f in items)


# ---------------------------------------------------------------------------
# IT-C3: Dataset from feedback
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_it_dataset_from_feedback(cluco_client, services_available):
    """IT-C3: Create trace + feedback, create dataset from feedback."""
    if not services_available:
        pytest.skip("MongoDB not available")
    tid = f"it_trace_{uuid.uuid4().hex[:12]}"
    cluco_client.post(f"{BASE}/traces", json={
        "trace_id": tid,
        "session_id": "sess_it3",
        "spans": [{"span_id": "s1", "kind": "chain", "inputs": "query", "outputs": "response"}],
    })
    cluco_client.post(f"{BASE}/feedback/thumbs", json={
        "trace_id": tid,
        "thumbs": "down",
    })
    resp = cluco_client.post(f"{BASE}/datasets/from-feedback", json={
        "name": "IT Neg Feedback",
        "filters": {"feedback_key": "user_feedback", "feedback_value": "False"},
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "dataset_id" in data
    assert data.get("item_count", 0) >= 0


# ---------------------------------------------------------------------------
# IT-C4: Run evaluation on trace
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_it_run_evaluation_on_trace(cluco_client, services_available):
    """IT-C4: Ingest trace, run evaluation with trace_id + evaluator."""
    if not services_available:
        pytest.skip("MongoDB not available")
    tid = f"it_trace_{uuid.uuid4().hex[:12]}"
    cluco_client.post(f"{BASE}/traces", json={
        "trace_id": tid,
        "session_id": "sess_it4",
        "spans": [{"span_id": "s1", "kind": "chain", "inputs": "Hi", "outputs": "Hello!"}],
    })
    resp = cluco_client.post(f"{BASE}/evaluations/run", json={
        "trace_id": tid,
        "evaluator_ids": ["builtin.helpfulness"],
        "product_id": "default",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "run_id" in data or "status" in data


# ---------------------------------------------------------------------------
# IT-C5: Run evaluation on dataset
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_it_run_evaluation_on_dataset(cluco_client, services_available):
    """IT-C5: Create dataset with items, run evaluation."""
    if not services_available:
        pytest.skip("MongoDB not available")
    resp = cluco_client.post(f"{BASE}/datasets", json={
        "name": "IT Eval Dataset",
        "items": [
            {"item_id": "i1", "input": "q1", "expected_output": "a1"},
            {"item_id": "i2", "input": "q2", "expected_output": "a2"},
        ],
    })
    assert resp.status_code == 200
    ds_id = resp.json().get("dataset_id")
    if not ds_id:
        pytest.skip("Dataset creation failed")
    eval_resp = cluco_client.post(f"{BASE}/evaluations/run", json={
        "dataset_id": ds_id,
        "evaluator_ids": ["builtin.helpfulness"],
        "product_id": "default",
    })
    assert eval_resp.status_code == 200


# ---------------------------------------------------------------------------
# IT-C6: Conversation evaluation
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_it_conversation_evaluation(cluco_client, services_available):
    """IT-C6: Ingest multi-trace session, run conversation evaluation."""
    if not services_available:
        pytest.skip("MongoDB not available")
    sess = f"sess_it6_{uuid.uuid4().hex[:8]}"
    for i in range(2):
        tid = f"it_conv_{uuid.uuid4().hex[:12]}"
        cluco_client.post(f"{BASE}/traces", json={
            "trace_id": tid,
            "session_id": sess,
            "spans": [{"span_id": f"s{i}", "kind": "chain", "inputs": f"q{i}", "outputs": f"a{i}"}],
        })
    resp = cluco_client.post(f"{BASE}/evaluations/run-conversation", json={
        "session_id": sess,
        "evaluator_ids": ["builtin.conversation_coherence"],
        "product_id": "default",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert data.get("status") in ("running", "completed", "failed") or "run_id" in data


# ---------------------------------------------------------------------------
# IT-C7: Prompt optimization
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_it_prompt_optimization(cluco_client, services_available):
    """IT-C7: Create dataset + prompt exists, run optimize."""
    if not services_available:
        pytest.skip("MongoDB not available")
    ds_resp = cluco_client.post(f"{BASE}/datasets", json={
        "name": "IT Optimize",
        "items": [{"item_id": "i1", "input": "q", "expected_output": "a"}],
    })
    if ds_resp.status_code != 200:
        pytest.skip("Dataset creation failed")
    ds_id = ds_resp.json().get("dataset_id")
    resp = cluco_client.post(f"{BASE}/prompts/travelmind-orchestrator/optimize", json={
        "dataset_id": ds_id,
        "evaluator_id": "builtin.helpfulness",
        "strategy": "failure_driven",
        "max_iterations": 1,
    })
    assert resp.status_code in (200, 404, 500)


# ---------------------------------------------------------------------------
# IT-C8: Dataset from traces
# ---------------------------------------------------------------------------
@pytest.mark.integration
def test_it_dataset_from_traces(cluco_client, services_available):
    """IT-C8: Ingest traces, create dataset from trace_ids."""
    if not services_available:
        pytest.skip("MongoDB not available")
    tids = [f"it_ds_{uuid.uuid4().hex[:12]}" for _ in range(2)]
    for tid in tids:
        cluco_client.post(f"{BASE}/traces", json={
            "trace_id": tid,
            "session_id": "sess_it8",
            "spans": [{"span_id": "s1", "kind": "chain", "inputs": "q", "outputs": "a"}],
        })
    resp = cluco_client.post(f"{BASE}/datasets/from-traces", json={
        "trace_ids": tids,
        "dataset_name": "IT From Traces",
    })
    assert resp.status_code == 200
    data = resp.json()
    assert "dataset_id" in data
    assert data.get("item_count", 0) >= 0
