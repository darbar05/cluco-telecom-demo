@echo off
title Demo Recorder - E2E Test with Screenshots and Video
color 0A

echo ============================================================
echo   Demo Recorder: Bad Prompt -^> Optimize -^> Compare
echo ============================================================
echo.
echo   This will run the full E2E workflow and record:
echo     - Screenshots in telecom-agent/e2e/screenshots/
echo     - Video in telecom-agent/e2e/videos/
echo.
echo   Ensure all services are running first (run start-local.bat
echo   or start-docker in another terminal).
echo.
echo ============================================================
echo.

set "BASE_DIR=%~dp0"
cd /d "%BASE_DIR%"

REM Run the demo orchestrator
python telecom-agent\e2e\run_demo.py %*

if errorlevel 1 (
    color 0C
    echo.
    echo  Demo run completed with errors. Check output above.
) else (
    color 0A
    echo.
    echo  Demo completed successfully!
    echo  Screenshots: telecom-agent\e2e\screenshots\
    echo  Video:       telecom-agent\e2e\videos\
)

echo.
pause
