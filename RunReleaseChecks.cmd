@echo off
setlocal
pushd "%~dp0"

set "publishRelease=0"
if "%~1"=="" goto :argumentsReady
if /I not "%~1"=="-Publish" goto :usage
if not "%~2"=="" goto :usage
set "publishRelease=1"

:argumentsReady
call :run call BuildPortableWindows.cmd || goto :failed
call :run powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests\Check-ReleasePackage.ps1 -ZipPath dist\PortableMarkdownEditor-win-x64.zip -SkipChecksum -SkipPublishedLegalCopies || goto :failed
call :run call RunChecks.cmd -SkipReleasePackage || goto :failed
if "%publishRelease%"=="0" goto :checksPassed
call :run powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tools\Publish-PortableWindows.ps1 || goto :failed
call :run powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File tests\Check-ReleasePackage.ps1 || goto :failed

:checksPassed
echo.
echo All release checks passed.
popd
exit /b 0

:run
echo.
echo ^> %*
%*
exit /b %errorlevel%

:usage
echo Usage: RunReleaseChecks.cmd [-Publish]
popd
exit /b 2

:failed
set "checkExitCode=%errorlevel%"
echo.
echo Release checks failed with exit code %checkExitCode%.
popd
exit /b %checkExitCode%
