@echo off
setlocal
cd /d "%~dp0"
title Agora
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start-docker.ps1" %*
set "AGORA_EXIT_CODE=%ERRORLEVEL%"
pause
exit /b %AGORA_EXIT_CODE%
