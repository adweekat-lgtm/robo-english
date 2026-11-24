@echo off
setlocal
cd /d "%~dp0"
title DN Reconciliation

if "%ANTHROPIC_API_KEY%"=="" (
  echo ERROR: ANTHROPIC_API_KEY is not set.
  echo Run once:  setx ANTHROPIC_API_KEY "sk-ant-..."   then reopen this window.
  pause
  exit /b 1
)

echo.
echo === Daily DN Reconciliation ===
echo Tip: you can drag a file or folder into this window instead of typing.
echo.
set "REPORT="
set /p "REPORT=Report Excel [Credit_Invoices_ICC.xlsx]: "
if "%REPORT%"=="" set "REPORT=Credit_Invoices_ICC.xlsx"
set "REPORT=%REPORT:"=%"

set "SCANS="
set /p "SCANS=Scans folder or PDF [scans]: "
if "%SCANS%"=="" set "SCANS=scans"
set "SCANS=%SCANS:"=%"

echo.
py reconcile.py --report "%REPORT%" --scans "%SCANS%" --out output
if errorlevel 1 (
  echo.
  echo Reconciliation FAILED - see the message above.
  pause
  exit /b 1
)

rem Open the newest result file
for /f "delims=" %%F in ('dir /b /o-d "output\DN_Reconciliation_*.xlsx" 2^>nul') do (
  start "" "output\%%F"
  goto :done
)
:done
pause
