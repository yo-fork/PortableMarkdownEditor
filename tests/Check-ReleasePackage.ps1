[CmdletBinding()]
param(
    [string]$ZipPath,
    [string]$ChecksumPath,
    [switch]$SkipChecksum,
    [switch]$SkipPublishedLegalCopies
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resolvedZipPath = if ([string]::IsNullOrWhiteSpace($ZipPath)) {
    Join-Path $repoRoot 'release\PortableMarkdownEditor-win-x64.zip'
} elseif ([IO.Path]::IsPathRooted($ZipPath)) {
    [IO.Path]::GetFullPath($ZipPath)
} else {
    [IO.Path]::GetFullPath((Join-Path $repoRoot $ZipPath))
}
$resolvedChecksumPath = if ([string]::IsNullOrWhiteSpace($ChecksumPath)) {
    Join-Path $repoRoot 'release\SHA256SUMS.txt'
} elseif ([IO.Path]::IsPathRooted($ChecksumPath)) {
    [IO.Path]::GetFullPath($ChecksumPath)
} else {
    [IO.Path]::GetFullPath((Join-Path $repoRoot $ChecksumPath))
}
$publishedLicensePath = Join-Path $repoRoot 'release\LICENSE'
$publishedNoticesPath = Join-Path $repoRoot 'release\THIRD-PARTY-NOTICES.txt'
$assemblyInfoPath = Join-Path $repoRoot 'native\Properties\AssemblyInfo.cs'
$defaultPublishedZipPath = [IO.Path]::GetFullPath((Join-Path $repoRoot 'release\PortableMarkdownEditor-win-x64.zip'))
$isDefaultPublishedZip = [string]::Equals(
    $resolvedZipPath,
    $defaultPublishedZipPath,
    [StringComparison]::OrdinalIgnoreCase)

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

function Get-CurrentSourceRevision {
    $sourceRevisionOutput = @(& git.exe -C $repoRoot rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -ne 0 -or $sourceRevisionOutput.Count -ne 1) {
        throw 'The source Git revision could not be determined.'
    }

    $sourceRevision = $sourceRevisionOutput[0].Trim().ToLowerInvariant()
    if ($sourceRevision -notmatch '^[0-9a-f]{40}$') {
        throw "The source Git revision is invalid: $sourceRevision"
    }
    return $sourceRevision
}

function Assert-PackageSourceRevision {
    param(
        [Parameter(Mandatory = $true)][string]$PackageRevision,
        [Parameter(Mandatory = $true)][string]$CurrentRevision
    )

    if ($PackageRevision -eq $CurrentRevision) {
        return
    }
    if (!$isDefaultPublishedZip) {
        throw "BUILD-INFO.txt identifies source revision $PackageRevision instead of current revision $CurrentRevision."
    }

    & git.exe -C $repoRoot merge-base --is-ancestor $PackageRevision $CurrentRevision 2>$null
    if ($LASTEXITCODE -ne 0) {
        throw "Published source revision $PackageRevision is not an ancestor of current revision $CurrentRevision."
    }

    $changedPathOutput = @(& git.exe -C $repoRoot diff --name-only --no-renames "$PackageRevision..$CurrentRevision" -- 2>$null)
    if ($LASTEXITCODE -ne 0) {
        throw "Changes after published source revision $PackageRevision could not be inspected."
    }
    $releaseOnlyPaths = @(
        'release/PortableMarkdownEditor-win-x64.zip',
        'release/SHA256SUMS.txt',
        'release/LICENSE',
        'release/THIRD-PARTY-NOTICES.txt'
    )
    $unexpectedPaths = @($changedPathOutput | ForEach-Object {
        $_.Trim().Replace('\', '/')
    } | Where-Object {
        $_ -and $releaseOnlyPaths -notcontains $_
    })
    if ($unexpectedPaths.Count -ne 0) {
        throw "Published source revision $PackageRevision is followed by non-release changes: $($unexpectedPaths -join ', ')"
    }
}

$requiredPaths = @($resolvedZipPath)
if (!$SkipChecksum) {
    $requiredPaths += $resolvedChecksumPath
}
if (!$SkipPublishedLegalCopies) {
    $requiredPaths += @($publishedLicensePath, $publishedNoticesPath)
}
foreach ($requiredPath in $requiredPaths) {
    if (!(Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Release file was not found: $requiredPath"
    }
}

if (!$SkipPublishedLegalCopies) {
    $releaseSourceCopies = @{
        $publishedLicensePath = (Join-Path $repoRoot 'LICENSE')
        $publishedNoticesPath = (Join-Path $repoRoot 'native\THIRD-PARTY-NOTICES.txt')
    }
    foreach ($publishedPath in $releaseSourceCopies.Keys) {
        $publishedHash = Get-FileSha256Hex $publishedPath
        $sourceHash = Get-FileSha256Hex $releaseSourceCopies[$publishedPath]
        if ($publishedHash -ne $sourceHash) {
            throw "Published legal file differs from its source: $publishedPath"
        }
    }
}

$assemblyInfo = [IO.File]::ReadAllText($assemblyInfoPath)
$versionMatch = [regex]::Match($assemblyInfo, 'AssemblyInformationalVersion\("([0-9]+\.[0-9]+\.[0-9]+)"\)')
if (!$versionMatch.Success) {
    throw 'AssemblyInformationalVersion was not found in native\Properties\AssemblyInfo.cs.'
}
$expectedApplicationVersion = $versionMatch.Groups[1].Value
$currentSourceRevision = Get-CurrentSourceRevision

$actualZipHash = Get-FileSha256Hex $resolvedZipPath
if (!$SkipChecksum) {
    $checksumText = [IO.File]::ReadAllText($resolvedChecksumPath).Trim()
    $expectedZipName = [regex]::Escape([IO.Path]::GetFileName($resolvedZipPath))
    $checksumMatch = [regex]::Match($checksumText, "^([0-9a-f]{64})  $expectedZipName$")
    if (!$checksumMatch.Success) {
        throw 'SHA256SUMS.txt has an invalid format.'
    }
    if ($actualZipHash -ne $checksumMatch.Groups[1].Value) {
        throw "Release ZIP hash mismatch: expected $($checksumMatch.Groups[1].Value), got $actualZipHash"
    }
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [IO.Compression.ZipFile]::OpenRead($resolvedZipPath)
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
        'PortableMarkdownEditor/BUILD-INFO.txt',
        'PortableMarkdownEditor/app/index.html',
        'PortableMarkdownEditor/app/app.js',
        'PortableMarkdownEditor/app/modules/file-manager.js',
        'PortableMarkdownEditor/app/modules/markdown-renderer.js',
        'PortableMarkdownEditor/app/modules/rich-editor.js',
        'PortableMarkdownEditor/app/modules/rich-input-controller.js',
        'PortableMarkdownEditor/app/modules/shortcut-manager.js',
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

    $buildInfoStream = $entriesByName['PortableMarkdownEditor/BUILD-INFO.txt'].Open()
    try {
        $buildInfoReader = [IO.StreamReader]::new($buildInfoStream, [Text.Encoding]::UTF8, $true, 1024, $true)
        try {
            $buildInfo = $buildInfoReader.ReadToEnd()
        }
        finally {
            $buildInfoReader.Dispose()
        }
    }
    finally {
        $buildInfoStream.Dispose()
    }
    $escapedVersion = [regex]::Escape($expectedApplicationVersion)
    if ($buildInfo -notmatch "(?m)^Application version: $escapedVersion\r?$") {
        throw "BUILD-INFO.txt does not identify application version $expectedApplicationVersion."
    }
    $packageRevisionMatch = [regex]::Match($buildInfo, '(?m)^Source revision: ([0-9a-fA-F]{40})\r?$')
    if (!$packageRevisionMatch.Success) {
        throw 'BUILD-INFO.txt does not identify a valid source revision.'
    }
    $packageSourceRevision = $packageRevisionMatch.Groups[1].Value.ToLowerInvariant()
    Assert-PackageSourceRevision $packageSourceRevision $currentSourceRevision
    if ($buildInfo -notmatch '(?m)^Source tree: (clean|modified)\r?$') {
        throw 'BUILD-INFO.txt does not identify whether the source tree was clean or modified.'
    }

    $userDataEntries = @($archive.Entries | Where-Object {
        $_.FullName.StartsWith('PortableMarkdownEditor/data/WebView2/', [StringComparison]::Ordinal)
    })
    if ($userDataEntries.Count -ne 0) {
        throw "WebView2 user data must not be included in the release ZIP: $($userDataEntries[0].FullName)"
    }

    $sourceByEntry = @{
        'PortableMarkdownEditor/app/index.html' = (Join-Path $repoRoot 'index.html')
        'PortableMarkdownEditor/app/app.js' = (Join-Path $repoRoot 'app.js')
        'PortableMarkdownEditor/app/modules/file-manager.js' = (Join-Path $repoRoot 'modules\file-manager.js')
        'PortableMarkdownEditor/app/modules/markdown-renderer.js' = (Join-Path $repoRoot 'modules\markdown-renderer.js')
        'PortableMarkdownEditor/app/modules/rich-editor.js' = (Join-Path $repoRoot 'modules\rich-editor.js')
        'PortableMarkdownEditor/app/modules/rich-input-controller.js' = (Join-Path $repoRoot 'modules\rich-input-controller.js')
        'PortableMarkdownEditor/app/modules/shortcut-manager.js' = (Join-Path $repoRoot 'modules\shortcut-manager.js')
        'PortableMarkdownEditor/app/styles.css' = (Join-Path $repoRoot 'styles.css')
        'PortableMarkdownEditor/README.txt' = (Join-Path $repoRoot 'native\README-WINDOWS.txt')
        'PortableMarkdownEditor/LICENSE' = (Join-Path $repoRoot 'LICENSE')
        'PortableMarkdownEditor/THIRD-PARTY-NOTICES.txt' = (Join-Path $repoRoot 'native\THIRD-PARTY-NOTICES.txt')
    }
    foreach ($sourceDirectoryName in @('modules', 'vendor')) {
        $sourceDirectory = Join-Path $repoRoot $sourceDirectoryName
        foreach ($sourceFile in Get-ChildItem -LiteralPath $sourceDirectory -Recurse -File) {
            $relativeSourcePath = $sourceFile.FullName.Substring($repoRoot.TrimEnd('\').Length + 1).Replace('\', '/')
            $sourceByEntry["PortableMarkdownEditor/app/$relativeSourcePath"] = $sourceFile.FullName
        }
    }

    $appEntries = @($archive.Entries | Where-Object {
        ![string]::IsNullOrEmpty($_.Name) -and $_.FullName.StartsWith('PortableMarkdownEditor/app/', [StringComparison]::Ordinal)
    })
    foreach ($entry in $appEntries) {
        if (!$sourceByEntry.ContainsKey($entry.FullName)) {
            throw "Release ZIP contains an unexpected application file: $($entry.FullName)"
        }
    }
    foreach ($entryName in $sourceByEntry.Keys) {
        if (!$entriesByName.ContainsKey($entryName) -or $entriesByName[$entryName].Length -eq 0) {
            throw "Source application file is missing from the release ZIP: $entryName"
        }
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
