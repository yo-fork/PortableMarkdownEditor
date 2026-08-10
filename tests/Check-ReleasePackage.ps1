[CmdletBinding()]
param()

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$zipPath = Join-Path $repoRoot 'release\PortableMarkdownEditor-win-x64.zip'
$checksumPath = Join-Path $repoRoot 'release\SHA256SUMS.txt'

function Get-StreamSha256Hex {
    param([Parameter(Mandatory = $true)][IO.Stream]$Stream)

    $sha256 = [Security.Cryptography.SHA256]::Create()
    try {
        return ([BitConverter]::ToString($sha256.ComputeHash($Stream))).Replace('-', '').ToLowerInvariant()
    }
    finally {
        $sha256.Dispose()
    }
}

function Get-FileSha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [IO.File]::OpenRead($Path)
    try {
        return Get-StreamSha256Hex $stream
    }
    finally {
        $stream.Dispose()
    }
}

foreach ($requiredPath in @($zipPath, $checksumPath)) {
    if (!(Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Release file was not found: $requiredPath"
    }
}

$checksumText = [IO.File]::ReadAllText($checksumPath).Trim()
$checksumMatch = [regex]::Match($checksumText, '^([0-9a-f]{64})  PortableMarkdownEditor-win-x64\.zip$')
if (!$checksumMatch.Success) {
    throw 'SHA256SUMS.txt has an invalid format.'
}

$actualZipHash = Get-FileSha256Hex $zipPath
if ($actualZipHash -ne $checksumMatch.Groups[1].Value) {
    throw "Release ZIP hash mismatch: expected $($checksumMatch.Groups[1].Value), got $actualZipHash"
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($zipPath)
try {
    $entriesByName = @{}
    foreach ($entry in $archive.Entries) {
        $entryName = $entry.FullName
        if ($entriesByName.ContainsKey($entryName)) {
            throw "Duplicate ZIP entry: $entryName"
        }
        if ([IO.Path]::IsPathRooted($entryName) -or $entryName -match '(^|/)\.\.(/|$)') {
            throw "Unsafe ZIP entry: $entryName"
        }
        $entriesByName[$entryName] = $entry
    }

    $requiredEntries = @(
        'PortableMarkdownEditor/PortableMarkdownEditor.exe',
        'PortableMarkdownEditor/PortableMarkdownEditor.exe.config',
        'PortableMarkdownEditor/Microsoft.Web.WebView2.Core.dll',
        'PortableMarkdownEditor/Microsoft.Web.WebView2.Wpf.dll',
        'PortableMarkdownEditor/WebView2Loader.dll',
        'PortableMarkdownEditor/README.txt',
        'PortableMarkdownEditor/LICENSE',
        'PortableMarkdownEditor/THIRD-PARTY-NOTICES.txt',
        'PortableMarkdownEditor/app/index.html',
        'PortableMarkdownEditor/app/app.js',
        'PortableMarkdownEditor/app/styles.css'
    )
    foreach ($entryName in $requiredEntries) {
        if (!$entriesByName.ContainsKey($entryName) -or $entriesByName[$entryName].Length -eq 0) {
            throw "Required ZIP entry was not found or was empty: $entryName"
        }
    }

    if ($entriesByName.ContainsKey('PortableMarkdownEditor/BuildPortableWindows.cmd')) {
        throw 'The developer build command must not be included in the release ZIP.'
    }

    $sourceByEntry = @{
        'PortableMarkdownEditor/app/index.html' = (Join-Path $repoRoot 'index.html')
        'PortableMarkdownEditor/app/app.js' = (Join-Path $repoRoot 'app.js')
        'PortableMarkdownEditor/app/styles.css' = (Join-Path $repoRoot 'styles.css')
        'PortableMarkdownEditor/README.txt' = (Join-Path $repoRoot 'native\README-WINDOWS.txt')
        'PortableMarkdownEditor/LICENSE' = (Join-Path $repoRoot 'LICENSE')
        'PortableMarkdownEditor/THIRD-PARTY-NOTICES.txt' = (Join-Path $repoRoot 'native\THIRD-PARTY-NOTICES.txt')
    }
    foreach ($entryName in $sourceByEntry.Keys) {
        $entryStream = $entriesByName[$entryName].Open()
        try {
            $entryHash = Get-StreamSha256Hex $entryStream
        }
        finally {
            $entryStream.Dispose()
        }
        $sourceHash = Get-FileSha256Hex $sourceByEntry[$entryName]
        if ($entryHash -ne $sourceHash) {
            throw "Release ZIP content differs from the source file: $entryName"
        }
    }

    Write-Host "release package checks passed ($($archive.Entries.Count) entries, SHA-256 $actualZipHash)"
}
finally {
    $archive.Dispose()
}
