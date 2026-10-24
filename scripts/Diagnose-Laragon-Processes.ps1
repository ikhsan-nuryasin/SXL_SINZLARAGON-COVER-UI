param(
    [int[]]$TargetPids = @(),
    [string]$LaragonRoot = 'C:\laragon'
)

# Read-only diagnostic helper. It does not start, stop, or modify any service.
$ErrorActionPreference = 'SilentlyContinue'
$allProcesses = @(Get-CimInstance Win32_Process)
if (-not $TargetPids -or $TargetPids.Count -eq 0) {
    $TargetPids = @($allProcesses | Where-Object { $_.Name -in @('mysqld.exe', 'mariadbd.exe') } | Select-Object -ExpandProperty ProcessId)
}
$allServices = @(Get-CimInstance Win32_Service | Where-Object { $_.ProcessId -gt 0 })
$allListeners = @()
try { $allListeners = @(Get-NetTCPConnection -State Listen) } catch { }
$processByPid = @{}
foreach ($processItem in $allProcesses) {
    $processByPid[[string]$processItem.ProcessId] = $processItem
}
$serviceByPid = @{}
foreach ($serviceItem in $allServices) {
    $serviceByPid[[string]$serviceItem.ProcessId] = $serviceItem
}

function Protect-CommandLine([string]$CommandLine) {
    if ([string]::IsNullOrWhiteSpace($CommandLine)) { return '' }
    $safe = $CommandLine
    $safe = $safe -replace '(?i)(--password(?:=|\s+))("[^"]*"|\S+)', '$1[REDACTED]'
    $safe = $safe -replace '(?i)(--password1(?:=|\s+))("[^"]*"|\S+)', '$1[REDACTED]'
    $safe = $safe -replace '(?i)(^|\s)(-p)(?!-)([^\s]+)', '$1$2[REDACTED]'
    return $safe
}

if (-not $TargetPids -or $TargetPids.Count -eq 0) {
    Write-Output 'Tidak ada proses mysqld.exe atau mariadbd.exe yang terdeteksi saat skrip dijalankan.'
}

foreach ($targetPid in $TargetPids) {
    $target = $processByPid[[string]$targetPid]
    if (-not $target) {
        Write-Output ([PSCustomObject]@{ PID = $targetPid; Found = $false; Note = 'PID tidak ditemukan; proses mungkin sudah berhenti.' })
        continue
    }

    $parent = $processByPid[[string]$target.ParentProcessId]
    $lineage = @()
    $laragonAncestor = $false
    $visited = @{}
    $cursor = [int]$target.ParentProcessId
    for ($depth = 0; $depth -lt 10 -and $cursor -gt 0; $depth++) {
        $key = [string]$cursor
        if ($visited.ContainsKey($key)) { break }
        $visited[$key] = $true
        $ancestor = $processByPid[$key]
        if (-not $ancestor) { break }
        $lineage += ('{0} (PID {1}; Path={2})' -f $ancestor.Name, $ancestor.ProcessId, $ancestor.ExecutablePath)
        if ($ancestor.Name -ieq 'laragon.exe' -and $ancestor.ExecutablePath) {
            try {
                $fullRoot = [System.IO.Path]::GetFullPath($LaragonRoot).TrimEnd('\')
                $fullParent = [System.IO.Path]::GetFullPath([string]$ancestor.ExecutablePath)
                if ($fullParent -ieq (Join-Path $fullRoot 'laragon.exe')) { $laragonAncestor = $true }
            } catch { }
        }
        $cursor = [int]$ancestor.ParentProcessId
    }

    $service = $serviceByPid[[string]$targetPid]
    $ports = @($allListeners | Where-Object { [int]$_.OwningProcess -eq $targetPid } | Select-Object -ExpandProperty LocalPort -Unique)
    $commandLine = Protect-CommandLine ([string]$target.CommandLine)
    $servicePath = if ($service) { Protect-CommandLine ([string]$service.PathName) } else { '' }
    $parentName = if ($parent) { [string]$parent.Name } else { '' }
    $parentPath = if ($parent) { [string]$parent.ExecutablePath } else { '' }
    $serviceName = if ($service) { [string]$service.Name } else { '' }

    [PSCustomObject]@{
        PID = [int]$target.ProcessId
        Found = $true
        Name = [string]$target.Name
        ExecutablePath = [string]$target.ExecutablePath
        CommandLineSafe = $commandLine
        ParentPID = [int]$target.ParentProcessId
        ParentName = $parentName
        ParentPath = $parentPath
        ParentChain = ($lineage -join ' -> ')
        LaragonAncestorMatched = $laragonAncestor
        ListeningPorts = (@($ports) -join ', ')
        WindowsServiceName = $serviceName
        WindowsServicePathSafe = $servicePath
        SelectedLaragonRoot = $LaragonRoot
    } | Format-List
}
