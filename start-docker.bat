@echo off
title Docker Compose - Cluco + Telecom Agent
color 0A

echo ============================================================
echo   Docker Compose - Cluco Observability + Telecom Agent
echo ============================================================
echo.
echo   This will start all services via Docker:
echo     MongoDB          :27017
echo     Cluco Backend    :9410
echo     Cluco UI         :9411
echo     Telecom Backend  :9412
echo     Telecom Chat UI  :9413
echo.
echo ============================================================
echo.

REM Check if .env.docker exists
if not exist "%~dp0.env.docker" (
    echo  ERROR: .env.docker not found!
    echo.
    echo  Please copy .env.docker.example to .env.docker and
    echo  fill in your OPENAI_API_KEY and PINECONE_API_KEY.
    echo.
    echo    copy .env.docker.example .env.docker
    echo.
    pause
    exit /b 1
)

REM Check Docker is running
docker info >nul 2>&1
if errorlevel 1 (
    echo  ERROR: Docker is not running!
    echo  Please start Docker Desktop and try again.
    echo.
    pause
    exit /b 1
)

echo  Building and starting all containers...
echo.

docker-compose up --build

echo.
echo  All containers stopped.
pause
