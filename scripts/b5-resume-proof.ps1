# B5 real second-launch resume proof.
# Uses a fresh --user-data-dir. Does NOT manually seed workbench-state.json.
$ErrorActionPreference = "Stop"

$repoRoot = "C:\Users\Administrator\Desktop\ming-pr22-exact"
$exe = Join-Path $repoRoot "dist-desktop\win-unpacked\Ming Workbench.exe"
$scratch = Join-Path $env:TEMP "ming-p03-b5-repo"
$userData = Join-Path $env:TEMP "ming-p03-b5-userdata"

Remove-Item $scratch -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $userData -Recurse -Force -ErrorAction SilentlyContinue

# --- scratch repo ---
New-Item -ItemType Directory -Force -Path $scratch | Out-Null
Push-Location $scratch
git init -q
git config user.email "b5@local.test"
git config user.name "B5 Resume"
Set-Content -Path README.md -Value "b5 scratch project`n" -Encoding utf8
git add README.md
git commit -q -m init
Pop-Location
Write-Host "SCRATCH: $scratch"

$statePath = Join-Path $userData "workbench-state.json"
$logPath = Join-Path $userData "startup.log"

function Read-File([string]$p) {
  try { return [System.IO.File]::ReadAllText($p) } catch { return "" }
}

function Wait-BackendReady([string]$logPath, [int]$timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $c = Read-File $logPath
    if ($c -match "backend ready (http://127\.0\.0\.1:\d+)") { return $Matches[1] }
    if ($c -match "backend startup failed|无法启动") { return "" }
  }
  return ""
}

function Close-App {
  # Close the main window (clean, app-owned shutdown). Retry the close message
  # a few times because CloseMainWindow can transiently report false while the
  # renderer is busy.
  $closed = $false
  for ($attempt = 0; $attempt -lt 5 -and -not $closed; $attempt++) {
    $procs = Get-Process -Name "Ming Workbench" -ErrorAction SilentlyContinue
    foreach ($p in $procs) {
      if ($p.MainWindowHandle -ne 0) {
        [void]$p.CloseMainWindow()
      }
    }
    Start-Sleep -Seconds 2
    $alive = Get-Process -Name "Ming Workbench" -ErrorAction SilentlyContinue
    if (-not $alive) { $closed = $true; break }
  }
  if ($closed) { return $true }
  # Final wait for the app-owned cleanup (backend tree kill) to finish.
  $deadline = (Get-Date).AddSeconds(40)
  while ((Get-Date) -lt $deadline) {
    $alive = Get-Process -Name "Ming Workbench" -ErrorAction SilentlyContinue
    if (-not $alive) { return $true }
    Start-Sleep -Milliseconds 500
  }
  return $false
}

# ===== LAUNCH 1: --project + fresh userData =====
Write-Host "=== LAUNCH 1 (project + fresh userData) ==="
$p1 = Start-Process -FilePath $exe -ArgumentList "--project `"$scratch`" --user-data-dir `"$userData`"" -PassThru
$url1 = Wait-BackendReady $logPath 180
if (-not $url1) { Write-Host "LAUNCH1: FAIL (backend not ready)"; exit 1 }
Write-Host "LAUNCH1 backend ready: $url1"

$state = Read-File $statePath
$stateObj = $null
if ($state) { try { $stateObj = $state | ConvertFrom-Json } catch { $stateObj = $null } }
$stateHasProject = ($stateObj -and $stateObj.lastProject -eq $scratch)
Write-Host "STATE FILE EXISTS: $(Test-Path $statePath)"
Write-Host "STATE lastProject == scratch: $stateHasProject"
if (-not (Test-Path $statePath)) { Write-Host "FIRST_RUN_STATE_WRITTEN_BY_APP: false"; exit 1 }
if (-not $stateHasProject) { Write-Host "FIRST_RUN_STATE_WRITTEN_BY_APP: false (wrong lastProject)"; exit 1 }
Write-Host "FIRST_RUN_STATE_WRITTEN_BY_APP: true"

$closed1 = Close-App
Start-Sleep -Seconds 2
$residual1 = @(Get-Process -Name "Ming Workbench" -ErrorAction SilentlyContinue)
Write-Host "LAUNCH1 close=$closed1 residual=$($residual1.Count)"
if (-not $closed1 -or $residual1.Count -gt 0) { Write-Host "LAUNCH1_CLEAN_CLOSE: FAIL"; exit 1 }
Write-Host "LAUNCH1_CLEAN_CLOSE: PASS"

# ===== LAUNCH 2: SAME userData, NO --project =====
Write-Host "=== LAUNCH 2 (same userData, no --project) ==="
# Clear startup.log so we read only launch-2 evidence.
if (Test-Path $logPath) { Remove-Item $logPath -Force }
$p2 = Start-Process -FilePath $exe -ArgumentList "--user-data-dir `"$userData`"" -PassThru
$url2 = Wait-BackendReady $logPath 180
if (-not $url2) { Write-Host "LAUNCH2: FAIL (backend not ready)"; exit 1 }
Write-Host "LAUNCH2 backend ready: $url2"

$log2 = Read-File $logPath
$fixedScratch = ($log2 -match [regex]::Escape("project fixed $scratch"))
Write-Host "LAUNCH2 'project fixed <scratch>': $fixedScratch"
if (-not $fixedScratch) { Write-Host "SECOND_RUN_AUTO_RESTORE: FAIL"; exit 1 }
Write-Host "SECOND_RUN_AUTO_RESTORE: PASS"

$closed2 = Close-App
Start-Sleep -Seconds 2
$residual2 = @(Get-Process -Name "Ming Workbench" -ErrorAction SilentlyContinue)
Write-Host "LAUNCH2 close=$closed2 residual=$($residual2.Count)"
if (-not $closed2 -or $residual2.Count -gt 0) { Write-Host "LAUNCH2_CLEAN_CLOSE: FAIL"; exit 1 }
Write-Host "LAUNCH2_CLEAN_CLOSE: PASS"

Write-Host "B5_REAL_RESUME: PASS"
exit 0
