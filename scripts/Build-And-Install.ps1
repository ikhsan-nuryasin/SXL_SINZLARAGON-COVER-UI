[CmdletBinding()]
param(
    [string]$LaragonRoot = 'C:\laragon',
    [switch]$KeepExistingLaragonShortcuts
)

$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$packageJson = Join-Path $projectRoot 'package.json'
if (-not (Test-Path -LiteralPath $packageJson -PathType Leaf)) {
    throw "package.json tidak ditemukan di folder proyek: $projectRoot"
}

Push-Location $projectRoot
try {
    Write-Host 'Membangun SXL Cover...' -ForegroundColor Cyan
    & npm.cmd run package
    $packageExitCode = $LASTEXITCODE
    if ($packageExitCode -ne 0) {
        throw "Build Electron gagal dengan exit code $packageExitCode. Instalasi dibatalkan agar tidak menggunakan paket lama atau setengah jadi. Periksa error npm run package di atas."
    }

    $buildRoot = Join-Path $projectRoot 'out'
    $builtExe = Get-ChildItem -LiteralPath $buildRoot -Filter 'sxl-cover.exe' -File -Recurse -ErrorAction SilentlyContinue |
        Select-Object -First 1
    if (-not $builtExe) { $builtExe = Get-ChildItem -LiteralPath $buildRoot -Filter 'laragon-x-sinz-ui.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 }
    if (-not $builtExe) {
        throw "Build selesai tetapi executable tidak ditemukan di '$buildRoot'. Instalasi dibatalkan. Periksa forge.config.js dan output Electron Forge."
    }

    Write-Host "Build berhasil: $($builtExe.FullName)" -ForegroundColor Green
    $installScript = Join-Path $PSScriptRoot 'Install-To-Laragon.ps1'
    $powershellExe = Join-Path $PSHOME 'powershell.exe'
    $installArgs = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $installScript, '-LaragonRoot', $LaragonRoot)
    if ($KeepExistingLaragonShortcuts) {
        $installArgs += '-KeepExistingLaragonShortcuts'
    }

    Write-Host 'Memasang paket yang baru berhasil dibangun...' -ForegroundColor Cyan
    & $powershellExe @installArgs
    $installExitCode = $LASTEXITCODE
    if ($installExitCode -ne 0) {
        throw "Build berhasil, tetapi pemasangan ke Laragon gagal dengan exit code $installExitCode. Paket hasil build tetap tersedia di '$buildRoot'."
    }
    Write-Host 'Build dan pemasangan selesai.' -ForegroundColor Green
}
finally {
    Pop-Location
}
