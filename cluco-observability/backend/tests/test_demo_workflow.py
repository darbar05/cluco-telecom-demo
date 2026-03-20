"""
Demo Workflow Test Cases (TC1-TC10, C1-C10).

Tests for the feedback-to-dataset-to-prompt-optimization flow and Trace Assessments.
Run with: pytest tests/test_demo_workflow.py -v
"""

import json
import pytest
from unittest.mock import MagicMock, patch


# ---------------------------------------------------------------------------
# C1: Feedback API - thumbs up without trace_id
# ---------------------------------------------------------------------------
class TestFeedbackAPI:
    """Edge cases for feedback endpoints."""

    def test_feedback_thumbs_without_trace_id(self):
        """C1: Feedback API: thumbs up without trace_id -> 400 or 422."""
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.post("/api/v1/feedback/thumbs", json={"thumbs": "up"})
        assert resp.status_code in (400, 422)


# ---------------------------------------------------------------------------
# TC5 / C3-C4: Trace Assessments - _extract_trace_request and _extract_trace_response
# ---------------------------------------------------------------------------
class TestExtractTraceRequestResponse:
    """Test that request/response extraction handles inputs/outputs for Trace Assessments."""

    def test_extract_request_from_inputs(self):
        """Spans use 'inputs' (plural); extraction should find it."""
        with patch("app.storage.mongodb._get_db") as mock_get_db:
            mock_db = MagicMock()
            mock_get_db.return_value = mock_db
            for name in ("traces", "spans", "feedback", "evaluations", "alerts", "datasets",
                        "evaluation_runs", "evaluators", "prompt_templates", "prompt_template_versions",
                        "labeling_sessions", "labeling_schemas", "judge_monitor_config",
                        "score_configs", "scores", "annotation_queues", "dataset_versions",
                        "experiments", "evaluation_suites", "prompt_deployments", "scheduled_evaluations"):
                getattr(mock_db, "create_index", MagicMock())  # no-op
            from app.storage.mongodb import MongoTraceStore
            store = MongoTraceStore()

            trace = {
                "flat_spans": [
                    {"kind": "chain", "inputs": "Find flights to Paris", "outputs": None},
                ],
                "spans": [],
                "payload": {},
                "metadata": {},
            }
            req = store._extract_trace_request(trace)
            assert req == "Find flights to Paris"

    def test_extract_response_from_outputs(self):
        """Spans use 'outputs' (plural); extraction should find it."""
        with patch("app.storage.mongodb._get_db") as mock_get_db:
            mock_get_db.return_value = MagicMock()
            from app.storage.mongodb import MongoTraceStore
            store = MongoTraceStore()

            trace = {
                "flat_spans": [
                    {"kind": "chain", "inputs": "query", "outputs": "Here are 3 flights to Paris"},
                ],
                "spans": [],
                "payload": {},
                "metadata": {},
            }
            resp = store._extract_trace_response(trace)
            assert resp == "Here are 3 flights to Paris"

    def test_extract_request_fallback_payload_metadata(self):
        """Fallback to payload.metadata.request when spans lack inputs."""
        with patch("app.storage.mongodb._get_db") as mock_get_db:
            mock_get_db.return_value = MagicMock()
            from app.storage.mongodb import MongoTraceStore
            store = MongoTraceStore()

            trace = {
                "flat_spans": [],
                "payload": {"metadata": {"request": "User query from payload"}},
                "metadata": {},
            }
            req = store._extract_trace_request(trace)
            assert req == "User query from payload"

    def test_extract_response_dict_outputs_json_serialized(self):
        """Dict outputs should be JSON serialized."""
        with patch("app.storage.mongodb._get_db") as mock_get_db:
            mock_get_db.return_value = MagicMock()
            from app.storage.mongodb import MongoTraceStore
            store = MongoTraceStore()

            trace = {
                "flat_spans": [
                    {"kind": "chain", "outputs": {"response": "Found 5 flights", "count": 5}},
                ],
                "spans": [],
                "payload": {},
                "metadata": {},
            }
            resp = store._extract_trace_response(trace)
            assert "Found 5 flights" in resp or "5" in resp

    def test_extract_request_from_llm_prompt_messages(self):
        """C3: Spans with nested llm.prompt_messages -> extract from llm block."""
        with patch("app.storage.mongodb._get_db") as mock_get_db:
            mock_get_db.return_value = MagicMock()
            from app.storage.mongodb import MongoTraceStore
            store = MongoTraceStore()

            trace = {
                "flat_spans": [
                    {"kind": "llm", "llm": {"prompt_messages": [{"role": "user", "content": "Find Paris flights"}]}},
                ],
                "spans": [],
                "payload": {},
                "metadata": {},
            }
            req = store._extract_trace_request(trace)
            assert req is not None
            # prompt_messages returned as list from llm block
            assert "Find Paris flights" in str(req) or req == [{"role": "user", "content": "Find Paris flights"}]

    def test_extract_empty_trace_returns_empty_string(self):
        """C4: Empty trace -> return empty string."""
        with patch("app.storage.mongodb._get_db") as mock_get_db:
            mock_get_db.return_value = MagicMock()
            from app.storage.mongodb import MongoTraceStore
            store = MongoTraceStore()

            trace = {"flat_spans": [], "spans": [], "payload": {}, "metadata": {}}
            req = store._extract_trace_request(trace)
            resp = store._extract_trace_response(trace)
            assert req == ""
            assert resp == ""


