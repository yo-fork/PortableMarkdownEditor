[CmdletBinding()]
param(
    [switch]$SkipZip
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$repoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$projectPath = Join-Path $repoRoot 'native\PortableMarkdownEditor.Desktop.csproj'
$nativeChecksProjectPath = Join-Path $repoRoot 'tests\native\PortableMarkdownEditor.NativeChecks.csproj'
$buildRoot = Join-Path $repoRoot 'artifacts\portable-windows'
$buildOutput = Join-Path $buildRoot 'bin'
$intermediateOutput = Join-Path $buildRoot 'obj'
$nativeChecksOutput = Join-Path $buildRoot 'checks-bin'
$nativeChecksIntermediateOutput = Join-Path $buildRoot 'checks-obj'
$distParent = Join-Path $repoRoot 'dist'
$distRoot = Join-Path $distParent 'PortableMarkdownEditor'
$zipPath = Join-Path $distParent 'PortableMarkdownEditor-win-x64.zip'
$requiredWebView2Version = '1.0.2903.40'

function Assert-GeneratedPath {
    param([Parameter(Mandatory = $true)][string]$Path)

    $resolved = [IO.Path]::GetFullPath($Path)
    $repoPrefix = $repoRoot.TrimEnd('\') + '\'
    if (!$resolved.StartsWith($repoPrefix, [StringComparison]::OrdinalIgnoreCase) -or $resolved -eq $repoRoot) {
        throw "Generated path is outside the repository: $resolved"
    }

    return $resolved
}

function Find-WebView2Toolchain {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (!(Test-Path -LiteralPath $vswhere)) {
        throw 'Visual Studio Installer vswhere.exe was not found.'
    }

    $installations = @(& $vswhere -all -products * -requires Microsoft.Component.MSBuild -property installationPath)
    foreach ($installation in $installations) {
        if ([string]::IsNullOrWhiteSpace($installation)) {
            continue
        }

        $msbuild = Join-Path $installation 'MSBuild\Current\Bin\MSBuild.exe'
        $sdkDirectory = Join-Path $installation 'Common7\IDE\PrivateAssemblies'
        $core = Join-Path $sdkDirectory 'Microsoft.Web.WebView2.Core.dll'
        $wpf = Join-Path $sdkDirectory 'Microsoft.Web.WebView2.Wpf.dll'
        $loader = Join-Path $installation 'Common7\IDE\CommonExtensions\Microsoft\Markdown\runtimes\win-x64\native\WebView2Loader.dll'
        if (!(Test-Path -LiteralPath $loader)) {
            $loader = Get-ChildItem -LiteralPath (Join-Path $installation 'Common7\IDE') -Recurse -File -Filter 'WebView2Loader.dll' -ErrorAction SilentlyContinue |
                Where-Object { $_.FullName -match 'runtimes[\\/]win-x64[\\/]native[\\/]WebView2Loader\.dll$' } |
                Select-Object -First 1 -ExpandProperty FullName
        }

        if ((Test-Path -LiteralPath $msbuild) -and (Test-Path -LiteralPath $core) -and (Test-Path -LiteralPath $wpf) -and $loader -and (Test-Path -LiteralPath $loader)) {
            $coreVersion = (Get-Item -LiteralPath $core).VersionInfo.FileVersion
            $wpfVersion = (Get-Item -LiteralPath $wpf).VersionInfo.FileVersion
            $loaderVersion = (Get-Item -LiteralPath $loader).VersionInfo.FileVersion
            if ($coreVersion -ne $wpfVersion -or $coreVersion -ne $loaderVersion -or $coreVersion -ne $requiredWebView2Version) {
                continue
            }

            return [pscustomobject]@{
                Installation = $installation
                MsBuild = $msbuild
                SdkDirectory = $sdkDirectory
                Loader = $loader
                Version = $coreVersion
            }
        }
    }

    throw "Visual Studio Build Tools with WebView2 $requiredWebView2Version Core, WPF, and Loader files were not found."
}

$buildRoot = Assert-GeneratedPath $buildRoot
$distRoot = Assert-GeneratedPath $distRoot
$zipPath = Assert-GeneratedPath $zipPath

$toolchain = Find-WebView2Toolchain
Write-Host "WebView2 SDK: $($toolchain.Version)"
Write-Host "MSBuild: $($toolchain.MsBuild)"

$frameworkArguments = @()
$targetingPack = Join-Path ${env:ProgramFiles(x86)} 'Reference Assemblies\Microsoft\Framework\.NETFramework\v4.8\mscorlib.dll'
if (!(Test-Path -LiteralPath $targetingPack)) {
    $frameworkRuntime = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319'
    $requiredRuntimeFiles = @(
        (Join-Path $frameworkRuntime 'mscorlib.dll'),
        (Join-Path $frameworkRuntime 'System.Xaml.dll'),
        (Join-Path $frameworkRuntime 'WPF\PresentationCore.dll'),
        (Join-Path $frameworkRuntime 'WPF\PresentationFramework.dll'),
        (Join-Path $frameworkRuntime 'WPF\WindowsBase.dll')
    )
    if ($requiredRuntimeFiles.Where({ !(Test-Path -LiteralPath $_) }).Count -ne 0) {
        throw '.NET Framework 4.8 reference assemblies or compatible runtime assemblies were not found.'
    }
    $frameworkArguments += "/p:FrameworkPathOverride=$frameworkRuntime"
    $frameworkArguments += "/p:FrameworkRuntimeDirectory=$frameworkRuntime"
    Write-Host 'Targeting pack: using installed .NET Framework 4.8 runtime assemblies'
}

foreach ($generatedPath in @($buildRoot, $distRoot)) {
    if (Test-Path -LiteralPath $generatedPath) {
        Remove-Item -LiteralPath $generatedPath -Recurse -Force
    }
}
if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
}

New-Item -ItemType Directory -Path $buildOutput -Force | Out-Null
New-Item -ItemType Directory -Path $intermediateOutput -Force | Out-Null
New-Item -ItemType Directory -Path $distRoot -Force | Out-Null

$msbuildArguments = @(
    $projectPath,
    '/nologo',
    '/m',
    '/t:Rebuild',
    '/p:Configuration=Release',
    '/p:Platform=x64',
    "/p:WebView2SdkDirectory=$($toolchain.SdkDirectory)",
    "/p:OutDir=$($buildOutput.TrimEnd('\'))\",
    "/p:IntermediateOutputPath=$($intermediateOutput.TrimEnd('\'))\"
)
$msbuildArguments += $frameworkArguments
& $toolchain.MsBuild @msbuildArguments
if ($LASTEXITCODE -ne 0) {
    throw "MSBuild failed with exit code $LASTEXITCODE."
}

New-Item -ItemType Directory -Path $nativeChecksOutput -Force | Out-Null
New-Item -ItemType Directory -Path $nativeChecksIntermediateOutput -Force | Out-Null
$nativeChecksArguments = @(
    $nativeChecksProjectPath,
    '/nologo',
    '/m',
    '/t:Rebuild',
    '/p:Configuration=Release',
    '/p:Platform=x64',
    "/p:OutDir=$($nativeChecksOutput.TrimEnd('\'))\",
    "/p:IntermediateOutputPath=$($nativeChecksIntermediateOutput.TrimEnd('\'))\"
)
$nativeChecksArguments += $frameworkArguments
& $toolchain.MsBuild @nativeChecksArguments
if ($LASTEXITCODE -ne 0) {
    throw "Native checks build failed with exit code $LASTEXITCODE."
}

$nativeChecksExecutable = Join-Path $nativeChecksOutput 'PortableMarkdownEditor.NativeChecks.exe'
& $nativeChecksExecutable
if ($LASTEXITCODE -ne 0) {
    throw "Native checks failed with exit code $LASTEXITCODE."
}

$nativeFiles = @(
    'PortableMarkdownEditor.exe',
    'PortableMarkdownEditor.exe.config',
    'Microsoft.Web.WebView2.Core.dll',
    'Microsoft.Web.WebView2.Wpf.dll'
)
foreach ($fileName in $nativeFiles) {
    $source = Join-Path $buildOutput $fileName
    if (!(Test-Path -LiteralPath $source)) {
        throw "Build output was not found: $source"
    }
    Copy-Item -LiteralPath $source -Destination (Join-Path $distRoot $fileName)
}
Copy-Item -LiteralPath $toolchain.Loader -Destination (Join-Path $distRoot 'WebView2Loader.dll')

$webRoot = Join-Path $distRoot 'app'
New-Item -ItemType Directory -Path $webRoot -Force | Out-Null
foreach ($webFile in @('index.html', 'app.js', 'styles.css')) {
    Copy-Item -LiteralPath (Join-Path $repoRoot $webFile) -Destination (Join-Path $webRoot $webFile)
}
Copy-Item -LiteralPath (Join-Path $repoRoot 'vendor') -Destination (Join-Path $webRoot 'vendor') -Recurse
Copy-Item -LiteralPath (Join-Path $repoRoot 'LICENSE') -Destination (Join-Path $distRoot 'LICENSE')
Copy-Item -LiteralPath (Join-Path $repoRoot 'native\README-WINDOWS.txt') -Destination (Join-Path $distRoot 'README.txt')
Copy-Item -LiteralPath (Join-Path $repoRoot 'native\THIRD-PARTY-NOTICES.txt') -Destination (Join-Path $distRoot 'THIRD-PARTY-NOTICES.txt')

$buildInfo = @(
    'Portable Markdown Editor Windows portable build',
    "WebView2 SDK: $($toolchain.Version)",
    'Target: .NET Framework 4.8 / Windows x64',
    "Built: $([DateTime]::Now.ToString('yyyy-MM-dd HH:mm:ss zzz'))"
) -join [Environment]::NewLine
Set-Content -LiteralPath (Join-Path $distRoot 'BUILD-INFO.txt') -Value $buildInfo -Encoding UTF8

if (!$SkipZip) {
    New-Item -ItemType Directory -Path $distParent -Force | Out-Null
    Compress-Archive -LiteralPath $distRoot -DestinationPath $zipPath -CompressionLevel Optimal
}

Write-Host ''
Write-Host "Portable folder: $distRoot"
if (!$SkipZip) {
    Write-Host "ZIP: $zipPath"
}
