# Desktop smoke verification for Ming Workbench v0.1 (PowerShell).
# Usage: pwsh -File desktop-smoke.ps1 -Project <path> [-IntakeText <text>]
param(
  [Parameter(Mandatory = $true)][string]$Project,
  [string]$IntakeText = "看看这个项目现在做到哪了，接下来最应该先做什么？",
  [switch]$RunSetup,
  [string]$Electron = "",
  [string]$WorkDir = ""
)

$ErrorActionPreference = "Stop"
if (-not $Electron) { $Electron = Join-Path $PSScriptRoot "..\node_modules\electron\dist\electron.exe" }
if (-not $WorkDir) { $WorkDir = Split-Path $PSScriptRoot -Parent }
$log = Join-Path $env:TEMP "ming-desktop-smoke.out.log"
$err = Join-Path $env:TEMP "ming-desktop-smoke.err.log"
Remove-Item $log, $err -ErrorAction SilentlyContinue

Write-Host "=== MING DESKTOP SMOKE ==="
Write-Host "electron: $Electron"
Write-Host "project:  $Project"

$proc = Start-Process -FilePath $Electron -ArgumentList @(".", "--project", "`"$Project`"") -WorkingDirectory $WorkDir -RedirectStandardOutput $log -RedirectStandardError $err -PassThru -WindowStyle Normal
Write-Host "launched pid: $($proc.Id)"

$ready = $false
$backendUrl = ""
$deadline = (Get-Date).AddSeconds(90)
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 300
  if ($proc.HasExited) { Write-Host "ELECTRON EXITED EARLY code=$($proc.ExitCode)"; break }
  if (Test-Path $log) {
    $stream = [System.IO.File]::Open($log, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $content = (New-Object System.IO.StreamReader($stream)).ReadToEnd()
    } finally {
      $stream.Close()
    }
    if ($content -match "MING_DESKTOP_WINDOW_READY") { $ready = $true }
    if ($content -match "MING_WORKBENCH_READY\s+(http://[^\s]+)") { $backendUrl = $Matches[1] }
    if ($ready -and $backendUrl) { break }
  }
}

Write-Host "window_ready: $ready"
Write-Host "backend_url:  $backendUrl"

$code = 1
if ($ready -and $backendUrl) {
  Write-Host "=== BACKEND API VERIFICATION ==="
  $page = Invoke-WebRequest -Uri "$backendUrl/" -UseBasicParsing -TimeoutSec 15
  Write-Host "GET / status: $($page.StatusCode)"
  if ($page.Content -match 'ming-workbench-token" content="([^"]+)"') {
    $token = $Matches[1]
    $headers = @{ "x-ming-workbench-token" = $token }

    $project = Invoke-WebRequest -Uri "$backendUrl/api/project" -Headers $headers -UseBasicParsing -TimeoutSec 30
    Write-Host "GET /api/project status: $($project.StatusCode)"
    Write-Host "  body: $($project.Content.Trim())"

    $setup = $null
    if ($RunSetup) {
      $setup = Invoke-WebRequest -Uri "$backendUrl/api/setup" -Method Post -Headers $headers -ContentType "application/json" -Body '{"authorize":true}' -UseBasicParsing -TimeoutSec 300
      Write-Host "POST /api/setup status: $($setup.StatusCode)"
      Write-Host "  body: $($setup.Content.Trim())"
    } else {
      Write-Host "POST /api/setup skipped (-RunSetup not set)"
    }

    $body = @{ request = $IntakeText } | ConvertTo-Json
    try {
      $intake = Invoke-WebRequest -Uri "$backendUrl/api/intake" -Method Post -Headers $headers -ContentType "application/json" -Body $body -UseBasicParsing -TimeoutSec 180
      Write-Host "POST /api/intake status: $($intake.StatusCode)"
      Write-Host "  body: $($intake.Content.Trim())"
    } catch {
      $resp = $_.Exception.Response
      if ($resp) {
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $text = $reader.ReadToEnd()
        Write-Host "POST /api/intake status: $([int]$resp.StatusCode)"
        Write-Host "  body: $text"
      } else {
        Write-Host "POST /api/intake ERROR: $($_.Exception.Message)"
      }
    }
    $code = 0
  } else {
    Write-Host "TOKEN NOT FOUND IN PAGE"
  }
} else {
  Write-Host "SMOKE FAILED - window/backend not ready"
  if (Test-Path $err) { Write-Host "stderr:"; Get-Content $err -Tail 30 }
}

Write-Host "=== GRACEFUL CLOSE ==="
if (-not $proc.HasExited) {
  taskkill /PID $proc.Id 2>&1 | Out-Null
  if (-not $proc.WaitForExit(15000)) { taskkill /PID $proc.Id /T /F 2>&1 | Out-Null; $proc.WaitForExit(5000) | Out-Null }
}
Write-Host "electron exited: $($proc.HasExited) code=$($proc.ExitCode)"

Start-Sleep -Seconds 2
$residual = Get-CimInstance Win32_Process -Filter "Name='electron.exe'" | Where-Object { $_.CommandLine -match "start-local-web|Ming-Workbench" }
if ($residual) {
  Write-Host "RESIDUAL ELECTRON PROCESSES:"
  $residual | ForEach-Object { Write-Host "  pid=$($_.ProcessId) $($_.CommandLine)" }
} else {
  Write-Host "residual electron.exe: none"
}
$residualNode = Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match "start-local-web|Ming-Workbench" }
if ($residualNode) {
  Write-Host "RESIDUAL NODE PROCESSES:"
  $residualNode | ForEach-Object { Write-Host "  pid=$($_.ProcessId) $($_.CommandLine)" }
} else {
  Write-Host "residual node.exe: none"
}

Write-Host "SMOKE RESULT: $($(if ($code -eq 0) { 'PASS' } else { 'FAIL' }))"
exit $code
