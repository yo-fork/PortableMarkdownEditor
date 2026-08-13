[CmdletBinding()]
param(
    [string]$ZipPath = 'dist\PortableMarkdownEditor-win-x64.zip',
    [string]$ReleaseDirectory = 'release'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$resolvedZipPath = if ([IO.Path]::IsPathRooted($ZipPath)) {
    [IO.Path]::GetFullPath($ZipPath)
} else {
    [IO.Path]::GetFullPath((Join-Path $repoRoot $ZipPath))
}
$resolvedReleaseDirectory = if ([IO.Path]::IsPathRooted($ReleaseDirectory)) {
    [IO.Path]::GetFullPath($ReleaseDirectory)
} else {
    [IO.Path]::GetFullPath((Join-Path $repoRoot $ReleaseDirectory))
}

function Assert-RepositoryPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = [IO.Path]::GetFullPath($Path)
    $repoPrefix = $repoRoot.TrimEnd('\') + '\'
    if (!$resolved.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or $resolved -eq $repoRoot) {
        throw "Publish path is outside the repository: $resolved"
    }
    return $resolved
}

function Get-Sha256Hex {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace('-', '').ToLowerInvariant()
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

$resolvedZipPath = Assert-RepositoryPath $resolvedZipPath
$resolvedReleaseDirectory = Assert-RepositoryPath $resolvedReleaseDirectory
$licenseSource = Join-Path $repoRoot 'LICENSE'
$noticesSource = Join-Path $repoRoot 'native\THIRD-PARTY-NOTICES.txt'
foreach ($requiredPath in @($resolvedZipPath, $licenseSource, $noticesSource)) {
    if (!(Test-Path -LiteralPath $requiredPath -PathType Leaf)) {
        throw "Publish source was not found: $requiredPath"
    }
}

New-Item -ItemType Directory -Path $resolvedReleaseDirectory -Force | Out-Null
$suffix = '.publishing-' + [Guid]::NewGuid().ToString('N') + '.tmp'
$publishedZipPath = Join-Path $resolvedReleaseDirectory 'PortableMarkdownEditor-win-x64.zip'
$publishedLicensePath = Join-Path $resolvedReleaseDirectory 'LICENSE'
$publishedNoticesPath = Join-Path $resolvedReleaseDirectory 'THIRD-PARTY-NOTICES.txt'
$checksumPath = Join-Path $resolvedReleaseDirectory 'SHA256SUMS.txt'
$temporaryZipPath = $publishedZipPath + $suffix
$temporaryLicensePath = $publishedLicensePath + $suffix
$temporaryNoticesPath = $publishedNoticesPath + $suffix
$temporaryChecksumPath = $checksumPath + $suffix
$temporaryPaths = @($temporaryZipPath, $temporaryLicensePath, $temporaryNoticesPath, $temporaryChecksumPath)

try {
    Copy-Item -LiteralPath $resolvedZipPath -Destination $temporaryZipPath
    Copy-Item -LiteralPath $licenseSource -Destination $temporaryLicensePath
    Copy-Item -LiteralPath $noticesSource -Destination $temporaryNoticesPath
    $publishedHash = Get-Sha256Hex $temporaryZipPath
    $checksumLine = "$publishedHash  $([IO.Path]::GetFileName($publishedZipPath))`n"
    [IO.File]::WriteAllText($temporaryChecksumPath, $checksumLine, [Text.Encoding]::ASCII)

    Move-Item -LiteralPath $temporaryLicensePath -Destination $publishedLicensePath -Force
    Move-Item -LiteralPath $temporaryNoticesPath -Destination $publishedNoticesPath -Force
    Move-Item -LiteralPath $temporaryZipPath -Destination $publishedZipPath -Force
    Move-Item -LiteralPath $temporaryChecksumPath -Destination $checksumPath -Force
}
finally {
    foreach ($temporaryPath in $temporaryPaths) {
        if (Test-Path -LiteralPath $temporaryPath) {
            Remove-Item -LiteralPath $temporaryPath -Force
        }
    }
}

Write-Host "Published ZIP: $publishedZipPath"
Write-Host "SHA-256: $checksumPath"
Write-Host "License: $publishedLicensePath"
Write-Host "Third-party notices: $publishedNoticesPath"
