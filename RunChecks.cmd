@echo off
setlocal
pushd "%~dp0"

set "skipReleasePackage=0"
if "%~1"=="" goto :argumentsReady
if /I not "%~1"=="-SkipReleasePackage" goto :usage
if not "%~2"=="" goto :usage
set "skipReleasePackage=1"

:argumentsReady
echo.
echo ^> node --check app.js
node --check app.js
if errorlevel 1 goto :failed

echo.
echo ^> node --check modules\markdown-renderer.js
node --check modules\markdown-renderer.js
if errorlevel 1 goto :failed

echo.
echo ^> node --check modules\rich-editor.js
node --check modules\rich-editor.js
if errorlevel 1 goto :failed

echo.
echo ^> node --check modules\rich-input-controller.js
node --check modules\rich-input-controller.js
if errorlevel 1 goto :failed

echo.
echo ^> node --check modules\file-manager.js
node --check modules\file-manager.js
if errorlevel 1 goto :failed

echo.
echo ^> node --check modules\shortcut-manager.js
node --check modules\shortcut-manager.js
if errorlevel 1 goto :failed

echo.
echo ^> node tests\shortcut-manager-check.mjs
node tests\shortcut-manager-check.mjs
if errorlevel 1 goto :failed

echo.
echo ^> node tests\icon-assets-check.mjs
node tests\icon-assets-check.mjs
if errorlevel 1 goto :failed

echo.
echo ^> node tests\repository-hygiene-check.mjs
node tests\repository-hygiene-check.mjs
if errorlevel 1 goto :failed

echo.
echo ^> node tests\lint-security.mjs
node tests\lint-security.mjs
if errorlevel 1 goto :failed

echo.
echo ^> node tests\security-smoke.mjs
node tests\security-smoke.mjs
if errorlevel 1 goto :failed

echo.
echo ^> node tests\desktop-host-static-check.mjs
node tests\desktop-host-static-check.mjs
if errorlevel 1 goto :failed

if "%skipReleasePackage%"=="1" goto :releasePackageReady
echo.
echo ^> powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests\Check-ReleasePackage.ps1
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests\Check-ReleasePackage.ps1
if errorlevel 1 goto :failed

:releasePackageReady
echo.
echo ^> powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests\Run-BrowserChecks.ps1
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests\Run-BrowserChecks.ps1
if errorlevel 1 goto :failed

echo.
echo ^> node tests\rendering-quality-check.mjs
node tests\rendering-quality-check.mjs
if errorlevel 1 goto :failed

echo.
echo ^> node tests\vendor-static-check.mjs
node tests\vendor-static-check.mjs
if errorlevel 1 goto :failed

echo.
echo ^> node tests\vendor-audit.mjs
node tests\vendor-audit.mjs
if errorlevel 1 goto :failed

echo.
echo All automated checks passed.
popd
exit /b 0

:usage
echo Usage: RunChecks.cmd [-SkipReleasePackage]
popd
exit /b 2

:failed
set "checkExitCode=%errorlevel%"
echo.
echo Automated checks failed with exit code %checkExitCode%.
popd
exit /b %checkExitCode%
