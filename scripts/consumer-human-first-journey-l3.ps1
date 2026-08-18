# Consumer Human-First Journey — L3 acceptance for V1 human-first entry.
#
# Evidence level: L3 (installed human consumer journey with a real outcome).
#
# This gate drives the INSTALLED NSIS Ming Workbench EXE through its REAL UI
# (Chromium DevTools Protocol) exactly as a human would — with NO --project and
# a fresh userData, per docs/V1_PRODUCT_CONTRACT.md section 7. It never calls
# backend APIs directly and never evals product internals.
#
# The journey must FAIL if the old project-first welcome page returns, and must
# prove the 14 acceptance items:
#   1. first letter appears (fresh userData, no existing repo)
#   2. 开始 works
#   3. exact 3 human entry choices exist
#   4. ordinary-language idea entered through real UI
#   5. more than one conversation turn
#   6. synthesis is grounded in the conversation
#   7. larger direction/map is human-facing, not ticket UI
#   8. exactly one smallest complete outcome recommended
#   9. agreement contains the four required semantics
#  10. confirmation persists after close/reopen
#  11. no repo/project required before confirmation
#  12. normal pre-confirmation UI hides engineering concepts
#  13. no execution/mutation occurs
#  14. Stage 0 critical safety/runtime gates remain green (CI-level)
#
# The provider is the repository-owned deterministic fixture (extended with the
# human-first branch). A real-provider L4 dogfood is never claimed here.
#
# Usage (Windows):
#   pwsh -NoProfile -File scripts/consumer-human-first-journey-l3.ps1
#   pwsh -NoProfile -File scripts/consumer-human-first-journey-l3.ps1 -SkipBuild

param(
  [switch]$SkipBuild,
  [string]$WorkDir = "",
  [string]$ScratchRoot = "",
  [string]$ArtifactDir = "",
  [int]$ReadyTimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"

function Write-Step([string]$Message) { Write-Host "=== $Message ===" }
function Assert-True([bool]$Condition, [string]$Label, [string]$Detail = "") {
  if (-not $Condition) {
    Write-Host "FAIL: $Label $Detail"
    throw "consumer human-first journey L3 failed: $Label"
  }
  Write-Host "PASS: $Label"
}
function Read-TextFileShared([string]$Path) {
  try {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $reader = New-Object System.IO.StreamReader($stream)
      try { return $reader.ReadToEnd() } finally { $reader.Close() }
    } finally { $stream.Close() }
  } catch { return "" }
}

if (-not $WorkDir) { $WorkDir = (Split-Path $PSScriptRoot -Parent) }
if (-not (Test-Path (Join-Path $WorkDir "package.json"))) { Write-Host "FAIL: not a Ming Workbench repo root: $WorkDir"; exit 2 }
if (-not $ScratchRoot) { $ScratchRoot = Join-Path $env:TEMP ("mfh-" + [guid]::NewGuid().ToString("N").Substring(0, 8)) }
New-Item -ItemType Directory -Force -Path $ScratchRoot | Out-Null
if ($ArtifactDir) { New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null }
$distRoot = Join-Path $WorkDir "dist-desktop"

Write-Step "REPO $WorkDir"

if (-not $SkipBuild) {
  Write-Step "BUILD NSIS installer (runtime:prepare + package)"
  Push-Location $WorkDir
  try {
    & npm.cmd run desktop:package 2>&1 | Out-File (Join-Path $ScratchRoot "human-first-build.log") -Encoding utf8
    if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: desktop:package exited $LASTEXITCODE"; exit 1 }
  } finally { Pop-Location }
} else {
  Write-Host "build skipped (-SkipBuild)"
}

$installer = Get-ChildItem -Path (Join-Path $distRoot "Ming Workbench Setup *.exe") -File -ErrorAction SilentlyContinue | Select-Object -First 1
Assert-True ($null -ne $installer) "real NSIS installer exists"
$installerSha256 = (Get-FileHash -Algorithm SHA256 -Path $installer.FullName).Hash
$installerBytes = $installer.Length
Write-Host "HUMAN_FIRST_EVIDENCE installer=$($installer.Name) sha256=$installerSha256 bytes=$installerBytes"

