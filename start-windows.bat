@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul 2>nul
title DevDeck Live Bridge (Windows 10/11 -^> iPhone)

echo.
echo  =======================================================
echo   DEVDECK LIVE LAUNCHER (Windows 10/11 -^> iPhone PWA)
echo  =======================================================
echo   Folder: %CD%
echo.

:: Ensure standard Node.js and Git install paths are in PATH even right after winget install
set "PATH=%PATH%;%ProgramFiles%\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%ProgramFiles%\Git\cmd"

:: 1. Verify Node.js is installed (auto-install via winget if missing!)
where node.exe >nul 2>nul
if %errorlevel% neq 0 (
  echo [SETUP] Node.js was not found in PATH. Attempting automatic install via Windows winget...
  where winget.exe >nul 2>nul
  if !errorlevel! equ 0 (
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    set "PATH=%PATH%;%ProgramFiles%\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs"
  )
)

where node.exe >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Node.js is not installed.
  echo         Install Node.js LTS from https://nodejs.org and double-click start-windows.bat again.
  echo.
  pause
  exit /b 1
)

:: 2. Verify npm.cmd is available
where npm.cmd >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] npm.cmd was not found in PATH.
  echo.
  pause
  exit /b 1
)

:: 3. Install workspace dependencies on first run (or if tsx is missing)
if not exist "node_modules\tsx\dist\cli.mjs" (
  echo [SETUP] Installing DevDeck dependencies ^(first run^)...
  echo.
  call npm.cmd install
  if %errorlevel% neq 0 (
    echo.
    echo [WARN] Standard npm install reported an error — retrying with --legacy-peer-deps...
    call npm.cmd install --legacy-peer-deps
    if %errorlevel% neq 0 (
      echo [ERROR] npm install failed. Check your internet connection and try again.
      pause
      exit /b 1
    )
  )
)

:: 4. Pre-build mac-bridge if dist/index.js is missing for instant startup
if not exist "mac-bridge\dist\index.js" (
  echo [BUILD] Compiling DevDeck Windows Bridge...
  call npm.cmd run build -w mac-bridge >nul 2>nul
)

set NODE_NO_WARNINGS=1

:bridge_start
echo.
echo [LIVE] Starting DevDeck Windows Bridge + Free Cloudflare HTTPS Tunnel...
echo        ^(Scan the QR code below with your iPhone Camera once it appears!^)
echo.

call npm.cmd run live
set BRIDGE_EXIT_CODE=%errorlevel%

if %BRIDGE_EXIT_CODE% neq 0 (
  echo.
  echo [WARN] DevDeck Bridge exited ^(code %BRIDGE_EXIT_CODE%^). Restarting in 4 seconds...
  echo        Press Ctrl+C to stop.
  timeout /t 4 >nul
  goto bridge_start
)

echo.
pause
