param(
    [ValidateRange(1, 65535)][int]$Port = 3000,
    [switch]$SkipBuild,
    [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
Set-Location (Split-Path -Parent $PSScriptRoot)
$ProjectRoot = (Get-Location).Path
$ContainerName = 'agora'
$Volume = 'agora_agora-data'

function Invoke-Docker {
    param([string[]]$Arguments)
    & docker @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw ('Docker command failed: ' + ($Arguments -join ' '))
    }
}

function Remove-ManagedContainer {
    param([string]$Name)
    $Existing = @(& docker ps -a --filter "name=^/$Name$" --format '{{.ID}}')
    if ($Existing.Count -eq 0) { return }
    $Labels = (& docker inspect --format '{{json .Config.Labels}}' $Name | ConvertFrom-Json)
    if ($Labels.'io.agora.managed' -ne 'true') {
        throw "A container named $Name already exists and is not managed by this launcher."
    }
    Invoke-Docker -Arguments @('rm', '-f', $Name)
}

try {
    & docker info *> $null
    if ($LASTEXITCODE -ne 0) { throw 'Start Docker Desktop using Linux containers, then try again.' }
    if (-not $PSBoundParameters.ContainsKey('Port')) {
        if ($env:AGORA_PORT) {
            $Port = [int]$env:AGORA_PORT
        } elseif (Test-Path '.env') {
            foreach ($Line in Get-Content '.env') {
                if ($Line -match '^\s*AGORA_PORT\s*=\s*["'']?(\d+)["'']?\s*$') { $Port = [int]$Matches[1] }
            }
        }
    }
    if ($Port -lt 1 -or $Port -gt 65535) { throw 'AGORA_PORT must be between 1 and 65535.' }

    if (-not $SkipBuild) {
        Write-Host 'Building one Agora image from the separate frontend and backend source folders...'
        Invoke-Docker -Arguments @('build', '-t', 'agora:local', '.')
    }

    # Migrate previous deployments without removing any named volume.
    $LegacyIds = @(& docker ps -a --filter 'label=com.docker.compose.project=agora' --format '{{.ID}}')
    foreach ($LegacyId in $LegacyIds) {
        if ($LegacyId) { Invoke-Docker -Arguments @('rm', '-f', $LegacyId) }
    }
    Remove-ManagedContainer -Name $ContainerName
    Remove-ManagedContainer -Name 'agora-api'
    Invoke-Docker -Arguments @('volume', 'create', $Volume)

    $RunArgs = @('run', '-d', '--name', $ContainerName, '--label', 'io.agora.managed=true',
        '--restart', 'unless-stopped', '--init', '-p', "127.0.0.1:${Port}:8000", '-v', "${Volume}:/data")
    if (Test-Path '.env') { $RunArgs += @('--env-file', (Join-Path $ProjectRoot '.env')) }
    if ($env:DEEPSEEK_API_KEY) { $RunArgs += @('-e', 'DEEPSEEK_API_KEY') }
    $RunArgs += 'agora:local'
    Invoke-Docker -Arguments $RunArgs

    Write-Host 'Waiting for the webpage and API to become healthy...'
    $Ready = $false
    $Deadline = (Get-Date).AddSeconds(90)
    do {
        $StateInfo = (& docker inspect --format '{{.State.Status}}|{{.State.Health.Status}}' $ContainerName | Out-String).Trim()
        if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the Agora container.' }
        if ($StateInfo -eq 'running|healthy') { $Ready = $true; break }
        if ($StateInfo -match '^(exited|dead)\|' -or $StateInfo -match '\|unhealthy$') { break }
        Start-Sleep -Milliseconds 500
    } while ((Get-Date) -lt $Deadline)
    if (-not $Ready) {
        & docker logs --tail 40 $ContainerName
        throw "The container did not become healthy: $StateInfo"
    }

    $ContainerInfo = @(& docker inspect $ContainerName | ConvertFrom-Json)[0]
    $PublishedPorts = @($ContainerInfo.NetworkSettings.Ports.'8000/tcp')
    if ($PublishedPorts.Count -ne 1 -or $PublishedPorts[0].HostIp -ne '127.0.0.1' -or $PublishedPorts[0].HostPort -ne [string]$Port) {
        throw 'The Agora container does not have the expected published port.'
    }
    if ($ContainerInfo.Config.Labels.'com.docker.compose.project') {
        throw 'Unexpected Compose grouping label on the standalone Agora container.'
    }

    $Url = "http://127.0.0.1:$Port"
    $PageResponse = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 15
    $ApiHealth = Invoke-RestMethod -Uri "$Url/api/health" -TimeoutSec 15
    if ($PageResponse.StatusCode -ne 200 -or -not $ApiHealth.ok) { throw 'The webpage or API failed its access check.' }

    Write-Host ''
    Write-Host 'One container, with the clickable port directly on the agora row in Docker Desktop:'
    Invoke-Docker -Arguments @('ps', '--filter', 'label=io.agora.managed=true', '--format', 'table {{.Names}}\t{{.Status}}\t{{.Ports}}')
    Write-Host "Open: $Url"
    Write-Host 'Verified: webpage HTTP 200 and API healthy through the published Docker port.'
    if (-not $NoBrowser) { Start-Process $Url }
    exit 0
} catch {
    Write-Host "Startup failed: $($_.Exception.Message)" -ForegroundColor Red
    & docker ps -a --filter 'name=agora' --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
    exit 1
}
