[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$AppExe,

    [string]$LaragonRoot = $env:LARAGON_ROOT,

    [switch]$ReplaceExistingLaragonShortcuts
)

$ErrorActionPreference = 'Stop'
$AppExe = [System.IO.Path]::GetFullPath($AppExe)
if (-not (Test-Path -LiteralPath $AppExe -PathType Leaf)) {
    throw "File aplikasi tidak ditemukan: $AppExe"
}

if ([string]::IsNullOrWhiteSpace($LaragonRoot)) {
    foreach ($candidate in @('C:\laragon', 'D:\laragon', 'E:\laragon', "$env:ProgramFiles\Laragon", "${env:ProgramFiles(x86)}\Laragon")) {
        if (Test-Path -LiteralPath (Join-Path $candidate 'laragon.exe') -PathType Leaf) {
            $LaragonRoot = $candidate
            break
        }
    }
}
if ([string]::IsNullOrWhiteSpace($LaragonRoot)) {
    throw 'Lokasi Laragon tidak terdeteksi. Jalankan ulang dengan -LaragonRoot "C:\laragon".'
}
$LaragonRoot = [System.IO.Path]::GetFullPath($LaragonRoot)
$nativeExe = [System.IO.Path]::GetFullPath((Join-Path $LaragonRoot 'laragon.exe'))
if (-not (Test-Path -LiteralPath $nativeExe -PathType Leaf) -or -not (Test-Path -LiteralPath (Join-Path $LaragonRoot 'bin') -PathType Container)) {
    throw "Folder Laragon tidak lengkap: harus berisi laragon.exe dan folder bin. Folder yang hanya berisi laragon.exe tidak cukup. Path: $LaragonRoot"
}

$desktop = [Environment]::GetFolderPath('DesktopDirectory')
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
    $shortcut.TargetPath = $AppExe
    $shortcut.Arguments = "--laragon-root `"$LaragonRoot`""
    $shortcut.WorkingDirectory = $LaragonRoot
    $shortcut.IconLocation = "$AppExe,0"
    $shortcut.Description = 'Manage Laragon runtimes from the SXL Cover desktop interface.'
    $shortcut.Save()
}

$changed = 0
if ($ReplaceExistingLaragonShortcuts) {
    $nativeShortcuts = @()
    foreach ($location in $locations) {
        # Only inspect the user's Desktop and Start Menu shortcut trees, never Laragon's install directory.
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
            # Idempotent: don't back up a link that's already routed to SXL Cover.
            if ([string]::Equals($targetNow, $AppExe, [System.StringComparison]::OrdinalIgnoreCase)) { continue }
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

# Always provide the branded Desktop entry as a convenient default.
if (-not (Test-Path -LiteralPath $desktop -PathType Container)) {
    throw 'Folder Desktop tidak ditemukan.'
}
$desktopBrand = Join-Path $desktop 'SXL Cover.lnk'
$existingTarget = if (Test-Path -LiteralPath $desktopBrand) { Get-ShortcutTarget $desktopBrand } else { '' }
if (-not [string]::Equals($existingTarget, $AppExe, [System.StringComparison]::OrdinalIgnoreCase)) {
    if (Test-Path -LiteralPath $desktopBrand) {
        $backup = "$desktopBrand.previous.lnk"
        if (-not (Test-Path -LiteralPath $backup)) { Copy-Item -LiteralPath $desktopBrand -Destination $backup }
    }
    Set-SinzShortcut -ShortcutPath $desktopBrand
}

Write-Host ''
Write-Host 'SXL Cover shortcut siap digunakan.' -ForegroundColor Green
Write-Host "Laragon root : $LaragonRoot"
Write-Host "UI executable: $AppExe"
Write-Host "Shortcut native yang dialihkan: $changed"
Write-Host 'Shortcut asli disimpan dengan akhiran .native-backup.lnk jika ada yang dialihkan.'
Write-Host 'SXL Cover mengelola binary dan konfigurasi layanan langsung; laragon.exe tidak dimodifikasi atau dijalankan sebagai jendela utama.'
