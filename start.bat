@echo off
setlocal
echo Dam Flood Simulator
echo ===================
echo.

where npm >nul 2>&1
if errorlevel 1 (
    echo ERROR: Node.js is required. Install it from https://nodejs.org and run this again.
    pause
    exit /b 1
)

pushd "%~dp0frontend"
if not exist node_modules (
    echo Installing dependencies...
    call npm install
    if errorlevel 1 (
        echo ERROR: npm install failed.
        popd
        pause
        exit /b 1
    )
)

echo Starting on http://localhost:5173
call npm run dev -- --open
popd
endlocal
