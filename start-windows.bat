@echo off
title DevDeck Live Bridge (Windows -> iPhone)
echo.
echo  =============================================
echo   DEVDECK LIVE LAUNCHER (Windows -^> iPhone)
echo  =============================================
echo.

:: Check Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not installed. Please install Node.js LTS from https://nodejs.org
  pause
  exit /b 1
)

:: Check npm
where npm >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] npm is not installed.
  pause
  exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
  echo [INFO] First run - installing dependencies...
  echo.
  npm install --legacy-peer-deps 2>&1 | find "npm notice" >nul
  if %errorlevel% neq 0 (
    echo [WARN] Some warnings during install, continuing...
  )
)

:: Set environment for stability
set NODE_OPTIONS=--max-old-space-size=512
set NODE_NO_WARNINGS=1

:: Start with error handling
echo.
echo [starting] Initializing DevDeck Windows Bridge...
echo.

:: Start the bridge with restart on crash
:bridge_start
echo.
echo [bridge] Starting bridge server (port 4747)...
timeout /t 1 >nul

node dist/index.js >bridge.log 2>&1
set BRIDGE_EXIT_CODE=%errorlevel%

if %BRIDGE_EXIT_CODE% neq 0 (
  echo.
  echo [ERROR] Bridge crashed with exit code: %BRIDGE_EXIT_CODE%
  echo [retry] Attempting restart in 3 seconds...
  timeout /t 3 >nul
  goto bridge_start
)

echo.
echo [success] DevDeck Bridge is running on port 4747
echo.
echo [info] Bridge log: bridge.log
echo.
pause
