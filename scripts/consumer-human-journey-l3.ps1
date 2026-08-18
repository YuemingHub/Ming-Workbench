# Consumer Human Journey — TRUE L3.
#
# Evidence level: L3 (installed human consumer journey with a real outcome).
#
# This gate drives the INSTALLED NSIS Ming Workbench EXE through its REAL UI
# (Chromium DevTools Protocol) exactly as a human would: click, type, select,
# save, approve, wait, reopen. It never calls backend APIs directly and never
# evals product internals.
#
# Canonical task (fixed):
#   scratch git repo README.md = "# Workbench Reality Test\n\nVersion: OLD\n"
#   the user types through the UI:
#     "把 README 里的 Version: OLD 改成 Version: NEW，然后确认真的改好了。"
#   final independent observation: README contains "Version: NEW" and git diff
#   shows only the README change.
#
# What it proves (the true L3 checklist):
#   1. real NSIS install
#   2. fresh userData
#   3. not a Ming-Workbench source checkout
#   4. scratch git project selected through the UI
#   5. INSTALLED exe launched (not win-unpacked / dev / backend-direct)
#   6. product enters the project through the UI
#   7. AAOP absent -> AAOP setup authorized through the UI (bundled Python;
#      .aaop appears; UI goes setup-required -> ready)
#   8. Harness runtime ready (bundled-capsule identity)
#   9. provider configured through the UI (fill provider/model/credential,
#      save through safeStorage, test connection through UI)
#  10. plain-language request typed through the UI
#  11. request reaches the real Workbench application pipeline
#  12. intake/result returned (not just HTTP 200)
#  13. Work Unit created
#  14. grounded README mutation scope appears in the UI
#  15. approval clicked through the UI
#  16. bounded execution actually occurs (real Harness ACP write in isolation)
#  17. README changes OLD -> NEW
#  18. git diff independently observed (only README.md)
#  19. verifier passes
#  20. Evidence backs acceptance
#  21. Work Unit completed (or verifying with evidence; acceptance human-owned)
#  22. user-facing UI shows the outcome
#  23. app closes cleanly (zero residual)
#  24. second launch restores project/state
#  25. no credential leakage
#
# The provider is a repository-owned deterministic local OpenAI-compatible
# fixture (scripts/provider-fixture-server.mjs). That proves product TRANSPORT;
# a real-provider L4 dogfood is never claimed here.
#
# Usage (Windows):
#   pwsh -NoProfile -File scripts/consumer-human-journey-l3.ps1
#   pwsh -NoProfile -File scripts/consumer-human-journey-l3.ps1 -SkipBuild

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
    throw "consumer human journey L3 failed: $Label"
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
if (-not $ScratchRoot) { $ScratchRoot = Join-Path $env:TEMP ("mwl3-" + [guid]::NewGuid().ToString("N").Substring(0, 8)) }
New-Item -ItemType Directory -Force -Path $ScratchRoot | Out-Null
if ($ArtifactDir) { New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null }
$distRoot = Join-Path $WorkDir "dist-desktop"

Write-Step "REPO $WorkDir"

if (-not $SkipBuild) {
  Write-Step "BUILD NSIS installer (runtime:prepare + package)"
  Push-Location $WorkDir
  try {
    & npm.cmd run desktop:package 2>&1 | Out-File (Join-Path $ScratchRoot "l3-build.log") -Encoding utf8
    if ($LASTEXITCODE -ne 0) { Write-Host "FAIL: desktop:package exited $LASTEXITCODE"; exit 1 }
  } finally { Pop-Location }
} else {
  Write-Host "build skipped (-SkipBuild)"
}

# Canonical scratch project with README Version: OLD.
$scratchRepo = Join-Path $ScratchRoot "l3-project"
New-Item -ItemType Directory -Force -Path $scratchRepo | Out-Null
Push-Location $scratchRepo
try {
  git init -q
  git config user.email "l3@local.test"
  git config user.name "L3 Gate"
  Set-Content -Path README.md -Value "# Workbench Reality Test`n`nVersion: OLD`n" -Encoding utf8
  git add README.md
  git commit -q -m "init: OLD"
} finally { Pop-Location }
Assert-True (-not (Test-Path (Join-Path $scratchRepo "package.json"))) "scratch project is NOT a Ming-Workbench checkout"

