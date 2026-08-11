@echo off
setlocal
pushd "%~dp0"

call :run node --check app.js || goto :failed
call :run node --check modules\markdown-renderer.js || goto :failed
call :run node tests\lint-security.mjs || goto :failed
call :run node tests\security-smoke.mjs || goto :failed
call :run node tests\desktop-host-static-check.mjs || goto :failed
call :run powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests\Check-ReleasePackage.ps1 || goto :failed
call :run node tests\rendering-quality-check.mjs || goto :failed
call :run node tests\vendor-static-check.mjs || goto :failed
call :run node tests\vendor-audit.mjs || goto :failed

echo.
echo All automated checks passed.
popd
exit /b 0

:run
echo.
echo ^> %*
%*
exit /b %errorlevel%

:failed
set "checkExitCode=%errorlevel%"
echo.
echo Automated checks failed with exit code %checkExitCode%.
popd
exit /b %checkExitCode%
