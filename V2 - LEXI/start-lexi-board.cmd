@echo off
REM ============================================================================
REM Start the Cline Kanban board for Lexi.
REM
REM Durable workaround: `cline --kanban` is BROKEN in kanban@0.1.70 (its launcher
REM references kanban/dist/entry.js, which the published package does not ship).
REM The board itself runs fine from kanban/dist/cli.js, so we launch that directly.
REM
REM Board URL: http://127.0.0.1:3484   (OmniRoute dashboard: http://localhost:20128)
REM Note: the board's AI "Kanban Agent" sidebar is broken by the same upstream bug
REM (needs entry.js). Do decomposition/execution via headless cline instead:
REM   cline -P openai-compatible -m lexi-orchestrator -p -c "C:\dev\companyos-lexi" "<brief>"
REM   cline -P openai-compatible -m lexi-cheap --auto-approve true -c "C:\dev\companyos-lexi" "<card>"
REM ============================================================================
setlocal
for /f "delims=" %%i in ('npm root -g') do set "NPMROOT=%%i"
set "CLI=%NPMROOT%\kanban\dist\cli.js"
if not exist "%CLI%" (
  echo ERROR: cannot find "%CLI%"
  echo Is the kanban package installed globally?  npm i -g kanban@latest
  exit /b 1
)
echo Starting Lexi Kanban board on http://127.0.0.1:3484
echo   (Ctrl+C or close this window to stop it)
node "%CLI%"
