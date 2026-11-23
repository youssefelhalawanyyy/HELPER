@echo off
title DevDeck Live Bridge (Windows -> iPhone)
echo.
echo  =============================================
echo   DEVDECK LIVE LAUNCHER (Windows -^> iPhone)
echo  =============================================
echo.

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not installed. Please install Node.js LTS from https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Installing dependencies for first run...
  call npm install
)

echo Starting Cloudflare Tunnel + DevDeck Windows Bridge...
call npm run live
pause
