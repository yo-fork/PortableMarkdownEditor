[CmdletBinding()]
param(
    [string]$BrowserPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Find-BrowserExecutable {
    if (![string]::IsNullOrWhiteSpace($BrowserPath)) {
        $resolved = [IO.Path]::GetFullPath($BrowserPath)
        if (!(Test-Path -LiteralPath $resolved -PathType Leaf)) {
            throw "Browser executable was not found: $resolved"
        }
        return $resolved
    }

    $candidates = @(
        (Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:LOCALAPPDATA 'Microsoft\Edge\Application\msedge.exe'),
        (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
        (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
        (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
    )
    foreach ($candidate in $candidates) {
        if (Test-Path -LiteralPath $candidate -PathType Leaf) {
            return [IO.Path]::GetFullPath($candidate)
        }
    }
    throw 'Microsoft Edge or Google Chrome was not found. A local Chromium browser is required for browser checks.'
}

$browserExecutable = Find-BrowserExecutable
$nodeExecutable = (Get-Command node.exe -ErrorAction Stop).Source
& $nodeExecutable (Join-Path $PSScriptRoot 'browser-check.mjs') --browser $browserExecutable
if ($LASTEXITCODE -ne 0) {
    throw "Browser checks failed with exit code $LASTEXITCODE."
}