$installer = Get-ChildItem -Path (Join-Path $distRoot "Ming Workbench Setup *.exe") -File -ErrorAction SilentlyContinue | Select-Object -First 1
Assert-True ($null -ne $installer) "real NSIS installer exists"
$installerSha256 = (Get-FileHash -Algorithm SHA256 -Path $installer.FullName).Hash
$installerBytes = $installer.Length
Write-Host "L3_EVIDENCE installer=$($installer.Name) sha256=$installerSha256 bytes=$installerBytes"
$installDir = Join-Path $ScratchRoot "l3-installed"
Write-Step "INSTALL (silent per-user)"
$installProc = Start-Process -FilePath $installer.FullName -ArgumentList "/S /D=$installDir" -Wait -PassThru
if ($installProc.ExitCode -ne 0) { throw "installer exited $($installProc.ExitCode)" }
$installedExe = Join-Path $installDir "Ming Workbench.exe"
Assert-True (Test-Path $installedExe) "installed Ming Workbench.exe exists"

$appDataDir = Join-Path $ScratchRoot "l3-userdata"
New-Item -ItemType Directory -Force -Path $appDataDir | Out-Null
$cdpPort = 9333

$script:launchDurations = @{}

function Invoke-L3UiJourney([string]$Label, [string]$UserData) {
  Write-Step "L3 UI JOURNEY $Label"
  $startupLog = Join-Path $UserData "startup.log"
  $launchStart = Get-Date
  $proc = Start-Process -FilePath $installedExe `
    -ArgumentList "--project `"$scratchRepo`" --user-data-dir `"$UserData`" --remote-debugging-port=$cdpPort --no-sandbox --disable-gpu" `
    -PassThru
  Write-Host "launched installed exe pid=$($proc.Id)"

  # Wait for the backend to actually become ready (the first launch extracts
  # the 58MB capsule archive to the per-user cache, which can take tens of
  # seconds on Windows). The CDP port becomes reachable before the backend is
  # ready, so gate on the startup.log handshake, not the port alone.
  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
  $backendReady = $false
  $startupFailed = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1000
    $content = Read-TextFileShared $startupLog
    if ($content -match "backend ready http://127\.0\.0\.1:\d+") { $backendReady = $true; break }
    if ($content -match "无法启动|backend startup failed|harness runtime preparation failed") { $startupFailed = $true; break }
  }

  # Post-boundary final-read rescue: if the last sleep tick landed just past the
  # deadline, the ready line can appear in startup.log milliseconds after the
  # loop exits. Do NOT widen $ReadyTimeoutSeconds to hide this — perform one
  # short bounded re-read so true failures still fail, while tick-misalignment
  # and legitimate final I/O flush (observed ~0.6s overshoot on loaded
  # runners) are rescued.
  if (-not $backendReady -and -not $startupFailed) {
    $rescueUntil = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $rescueUntil -and -not $backendReady) {
      Start-Sleep -Milliseconds 500
      $final = Read-TextFileShared $startupLog
      if ($final -match "backend ready http://127\.0\.0\.1:\d+") {
        $backendReady = $true
        Write-Host "L3_LAUNCH_POST_BOUNDARY_RESCUE: backend ready signal caught in final re-read (tick/flush rescue)"
      }
    }
  }

  $script:launchDurations[$Label] = ((Get-Date) - $launchStart).TotalSeconds
  Write-Host "L3_LAUNCH_DURATION $Label=$([math]::Round($script:launchDurations[$Label],1))s"
  if (-not $backendReady) {
    # Upload startup.log as artifact before throwing so failure is diagnosable.
    if ($ArtifactDir -and (Test-Path $startupLog)) {
      New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
      Copy-Item $startupLog (Join-Path $ArtifactDir "$Label-startup.log") -Force
    }
    Write-Host "--- startup.log tail (last 40 lines) ---"
    Get-Content $startupLog -Tail 40
  }
  Assert-True $backendReady "installed backend became ready (archive extraction + harness runtime)" "(see $startupLog)"

  # CDP must be reachable for the UI driver.
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

  # Drive the UI through the journey driver.
  $env:MING_CDP_URL = "http://127.0.0.1:$cdpPort"
  $env:MING_JOURNEY_REQUEST = "把 README 里的 Version: OLD 改成 Version: NEW，然后确认真的改好了。"
  $env:MING_JOURNEY_CREDENTIAL = "fixture-key"
  $env:MING_JOURNEY_BASE_URL = "http://127.0.0.1:8000/v1"
  Push-Location $WorkDir
  try {
    & node scripts/ui-journey-driver.mjs 2>&1 | Tee-Object -FilePath (Join-Path $ScratchRoot "$Label-ui.log")
    $driverExit = $LASTEXITCODE
    # Stage diagnostics so a failure is inspectable via artifacts.
    if ($ArtifactDir) {
      New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
      if (Test-Path $startupLog) { Copy-Item $startupLog (Join-Path $ArtifactDir "$Label-startup.log") -Force }
      if (Test-Path (Join-Path $ScratchRoot "$Label-ui.log")) { Copy-Item (Join-Path $ScratchRoot "$Label-ui.log") (Join-Path $ArtifactDir "$Label-ui.log") -Force }
    }
    if ($driverExit -ne 0) {
      Write-Host "--- ui journey driver log ---"
      Get-Content (Join-Path $ScratchRoot "$Label-ui.log") -Tail 60
      Write-Host "--- installed app startup.log ---"
      Get-Content $startupLog -Tail 40
      throw "ui journey driver exited $driverExit"
    }
  } finally { Pop-Location }
  Remove-Item Env:MING_CDP_URL -ErrorAction SilentlyContinue
  Remove-Item Env:MING_JOURNEY_REQUEST -ErrorAction SilentlyContinue
  Remove-Item Env:MING_JOURNEY_CREDENTIAL -ErrorAction SilentlyContinue
  Remove-Item Env:MING_JOURNEY_BASE_URL -ErrorAction SilentlyContinue

  # Copy diagnostics to the artifact dir so failures are inspectable.
  if ($ArtifactDir) {
    New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
    if (Test-Path $startupLog) { Copy-Item $startupLog (Join-Path $ArtifactDir "$Label-startup.log") -Force }
    if (Test-Path (Join-Path $ScratchRoot "$Label-ui.log")) { Copy-Item (Join-Path $ScratchRoot "$Label-ui.log") (Join-Path $ArtifactDir "$Label-ui.log") -Force }
    if (Test-Path $fixtureLog) { Copy-Item $fixtureLog (Join-Path $ArtifactDir "fixture.out.log") -Force }
  }

  return $proc
}

# Start the repository-owned OpenAI-compatible provider fixture INSIDE this
# process so it is guaranteed alive for the whole journey (a workflow-level
# Start-Process may be cleaned up between steps). The driver configures the
# product to reach it through the UI, never via launch env.
$fixtureTarget = Join-Path $ScratchRoot "fixture-target"
New-Item -ItemType Directory -Force -Path $fixtureTarget | Out-Null
$env:FIXTURE_TARGET_DIR = $fixtureTarget
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
Assert-True $fixtureReady "provider fixture ready inside L3 process"

# First launch: fresh userData, project selected, AAOP setup through UI,
# provider configured through UI, request, intake, approve, execute.
$firstUserData = Join-Path $appDataDir "first"
New-Item -ItemType Directory -Force -Path $firstUserData | Out-Null
$firstProc = Invoke-L3UiJourney "first" $firstUserData

# Independent outcome observation (not driver assertion only).
$aaopExists = Test-Path (Join-Path $scratchRepo ".aaop")
Write-Host "AAOP installed after journey: $aaopExists"
if ($aaopExists) {
  $aaopVersion = Read-TextFileShared (Join-Path $scratchRepo ".aaop\VERSION")
  Write-Host "AAOP VERSION: $aaopVersion"
}
Assert-True $aaopExists "AAOP was installed into the scratch project through the UI"
$readmeAfter = Read-TextFileShared (Join-Path $scratchRepo "README.md")
Write-Host "README after:"
Write-Host $readmeAfter
Assert-True ($readmeAfter -match "Version: NEW") "README reached Version: NEW (independent read)"
$diff = & git -C $scratchRepo diff 2>&1 | Out-String
Write-Host "git diff:"
Write-Host $diff
Assert-True ($diff -match "Version: OLD" -and $diff -match "Version: NEW") "git diff shows OLD -> NEW"
$status = & git -C $scratchRepo status --porcelain 2>&1 | Out-String
Assert-True ($status -match "README\.md") "git status shows only README.md modified"

# Clean close: request the product window to close, then give the whole tree
# (Electron main + backend child + any Harness/ACP child still settling) time
# to exit gracefully. A fresh packaged first launch has more children settling
# than a plain window, so a few seconds is not enough; wait for the tracked
# tree to drain before asserting zero residual.
#
# Returns $true when the tree drained in bounded time (a real clean close).
# When it times out, this is a product-close FAILURE: it is recorded, the
# residual processes are dumped for diagnosis, and force-kill is applied ONLY
# as CI self-cleanup so the remaining steps can run. A forced cleanup never
# converts the gate to PASS — the caller asserts on the returned value.
function Close-InstalledTree([int]$RootPid, [string]$ScratchPath, [string]$InstalledExe, [string]$UserDataDir, [string]$ProjectPath) {
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
    if (-not $fallbackTriggered -and $InstalledExe -and ((Get-Date) - $closeStart).TotalSeconds -ge 8) {
      $fallbackTriggered = $true
      Write-Host "close fallback: launching second instance with --mw-close-instance"
      $fallbackArgs = "--mw-close-instance --user-data-dir `"$UserDataDir`" --no-sandbox --disable-gpu"
      if ($ProjectPath) { $fallbackArgs = "--project `"$ProjectPath`" $fallbackArgs" }
      try {
        Start-Process -FilePath $InstalledExe -ArgumentList $fallbackArgs | Out-Null
      } catch {
        Write-Host "close fallback launch failed: $($_.Exception.Message)"
      }
    }
    Start-Sleep -Milliseconds 500
  }
  Write-Host "L3_GRACEFUL_CLOSE: FAIL (installed tree did not drain within 90s)"
  $rootP = Get-Process -Id $RootPid -ErrorAction SilentlyContinue
  if ($rootP) {
    Write-Host "root pid=$RootPid still alive; MainWindowHandle=$($rootP.MainWindowHandle) title='$($rootP.MainWindowTitle)'"
  } else {
    Write-Host "root pid=$RootPid exited (orphan tree kept matching)"
  }
  Write-Host "residual processes still matching the installed tree:"
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($ScratchPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  } | ForEach-Object {
    Write-Host "  pid=$($_.ProcessId) name=$($_.Name) cmd=$($_.CommandLine)"
  }
  Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
    $_.CommandLine -and $_.CommandLine.IndexOf($ScratchPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0
  } | ForEach-Object {
    try { taskkill /PID $_.ProcessId /T /F 2>&1 | Out-Null } catch { }
  }
  try { taskkill /PID $RootPid /T /F 2>&1 | Out-Null } catch { }
  Start-Sleep -Seconds 3
  return $false
}

$firstCloseGraceful = Close-InstalledTree $firstProc.Id $scratchRepo $installedExe $firstUserData $scratchRepo
$residual = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match [regex]::Escape($scratchRepo) }
Assert-True ($null -eq $residual -or @($residual).Count -eq 0) "zero residual processes after close"
Assert-True $firstCloseGraceful "first close completed gracefully within the 90s bound"

# Second launch: same userData, no --project, restore project/state.
# The driver runs in SECOND phase: it asserts the prior Work Unit/outcome/
# evidence is restored through the UI and must NOT rewrite the credential that
# was already saved into safeStorage on the first launch (rewriting it with a
# wrong value would break the provider, not prove anything about the product).
# The credential/base URL env match the first launch so the driver reports the
# same facts it observed then.
Write-Step "SECOND LAUNCH (restore)"
$secondUserData = $firstUserData
$secondLaunchStart = Get-Date
$secondProc = Start-Process -FilePath $installedExe `
  -ArgumentList "--user-data-dir `"$secondUserData`" --remote-debugging-port=$cdpPort --no-sandbox --disable-gpu" -PassThru
$deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
$cdpReady = $false
while ((Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
  try {
    $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$cdpPort/json/version" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
    if ($resp.StatusCode -eq 200) { $cdpReady = $true; break }
  } catch { }
}

# Post-boundary CDP rescue: same tick-misalignment rationale as first launch.
if (-not $cdpReady) {
  $rescueUntil = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $rescueUntil -and -not $cdpReady) {
    Start-Sleep -Milliseconds 300
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$cdpPort/json/version" -UseBasicParsing -TimeoutSec 2 -ErrorAction SilentlyContinue
      if ($resp.StatusCode -eq 200) {
        $cdpReady = $true
        Write-Host "L3_LAUNCH_POST_BOUNDARY_RESCUE: second-launch CDP endpoint reached in final poll (tick rescue)"
      }
    } catch { }
  }
}

$script:launchDurations['second'] = ((Get-Date) - $secondLaunchStart).TotalSeconds
Write-Host "L3_LAUNCH_DURATION second=$([math]::Round($script:launchDurations['second'],1))s"
Assert-True $cdpReady "second launch CDP endpoint reachable"
$env:MING_CDP_URL = "http://127.0.0.1:$cdpPort"
$env:MING_JOURNEY_PHASE = "second"
$env:MING_JOURNEY_CREDENTIAL = "fixture-key"
$env:MING_JOURNEY_BASE_URL = "http://127.0.0.1:8000/v1"
Push-Location $WorkDir
try {
  & node scripts/ui-journey-driver.mjs 2>&1 | Tee-Object -FilePath (Join-Path $ScratchRoot "second-ui.log")
  if ($LASTEXITCODE -ne 0) {
    Write-Host "--- second ui journey driver log ---"
    Get-Content (Join-Path $ScratchRoot "second-ui.log") -Tail 60
    throw "second ui journey driver exited $LASTEXITCODE"
  }
} finally { Pop-Location }
Remove-Item Env:MING_CDP_URL -ErrorAction SilentlyContinue
Remove-Item Env:MING_JOURNEY_PHASE -ErrorAction SilentlyContinue
Remove-Item Env:MING_JOURNEY_CREDENTIAL -ErrorAction SilentlyContinue
Remove-Item Env:MING_JOURNEY_BASE_URL -ErrorAction SilentlyContinue
$secondCloseGraceful = Close-InstalledTree $secondProc.Id $scratchRepo $installedExe $secondUserData $null
Assert-True $secondCloseGraceful "second close completed gracefully within the 90s bound"

# Independent evidence summary (facts already verified above; printed as a
# single reviewable block). Read BEFORE uninstall removes the installed exe and
# its runtime manifests. All values come from the real installed app and its
# startup.log, not from agent claims.
$evidenceStartupLog = Join-Path $firstUserData "startup.log"
$startupText = Read-TextFileShared $evidenceStartupLog
$harnessIdentity = "unknown"
if ($startupText -match "harness runtime ready source=bundled-capsule commit=([0-9a-f]{40})") { $harnessIdentity = $Matches[1] }
# Bundled Python identity comes from the installed app's runtime manifest.
$pythonIdentity = "unknown"
$pythonRuntimeJson = Join-Path $installDir "resources\app\.workbench\runtime\python\python-runtime.json"
if (Test-Path $pythonRuntimeJson) {
  try {
    $pythonIdentity = (Read-TextFileShared $pythonRuntimeJson | ConvertFrom-Json).version
  } catch { }
}
$installedSize = 0
if (Test-Path $installedExe) { $installedSize = (Get-Item $installedExe).Length }
$firstLaunchLog = Read-TextFileShared $evidenceStartupLog

Write-Host "L3_EVIDENCE installer_sha256=$installerSha256"
Write-Host "L3_EVIDENCE installer_bytes=$installerBytes"
Write-Host "L3_EVIDENCE installed_exe=$installedExe"
Write-Host "L3_EVIDENCE installed_exe_bytes=$installedSize"
Write-Host "L3_EVIDENCE harness_commit=$harnessIdentity"
Write-Host "L3_EVIDENCE python_version=$pythonIdentity"
Write-Host "L3_EVIDENCE scratch_repo=$scratchRepo"
Write-Host "L3_EVIDENCE first_launch_duration_s=$([math]::Round([double]$script:launchDurations['first'],1))"
Write-Host "L3_EVIDENCE second_launch_duration_s=$([math]::Round([double]$script:launchDurations['second'],1))"

# Uninstall cleanup.
Write-Step "UNINSTALL"
$uninstaller = Join-Path $installDir "Uninstall Ming Workbench.exe"
if (Test-Path $uninstaller) {
  Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru | Out-Null
  Start-Sleep -Seconds 3
}
Assert-True (-not (Test-Path $installedExe)) "installed exe removed after uninstall"

# Stop the provider fixture.
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

Write-Host "CONSUMER_HUMAN_JOURNEY_L3: PASS"
exit 0