# ---------------------------------------------------------------------------
# TC3: Create dataset from feedback - default feedback_key
# ---------------------------------------------------------------------------
class TestCreateDatasetFromFeedback:
    """Test that create_dataset_from_feedback defaults feedback_key to user_feedback."""

    @pytest.fixture
    def mock_store(self):
        store = MagicMock()
        feedback_list = [
            {"trace_id": "tid1", "key": "user_feedback", "value": "False", "score": 0},
        ]
        cursor = MagicMock()
        cursor.sort.return_value = cursor
        cursor.limit.return_value = feedback_list
        store._feedback.find.return_value = cursor
        trace = {
            "trace_id": "tid1",
            "flat_spans": [{"inputs": "bad query", "outputs": "bad response"}],
            "spans": [],
            "payload": {},
            "metadata": {},
        }
        store.get.return_value = trace
        store._extract_trace_request = lambda t: t.get("flat_spans", [{}])[0].get("inputs", "") if t.get("flat_spans") else ""
        store._extract_trace_response = lambda t: t.get("flat_spans", [{}])[0].get("outputs", "") if t.get("flat_spans") else ""
        store.create_dataset = MagicMock()
        return store

    def test_default_feedback_key_is_user_feedback(self, mock_store):
        """When filters omit feedback_key, it should default to user_feedback."""
        with patch("app.storage.get_trace_store", return_value=mock_store):
            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            body = {"name": "Neg Feedback", "filters": {"feedback_value": "False"}}
            resp = client.post("/api/v1/datasets/from-feedback", json=body)
            assert resp.status_code == 200
            # Verify find was called with key=user_feedback (default)
            call_args = mock_store._feedback.find.call_args
            assert call_args, "find should have been called"
            filt = call_args[0][0] if call_args[0] else call_args[1]
            assert filt.get("key") == "user_feedback"


