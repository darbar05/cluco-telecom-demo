@echo off
title Local Launcher - Cluco + Telecom Agent
color 0A

echo ============================================================
echo   Local Launcher  (MongoDB must be running locally)
echo ============================================================
echo.
echo   Services to start:
echo     Cluco Backend    http://localhost:9410
echo     Cluco UI         http://localhost:9411
echo     Telecom Backend  http://localhost:9412
echo     Telecom Chat UI  http://localhost:9413
echo.
echo ============================================================
echo.

set "BASE_DIR=%~dp0"

REM -------------------------------------------------------
REM  Check MongoDB is reachable
REM -------------------------------------------------------
echo  Checking MongoDB on localhost:27017 ...
powershell -Command "try { $tcp = New-Object System.Net.Sockets.TcpClient('localhost',27017); $tcp.Close(); exit 0 } catch { exit 1 }" >nul 2>&1
if errorlevel 1 (
    color 0C
    echo.
    echo  ERROR: MongoDB is not running on localhost:27017
    echo  Please start MongoDB first, then re-run this script.
    echo.
    pause
    exit /b 1
)
echo  MongoDB OK
echo.

REM -------------------------------------------------------
REM  Install deps only when missing (fast on repeat runs)
REM -------------------------------------------------------
echo  Checking dependencies ...

if not exist "%BASE_DIR%cluco-observability\backend\venv\Scripts\activate.bat" (
    echo    Creating Cluco backend venv ...
    python -m venv "%BASE_DIR%cluco-observability\backend\venv"
    call "%BASE_DIR%cluco-observability\backend\venv\Scripts\activate.bat"
    pip install -q -r "%BASE_DIR%cluco-observability\backend\requirements.txt"
    call deactivate
) else (
    echo    Cluco backend venv OK
)

if not exist "%BASE_DIR%telecom-agent\backend\venv\Scripts\activate.bat" (
    echo    Creating Telecom backend venv ...
    python -m venv "%BASE_DIR%telecom-agent\backend\venv"
    call "%BASE_DIR%telecom-agent\backend\venv\Scripts\activate.bat"
    pip install -q -r "%BASE_DIR%telecom-agent\backend\requirements.txt"
    call deactivate
) else (
    echo    Telecom backend venv OK
)

if not exist "%BASE_DIR%cluco-observability\ui\node_modules" (
    echo    Installing Cluco UI packages ...
    cd /d "%BASE_DIR%cluco-observability\ui"
    call npm install
) else (
    echo    Cluco UI node_modules OK
)

if not exist "%BASE_DIR%telecom-agent\frontend\node_modules" (
    echo    Installing Telecom UI packages ...
    cd /d "%BASE_DIR%telecom-agent\frontend"
    call npm install
) else (
    echo    Telecom UI node_modules OK
)

cd /d "%BASE_DIR%"

echo.
echo ============================================================
echo   Launching 4 services ...
echo ============================================================
echo.

REM -- Cluco Backend (port 9410) --------------------------------
echo  [1/4] Cluco Backend    :9410
start "Cluco Backend :9410" cmd /k "title Cluco Backend :9410 && color 0B && cd /d "%BASE_DIR%cluco-observability\backend" && call venv\Scripts\activate.bat && python run.py"

timeout /t 3 /nobreak >nul

REM -- Cluco UI (port 9411) -------------------------------------
echo  [2/4] Cluco UI         :9411
start "Cluco UI :9411" cmd /k "title Cluco UI :9411 && color 0D && cd /d "%BASE_DIR%cluco-observability\ui" && npm run dev"

REM -- Telecom Backend (port 9412) ------------------------------
echo  [3/4] Telecom Backend  :9412
start "Telecom Backend :9412" cmd /k "title Telecom Backend :9412 && color 0E && cd /d "%BASE_DIR%telecom-agent\backend" && call venv\Scripts\activate.bat && python -m app.chat_server"

REM -- Telecom Chat UI (port 9413) ------------------------------
echo  [4/4] Telecom Chat UI  :9413
start "Telecom Chat UI :9413" cmd /k "title Telecom Chat UI :9413 && color 0C && cd /d "%BASE_DIR%telecom-agent\frontend" && npm run dev"

echo.
echo ============================================================
echo   All 4 services are running!
echo ============================================================
echo.
echo   Cluco Observability:
echo     Backend  :  http://localhost:9410
echo     UI       :  http://localhost:9411
echo.
echo   Telecom Agent:
echo     Backend  :  http://localhost:9412
echo     Chat UI  :  http://localhost:9413
echo.
echo   Tip: Each service has its own colored terminal window.
echo        Close them individually, or run stop-services.bat
echo        to kill everything at once.
echo ============================================================
echo.
pause
