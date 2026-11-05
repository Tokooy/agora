@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title 共识 Agora
docker info >nul 2>&1
if errorlevel 1 (
  echo 请先启动 Docker Desktop，并确认使用 Linux containers 模式。
  pause
  exit /b 1
)
echo 正在构建并启动共识 Agora，首次运行需要下载依赖，请稍候。
docker compose up -d --build
if errorlevel 1 (
  echo 启动失败，请查看上方错误信息。
  pause
  exit /b 1
)
if not defined AGORA_PORT set AGORA_PORT=3000
if exist ".env" for /f "usebackq tokens=1,* delims==" %%a in (".env") do if "%%a"=="AGORA_PORT" set AGORA_PORT=%%b
echo 启动成功，请访问 http://localhost:%AGORA_PORT%
start "" "http://localhost:%AGORA_PORT%"
pause
