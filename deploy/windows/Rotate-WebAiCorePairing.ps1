[CmdletBinding()]
param(
    [string]$RuntimePath = 'C:\WebAiCore',
    [string]$RuntimeDataPath = 'C:\ProgramData\WebAiCore',
    [string]$TaskName = 'WebAiCore',
    [int]$ReadyTimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$environmentPath = Join-Path $RuntimeDataPath 'config\core.env'
$sourceRoot = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$runtimeCorePath = Join-Path $RuntimePath 'app\server\core.mjs'

function New-Base64UrlSecret([int]$bytes) {
    $buffer = New-Object byte[] $bytes
    $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $rng.GetBytes($buffer) } finally { $rng.Dispose() }
    return [Convert]::ToBase64String($buffer).TrimEnd('=').Replace('+', '-').Replace('/', '_')
}

function Set-EnvironmentValue([string[]]$lines, [string]$name, [string]$value) {
    $found = $false
    $updated = foreach ($line in $lines) {
        if ($line -match "^$([regex]::Escape($name))=") {
            $found = $true
            "$name=$value"
        } else {
            $line
        }
    }
    if (-not $found) { throw "WebAi Core environment is missing $name." }
    return [string[]]$updated
}

function Stop-WebAiCoreListener {
    Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
    $deadline = (Get-Date).AddSeconds(10)
    do {
        $listener = Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 8790 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
        if (-not $listener) { return }
        $process = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)" -ErrorAction Stop
        if ([string]::IsNullOrWhiteSpace($process.CommandLine) -or $process.CommandLine -notlike '*C:\WebAiCore\app\server\core.mjs*') {
            throw 'Refusing to stop an unexpected process on the WebAi Core port.'
        }
        Stop-Process -Id $listener.OwningProcess -Force -ErrorAction Stop
        Start-Sleep -Milliseconds 250
    } while ((Get-Date) -lt $deadline)
    throw 'WebAi Core listener did not stop within the timeout.'
}

if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) {
    throw 'WebAi Core environment file was not found.'
}
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'server\core.mjs') -PathType Leaf)) { throw 'WebAi Core source was not found.' }
if (-not (Test-Path -LiteralPath $runtimeCorePath -PathType Leaf)) { throw 'WebAi Core runtime source was not found.' }

$oldLines = [System.IO.File]::ReadAllLines($environmentPath)
$pairingToken = New-Base64UrlSecret 32
$sessionSecret = New-Base64UrlSecret 48
$newLines = Set-EnvironmentValue $oldLines 'WEBAI_CORE_PAIRING_TOKEN' $pairingToken
$newLines = Set-EnvironmentValue $newLines 'WEBAI_CORE_SESSION_SECRET' $sessionSecret

try {
    [System.IO.File]::WriteAllLines($environmentPath, $newLines, [System.Text.UTF8Encoding]::new($false))
    Stop-WebAiCoreListener
    Copy-Item -LiteralPath (Join-Path $sourceRoot 'server\core.mjs') -Destination $runtimeCorePath -Force
    Start-ScheduledTask -TaskName $TaskName

    $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
    do {
        try {
            $health = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/health' -Headers @{ Origin = 'https://nustanakritwithai.github.io' } -TimeoutSec 3
            if ($health.ok -and $health.configured -and $health.authConfigured) { break }
        } catch {}
        Start-Sleep -Seconds 1
    } while ((Get-Date) -lt $deadline)

    if (-not $health.ok -or -not $health.configured -or -not $health.authConfigured) {
        throw 'WebAi Core did not become ready after the credential rotation.'
    }

    $clientId = "bootstrap_$([guid]::NewGuid().ToString('N'))"
    $bootstrap = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/bootstrap' -Method Post -Headers @{ Origin = 'https://nustanakritwithai.github.io'; 'Content-Type' = 'application/json' } -Body (@{ pairingToken = $pairingToken; clientId = $clientId } | ConvertTo-Json -Compress) -TimeoutSec 10
    if ([string]::IsNullOrWhiteSpace($bootstrap.code) -or [string]::IsNullOrWhiteSpace($bootstrap.expiresAt)) {
        throw 'WebAi Core did not issue a one-time bootstrap after the credential rotation.'
    }

    $fragment = "coreBase=$([uri]::EscapeDataString('https://157.85.96.139:5445'))&coreBootstrap=$([uri]::EscapeDataString($bootstrap.code))&coreClient=$([uri]::EscapeDataString($clientId))"
    Start-Process -FilePath "https://nustanakritwithai.github.io/WebAi/#$fragment"
    [pscustomobject]@{
        rotated = $true
        coreReady = $true
        bootstrapIssued = $true
        browserOpened = $true
    } | ConvertTo-Json -Compress
} catch {
    [System.IO.File]::WriteAllLines($environmentPath, $oldLines, [System.Text.UTF8Encoding]::new($false))
    try { Start-ScheduledTask -TaskName $TaskName } catch {}
    throw
}
