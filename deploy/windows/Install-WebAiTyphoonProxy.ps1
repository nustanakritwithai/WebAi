$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoPath = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$runtimePath = 'C:\ProgramData\WebAi'
$deploymentPath = 'C:\WebAi'
$taskName = 'WebAiTyphoonProxy'
$runnerSource = Join-Path $PSScriptRoot 'run-webai-typhoon-proxy.ps1'
$runnerTarget = Join-Path $runtimePath 'run-webai-typhoon-proxy.ps1'
$environmentSource = Join-Path $repoPath '.env'
$environmentTarget = Join-Path $runtimePath 'typhoon-proxy.env'
$proxySource = Join-Path $repoPath 'server\index.mjs'
$proxyTargetDirectory = Join-Path $deploymentPath 'server'
$proxyTarget = Join-Path $proxyTargetDirectory 'index.mjs'
$apacheSource = Join-Path $repoPath 'deploy\apache\webai-typhoon-proxy-5444.conf'
$apacheTarget = 'C:\xampp\apache\conf\extra\webai-typhoon-proxy-5444.conf'
$apacheConfig = 'C:\xampp\apache\conf\httpd.conf'
$apacheBackup = 'C:\xampp\apache\conf\httpd.conf.webai-pre-proxy.bak'
$httpd = 'C:\xampp\apache\bin\httpd.exe'

if (-not (Test-Path -LiteralPath $environmentSource -PathType Leaf)) { throw 'Create the ignored .env file before installation.' }
if (-not (Test-Path -LiteralPath $httpd -PathType Leaf)) { throw 'Apache runtime was not found.' }

New-Item -ItemType Directory -Path $runtimePath -Force | Out-Null
New-Item -ItemType Directory -Path $proxyTargetDirectory -Force | Out-Null
Copy-Item -LiteralPath $runnerSource -Destination $runnerTarget -Force
Copy-Item -LiteralPath $environmentSource -Destination $environmentTarget -Force
Copy-Item -LiteralPath $proxySource -Destination $proxyTarget -Force
Copy-Item -LiteralPath $apacheSource -Destination $apacheTarget -Force

$includeLine = 'Include "conf/extra/webai-typhoon-proxy-5444.conf"'
if (-not (Select-String -LiteralPath $apacheConfig -SimpleMatch $includeLine -Quiet)) {
    Copy-Item -LiteralPath $apacheConfig -Destination $apacheBackup -Force
    Add-Content -LiteralPath $apacheConfig -Value "`r`n# WebAi secure OpenTyphoon proxy`r`n$includeLine"
}

& icacls.exe $runtimePath /inheritance:r /grant:r 'SYSTEM:(OI)(CI)F' 'Administrators:(OI)(CI)F' | Out-Null
& $httpd -t
if ($LASTEXITCODE -ne 0) { throw 'Apache configuration validation failed.' }

$action = New-ScheduledTaskAction -Execute 'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe' -Argument "-NoProfile -ExecutionPolicy Bypass -File `"$runnerTarget`""
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Seconds 0) -StartWhenAvailable
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -User 'SYSTEM' -RunLevel Highest -Force | Out-Null
Start-ScheduledTask -TaskName $taskName

if (-not (Get-NetFirewallRule -DisplayName 'WebAi Typhoon HTTPS 5444' -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName 'WebAi Typhoon HTTPS 5444' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5444 -Profile Any | Out-Null
}

Restart-Service -Name Apache2.4
Start-Sleep -Seconds 3
