@echo off
setlocal
echo Dam Flood Simulator
echo ===================
echo.

REM -----------------------------------------------------------------------
REM Check that uv is available
REM -----------------------------------------------------------------------
where uv >nul 2>&1
if errorlevel 1 (
    echo uv not found. Installing uv via PowerShell...
    powershell -ExecutionPolicy Bypass -Command "irm https://astral.sh/uv/install.ps1 | iex"
    REM Refresh PATH so the newly installed uv is visible in this session
    for /f "usebackq delims=" %%P in (`powershell -Command "$env:PATH"`) do set "PATH=%%P"
    where uv >nul 2>&1
    if errorlevel 1 (
        echo ERROR: uv installation failed. Please install manually: https://docs.astral.sh/uv/
        pause
        exit /b 1
    )
    echo uv installed successfully.
    echo.
)

REM -----------------------------------------------------------------------
REM Backend — uv creates / reuses .venv automatically via "uv sync"
REM -----------------------------------------------------------------------
echo [1/2] Setting up Python backend (uv sync)...
pushd "%~dp0backend"
uv sync --no-install-project --quiet
if errorlevel 1 (
    echo ERROR: uv sync failed. Check backend\pyproject.toml.
    popd
    pause
    exit /b 1
)
popd

echo       Starting backend on http://localhost:8000
start "Backend - Dam Flood Simulator" cmd /k "cd /d %~dp0backend && uv run uvicorn main:app --reload --port 8000"

REM Brief pause so the backend is up before the browser opens
timeout /t 3 /nobreak >nul

REM -----------------------------------------------------------------------
REM Frontend — npm
REM -----------------------------------------------------------------------
echo [2/2] Setting up and starting React frontend...
start "Frontend - Dam Flood Simulator" cmd /k "cd /d %~dp0frontend && npm install --silent && npm run dev"

echo.
echo Both servers are starting.
echo Open http://localhost:5173 in your browser.
echo.
pause
endlocal