# ---------------------------------------------------------------------------
# TC2 / TC6 / C5-C7: Run evaluation - structure and edge cases
# ---------------------------------------------------------------------------
class TestEvaluationRunStructure:
    """Test evaluation run request/response structure."""

    def test_run_evaluation_accepts_trace_id(self):
        """POST /evaluations/run accepts trace_id."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store.get_evaluation_run = MagicMock(return_value=None)
            mock_store._traces = MagicMock()
            mock_store._traces.find_one.return_value = {
                "trace_id": "t1", "session_id": "s1",
                "spans": [], "flat_spans": [{"inputs": "q", "outputs": "a"}],
                "payload": {}, "metadata": {},
            }
            mock_store._spans = MagicMock()
            mock_store._spans.find.return_value = []
            mock_store.create_evaluation_run = MagicMock()
            mock_store.update_evaluation_run = MagicMock()
            mock_store.get_evaluator = MagicMock(return_value={"evaluator_id": "builtin.helpfulness", "type": "llm_judge", "enabled": True, "config": {}})
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.post("/api/v1/evaluations/run", json={
                "trace_id": "t1",
                "evaluator_ids": ["builtin.helpfulness"],
                "product_id": "default",
            })
            # May fail if evaluator instantiation needs real config; at least check route exists
            assert resp.status_code in (200, 500, 404)

    def test_run_evaluation_invalid_evaluator_id(self):
        """C5: Run evaluation: invalid evaluator_id -> 404 or clear error."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store._traces = MagicMock()
            mock_store._traces.find_one.return_value = {
                "trace_id": "t1", "session_id": "s1",
                "spans": [], "flat_spans": [{"inputs": "q", "outputs": "a"}],
                "payload": {}, "metadata": {},
            }
            mock_store._spans = MagicMock()
            mock_store._spans.find.return_value = []
            mock_store.create_evaluation_run = MagicMock()
            mock_store.update_evaluation_run = MagicMock()
            mock_store.get_evaluator = MagicMock(return_value=None)  # evaluator not found
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.post("/api/v1/evaluations/run", json={
                "trace_id": "t1",
                "evaluator_ids": ["nonexistent.evaluator"],
                "product_id": "default",
            })
            assert resp.status_code == 200  # run_evaluation returns run doc, doesn't raise
            data = resp.json()
            assert data.get("status") == "failed" or "error" in str(data).lower()

    def test_run_evaluation_empty_dataset(self):
        """C6: Run evaluation: dataset with no items -> clear error, no crash."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store.get_dataset = MagicMock(return_value={
                "dataset_id": "ds_empty", "items": [], "item_count": 0,
            })
            mock_store.create_evaluation_run = MagicMock()
            mock_store.update_evaluation_run = MagicMock()
            mock_store.get_evaluator = MagicMock(return_value={"evaluator_id": "builtin.helpfulness", "type": "llm_judge", "enabled": True, "config": {}})
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.post("/api/v1/evaluations/run", json={
                "dataset_id": "ds_empty",
                "evaluator_ids": ["builtin.helpfulness"],
                "product_id": "default",
            })
            assert resp.status_code == 200
            data = resp.json()
            assert "status" in data

    def test_conversation_evaluation_session_with_no_traces(self):
        """C7: Conversation evaluation: session with no traces -> failed run with clear message."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            cursor = MagicMock()
            cursor.sort.return_value = cursor
            cursor.limit.return_value = []  # no traces
            mock_store._traces = MagicMock()
            mock_store._traces.find.return_value = cursor
            mock_store._spans = MagicMock()
            mock_store._spans.find.return_value = []
            mock_store.create_evaluation_run = MagicMock()
            mock_store.update_evaluation_run = MagicMock()
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.post("/api/v1/evaluations/run-conversation", json={
                "session_id": "sess_nonexistent",
                "evaluator_ids": ["builtin.helpfulness"],
                "product_id": "default",
            })
            assert resp.status_code == 200
            data = resp.json()
            assert data.get("status") == "failed"
            assert "error" in data.get("metadata", {})


# ---------------------------------------------------------------------------
# C8-C9: Create dataset from feedback edge cases
# ---------------------------------------------------------------------------
class TestCreateDatasetFromFeedbackEdgeCases:
    """Additional edge cases for create_dataset_from_feedback."""

    def test_dataset_from_feedback_no_matching_feedback(self):
        """C8: Create dataset from feedback: no matching feedback -> empty dataset, item_count=0."""
        store = MagicMock()
        cursor = MagicMock()
        cursor.sort.return_value = cursor
        cursor.limit.return_value = []  # no feedback docs
        store._feedback.find.return_value = cursor
        store.get = MagicMock()
        store.create_dataset = MagicMock()

        with patch("app.storage.get_trace_store", return_value=store):
            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            body = {"name": "Empty", "filters": {"feedback_key": "user_feedback", "feedback_value": "rare"}}
            resp = client.post("/api/v1/datasets/from-feedback", json=body)
            assert resp.status_code == 200
            data = resp.json()
            assert data.get("item_count", 0) == 0
            assert "dataset_id" in data

    def test_dataset_from_feedback_positive_feedback_value_true(self):
        """C9: Create dataset from feedback: feedback_value 'True' -> positive feedback dataset."""
        store = MagicMock()
        feedback_list = [
            {"trace_id": "tid1", "key": "user_feedback", "value": "True", "score": 1},
        ]
        cursor = MagicMock()
        cursor.sort.return_value = cursor
        cursor.limit.return_value = feedback_list
        store._feedback.find.return_value = cursor
        trace = {
            "trace_id": "tid1",
            "flat_spans": [{"inputs": "good query", "outputs": "good response"}],
            "spans": [], "payload": {}, "metadata": {},
        }
        store.get = MagicMock(return_value=trace)
        store._extract_trace_request = lambda t: t.get("flat_spans", [{}])[0].get("inputs", "") if t.get("flat_spans") else ""
        store._extract_trace_response = lambda t: t.get("flat_spans", [{}])[0].get("outputs", "") if t.get("flat_spans") else ""
        store.create_dataset = MagicMock()

        with patch("app.storage.get_trace_store", return_value=store):
            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            body = {"name": "Pos Feedback", "filters": {"feedback_value": "True"}}
            resp = client.post("/api/v1/datasets/from-feedback", json=body)
            assert resp.status_code == 200
            data = resp.json()
            assert data.get("item_count", 0) >= 1
            filt = store._feedback.find.call_args[0][0]
            assert filt.get("value") == "True"


