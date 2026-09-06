[CmdletBinding()]
param(
    [string]$RuntimePath = 'C:\WebAiCore',
    [string]$RuntimeDataPath = 'C:\ProgramData\WebAiCore'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$projectPath = Join-Path $RuntimePath 'app'
$serverPath = Join-Path $projectPath 'server'
$runnerPath = Join-Path $projectPath 'run-webai-core.ps1'
$configurationPath = Join-Path $RuntimeDataPath 'config'
$runtimeLogPath = Join-Path $RuntimeDataPath 'runtime'
$coreEnvironmentPath = Join-Path $configurationPath 'core.env'
$backupPath = Join-Path $runtimeLogPath ("app-backup-" + (Get-Date -Format 'yyyyMMddHHmmss'))
$taskName = 'WebAiCore'
$nodePath = 'C:\Program Files\nodejs\node.exe'

function Assert-File([string]$Path, [string]$Message) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw $Message }
}

foreach ($relative in @(
    'server\core.mjs',
    'server\agent.mjs',
    'server\native-worker.mjs',
    'server\snapshot-store.mjs',
    'server\core-recovery.mjs',
    'server\diff-evidence.mjs',
    'server\verification-engine.mjs',
    'deploy\windows\run-webai-core.ps1'
)) {
    Assert-File (Join-Path $sourceRoot $relative) "WebAi source is missing $relative"
}
Assert-File $nodePath 'Node.js runtime was not found.'
Assert-File $coreEnvironmentPath 'Existing Core environment is missing; refusing to create or rotate credentials.'
if (-not (Test-Path -LiteralPath $projectPath -PathType Container)) { throw 'Existing WebAi Core app directory was not found.' }
if (-not (Test-Path -LiteralPath $runtimeLogPath -PathType Container)) { throw 'Existing WebAi Core runtime log directory was not found.' }

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($task) {
    Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

New-Item -ItemType Directory -Path $backupPath -Force | Out-Null
foreach ($name in @('core.mjs', 'agent.mjs', 'native-worker.mjs', 'snapshot-store.mjs', 'core-recovery.mjs', 'diff-evidence.mjs', 'verification-engine.mjs')) {
    $destination = Join-Path $serverPath $name
    if (Test-Path -LiteralPath $destination -PathType Leaf) {
        Copy-Item -LiteralPath $destination -Destination (Join-Path $backupPath $name) -Force
    }
}
if (Test-Path -LiteralPath $runnerPath -PathType Leaf) {
    Copy-Item -LiteralPath $runnerPath -Destination (Join-Path $backupPath 'run-webai-core.ps1') -Force
}

Copy-Item -LiteralPath (Join-Path $sourceRoot 'server\core.mjs') -Destination (Join-Path $serverPath 'core.mjs') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'server\agent.mjs') -Destination (Join-Path $serverPath 'agent.mjs') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'server\native-worker.mjs') -Destination (Join-Path $serverPath 'native-worker.mjs') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'server\snapshot-store.mjs') -Destination (Join-Path $serverPath 'snapshot-store.mjs') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'server\core-recovery.mjs') -Destination (Join-Path $serverPath 'core-recovery.mjs') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'server\diff-evidence.mjs') -Destination (Join-Path $serverPath 'diff-evidence.mjs') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'server\verification-engine.mjs') -Destination (Join-Path $serverPath 'verification-engine.mjs') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'deploy\windows\run-webai-core.ps1') -Destination $runnerPath -Force

& icacls.exe $projectPath /grant '*S-1-5-19:RX' /t /c | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Failed to grant Local Service read access to updated Core files.' }

$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

$health = $null
for ($attempt = 0; $attempt -lt 20; $attempt += 1) {
    Start-Sleep -Milliseconds 500
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8790/api/health' -TimeoutSec 3
        if ($health.ok -eq $true -and $health.service -eq 'webai-core') { break }
    } catch {}
}
if ($null -eq $health -or $health.ok -ne $true -or $health.service -ne 'webai-core') { throw 'WebAi Core did not pass local health check after update.' }

[pscustomobject]@{
    CoreTask = $taskName
    CorePort = 8790
    Worker = 'webai-omp-runtime-v0.2'
    BackupPath = $backupPath
    Health = $health.ok
} | ConvertTo-Json -Compress
