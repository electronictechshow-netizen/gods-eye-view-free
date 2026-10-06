@echo off
setlocal EnableExtensions
title God's Eye View - API keys
cd /d "%~dp0"

if not exist ".env" copy /y ".env.example" ".env" >nul

echo.
echo  Opening your key file in Notepad.
echo.
echo    - Every key has its free sign-up link written right above it.
echo    - Paste each key right AFTER the "=" sign. No quotes, no spaces.
echo    - Save with Ctrl+S, then close Notepad.
echo    - Then RESTART the app: close its black window and run
echo      START-HERE-WINDOWS.bat again.
echo.
start "" notepad ".env"
timeout /t 4 >nul