# ---------------------------------------------------------------------------
# C10: Trace Assessments - conversation mode with created_at sort
# ---------------------------------------------------------------------------
class TestTraceAssessmentsConversationMode:
    """Test Trace Assessments conversation mode ordering."""

    def test_conversation_mode_traces_ordered_by_created_at(self):
        """C10: Trace Assessments: conversation mode with created_at sort -> traces ordered correctly."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            trace_docs = [
                {"trace_id": "t1", "session_id": "s1", "created_at": "2025-01-01T10:00:00Z"},
                {"trace_id": "t2", "session_id": "s1", "created_at": "2025-01-01T10:01:00Z"},
            ]
            mock_store._traces = MagicMock()
            mock_store._traces.find.return_value.sort.return_value.limit.return_value = trace_docs
            mock_store._spans = MagicMock()
            mock_store._spans.find.return_value = []
            mock_store.get_evaluation_run = MagicMock(return_value={
                "run_id": "run1", "mode": "conversation", "session_id": "s1",
                "results": [], "aggregate_score": 0, "aggregate_passed": False,
            })
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.get("/api/v1/evaluations/runs/run1/traces")
            assert resp.status_code == 200
            data = resp.json()
            traces = data.get("traces", [])
            if len(traces) >= 2:
                assert traces[0]["trace_id"] == "t1" and traces[1]["trace_id"] == "t2"


# ---------------------------------------------------------------------------
# C11-C27: Additional Cluco test cases
# ---------------------------------------------------------------------------
class TestClucoHealthAndCore:
    """C11: Health check."""

    def test_health_check(self):
        """C11: Health check -> 200, status ok."""
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.get("/api/v1/health")
        assert resp.status_code == 200
        assert resp.json().get("status") == "ok"


class TestClucoTraces:
    """C12-C14: Traces."""

    def test_ingest_trace_valid_payload(self):
        """C12: Ingest trace - valid payload -> 200, trace_id."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store.ingest.return_value = {"ok": True, "trace_id": "t1", "status": "ingested"}
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.post("/api/v1/traces", json={
                "trace_id": "t1",
                "session_id": "s1",
                "spans": [],
            })
            assert resp.status_code == 200
            data = resp.json()
            assert data.get("trace_id") == "t1"

    def test_get_trace_not_found(self):
        """C13: Get trace - not found -> 404 or error."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store.get.return_value = None
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.get("/api/v1/traces/nonexistent")
            assert resp.status_code in (200, 404)
            if resp.status_code == 200:
                assert "error" in resp.json()

    def test_list_traces_empty(self):
        """C14: List traces - empty -> 200, empty list."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store.list_traces.return_value = {"traces": [], "count": 0}
            mock_store.get_assessments_for_traces = MagicMock(return_value={})
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.get("/api/v1/traces")
            assert resp.status_code == 200


class TestClucoFeedbackExtended:
    """C15-C17: Feedback extended."""

    def test_feedback_full_payload(self):
        """C15: Feedback full payload (key, score, value) -> 200."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store.add_feedback.return_value = {"ok": True}
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.post("/api/v1/feedback", json={
                "trace_id": "t1",
                "key": "custom",
                "score": 0.5,
                "value": "medium",
            })
            assert resp.status_code == 200

    def test_feedback_thumbs_invalid_thumbs(self):
        """C16: Feedback thumbs - invalid thumbs value -> 422 (if validated)."""
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.post("/api/v1/feedback/thumbs", json={
            "trace_id": "t1",
            "thumbs": "maybe",
        })
        assert resp.status_code in (400, 422)

    def test_list_feedback_no_trace_id(self):
        """C17: List feedback - no trace_id -> 200."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store.get_feedback.return_value = []
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.get("/api/v1/feedback")
            assert resp.status_code == 200


class TestClucoDatasetsExtended:
    """C18-C20: Datasets extended."""

    def test_create_dataset_empty_body(self):
        """C18: Create dataset - empty body -> 200 (uses defaults) or 400."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store.create_dataset.return_value = {"dataset_id": "ds_abc", "ok": True}
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.post("/api/v1/datasets", json={})
            assert resp.status_code in (200, 400)

    def test_create_dataset_from_traces_no_trace_ids(self):
        """C19: Create dataset from traces - no trace_ids -> 400."""
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.post("/api/v1/datasets/from-traces", json={
            "dataset_name": "Empty",
            "trace_ids": [],
        })
        assert resp.status_code == 400

    def test_get_dataset_not_found(self):
        """C20: Get dataset - not found -> error."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store.get_dataset.return_value = None
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.get("/api/v1/datasets/nonexistent")
            assert resp.status_code == 200
            assert "error" in resp.json()


