@echo off
title ZeroProp - Live Mode
cd /d "%~dp0"

echo =======================================================
echo               Starting ZeroProp (Live Mode)
echo =======================================================
echo   Mode: Real-time market prices (Crypto, Forex, Metals)
echo   PC URL:     http://localhost:8000
echo   Mobile URL: http://192.168.1.4:8000 (same Wi-Fi)
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

:: Launch browser on PC in background after short delay
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://127.0.0.1:8000"

:: Start application server (0.0.0.0 allows mobile access on same Wi-Fi)
set APP_NAME=ZeroProp
set PRICE_SOURCE=live
.venv\Scripts\uvicorn.exe app.main:app --host 0.0.0.0 --port 8000 --reload

pause