$installDir = Join-Path $ScratchRoot "hf-installed"
Write-Step "INSTALL (silent per-user)"
$installProc = Start-Process -FilePath $installer.FullName -ArgumentList "/S /D=$installDir" -Wait -PassThru
if ($installProc.ExitCode -ne 0) { throw "installer exited $($installProc.ExitCode)" }
$installedExe = Join-Path $installDir "Ming Workbench.exe"
Assert-True (Test-Path $installedExe) "installed Ming Workbench.exe exists"

$cdpPort = 9334
$script:launchDurations = @{}

# The idea lives entirely in userData; no project is ever created. This scratch
# dir must stay empty of any project/repo — the journey proves no repo/project
# is required and no mutation occurs.
$ideaScratch = Join-Path $ScratchRoot "idea-scratch"
New-Item -ItemType Directory -Force -Path $ideaScratch | Out-Null

function Close-InstalledTree([int]$RootPid, [string]$ScratchPath, [string]$InstalledExe, [string]$UserDataDir) {
  $p = Get-Process -Id $RootPid -ErrorAction SilentlyContinue
  if ($p -and $p.MainWindowHandle -ne 0) {
    $wmClose = $p.CloseMainWindow()
    Write-Host "close requested via window pid=$RootPid title='$($p.MainWindowTitle)' wmClose=$wmClose"
  } else {
    Write-Host "close requested but no main window handle for pid=$RootPid"
  }
  $fallbackTriggered = $false
  $closeStart = Get-Date
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline) {
    $alive = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      ($_.ProcessId -eq $RootPid) -or ($_.CommandLine -and $_.CommandLine.IndexOf($ScratchPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
    }
    if (-not $alive -or @($alive).Count -eq 0) {
      Write-Host "graceful close drained within 90s bound"
      return $true
    }
    if (-not $fallbackTriggered -and ((Get-Date) - $closeStart).TotalSeconds -ge 8) {
      $fallbackTriggered = $true
      Write-Host "close fallback: launching second instance with --mw-close-instance"
      $fallbackArgs = "--mw-close-instance --user-data-dir `"$UserDataDir`" --no-sandbox --disable-gpu"
      try { Start-Process -FilePath $InstalledExe -ArgumentList $fallbackArgs | Out-Null } catch {
        Write-Host "close fallback launch failed: $($_.Exception.Message)"
      }
    }
    Start-Sleep -Milliseconds 500
  }
  Write-Host "HUMAN_FIRST_GRACEFUL_CLOSE: FAIL (installed tree did not drain within 90s)"
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($ScratchPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  } | ForEach-Object { try { taskkill /PID $_.ProcessId /T /F 2>&1 | Out-Null } catch { } }
  try { taskkill /PID $RootPid /T /F 2>&1 | Out-Null } catch { }
  Start-Sleep -Seconds 3
  return $false
}

function Invoke-HumanFirstUiJourney([string]$Label, [string]$UserData, [string]$Phase) {
  Write-Step "HUMAN-FIRST UI JOURNEY $Label (phase=$Phase)"
  $startupLog = Join-Path $UserData "startup.log"
  # NO --project: the journey starts from fresh userData with no repository.
  $launchStart = Get-Date
  $proc = Start-Process -FilePath $installedExe `
    -ArgumentList "--user-data-dir `"$UserData`" --remote-debugging-port=$cdpPort --no-sandbox --disable-gpu" `
    -PassThru
  Write-Host "launched installed exe (no --project) pid=$($proc.Id)"

  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
  $backendReady = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1000
    $content = Read-TextFileShared $startupLog
    if ($content -match "backend ready http://127\.0\.0\.1:\d+.*mode=human-first") { $backendReady = $true; break }
    if ($content -match "human-first backend startup failed|无法启动") { break }
  }
  $script:launchDurations[$Label] = ((Get-Date) - $launchStart).TotalSeconds
  Write-Host "HUMAN_FIRST_LAUNCH_DURATION $Label=$([math]::Round($script:launchDurations[$Label],1))s"
  Assert-True $backendReady "installed backend ready in human-first mode (no --project)" "(see $startupLog)"

  $deadline = (Get-Date).AddSeconds(30)
  $cdpReady = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$cdpPort/json/version" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
      if ($resp.StatusCode -eq 200) { $cdpReady = $true; break }
    } catch { }
  }
  Assert-True $cdpReady "renderer CDP endpoint reachable (installed exe renderer)"

  $env:MING_CDP_URL = "http://127.0.0.1:$cdpPort"
  $env:MING_JOURNEY_PHASE = $Phase
  $env:MING_IDEA_TEXT_1 = "我想做一个给家里人整理菜谱的简单工具"
  $env:MING_IDEA_TEXT_2 = "最重要的是家里老人也能一眼看懂怎么用"
  Push-Location $WorkDir
  try {
    & node scripts/human-first-journey-driver.mjs 2>&1 | Tee-Object -FilePath (Join-Path $ScratchRoot "$Label-ui.log")
    $driverExit = $LASTEXITCODE
    if ($ArtifactDir) {
      New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
      if (Test-Path $startupLog) { Copy-Item $startupLog (Join-Path $ArtifactDir "$Label-startup.log") -Force }
      if (Test-Path (Join-Path $ScratchRoot "$Label-ui.log")) { Copy-Item (Join-Path $ScratchRoot "$Label-ui.log") (Join-Path $ArtifactDir "$Label-ui.log") -Force }
    }
    if ($driverExit -ne 0) {
      Write-Host "--- human-first journey driver log ---"
      Get-Content (Join-Path $ScratchRoot "$Label-ui.log") -Tail 60
      Write-Host "--- installed app startup.log ---"
      Get-Content $startupLog -Tail 40
      throw "human-first journey driver exited $driverExit"
    }
  } finally { Pop-Location }
  Remove-Item Env:MING_CDP_URL -ErrorAction SilentlyContinue
  Remove-Item Env:MING_JOURNEY_PHASE -ErrorAction SilentlyContinue
  Remove-Item Env:MING_IDEA_TEXT_1 -ErrorAction SilentlyContinue
  Remove-Item Env:MING_IDEA_TEXT_2 -ErrorAction SilentlyContinue

  if ($ArtifactDir) {
    New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
    if (Test-Path $startupLog) { Copy-Item $startupLog (Join-Path $ArtifactDir "$Label-startup.log") -Force }
    if (Test-Path (Join-Path $ScratchRoot "$Label-ui.log")) { Copy-Item (Join-Path $ScratchRoot "$Label-ui.log") (Join-Path $ArtifactDir "$Label-ui.log") -Force }
  }

  return $proc
}

