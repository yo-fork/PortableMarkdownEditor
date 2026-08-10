@echo off
setlocal
pushd "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0tools\Build-PortableWindows.ps1" %*
set "buildExitCode=%errorlevel%"
popd
exit /b %buildExitCode%
