[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ExecutablePath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$resolvedExecutable = [IO.Path]::GetFullPath($ExecutablePath)
if (!(Test-Path -LiteralPath $resolvedExecutable -PathType Leaf)) {
    throw "PortableMarkdownEditor.exe was not found: $resolvedExecutable"
}

$assembly = [Reflection.Assembly]::LoadFrom($resolvedExecutable)
$windowType = $assembly.GetType('PortableMarkdownEditor.Desktop.MainWindow', $true)
$window = [Activator]::CreateInstance($windowType)
$instanceFlags = [Reflection.BindingFlags]::Instance -bor [Reflection.BindingFlags]::NonPublic
$themeField = $windowType.GetField('_themeController', $instanceFlags)
if ($null -eq $themeField) {
    throw 'MainWindow theme controller field was not found.'
}

$themeController = $themeField.GetValue($window)
$applyMethod = $themeController.GetType().GetMethod('Apply', $instanceFlags)
if ($null -eq $applyMethod) {
    throw 'Native theme apply method was not found.'
}

function Assert-ThemeColor {
    param(
        [Parameter(Mandatory = $true)][object]$Window,
        [Parameter(Mandatory = $true)][string]$ResourceName,
        [Parameter(Mandatory = $true)][string]$ExpectedColor
    )

    $brush = $Window.Resources[$ResourceName]
    if ($null -eq $brush -or $brush.Color.ToString() -ne $ExpectedColor) {
        $actual = if ($null -eq $brush) { '<missing>' } else { $brush.Color.ToString() }
        throw "$ResourceName color mismatch. Expected $ExpectedColor, actual $actual."
    }
}

$applyMethod.Invoke($themeController, @($true)) | Out-Null
Assert-ThemeColor -Window $window -ResourceName 'NativeWindowBackgroundBrush' -ExpectedColor '#FF111827'
Assert-ThemeColor -Window $window -ResourceName 'NativeSurfaceBrush' -ExpectedColor '#FF182235'
Assert-ThemeColor -Window $window -ResourceName 'NativeTextBrush' -ExpectedColor '#FFEEF2FF'
$webView = $window.FindName('EditorWebView')
if ($null -eq $webView -or $webView.DefaultBackgroundColor.R -ne 0x11 -or $webView.DefaultBackgroundColor.G -ne 0x18 -or $webView.DefaultBackgroundColor.B -ne 0x27) {
    throw 'WebView2 dark loading background was not applied.'
}

$applyMethod.Invoke($themeController, @($false)) | Out-Null
Assert-ThemeColor -Window $window -ResourceName 'NativeWindowBackgroundBrush' -ExpectedColor '#FFF5F6F8'
Assert-ThemeColor -Window $window -ResourceName 'NativeSurfaceBrush' -ExpectedColor '#FFFFFFFF'
Assert-ThemeColor -Window $window -ResourceName 'NativeTextBrush' -ExpectedColor '#FF20242A'
if ($webView.DefaultBackgroundColor.R -ne 0xF5 -or $webView.DefaultBackgroundColor.G -ne 0xF6 -or $webView.DefaultBackgroundColor.B -ne 0xF8) {
    throw 'WebView2 light loading background was not applied.'
}

Write-Host 'native theme checks passed'
