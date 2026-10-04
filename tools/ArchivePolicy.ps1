function Assert-SafeArchiveEntry {
    param([Parameter(Mandatory = $true)]$Entry)

    $name = $Entry.FullName
    $directory = $name.EndsWith('/', [StringComparison]::Ordinal)
    $path = if ($directory) { $name.Substring(0, $name.Length - 1) } else { $name }
    if ([string]::IsNullOrEmpty($path) -or $path.Contains('\') -or $path.StartsWith('/') -or
        $path -match '[<>:"|?*\x00-\x1f]') {
        throw "Unsafe ZIP entry: $name"
    }
    foreach ($segment in $path.Split('/')) {
        if (!$segment -or $segment -eq '.' -or $segment -eq '..' -or $segment -match '[ .]$' -or
            $segment -match '^(con|prn|aux|nul|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)') {
            throw "Unsafe ZIP entry: $name"
        }
    }
    # ZIP may omit type flags (Compress-Archive does so for empty directories).
    # If present, only regular files/directories are supported, never links/devices.
    $attributes = [int64]$Entry.ExternalAttributes
    $unixType = ($attributes -shr 16) -band 0xf000
    if (($attributes -band 0x400) -ne 0 -or $unixType -notin @(0, 0x8000, 0x4000) -or
        ($unixType -eq 0x4000 -and !$directory) -or ($unixType -eq 0x8000 -and $directory) -or
        (($attributes -band 0x10) -ne 0 -and !$directory) -or ($directory -and $Entry.Length -ne 0)) {
        throw "Unsupported ZIP entry type: $name"
    }
}

function Assert-ArchiveInventory {
    param(
        [Parameter(Mandatory = $true)]$Entries,
        [Parameter(Mandatory = $true)][string[]]$Files,
        [Parameter(Mandatory = $true)][string[]]$Directories
    )

    $allowed = [Collections.Generic.HashSet[string]]::new([StringComparer]::Ordinal)
    foreach ($name in @($Files) + @($Directories)) { [void]$allowed.Add($name) }
    $seen = [Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
    foreach ($entry in $Entries) {
        Assert-SafeArchiveEntry $entry
        if (!$seen.Add($entry.FullName.TrimEnd('/'))) { throw "Duplicate ZIP entry: $($entry.FullName)" }
        if (!$allowed.Contains($entry.FullName)) { throw "Unexpected ZIP entry: $($entry.FullName)" }
    }
}