# Start the repository-owned OpenAI-compatible provider fixture INSIDE this
# process so it is guaranteed alive for the whole journey. The fixture now also
# answers the human-first turn/agreement requests deterministically.
$env:FIXTURE_TARGET_DIR = $ideaScratch
$env:FIXTURE_PORT = "8000"
$env:FIXTURE_API_KEY = "fixture-key"
$fixtureLog = Join-Path $ScratchRoot "fixture.out.log"
$fixtureProc = Start-Process -FilePath "node" -ArgumentList "scripts/provider-fixture-server.mjs" -WorkingDirectory $WorkDir -WindowStyle Hidden -RedirectStandardOutput $fixtureLog -RedirectStandardError (Join-Path $ScratchRoot "fixture.err.log") -PassThru
$deadline = (Get-Date).AddSeconds(60)
$fixtureReady = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Seconds 1
  if (Test-Path $fixtureLog) {
    $content = Get-Content $fixtureLog -Raw -ErrorAction SilentlyContinue
    if ($content -match "provider-fixture ready") { $fixtureReady = $true; break }
  }
}
Assert-True $fixtureReady "provider fixture ready inside human-first process"

# First launch: fresh userData, NO project. Letter -> conversation -> confirm.
$firstUserData = Join-Path $ScratchRoot "hf-userdata-first"
New-Item -ItemType Directory -Force -Path $firstUserData | Out-Null
$firstProc = Invoke-HumanFirstUiJourney "first" $firstUserData "first"

