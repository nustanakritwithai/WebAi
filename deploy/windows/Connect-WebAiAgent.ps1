[CmdletBinding()]
param(
    [string]$RuntimeDataPath = 'C:\ProgramData\WebAiCore'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$environmentPath = Join-Path $RuntimeDataPath 'config\core.env'
if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) { throw 'WebAi Core environment file was not found.' }

$pairingLine = Get-Content -LiteralPath $environmentPath | Where-Object { $_ -like 'WEBAI_CORE_PAIRING_TOKEN=*' } | Select-Object -First 1
if ([string]::IsNullOrWhiteSpace($pairingLine)) { throw 'WebAi Core pairing configuration was not found.' }
$pairingToken = $pairingLine.Substring('WEBAI_CORE_PAIRING_TOKEN='.Length)
$clientId = "webai_agent_$([guid]::NewGuid().ToString('N'))"
$session = Invoke-RestMethod -Uri 'http://127.0.0.1:8790/api/session' -Method Post -Headers @{ Origin = 'https://nustanakritwithai.github.io'; 'Content-Type' = 'application/json' } -Body (@{ pairingToken = $pairingToken; clientId = $clientId } | ConvertTo-Json -Compress) -TimeoutSec 15
if ([string]::IsNullOrWhiteSpace($session.sessionToken) -or [string]::IsNullOrWhiteSpace($session.expiresAt)) { throw 'WebAi Core did not issue a signed session.' }

$fragment = "coreBase=$([uri]::EscapeDataString('https://157.85.96.139:5445'))&coreSession=$([uri]::EscapeDataString($session.sessionToken))&coreSessionExpiresAt=$([uri]::EscapeDataString($session.expiresAt))&coreClient=$([uri]::EscapeDataString($clientId))"
Start-Process -FilePath "https://nustanakritwithai.github.io/WebAi/#$fragment"
[pscustomobject]@{ connected = $true; browserOpened = $true } | ConvertTo-Json -Compress
