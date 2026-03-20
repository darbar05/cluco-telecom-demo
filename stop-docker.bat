@echo off
title Stopping Docker Services
color 0C

echo ============================================================
echo   Stopping all Docker containers...
echo ============================================================
echo.

docker-compose down

echo.
echo  All containers stopped and removed.
echo  (MongoDB data is preserved in the docker volume.)
echo.
echo  To also remove stored data:
echo    docker-compose down -v
echo.
pause
