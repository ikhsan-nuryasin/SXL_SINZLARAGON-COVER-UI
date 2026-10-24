[CmdletBinding()]
param(
    [string]$LaragonRoot = $env:LARAGON_ROOT,
    [string]$BuildRoot,
    [switch]$KeepExistingLaragonShortcuts
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($BuildRoot)) {
    $BuildRoot = Join-Path $projectRoot 'out'
}
$BuildRoot = [System.IO.Path]::GetFullPath($BuildRoot)

function Test-LaragonRoot([string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return $false }
    return ((Test-Path -LiteralPath (Join-Path $Path 'laragon.exe') -PathType Leaf) -and (Test-Path -LiteralPath (Join-Path $Path 'bin') -PathType Container))
}

if ([string]::IsNullOrWhiteSpace($LaragonRoot) -or -not (Test-LaragonRoot $LaragonRoot)) {
    # First inspect ancestors (useful when the source project itself is extracted inside C:\laragon).
    $cursor = Get-Item -LiteralPath $projectRoot
    while ($cursor) {
        if (Test-LaragonRoot $cursor.FullName) {
            $LaragonRoot = $cursor.FullName
            break
        }
        $cursor = $cursor.Parent
    }
}
if ([string]::IsNullOrWhiteSpace($LaragonRoot) -or -not (Test-LaragonRoot $LaragonRoot)) {
    foreach ($candidate in @('C:\laragon', 'D:\laragon', 'E:\laragon', "$env:ProgramFiles\Laragon", "${env:ProgramFiles(x86)}\Laragon")) {
        if (Test-LaragonRoot $candidate) {
            $LaragonRoot = $candidate
            break
        }
    }
}
if ([string]::IsNullOrWhiteSpace($LaragonRoot) -or -not (Test-LaragonRoot $LaragonRoot)) {
    throw 'Folder Laragon tidak terdeteksi. Jalankan ulang dengan -LaragonRoot "C:\laragon".'
}
$LaragonRoot = [System.IO.Path]::GetFullPath($LaragonRoot)

if (-not (Test-Path -LiteralPath $BuildRoot -PathType Container)) {
    throw "Folder hasil build tidak ditemukan: $BuildRoot. Jalankan 'npm run package' terlebih dahulu."
}
$builtExe = Get-ChildItem -LiteralPath $BuildRoot -Filter 'sxl-cover.exe' -File -Recurse -ErrorAction SilentlyContinue |
    Select-Object -First 1
