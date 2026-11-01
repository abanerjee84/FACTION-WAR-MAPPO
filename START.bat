@echo off
setlocal
cd /d "%~dp0"

title Aetherfield - MAPPO Resource Wars

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js was not found. Install Node 18+ and run this file again.
  echo.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo  Installing dependencies for the first run...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  npm install failed. Check your network connection and try again.
    pause
    exit /b 1
  )
)

echo.
echo  ============================================================
echo    AETHERFIELD  -  Multi-Agent PPO Resource Wars
echo  ============================================================
echo.
echo    Open:  http://127.0.0.1:5173
echo    Training and the live match start automatically.
echo.
echo    Keep this window open. Press Ctrl+C to stop the server.
echo.
call npm run dev
pause
