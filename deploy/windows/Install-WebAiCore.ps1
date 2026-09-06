[CmdletBinding()]
param(
    [string]$RuntimePath = 'C:\WebAiCore',
    [string]$RuntimeDataPath = 'C:\ProgramData\WebAiCore',
    [string]$ApacheConfigPath = 'C:\xampp\apache\conf\httpd.conf',
    [string]$ApacheExtraPath = 'C:\xampp\apache\conf\extra\webai-core-5445.conf',
    [string]$ApacheBinaryPath = 'C:\xampp\apache\bin\httpd.exe',
    [string]$ApacheServiceName = 'Apache2.4'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$projectPath = Join-Path $RuntimePath 'app'
$serverPath = Join-Path $projectPath 'server'
$workspacePath = Join-Path $RuntimePath 'workspace'
$configurationPath = Join-Path $RuntimeDataPath 'config'
$runtimeLogPath = Join-Path $RuntimeDataPath 'runtime'
$coreEnvironmentPath = Join-Path $configurationPath 'core.env'
$runnerPath = Join-Path $projectPath 'run-webai-core.ps1'
$statePath = Join-Path $runtimeLogPath 'state'
$taskName = 'WebAiCore'
$nodePath = 'C:\Program Files\nodejs\node.exe'
$gitPath = 'C:\Program Files\Git\cmd\git.exe'
$firewallRuleName = 'WebAi Core HTTPS 5445'

function Assert-File([string]$path, [string]$message) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw $message }
}

function New-Base64UrlSecret([int]$bytes) {
    $buffer = New-Object byte[] $bytes
    [System.Security.Cryptography.RandomNumberGenerator]::Fill($buffer)
    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

Assert-File $nodePath 'Node.js runtime was not found.'
Assert-File $gitPath 'Git runtime was not found.'
Assert-File (Join-Path $sourceRoot 'server\core.mjs') 'WebAi Core source was not found.'
Assert-File (Join-Path $sourceRoot 'server\agent.mjs') 'WebAi agent source was not found.'
Assert-File (Join-Path $sourceRoot 'server\native-worker.mjs') 'WebAi Native Worker source was not found.'
Assert-File (Join-Path $sourceRoot 'deploy\windows\run-webai-core.ps1') 'WebAi Core runner source was not found.'
Assert-File (Join-Path $sourceRoot 'deploy\windows\webai-core-5445.conf') 'WebAi Core Apache source was not found.'
Assert-File $ApacheConfigPath 'Apache configuration was not found.'
Assert-File $ApacheBinaryPath 'Apache binary was not found.'

if (Test-Path -LiteralPath $RuntimePath) { throw 'WebAi Core runtime already exists. Refusing to replace it.' }
New-Item -ItemType Directory -Path $projectPath -Force | Out-Null
New-Item -ItemType Directory -Path $serverPath -Force | Out-Null
New-Item -ItemType Directory -Path $workspacePath -Force | Out-Null
New-Item -ItemType Directory -Path $configurationPath -Force | Out-Null
New-Item -ItemType Directory -Path $runtimeLogPath -Force | Out-Null
New-Item -ItemType Directory -Path $statePath -Force | Out-Null

if (Test-Path -LiteralPath $coreEnvironmentPath) {
    throw 'WebAi Core environment already exists. Refusing to rotate pairing or session credentials during install.'
}

$environmentLines = @(
    'CORE_PORT=8790',
    'CORE_ALLOWED_ORIGINS=https://nustanakritwithai.github.io,http://localhost:8000,http://127.0.0.1:8000',
    'TYPHOON_PROXY_BASE_URL=http://127.0.0.1:8787',
    'TYPHOON_PROXY_TOKEN=',
    "WEBAI_CORE_PAIRING_TOKEN=$(New-Base64UrlSecret 32)",
    "WEBAI_CORE_SESSION_SECRET=$(New-Base64UrlSecret 48)",
    'WEBAI_CORE_SESSION_TTL_SECONDS=43200',
    "WEBAI_WORKSPACE=$workspacePath",
    'WEBAI_NATIVE_WORKER_ENABLED=true',
    "WEBAI_CORE_STATE_DIR=$statePath"
)
[System.IO.File]::WriteAllLines($coreEnvironmentPath, $environmentLines, [System.Text.UTF8Encoding]::new($false))

Copy-Item -LiteralPath (Join-Path $sourceRoot 'server\core.mjs') -Destination (Join-Path $serverPath 'core.mjs') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'server\agent.mjs') -Destination (Join-Path $serverPath 'agent.mjs') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'server\native-worker.mjs') -Destination (Join-Path $serverPath 'native-worker.mjs') -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'deploy\windows\run-webai-core.ps1') -Destination $runnerPath -Force
Copy-Item -LiteralPath (Join-Path $sourceRoot 'deploy\windows\webai-core-5445.conf') -Destination $ApacheExtraPath -Force

& $gitPath -C $sourceRoot archive --format=zip --output (Join-Path $RuntimePath 'workspace.zip') HEAD
if ($LASTEXITCODE -ne 0) { throw 'Failed to archive the tracked WebAi workspace.' }
Expand-Archive -LiteralPath (Join-Path $RuntimePath 'workspace.zip') -DestinationPath $workspacePath -Force
Remove-Item -LiteralPath (Join-Path $RuntimePath 'workspace.zip') -Force

$systemFull = '*S-1-5-18:(OI)(CI)F'
$administratorsFull = '*S-1-5-32-544:(OI)(CI)F'
$localServiceRead = '*S-1-5-19:(OI)(CI)RX'
$localServiceModify = '*S-1-5-19:(OI)(CI)M'
foreach ($path in @($projectPath, $configurationPath)) {
    & icacls.exe $path /inheritance:r /grant $systemFull /grant $administratorsFull /grant $localServiceRead /t /c | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to restrict ACL for $path." }
}
foreach ($path in @($workspacePath, $runtimeLogPath)) {
    & icacls.exe $path /inheritance:r /grant $systemFull /grant $administratorsFull /grant $localServiceModify /t /c | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Failed to restrict ACL for $path." }
}

$include = 'Include "conf/extra/webai-core-5445.conf"'
$apacheText = Get-Content -LiteralPath $ApacheConfigPath -Raw
if ($apacheText -notmatch [regex]::Escape($include)) {
    Copy-Item -LiteralPath $ApacheConfigPath -Destination "$ApacheConfigPath.webai-core-backup-$(Get-Date -Format yyyyMMddHHmmss)" -Force
    Add-Content -LiteralPath $ApacheConfigPath -Value "`r`n# WebAi Core HTTPS listener`r`n$include`r`n"
}

& $ApacheBinaryPath -t
if ($LASTEXITCODE -ne 0) { throw 'Apache configuration validation failed.' }

if (-not (Get-NetFirewallRule -DisplayName $firewallRuleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $firewallRuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5445 | Out-Null
}

$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerPath`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\LOCAL SERVICE' -LogonType ServiceAccount -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3
Restart-Service -Name $ApacheServiceName

[pscustomobject]@{
    CoreTask = $taskName
    CorePort = 8790
    PublicCoreUrl = 'https://157.85.96.139:5445'
    Workspace = $workspacePath
    StateDirectory = $statePath
} | ConvertTo-Json -Compress
