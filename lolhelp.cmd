@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "PY=%~dp0.venv\Scripts\python.exe"
set "PIP=%~dp0.venv\Scripts\pip.exe"
set "CTL=%~dp0launcher_ctl.py"
set "OVERLAY_APP=%~dp0overlay-app"
set "ELECTRON=%OVERLAY_APP%\node_modules\electron\dist\electron.exe"

if not exist "%PY%" (
  echo.
  echo  Missing .venv — set up once:
  echo    python -m venv .venv
  echo    .venv\Scripts\pip.exe install -r requirements.txt
  echo.
  pause
  exit /b 1
)

if not exist "%ELECTRON%" (
  echo.
  echo  Electron launcher not installed. One-time:
  echo    cd overlay-app
  echo    npm install
  echo.
  pause
  exit /b 1
)

if not exist "%~dp0data" mkdir "%~dp0data"

REM Clear any leftover server/overlay from a previous run.
"%PY%" "%CTL%" stop

echo Starting LoL Live Helper launcher...
pushd "%OVERLAY_APP%"
"%ELECTRON%" .
set "EXIT_CODE=%ERRORLEVEL%"
popd

REM Launcher owns the server; belt-and-suspenders cleanup.
"%PY%" "%CTL%" stop

if not "%EXIT_CODE%"=="0" (
  echo.
  echo Launcher exited with an error.
  pause
  exit /b %EXIT_CODE%
)

echo Done.
endlocal
