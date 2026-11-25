@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
chcp 65001 >nul 2>nul
title DevDeck Autonomous Self-Healing Bridge (Windows 10/11 -^> iPhone)

echo.
echo  ================================================================
echo   DEVDECK AUTONOMOUS SELF-HEALING BRIDGE (Windows 10/11 -^> iPhone)
echo  ================================================================
echo   Folder: %CD%
echo.

:: 1. Ensure standard + portable Node.js and Git paths are in PATH
set "PORTABLE_NODE=%LOCALAPPDATA%\DevDeck\node\node-v22.14.0-win-x64"
set "PATH=%PATH%;%ProgramFiles%\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs;%PORTABLE_NODE%;%ProgramFiles%\Git\cmd"

:: 2. Verify Node.js is installed (try winget first, then zero-admin portable Node.js ZIP fallback!)
where node.exe >nul 2>nul
if %errorlevel% neq 0 (
  echo [AUTOPILOT] Node.js not found. Attempting automatic install via winget...
  where winget.exe >nul 2>nul
  if !errorlevel! equ 0 (
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    set "PATH=%PATH%;%ProgramFiles%\nodejs;%APPDATA%\npm;%LOCALAPPDATA%\Programs\nodejs"
  )
)

where node.exe >nul 2>nul
if %errorlevel% neq 0 (
  echo [AUTOPILOT] Downloading standalone portable Node.js v22 LTS ^(no admin required^)...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $z=\"$env:TEMP\node22.zip\"; $d=\"$env:LOCALAPPDATA\DevDeck\node\"; New-Item -ItemType Directory -Force -Path $d | Out-Null; Invoke-WebRequest -Uri 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-win-x64.zip' -OutFile $z; Expand-Archive -Path $z -DestinationPath $d -Force"
  set "PATH=%PORTABLE_NODE%;%PATH%"
)

where node.exe >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] Could not install Node.js automatically. Please check your internet connection.
  pause
  exit /b 1
)

:: 3. Free port 4747 if an old zombie process is holding it
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 4747 -ErrorAction SilentlyContinue | ForEach-Object { if ($_.OwningProcess -gt 4) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }" >nul 2>nul

:: 4. Self-healing npm install (retries with cache clean + --legacy-peer-deps if needed)
if not exist "node_modules\tsx\dist\cli.mjs" (
  echo [AUTOPILOT] Installing DevDeck workspace dependencies...
  call npm.cmd install --no-audit --no-fund
  if %errorlevel% neq 0 (
    echo [AUTOPILOT] Self-healing npm cache and retrying with --legacy-peer-deps...
    call npm.cmd cache clean --force >nul 2>nul
    call npm.cmd install --no-audit --no-fund --legacy-peer-deps
  )
)

:: 5. Pre-compile mac-bridge for instant startup
if not exist "mac-bridge\dist\index.js" (
  echo [AUTOPILOT] Compiling DevDeck Bridge...
  call npm.cmd run build -w mac-bridge >nul 2>nul
)

set NODE_NO_WARNINGS=1

:bridge_start
echo.
echo [LIVE] Starting DevDeck Bridge + Free Cloudflare HTTPS Tunnel...
echo        ^(Your QR Code and 6-Digit PIN will appear below AND in /setup!^)
echo.

call npm.cmd run live
set BRIDGE_EXIT_CODE=%errorlevel%

if %BRIDGE_EXIT_CODE% neq 0 (
  echo.
  echo [AUTOPILOT] Bridge exited ^(code %BRIDGE_EXIT_CODE%^). Self-healing port 4747 and restarting in 3s...
  powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Get-NetTCPConnection -LocalPort 4747 -ErrorAction SilentlyContinue | ForEach-Object { if ($_.OwningProcess -gt 4) { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue } }" >nul 2>nul
  timeout /t 3 >nul
  goto bridge_start
)

echo.
pause
