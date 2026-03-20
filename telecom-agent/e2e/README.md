# E2E Tests - Telecom Agent + Cluco

End-to-end tests for the routing accuracy workflow (transcript-inspired from MLflow/DataBricks agent demo).

## Prerequisites

1. **All services running:**
   - Cluco Backend (port 9410)
   - Cluco UI (port 9411)
   - Telecom Backend (port 9412)
   - Telecom Chat UI (port 9413)

   Use `start-services.bat` from the project root.

2. **Pinecone seeded, prompts registered** (via `setup_kb.py` or equivalent).

3. **Playwright browsers installed:**
   ```bash
   pip install -r requirements.txt
   playwright install
   ```

## Run Tests

From the project root (`demo/`):

```bash
pytest telecom-agent/e2e/test_routing_accuracy_workflow.py -v
```

Or from `telecom-agent/e2e/`:

```bash
cd telecom-agent/e2e
pytest -v
```

## Screenshots

Screenshots are saved to `telecom-agent/e2e/screenshots/` during test execution:

- `01_chat_loaded.png` - Telecom Chat loaded
- `02_v1_response.png` - v1 agent response (expect misroute)
- `03_feedback_submitted.png` - Thumbs down submitted
- `04_cluco_traces_list.png` - Cluco Traces page
- `05_trace_detail_v1.png` - Trace detail (billing agent)
- `06_v2_response.png` - v2 agent response (correct route)
- `07_trace_detail_v2.png` - Trace detail (product agent)

## Full Demo Workflow Test

Test the complete flow: **Bad prompt -> Response -> Feedback -> Evaluation -> AI Assistant -> SME labeling -> Prompt Optimizer -> Compare old vs optimized.**

```bash
pytest telecom-agent/e2e/test_full_demo_workflow.py -v --headed
```

Use `--headed` to watch the browser; omit for headless. Use `-s` to see print output (screenshot paths).

Screenshots saved to `screenshots/`: `01_telecom_chat_loaded.png` through `20_compare_old_vs_optimized.png`.
