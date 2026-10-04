Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\tools\ArchivePolicy.ps1')

function New-Entry([string]$Name, [int64]$Attributes = 0, [int64]$Size = 1) {
    [pscustomobject]@{ FullName = $Name; ExternalAttributes = $Attributes; Length = $Size }
}
function Assert-Rejected([scriptblock]$Action) {
    try { & $Action } catch { return }
    throw 'Unsafe archive input was accepted.'
}

foreach ($name in @('..\payload', 'PortableMarkdownEditor/app/x\..\payload', '../payload',
    '/root', '//server/share', 'C:/file', 'app/file:stream', 'app//file', 'app/./file',
    'app/../file', 'app/name.', 'app/name ', 'app/CON.txt', 'app/LPT1', "app/a`nb")) {
    Assert-Rejected { Assert-SafeArchiveEntry (New-Entry $name) }
}
foreach ($attrs in @((0xa000 -shl 16), (0x6000 -shl 16), 0x400, 0x10)) {
    Assert-Rejected { Assert-SafeArchiveEntry (New-Entry 'app/file' $attrs) }
}
Assert-Rejected { Assert-SafeArchiveEntry (New-Entry 'app/' 0 1) }
Assert-Rejected { Assert-SafeArchiveEntry (New-Entry ('app/COM' + [char]0xb9 + '.txt')) }
Assert-SafeArchiveEntry (New-Entry 'app/file.js')
Assert-SafeArchiveEntry (New-Entry 'app/file.js' (0x8000 -shl 16))
Assert-SafeArchiveEntry (New-Entry 'app/empty/' 0 0)
Assert-SafeArchiveEntry (New-Entry 'app/empty/' (0x4000 -shl 16) 0)
$files = @('PortableMarkdownEditor/app/file.js')
$dirs = @('PortableMarkdownEditor/', 'PortableMarkdownEditor/app/', 'PortableMarkdownEditor/app/empty/')
$normal = @((New-Entry $files[0]), (New-Entry $dirs[2] 0 0))
Assert-ArchiveInventory $normal $files $dirs
Assert-Rejected { Assert-ArchiveInventory @($normal + (New-Entry 'extra.exe')) $files $dirs }
Assert-Rejected { Assert-ArchiveInventory @($normal + (New-Entry 'PortableMarkdownEditor/extra.exe')) $files $dirs }
Assert-Rejected { Assert-ArchiveInventory @($normal + (New-Entry $files[0].ToUpperInvariant())) $files $dirs }
Assert-Rejected { Assert-ArchiveInventory @($normal + (New-Entry 'PortableMarkdownEditor/app/empty')) $files $dirs }
Write-Host 'release archive policy checks passed'