# Acceptance #11: no repo/project required — proven by the no--project launch
# reaching the letter (driver step 1). Acceptance #13: no execution/mutation —
# the Work Unit store must never appear and no repo/artifacts may be created.
Write-Step "NO REPO / NO MUTATION ASSERTIONS"
$workUnitStore = Join-Path $firstUserData "work-units.json"
Assert-True (-not (Test-Path $workUnitStore)) "no Work Unit store created (no execution/mutation)"
$ideaStore = Join-Path $firstUserData "human-first-idea.json"
Assert-True (Test-Path $ideaStore) "human-first idea state persisted in userData"
$scratchEntries = Get-ChildItem -Path $ideaScratch -Force -ErrorAction SilentlyContinue
Assert-True ($null -eq $scratchEntries -or @($scratchEntries).Count -eq 0) "no repository/artifacts created in the idea scratch dir"
$startupText = Read-TextFileShared (Join-Path $firstUserData "startup.log")
Assert-True ($startupText -match "mode=human-first") "installed app ran in human-first mode (no --project)"

$firstCloseGraceful = Close-InstalledTree $firstProc.Id $ideaScratch $installedExe $firstUserData
$residual = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match [regex]::Escape($ideaScratch) }
Assert-True ($null -eq $residual -or @($residual).Count -eq 0) "zero residual processes after close"
Assert-True $firstCloseGraceful "first close completed gracefully within the 90s bound"

# Second launch: SAME userData. Confirmation must persist and restore through
# the UI (acceptance #10).
Write-Step "SECOND LAUNCH (confirmation restore)"
$secondProc = Invoke-HumanFirstUiJourney "second" $firstUserData "second"
$secondCloseGraceful = Close-InstalledTree $secondProc.Id $ideaScratch $installedExe $firstUserData
Assert-True $secondCloseGraceful "second close completed gracefully within the 90s bound"

# Independent evidence summary.
Write-Host "HUMAN_FIRST_EVIDENCE installer_sha256=$installerSha256"
Write-Host "HUMAN_FIRST_EVIDENCE installer_bytes=$installerBytes"
Write-Host "HUMAN_FIRST_EVIDENCE userdata=$firstUserData"
Write-Host "HUMAN_FIRST_EVIDENCE idea_store=$ideaStore"
Write-Host "HUMAN_FIRST_EVIDENCE first_launch_duration_s=$([math]::Round([double]$script:launchDurations['first'],1))"
Write-Host "HUMAN_FIRST_EVIDENCE second_launch_duration_s=$([math]::Round([double]$script:launchDurations['second'],1))"

# Uninstall cleanup.
Write-Step "UNINSTALL"
$uninstaller = Join-Path $installDir "Uninstall Ming Workbench.exe"
if (Test-Path $uninstaller) {
  Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru | Out-Null
  Start-Sleep -Seconds 3
}
Assert-True (-not (Test-Path $installedExe)) "installed exe removed after uninstall"

if ($fixtureProc -and -not $fixtureProc.HasExited) {
  try { $fixtureProc.Kill() } catch { }
}
Remove-Item Env:FIXTURE_TARGET_DIR -ErrorAction SilentlyContinue
Remove-Item Env:FIXTURE_PORT -ErrorAction SilentlyContinue
Remove-Item Env:FIXTURE_API_KEY -ErrorAction SilentlyContinue
if ($ArtifactDir) {
  if (Test-Path $fixtureLog) { Copy-Item $fixtureLog (Join-Path $ArtifactDir "fixture.out.log") -Force }
  if (Test-Path (Join-Path $ScratchRoot "fixture.err.log")) { Copy-Item (Join-Path $ScratchRoot "fixture.err.log") (Join-Path $ArtifactDir "fixture.err.log") -Force }
}

Write-Host "CONSUMER_HUMAN_FIRST_JOURNEY_L3: PASS"
exit 0
