@echo off
title Stopping All Services
color 0C

echo ============================================================
echo   Stopping all Cluco + Telecom services...
echo ============================================================
echo.

REM Kill Python processes on the known ports
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :9410 ^| findstr LISTENING') do (
    echo  Stopping process on port 9410 (PID: %%a)
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :9411 ^| findstr LISTENING') do (
    echo  Stopping process on port 9411 (PID: %%a)
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :9412 ^| findstr LISTENING') do (
    echo  Stopping process on port 9412 (PID: %%a)
    taskkill /PID %%a /F >nul 2>&1
)
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :9413 ^| findstr LISTENING') do (
    echo  Stopping process on port 9413 (PID: %%a)
    taskkill /PID %%a /F >nul 2>&1
)

echo.
echo  All services stopped.
echo.
pause