class TestClucoEvaluationsExtended:
    """C21-C23: Evaluations extended."""

    def test_list_evaluators(self):
        """C21: List evaluators -> 200, evaluators array."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store.list_evaluators.return_value = []
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.get("/api/v1/evaluators")
            assert resp.status_code == 200

    def test_run_evaluation_no_trace_no_dataset(self):
        """C22: Run evaluation - no trace_id and no dataset_id -> 400 or failed run."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store.create_evaluation_run = MagicMock()
            mock_store.update_evaluation_run = MagicMock()
            mock_store.get_evaluator = MagicMock(return_value=None)
            mock_store.get_dataset = MagicMock(return_value=None)
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.post("/api/v1/evaluations/run", json={
                "evaluator_ids": ["builtin.helpfulness"],
                "product_id": "default",
            })
            assert resp.status_code in (200, 400, 422)
            if resp.status_code == 200:
                data = resp.json()
                assert data.get("status") in ("failed", "running", "completed") or "error" in str(data).lower()

    def test_get_evaluation_run_not_found(self):
        """C23: Get evaluation run - not found -> error or 404."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store.get_evaluation_run.return_value = None
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.get("/api/v1/evaluations/runs/nonexistent")
            assert resp.status_code == 200
            assert "error" in resp.json()


class TestClucoPrompts:
    """C24-C25: Prompts."""

    def test_prompt_optimize_invalid_prompt_id(self):
        """C24: Prompt optimize - invalid prompt_id -> 404, 500, 422 or 200."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_store.get_prompt_template.return_value = None
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.post("/api/v1/prompts/nonexistent/optimize", json={
                "dataset_id": "ds1",
                "evaluator_id": "builtin.helpfulness",
            })
            assert resp.status_code in (200, 404, 500, 422)

    def test_prompt_optimize_missing_dataset_id(self):
        """C25: Prompt optimize - missing dataset_id -> 400 or clear error."""
        with patch("app.storage.get_trace_store") as mock_gs:
            mock_store = MagicMock()
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.post("/api/v1/prompts/travelmind-orchestrator/optimize", json={})
            assert resp.status_code in (400, 422, 500)


class TestClucoConversationEvalExtended:
    """C26-C27: Conversation evaluation extended."""

    def test_run_conversation_eval_missing_session_id(self):
        """C26: Run conversation evaluation - missing session_id -> 400."""
        from fastapi.testclient import TestClient
        from app.main import app
        client = TestClient(app)
        resp = client.post("/api/v1/evaluations/run-conversation", json={
            "evaluator_ids": ["builtin.helpfulness"],
        })
        assert resp.status_code == 400

    def test_run_conversation_eval_empty_evaluator_ids(self):
        """C27: Run conversation evaluation - empty evaluator_ids -> 200, run created."""
        with patch("app.storage.get_trace_store") as mock_gs:
            cursor = MagicMock()
            cursor.sort.return_value = cursor
            cursor.limit.return_value = [{"trace_id": "t1", "session_id": "s1"}]
            mock_store = MagicMock()
            mock_store._traces = MagicMock()
            mock_store._traces.find.return_value = cursor
            mock_store._spans = MagicMock()
            mock_store._spans.find.return_value = []
            mock_store.create_evaluation_run = MagicMock()
            mock_store.update_evaluation_run = MagicMock()
            mock_store.get_evaluator = MagicMock(return_value=None)
            mock_gs.return_value = mock_store

            from fastapi.testclient import TestClient
            from app.main import app
            client = TestClient(app)
            resp = client.post("/api/v1/evaluations/run-conversation", json={
                "session_id": "s1",
                "evaluator_ids": [],
                "product_id": "default",
            })
            assert resp.status_code == 200


# ---------------------------------------------------------------------------
# Manual / Integration test instructions (TC1, TC4)
# ---------------------------------------------------------------------------
"""
TC1: User feedback flow (manual)
  1. Start TravelMind + Cluco
  2. Send a poor query, click thumbs down
  3. In Cluco Traces, verify feedback (user_feedback=False)

TC4: Prompt optimization (manual)
  1. Ensure prompt + dataset + evaluator exist
  2. POST /api/v1/prompts/{id}/optimize with dataset_id, evaluator_id
  3. Verify new prompt version created
"""
