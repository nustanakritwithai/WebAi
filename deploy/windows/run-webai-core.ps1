$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$nodePath = 'C:\Program Files\nodejs\node.exe'
$projectPath = 'C:\WebAiCore\app'
$environmentPath = 'C:\ProgramData\WebAiCore\config\core.env'
$logPath = 'C:\ProgramData\WebAiCore\runtime\webai-core.log'
$requiredNames = @(
    'CORE_PORT',
    'CORE_ALLOWED_ORIGINS',
    'TYPHOON_PROXY_BASE_URL',
    'WEBAI_CORE_PAIRING_TOKEN',
    'WEBAI_CORE_SESSION_SECRET',
    'WEBAI_CORE_SESSION_TTL_SECONDS',
    'WEBAI_WORKSPACE',
    'WEBAI_NATIVE_WORKER_ENABLED',
    'WEBAI_CORE_STATE_DIR'
)
$optionalNames = @('TYPHOON_PROXY_TOKEN')
$supportedNames = $requiredNames + $optionalNames

function Write-CoreLog([string]$message) {
    Add-Content -LiteralPath $logPath -Value "$(Get-Date -Format o) $message"
}

while ($true) {
    try {
        if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) { throw 'Node.js runtime was not found.' }
        if (-not (Test-Path -LiteralPath (Join-Path $projectPath 'server\core.mjs') -PathType Leaf)) { throw 'WebAi Core source was not found.' }
        if (-not (Test-Path -LiteralPath $environmentPath -PathType Leaf)) { throw 'WebAi Core environment file was not found.' }

        $values = @{}
        foreach ($line in Get-Content -LiteralPath $environmentPath) {
            if ($line -match '^\s*(?:#.*)?$') { continue }
            if ($line -notmatch '^([A-Z0-9_]+)=(.*)$') { throw 'WebAi Core environment file has an invalid line.' }
            if ($supportedNames -notcontains $matches[1]) { throw 'WebAi Core environment file has an unsupported variable name.' }
            $values[$matches[1]] = $matches[2]
        }
        foreach ($name in $requiredNames) {
            if (-not $values.ContainsKey($name) -or [string]::IsNullOrWhiteSpace($values[$name])) { throw "WebAi Core environment is missing $name." }
            Set-Item -Path "Env:$name" -Value $values[$name]
        }
        foreach ($name in $optionalNames) {
            if ($values.ContainsKey($name)) { Set-Item -Path "Env:$name" -Value $values[$name] }
        }

        Set-Location -LiteralPath $projectPath
        Write-CoreLog 'Starting WebAi Core.'
        & $nodePath 'server\core.mjs' *>> $logPath
        Write-CoreLog "WebAi Core exited with code $LASTEXITCODE; restarting in five seconds."
    } catch {
        Write-CoreLog "WebAi Core launcher error: $($_.Exception.Message); retrying in five seconds."
    }
    Start-Sleep -Seconds 5
}
