[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$wsh = New-Object -ComObject WScript.Shell
$locations = @(
    [Environment]::GetFolderPath('DesktopDirectory'),
    [Environment]::GetFolderPath('Programs'),
    [Environment]::GetFolderPath('CommonPrograms')
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique
$restored = 0

foreach ($location in $locations) {
    Get-ChildItem -LiteralPath $location -Filter '*.native-backup.lnk' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        $backup = $_.FullName
        $originalName = $_.Name -replace '\.native-backup\.lnk$', ''
        $originalPath = Join-Path $_.DirectoryName $originalName
        $target = ''
        if (Test-Path -LiteralPath $originalPath) {
            try { $target = ($wsh.CreateShortcut($originalPath)).TargetPath } catch { }
        }

        if (-not (Test-Path -LiteralPath $originalPath) -or ($target -and [System.IO.Path]::GetFileName($target) -ieq 'sxl-cover.exe')) {
            if (Test-Path -LiteralPath $originalPath) { Remove-Item -LiteralPath $originalPath -Force }
            Move-Item -LiteralPath $backup -Destination $originalPath -Force
            Write-Host "Dipulihkan: $originalPath"
            $restored++
        } elseif ([string]::IsNullOrWhiteSpace($target) -or [System.IO.Path]::GetFileName($target) -ieq 'laragon.exe') {
            # The original link is already native (for example, if the install script couldn't write it).
            Remove-Item -LiteralPath $backup -Force
        } else {
            $suffix = 1
            do {
                $alternate = Join-Path $_.DirectoryName ("$originalName.restored-$suffix.lnk")
                $suffix++
            } while (Test-Path -LiteralPath $alternate)
            Move-Item -LiteralPath $backup -Destination $alternate -Force
            Write-Host "Dipulihkan sebagai salinan alternatif: $alternate"
            $restored++
        }
    }

    # Restore any pre-existing desktop shortcut that was overwritten by the branded entry.
    Get-ChildItem -LiteralPath $location -Filter '*.previous.lnk' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
        $backup = $_.FullName
        $originalName = $_.Name -replace '\.previous\.lnk$', ''
        $originalPath = Join-Path $_.DirectoryName $originalName
        if (Test-Path -LiteralPath $originalPath) { Remove-Item -LiteralPath $originalPath -Force }
        Move-Item -LiteralPath $backup -Destination $originalPath -Force
        Write-Host "Shortcut sebelumnya dipulihkan: $originalPath"
        $restored++
    }
}

# Remove the extra branded shortcut if it's still aimed at this app; existing original-name shortcuts were restored above.
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
$desktopBrand = Join-Path $desktop 'SXL Cover.lnk'
if (Test-Path -LiteralPath $desktopBrand) {
    try {
        $target = ($wsh.CreateShortcut($desktopBrand)).TargetPath
        if ([System.IO.Path]::GetFileName($target) -ieq 'sxl-cover.exe') {
            Remove-Item -LiteralPath $desktopBrand -Force
            Write-Host 'Shortcut SXL Cover yang ditambahkan dihapus.'
        }
    } catch { }
}

if ($restored -eq 0) {
    Write-Host 'Tidak ada shortcut backup yang ditemukan.' -ForegroundColor Yellow
} else {
    Write-Host "Selesai. Shortcut yang dipulihkan: $restored" -ForegroundColor Green
}