if (-not $builtExe) {
    # Legacy build support for an existing v0.9.x out folder.
    $builtExe = Get-ChildItem -LiteralPath $BuildRoot -Filter 'laragon-x-sinz-ui.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
}
if (-not $builtExe) {
    $found = Get-ChildItem -LiteralPath $BuildRoot -Filter '*.exe' -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty FullName
    if ($found) {
        throw "Executable sxl-cover.exe atau legacy laragon-x-sinz-ui.exe tidak ditemukan. EXE yang ditemukan:`n$($found -join "`n")"
    }
    throw "Tidak ada file EXE di '$BuildRoot'. Jalankan 'npm run package' dahulu."
}

$sourceDir = [System.IO.Path]::GetFullPath($builtExe.DirectoryName)
$targetDir = Join-Path $LaragonRoot 'sinz-ui'
$targetDirFull = [System.IO.Path]::GetFullPath($targetDir)
if ([string]::Equals($sourceDir.TrimEnd('\'), $targetDirFull.TrimEnd('\'), [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Folder build dan folder instalasi tidak boleh sama.'
}

New-Item -ItemType Directory -Path $targetDirFull -Force | Out-Null
Write-Host "Menyalin paket UI ke: $targetDirFull" -ForegroundColor Cyan
Get-ChildItem -LiteralPath $sourceDir -Force | ForEach-Object {
    Copy-Item -LiteralPath $_.FullName -Destination $targetDirFull -Recurse -Force
}

$installedExe = Join-Path $targetDirFull $builtExe.Name
if (-not (Test-Path -LiteralPath $installedExe -PathType Leaf)) {
    throw "Penyalinan selesai, tetapi EXE tidak ditemukan di: $installedExe"
}

# Create / redirect shortcuts directly here. Do not call a second .ps1 script:
# this avoids parameter-contract mismatches when an older shortcut script remains in the folder.
$nativeExe = [System.IO.Path]::GetFullPath((Join-Path $LaragonRoot 'laragon.exe'))
$desktop = [Environment]::GetFolderPath('DesktopDirectory')
if ([string]::IsNullOrWhiteSpace($desktop) -or -not (Test-Path -LiteralPath $desktop -PathType Container)) {
    throw 'Folder Desktop tidak ditemukan.'
}
$programs = @(
    [Environment]::GetFolderPath('Programs'),
    [Environment]::GetFolderPath('CommonPrograms')
) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique
$locations = @($desktop) + @($programs) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) -and (Test-Path -LiteralPath $_ -PathType Container) } | Select-Object -Unique
$wsh = New-Object -ComObject WScript.Shell

function Get-ShortcutTarget([string]$ShortcutPath) {
    try {
        $shortcut = $wsh.CreateShortcut($ShortcutPath)
        if ([string]::IsNullOrWhiteSpace($shortcut.TargetPath)) { return '' }
        return [System.IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($shortcut.TargetPath))
    } catch { return '' }
}

function Set-SinzShortcut([string]$ShortcutPath) {
    $shortcut = $wsh.CreateShortcut($ShortcutPath)
    $shortcut.TargetPath = $installedExe
    $shortcut.Arguments = "--laragon-root `"$LaragonRoot`""
    $shortcut.WorkingDirectory = $LaragonRoot
    $shortcut.IconLocation = "$installedExe,0"
    $shortcut.Description = 'SXL Cover is an alternative desktop cover UI for managing an existing Laragon workspace.'
    $shortcut.Save()
}

$changed = 0
if (-not $KeepExistingLaragonShortcuts) {
    $nativeShortcuts = @()
    foreach ($location in $locations) {
        Get-ChildItem -LiteralPath $location -Filter '*.lnk' -File -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
            $target = Get-ShortcutTarget $_.FullName
            if ($target -and [string]::Equals($target, $nativeExe, [System.StringComparison]::OrdinalIgnoreCase)) {
                $nativeShortcuts += $_.FullName
            }
        }
    }

    foreach ($shortcutPath in ($nativeShortcuts | Select-Object -Unique)) {
        try {
            $targetNow = Get-ShortcutTarget $shortcutPath
            if ([string]::Equals($targetNow, $installedExe, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
            $backupPath = "$shortcutPath.native-backup.lnk"
            if (-not (Test-Path -LiteralPath $backupPath)) {
                Copy-Item -LiteralPath $shortcutPath -Destination $backupPath
            }
            Set-SinzShortcut -ShortcutPath $shortcutPath
            $changed++
            Write-Host "Shortcut dialihkan: $shortcutPath"
        } catch {
            Write-Warning "Tidak dapat mengubah shortcut '$shortcutPath'. Mungkin perlu izin yang sesuai. $($_.Exception.Message)"
        }
    }
}


# Retire the legacy branded shortcut after backing it up, so the Desktop does not show two competing UIs.
$legacyBrand = Join-Path $desktop 'Laragon X Sinz UI.lnk'
if (Test-Path -LiteralPath $legacyBrand) {
    $legacyTarget = Get-ShortcutTarget $legacyBrand
    if ($legacyTarget -and ([System.IO.Path]::GetFileName($legacyTarget) -ieq 'laragon-x-sinz-ui.exe')) {
        $legacyBackup = "$legacyBrand.legacy-backup.lnk"
        if (-not (Test-Path -LiteralPath $legacyBackup)) { Copy-Item -LiteralPath $legacyBrand -Destination $legacyBackup }
        Remove-Item -LiteralPath $legacyBrand -Force
        Write-Host "Shortcut lama dicadangkan dan diganti dengan SXL Cover: $legacyBackup"
    }
}

# Always create a branded desktop shortcut to the new UI.
$desktopBrand = Join-Path $desktop 'SXL Cover.lnk'
$existingTarget = if (Test-Path -LiteralPath $desktopBrand) { Get-ShortcutTarget $desktopBrand } else { '' }
if (-not [string]::Equals($existingTarget, $installedExe, [System.StringComparison]::OrdinalIgnoreCase)) {
    if (Test-Path -LiteralPath $desktopBrand) {
        $backup = "$desktopBrand.previous.lnk"
        if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $desktopBrand -Destination $backup }
    }
    Set-SinzShortcut -ShortcutPath $desktopBrand
}

Write-Host ''
Write-Host 'Instalasi SXL Cover selesai.' -ForegroundColor Green
Write-Host "Folder aplikasi: $targetDirFull"
Write-Host "Laragon root  : $LaragonRoot"
Write-Host "Shortcut native yang dialihkan: $changed"
Write-Host 'Shortcut asli disimpan dengan akhiran .native-backup.lnk jika ada yang dialihkan.'
Write-Host 'File inti Laragon tidak ditimpa. Aplikasi ditempatkan di subfolder sinz-ui.'
if ($KeepExistingLaragonShortcuts) {
    Write-Host 'Shortcut Laragon asli dipertahankan. Gunakan shortcut desktop SXL Cover.'
}
