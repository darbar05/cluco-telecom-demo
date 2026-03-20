@echo off
echo Starting Cluco Observability (MongoDB)...
cd /d "%~dp0.."

REM Ensure MongoDB is running (Docker)
docker compose up -d mongo 2>nul
timeout /t 5 /nobreak > nul

start "Cluco Backend" cmd /k "cd backend && set MONGODB_URI=mongodb://localhost:27017 && pip install -r requirements.txt -q && python run.py"
timeout /t 3 /nobreak > nul
start "Cluco UI" cmd /k "cd ui && npm install && npm run dev"

echo Backend: http://localhost:9410
echo UI: http://localhost:9411
