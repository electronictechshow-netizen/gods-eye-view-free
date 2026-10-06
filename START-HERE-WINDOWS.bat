@echo off
setlocal EnableExtensions EnableDelayedExpansion
title God's Eye View - Free Edition
cd /d "%~dp0"

echo.
echo  ==========================================================
echo    GOD'S EYE VIEW  -  FREE EDITION
echo  ==========================================================
echo.

rem ------------------------------------------------------------------
rem  1. Node.js (free, one-time install)
rem ------------------------------------------------------------------
where node >nul 2>nul
if errorlevel 1 goto :need_node

node -e "const [a,b]=process.versions.node.split('.').map(Number); process.exit((a===24&&b>=14)||(a>=26&&a<27)?0:1)"
if errorlevel 1 goto :old_node
goto :node_ok

:need_node
echo  [!] This app needs Node.js, which is free and takes about 2 minutes:
echo.
echo        1. A download page is opening now.
echo        2. Download the "LTS" installer ^(version 24^) and run it.
echo           Keep clicking Next. Leave every option as it is.
echo        3. Then double-click this file again.
echo.
start "" "https://nodejs.org/en/download"
pause
exit /b 1

:old_node
for /f %%v in ('node -v') do set NODEV=%%v
echo  [!] You have Node.js !NODEV!.  This app is tested with Node 24 LTS
echo      ^(24.14 or newer^).  Get the LTS installer here:
echo        https://nodejs.org/en/download
echo.
choice /c YN /m "  Try to start anyway"
if errorlevel 2 (
  start "" "https://nodejs.org/en/download"
  exit /b 1
)

:node_ok

rem ------------------------------------------------------------------
rem  2. First run: install the app's parts (once)
rem ------------------------------------------------------------------
if exist "node_modules\vite\package.json" goto :installed
echo  First run: installing the app's parts.
echo  This downloads about 200 MB and takes a few minutes.
echo  You only do this once.
echo.
rem  The browser the test tools download is not needed to run the app.
set PUPPETEER_SKIP_DOWNLOAD=true
call npm ci --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo  [!] The install did not finish. Check your internet connection,
  echo      then double-click START-HERE-WINDOWS.bat again.
  pause
  exit /b 1
)
echo.
:installed

rem ------------------------------------------------------------------
rem  3. First run: key file
rem ------------------------------------------------------------------
if exist ".env" goto :have_env
copy /y ".env.example" ".env" >nul
echo  I made your key file ^(.env^).
echo.
echo  The app works with NO keys. Keys add extras: 3D cities, voice,
echo  live ships, fires and more. Every key is free, and every link to
echo  get one is written right next to it in the file.
echo.
choice /c YN /m "  Open the key file in Notepad now"
if errorlevel 2 goto :have_env
echo.
echo  Notepad is opening. Paste each key right after its "=" sign,
echo  press Ctrl+S to save, then close Notepad.
start "" notepad ".env"
echo.
echo  Come back to THIS window when you have saved and closed Notepad.
pause
:have_env

rem ------------------------------------------------------------------
rem  4. Start
rem ------------------------------------------------------------------
echo.
echo  Starting God's Eye View. Your browser opens in a few seconds.
echo.
echo  KEEP THIS WINDOW OPEN while you use the app. Close it to stop.
echo  Add or change keys any time with ADD-API-KEYS.bat, or use the
echo  POWER UP button inside the app.
echo.
call npm run dev -- --open

echo.
echo  The app has stopped.
pause
