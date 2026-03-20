#!/bin/bash
cd "$(dirname "$0")/.."
echo "Starting Cluco Observability..."
(cd backend && pip install -r requirements.txt -q && python run.py) &
sleep 3
(cd ui && npm install && npm run dev) &
echo "Backend: http://localhost:9410"
echo "UI: http://localhost:9411"
