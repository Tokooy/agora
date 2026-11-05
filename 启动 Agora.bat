@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title Agora
docker info >nul 2>&1
if errorlevel 1 (
  echo Please start Docker Desktop using Linux containers, then try again.
  pause
  exit /b 1
)
echo Building Agora and waiting for the frontend and backend to become healthy...
docker compose up -d --build --wait --wait-timeout 90
if errorlevel 1 (
  echo Startup failed. Container status and recent logs:
  docker compose ps -a
  docker compose logs --tail 30
  pause
  exit /b 1
)
set "AGORA_ACTUAL_PORT="
for /f "tokens=2 delims=:" %%p in ('docker compose port frontend 80') do set "AGORA_ACTUAL_PORT=%%p"
if not defined AGORA_ACTUAL_PORT (
  echo Could not read the frontend port. Check the container status below:
  docker compose ps -a
  pause
  exit /b 1
)
set "AGORA_URL=http://127.0.0.1:%AGORA_ACTUAL_PORT%"
echo.
echo Both services are ready. Published ports:
docker compose ps
echo.
echo In Docker Desktop, expand the agora group to see the frontend port.
echo The backend API is accessed through the frontend.
echo Open: %AGORA_URL%
start "" "%AGORA_URL%"
pause
