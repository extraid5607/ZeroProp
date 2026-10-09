@echo off
title ZeroProp - Demo Mode
cd /d "%~dp0"

echo =======================================================
echo               Starting ZeroProp (Demo Mode)
echo =======================================================
echo   Mode: Fast simulated prices (works offline)
echo   URL:  http://127.0.0.1:8000
echo =======================================================
echo.

:: Ensure no duplicate / conflicting instances are running
echo Checking and closing any old server instances...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr :8000 ^| findstr LISTENING') do (
    taskkill /f /pid %%a >nul 2>&1
)
taskkill /f /im uvicorn.exe >nul 2>&1

:: Ensure virtual environment is set up
if not exist ".venv\Scripts\uvicorn.exe" (
    echo [1/2] Creating virtual environment...
    python -m venv .venv
    echo [2/2] Installing dependencies...
    call .venv\Scripts\pip.exe install -r requirements.txt
)

:: Launch browser in background after short delay
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:8000"

:: Start the application server in DEMO mode
set APP_NAME=ZeroProp
set PRICE_SOURCE=demo
.venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8000 --reload

pause
