@echo off
title Push ZeroProp to GitHub
cd /d "%~dp0"
echo ===================================================
echo   Pushing ZeroProp code to GitHub
echo   Repository: https://github.com/extraid5607/ZeroProp
echo ===================================================
echo.
git push -u origin main
echo.
if %ERRORLEVEL% EQU 0 (
    echo ===================================================
    echo   [SUCCESS] Code successfully pushed to GitHub!
    echo ===================================================
) else (
    echo ===================================================
    echo   [NOTICE] If prompted, complete GitHub browser login
    echo   or provide a GitHub Personal Access Token.
    echo ===================================================
)
pause
