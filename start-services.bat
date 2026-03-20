@echo off
title Cluco Observability + Telecom Agent - Service Launcher
color 0A

echo ============================================================
echo   Cluco Observability + Telecom Agent - Service Launcher
echo ============================================================
echo.
echo   Services:
echo     [1] Cluco Backend    (FastAPI)   http://localhost:9410
echo     [2] Cluco UI         (React)     http://localhost:9411
echo     [3] Telecom Backend  (FastAPI)   http://localhost:9412
echo     [4] Telecom Chat UI  (React)     http://localhost:9413
echo.
echo ============================================================
echo.

set "BASE_DIR=%~dp0"

REM -------------------------------------------------------
REM  Step 1: Install dependencies if missing
REM -------------------------------------------------------

echo [1/4] Checking Cluco Backend dependencies...
if not exist "%BASE_DIR%cluco-observability\backend\venv\Scripts\activate.bat" (
    echo        Creating virtual environment...
    python -m venv "%BASE_DIR%cluco-observability\backend\venv"
)
call "%BASE_DIR%cluco-observability\backend\venv\Scripts\activate.bat"
pip install -q -r "%BASE_DIR%cluco-observability\backend\requirements.txt" >nul 2>&1
call deactivate

echo [2/4] Checking Telecom Backend dependencies...
if not exist "%BASE_DIR%telecom-agent\backend\venv\Scripts\activate.bat" (
    echo        Creating virtual environment...
    python -m venv "%BASE_DIR%telecom-agent\backend\venv"
)
call "%BASE_DIR%telecom-agent\backend\venv\Scripts\activate.bat"
pip install -q -r "%BASE_DIR%telecom-agent\backend\requirements.txt" >nul 2>&1
call deactivate

echo [3/4] Checking Cluco UI dependencies...
if not exist "%BASE_DIR%cluco-observability\ui\node_modules" (
    echo        Running npm install...
    cd /d "%BASE_DIR%cluco-observability\ui"
    call npm install >nul 2>&1
)

echo [4/4] Checking Telecom Chat UI dependencies...
if not exist "%BASE_DIR%telecom-agent\frontend\node_modules" (
    echo        Running npm install...
    cd /d "%BASE_DIR%telecom-agent\frontend"
    call npm install >nul 2>&1
)

cd /d "%BASE_DIR%"

echo.
echo ============================================================
echo   Starting all services...
echo ============================================================
echo.

REM -------------------------------------------------------
REM  Step 2: Launch Cluco Backend (port 9410)
REM -------------------------------------------------------
echo  Starting Cluco Backend on http://localhost:9410 ...
start "Cluco Backend :9410" cmd /k "title Cluco Backend :9410 && color 0B && cd /d "%BASE_DIR%cluco-observability\backend" && call venv\Scripts\activate.bat && python run.py"

REM Give the backend a moment to start before dependent services
timeout /t 3 /nobreak >nul

REM -------------------------------------------------------
REM  Step 3: Launch Cluco UI (port 9411)
REM -------------------------------------------------------
echo  Starting Cluco UI on http://localhost:9411 ...
start "Cluco UI :9411" cmd /k "title Cluco UI :9411 && color 0D && cd /d "%BASE_DIR%cluco-observability\ui" && npm run dev"

REM -------------------------------------------------------
REM  Step 4: Launch Telecom Backend (port 9412)
REM -------------------------------------------------------
echo  Starting Telecom Backend on http://localhost:9412 ...
start "Telecom Backend :9412" cmd /k "title Telecom Backend :9412 && color 0E && cd /d "%BASE_DIR%telecom-agent\backend" && call venv\Scripts\activate.bat && python -m app.chat_server"

REM -------------------------------------------------------
REM  Step 5: Launch Telecom Chat UI (port 9413)
REM -------------------------------------------------------
echo  Starting Telecom Chat UI on http://localhost:9413 ...
start "Telecom Chat UI :9413" cmd /k "title Telecom Chat UI :9413 && color 0C && cd /d "%BASE_DIR%telecom-agent\frontend" && npm run dev"

echo.
echo ============================================================
echo   All services launched!
echo ============================================================
echo.
echo   Cluco Backend    :  http://localhost:9410
echo   Cluco UI         :  http://localhost:9411
echo   Telecom Backend  :  http://localhost:9412
echo   Telecom Chat UI  :  http://localhost:9413
echo.
echo   Each service runs in its own terminal window.
echo   Close this window or press any key to exit the launcher.
echo   (The services will keep running in their own windows.)
echo ============================================================
echo.
pause
