$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$nodePath = 'C:\Program Files\nodejs\node.exe'
$projectPath = 'C:\WebAi'
$environmentPath = 'C:\ProgramData\WebAi\typhoon-proxy.env'
$logPath = 'C:\ProgramData\WebAi\webai-typhoon-proxy.log'
$requiredNames = @('TYPHOON_API_KEY', 'TYPHOON_BASE_URL', 'TYPHOON_MODEL', 'PORT')

function Write-ProxyLog([string]$message) {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $message"
}

if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Node.js runtime was not found.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectPath 'server\index.mjs') -PathType Leaf)) { throw 'WebAi proxy source was not found.' }
if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) { throw 'WebAi environment file was not found.' }

$values = @{}
foreach ($line in Get-Content -LiteralPath $environmentPath) {
    if ($line -match '^\s*(?:#.*)?$') { continue }
    if ($line -notmatch '^([A-Z0-9_]+)=(.*)$') { throw 'WebAi environment file has an invalid line.' }
    if ($requiredNames -notcontains $matches[1]) { throw 'WebAi environment file has an unsupported variable name.' }
    $values[$matches[1]] = $matches[2]
}
foreach ($name in $requiredNames) {
    if (-not $values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($values[$name])) { throw "WebAi environment is missing $name." }
    Set-Item -Path "Env:$name" -Value $values[$name]
}

Set-Location -LiteralPath $projectPath
while ($true) {
    Write-ProxyLog 'Starting WebAi Typhoon proxy.'
    & $nodePath 'server\index.mjs' *>> $logPath
    Write-ProxyLog "WebAi Typhoon proxy exited with code $LASTEXITCODE; restarting in five seconds."
    Start-Sleep -Seconds 5
}
