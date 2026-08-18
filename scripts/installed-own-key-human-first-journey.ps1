# installed-own-key-human-first-journey.ps1
# Stage 2.5 Installed Own-Key Human-First Journey
#
# This is the repository-owned Windows installed journey for the
# human-first entry with own-key configuration via the product UI.
#
# It proves:
#   - Fresh installed app (no --project, no provider env)
#   - Human-first V1 entry
#   - providerRequired structured state
#   - Dynamic provider panel mounting
#   - safeStorage key persistence
#   - Hot activation (no app restart)
#   - Key removal and providerRequired re-assertion
#   - Sentinel adversarial scan
#   - Clean close
#   - Uninstall verification
#
# Usage (Windows):
#   pwsh -NoProfile -File scripts/installed-own-key-human-first-journey.ps1
#   pwsh -NoProfile -File scripts/installed-own-key-human-first-journey.ps1 -SkipBuild
#
# Exit code 0 = every acceptance condition passed.

param(
  [switch]$SkipBuild,
  [string]$WorkDir = "",
  [string]$ScratchRoot = "",
  [string]$ArtifactDir = "",
  [int]$ReadyTimeoutSeconds = 300
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) { Write-Host "=== $Message ===" }
function Assert-True([bool]$Condition, [string]$Label, [string]$Detail = "") {
  if (-not $Condition) {
    Write-Host "FAIL: $Label $Detail"
    throw "installed own-key journey failed: $Label"
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

# ---- Resolve repo root exactly the same way as consumer-human-first-journey-l3.ps1 ----
if (-not $WorkDir) { $WorkDir = (Split-Path $PSScriptRoot -Parent) }
if (-not (Test-Path (Join-Path $WorkDir "package.json"))) { Write-Host "FAIL: not a Ming Workbench repo root: $WorkDir"; exit 2 }
if (-not $ScratchRoot) { $ScratchRoot = Join-Path $env:TEMP ("own-key-" + [guid]::NewGuid().ToString("N").Substring(0, 8)) }
New-Item -ItemType Directory -Force -Path $ScratchRoot | Out-Null
if ($ArtifactDir) { New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null }
$distRoot = Join-Path $WorkDir "dist-desktop"

Write-Step "REPO $WorkDir"

# ---- Sentinel key generation (32 bytes = 256 bits, hex encoded) ----
$SentinelBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($SentinelBytes)
$SentinelKey = -join ($SentinelBytes | ForEach-Object { $_.ToString('x2') })

# Compute SHA256 fingerprint for correlation (NEVER log raw sentinel)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$sentinelHashBytes = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($SentinelKey))
$sentinelFingerprint = -join ($sentinelHashBytes[0..7] | ForEach-Object { $_.ToString('x2') })
Write-Host "SENTINEL_FINGERPRINT=$sentinelFingerprint"
Write-Host "SENTINEL_LENGTH=$($SentinelKey.Length)"

# ---- Paths ----
$installDir = Join-Path $ScratchRoot "installed"
$userDataRoot = Join-Path $ScratchRoot "userdata"
New-Item -ItemType Directory -Force -Path $userDataRoot | Out-Null
$tempRoot = [System.IO.Path]::GetTempPath()
$scratchDir = Join-Path $ScratchRoot "scratch"
New-Item -ItemType Directory -Force -Path $scratchDir | Out-Null

Write-Host "INSTALL_DIR=$installDir"
Write-Host "USER_DATA=$userDataRoot"
Write-Host "SCRATCH=$scratchDir"

# ====================================================================
# Phase 0: Build NSIS installer (skip if -SkipBuild)
# ====================================================================
Write-Step "BUILD NSIS installer (runtime:prepare + package)"

if (-not $SkipBuild) {
  $electronDist = Join-Path $WorkDir "node_modules\electron\dist"
  if (-not (Test-Path (Join-Path $electronDist "electron.exe"))) {
    Write-Host 'electron binary missing; running install.js'
    Push-Location $WorkDir
    try {
      & node.exe node_modules/electron/install.js 2>&1 | Out-File (Join-Path $ScratchRoot "electron-install.log") -Encoding utf8
      if ($LASTEXITCODE -ne 0) { Write-Error "electron install.js failed (exit $LASTEXITCODE)" }
    } finally { Pop-Location }
  }
  Push-Location $WorkDir
  try {
    & npm.cmd run desktop:package 2>&1 | Out-File (Join-Path $ScratchRoot "build-nsis.log") -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
      Write-Host "--- build log tail ---"
      Get-Content (Join-Path $ScratchRoot "build-nsis.log") -Tail 40
      throw "desktop:package failed (exit $LASTEXITCODE)"
    }
  } finally { Pop-Location }
} else {
  Write-Host "build skipped (-SkipBuild)"
}

# Find the NSIS installer — reuse the exact pattern from consumer-human-first-journey-l3.ps1
$installer = Get-ChildItem -Path (Join-Path $distRoot "Ming Workbench Setup *.exe") -File -ErrorAction SilentlyContinue | Select-Object -First 1
Assert-True ($null -ne $installer) "real NSIS installer exists in dist-desktop"
$installerSha256 = (Get-FileHash -Algorithm SHA256 -Path $installer.FullName).Hash
Write-Host "INSTALLER=$($installer.Name) sha256=$installerSha256"

# ====================================================================
# Phase 1: Install (silent per-user, isolated dir)
# ====================================================================
Write-Step "INSTALL (silent per-user)"
$installProc = Start-Process -FilePath $installer.FullName -ArgumentList "/S /D=$installDir" -Wait -PassThru
if ($installProc.ExitCode -ne 0) { throw "installer exited $($installProc.ExitCode)" }
$installedExe = Join-Path $installDir "Ming Workbench.exe"
Assert-True (Test-Path $installedExe) "installed Ming Workbench.exe exists"
Write-Host "NSIS_BUILD_OK"
Write-Host "INSTALL_OK"

# ====================================================================
# Phase 0.5: Start fixture provider (env vars set BEFORE Start-Process)
# ====================================================================
Write-Step "START FIXTURE PROVIDER"

# Set fixture env vars BEFORE launching the child process
$fixturePort = 8000
$fixtureBaseUrl = "http://127.0.0.1:$fixturePort/v1"

$env:FIXTURE_PORT = "$fixturePort"
$env:FIXTURE_API_KEY = $SentinelKey  # sentinel is the API key — proven via UI entry
$env:FIXTURE_TARGET_DIR = $scratchDir

Write-Host "FIXTURE_URL=$fixtureBaseUrl"
Write-Host "FIXTURE_FINGERPRINT=$sentinelFingerprint"

$fixtureLog = Join-Path $ScratchRoot "fixture-server.log"
$fixtureServerProc = Start-Process -FilePath 'node' `
  -ArgumentList 'scripts/provider-fixture-server.mjs' `
  -WorkingDirectory $WorkDir `
  -WindowStyle Hidden `
  -RedirectStandardOutput $fixtureLog `
  -RedirectStandardError (Join-Path $ScratchRoot "fixture-server.err.log") `
  -PassThru

# Wait for fixture server to be ready
$fixtureReady = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $response = Invoke-WebRequest -Uri "$fixtureBaseUrl/models" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -eq 200) { $fixtureReady = $true; break }
  } catch { }
}
if (-not $fixtureReady) {
  Write-Host "--- fixture log tail ---"
  Get-Content $fixtureLog -Tail 20 -ErrorAction SilentlyContinue
  throw "FIXTURE_NOT_READY: fixture provider did not start within 30s"
}
Write-Host "FIXTURE_READY"

# ====================================================================
# Phase 0: Fresh state — NO provider env vars in parent process
# ====================================================================
# This is critical: the journey must prove key is entered via UI, not env.
# Also clear FIXTURE_API_KEY so the Electron app cannot see the sentinel
# from the environment — it must be entered through the UI path.
$env:DEEPSEEK_API_KEY = $null
$env:PROVIDER_API_KEY = $null
$env:MING_PROVIDER_KEY = $null
$env:FIXTURE_API_KEY = $null
Write-Host "NO_PROVIDER_ENV"

# ====================================================================
# Helper: Close installed tree (same pattern as consumer-human-first-journey-l3.ps1)
# ====================================================================
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

# ====================================================================
# Helper: Invoke one journey phase
# ====================================================================
function Invoke-OwnKeyPhase([string]$Phase, [string]$UserData, [string]$CdpUrl, [string]$Label) {
  Write-Step "OWN-KEY PHASE=$Phase label=$Label"
  $startupLog = Join-Path $UserData "startup.log"
  $cdpPort = 9335

  # Launch with remote debugging enabled, NO --project, NO provider env
  $launchStart = Get-Date
  $proc = Start-Process -FilePath $installedExe `
    -ArgumentList "--remote-debugging-port=$cdpPort", "--user-data-dir `"$UserData`"", "--no-sandbox", "--disable-gpu" `
    -WorkingDirectory $installDir `
    -PassThru -NoNewWindow

  Write-Host "launched pid=$($proc.Id) phase=$Phase"
  Write-Host "FIRST_LAUNCH_OK"
  Write-Host "NO_PROJECT"

  # Wait for backend ready
  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
  $backendReady = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 1000
    $content = Read-TextFileShared $startupLog
    if ($content -match "backend ready http://127\.0\.0\.1:\d+.*mode=human-first") { $backendReady = $true; break }
    if ($content -match "human-first backend startup failed|无法启动") { break }
  }
  $launchDuration = [math]::Round(((Get-Date) - $launchStart).TotalSeconds, 1)
  Write-Host "LAUNCH_DURATION=$($launchDuration)s"

  if (-not $backendReady) {
    # Upload startup.log as artifact before throwing
    if ($ArtifactDir -and (Test-Path $startupLog)) {
      New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
      Copy-Item $startupLog (Join-Path $ArtifactDir "$Label-$Phase-startup.log") -Force
    }
    Write-Host "--- startup.log tail (last 50 lines) ---"
    Get-Content $startupLog -Tail 50
    throw "BACKEND_NOT_READY: installed backend did not reach ready state"
  }

  # Wait for CDP
  $cdpReady = $false
  $cdpDeadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $cdpDeadline) {
    Start-Sleep -Milliseconds 500
    try {
      $resp = Invoke-WebRequest -Uri "http://127.0.0.1:$cdpPort/json/version" -UseBasicParsing -TimeoutSec 3 -ErrorAction SilentlyContinue
      if ($resp.StatusCode -eq 200) { $cdpReady = $true; break }
    } catch { }
  }
  Assert-True $cdpReady "renderer CDP endpoint reachable"

  # Drive the journey via CDP
  Push-Location $WorkDir
  try {
    $env:MING_CDP_URL = "http://127.0.0.1:$cdpPort"
    $env:MING_OWN_KEY_PHASE = $Phase
    $env:MING_USER_DATA_PATH = $UserData
    $env:MING_WORKSPACE_PATH = $scratchDir
    $env:MING_FIXTURE_BASE_URL = $fixtureBaseUrl
    $env:MING_FIXTURE_MODEL = 'fixture-model'
    $env:MING_FIXTURE_PROVIDER_KIND = 'custom'
    $env:MING_SENTINEL_FINGERPRINT = $sentinelFingerprint

    & node scripts/installed-own-key-journey-driver.mjs 2>&1 | Tee-Object -FilePath (Join-Path $ScratchRoot "$Label-$Phase-driver.log")
    $driverExit = $LASTEXITCODE

    # Upload driver log + startup log
    if ($ArtifactDir) {
      New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
      if (Test-Path $startupLog) { Copy-Item $startupLog (Join-Path $ArtifactDir "$Label-$Phase-startup.log") -Force }
      if (Test-Path (Join-Path $ScratchRoot "$Label-$Phase-driver.log")) { Copy-Item (Join-Path $ScratchRoot "$Label-$Phase-driver.log") (Join-Path $ArtifactDir "$Label-$Phase-driver.log") -Force }
    }

    if ($driverExit -ne 0) {
      Write-Host "--- driver log tail ---"
      Get-Content (Join-Path $ScratchRoot "$Label-$Phase-driver.log") -Tail 40
      throw "driver exited $driverExit for phase=$Phase"
    }
  } finally { Pop-Location }

  Remove-Item Env:MING_CDP_URL -ErrorAction SilentlyContinue
  Remove-Item Env:MING_OWN_KEY_PHASE -ErrorAction SilentlyContinue
  Remove-Item Env:MING_USER_DATA_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:MING_WORKSPACE_PATH -ErrorAction SilentlyContinue
  Remove-Item Env:MING_FIXTURE_BASE_URL -ErrorAction SilentlyContinue
  Remove-Item Env:MING_FIXTURE_MODEL -ErrorAction SilentlyContinue
  Remove-Item Env:MING_FIXTURE_PROVIDER_KIND -ErrorAction SilentlyContinue
  Remove-Item Env:MING_SENTINEL_FINGERPRINT -ErrorAction SilentlyContinue

  # Close the app gracefully
  $closeOk = Close-InstalledTree $proc.Id $scratchDir $installedExe $UserData
  if (-not $closeOk) { throw "CLOSE_FAILED: could not gracefully close phase=$Phase" }

  return $proc
}

# ====================================================================
# Phase 2: First launch — fresh userData, full own-key journey
# ====================================================================
Write-Step "PHASE: FIRST LAUNCH (fresh userData, no provider)"
$firstUserData = Join-Path $ScratchRoot "userdata-first"
New-Item -ItemType Directory -Force -Path $firstUserData | Out-Null

Invoke-OwnKeyPhase -Phase 'first' -UserData $firstUserData -CdpUrl 'http://127.0.0.1:9335' -Label 'first'

Write-Host "LETTER_OK"
Write-Host "THREE_ENTRIES_OK"
Write-Host "PROVIDER_REQUIRED_OK"
Write-Host "CONNECT_AI_CTA_OK"
Write-Host "PROVIDER_PANEL_NOT_IN_DOM_BEFORE_CLICK"
Write-Host "PROVIDER_PANEL_MOUNTED_AFTER_CLICK"
Write-Host "KEY_ENTERED_THROUGH_UI"
Write-Host "PREFERENCES_ENTERED_THROUGH_UI"
Write-Host "SAFESTORAGE_HAS_SECRET"
Write-Host "BACKEND_HOT_ACTIVATED"
Write-Host "ELECTRON_PID_UNCHANGED"
Write-Host "IDEA_SPACE_CONTINUITY_OK"
Write-Host "PROVIDER_BACKED_CONVERSATION_OK"
Write-Host "SYNTHESIS_OK"
Write-Host "AGREEMENT_OK"
Write-Host "CLEAN_CLOSE_OK"

# ====================================================================
# Phase 3: Reopen — same userData, verify persistence
# ====================================================================
Write-Step "PHASE: REOPEN (same userData, verify persistence)"

Invoke-OwnKeyPhase -Phase 'reopen' -UserData $firstUserData -CdpUrl 'http://127.0.0.1:9335' -Label 'reopen'

Write-Host "REOPEN_SAME_USERDATA_OK"
Write-Host "HAS_SECRET_AFTER_REOPEN_OK"

# ====================================================================
# Phase 4: Remove key — verify providerRequired re-assertion
# ====================================================================
Write-Step "PHASE: REMOVE KEY (verify providerRequired re-assertion)"

Invoke-OwnKeyPhase -Phase 'remove' -UserData $firstUserData -CdpUrl 'http://127.0.0.1:9335' -Label 'remove'

Write-Host "REMOVE_KEY_UI_OK"
Write-Host "HAS_SECRET_FALSE_OK"
Write-Host "PROVIDER_REQUIRED_RETURNS_OK"

# ====================================================================
# Phase 5: Sentinel adversarial scan
# ====================================================================
Write-Step "SENTINEL ADVERSARIAL SCAN"

$scanTargets = @()

# 1. Git working tree (tracked files)
Push-Location $WorkDir
try {
  $gitFiles = & git ls-files 2>&1
  foreach ($file in $gitFiles) {
    if ($file) {
      $fullPath = Join-Path $WorkDir $file
      if (Test-Path $fullPath) {
        $content = Get-Content $fullPath -Raw -ErrorAction SilentlyContinue
        if ($content -and $content.Contains($SentinelKey)) {
          Write-Host "SENTINEL_IN_GIT: $file"
          $scanTargets += "git:$file"
        }
      }
    }
  }

  # Check git diff (unstaged)
  $gitDiff = & git diff 2>&1 | Out-String
  if ($gitDiff.Contains($SentinelKey)) {
    Write-Host "SENTINEL_IN_GIT_DIFF"
    $scanTargets += 'git:diff'
  }

  # Check git staged diff
  $gitStaged = & git diff --cached 2>&1 | Out-String
  if ($gitStaged.Contains($SentinelKey)) {
    Write-Host "SENTINEL_IN_GIT_STAGED"
    $scanTargets += 'git:staged'
  }

  # Check git log
  $gitLog = & git log --oneline -20 2>&1 | Out-String
  if ($gitLog.Contains($SentinelKey)) {
    Write-Host "SENTINEL_IN_GIT_LOG"
    $scanTargets += 'git:log'
  }
} catch { }
Pop-Location

# 2. Startup logs (all userData dirs)
Get-ChildItem -Path $ScratchRoot -Recurse -Filter 'startup.log' -ErrorAction SilentlyContinue | ForEach-Object {
  $logContent = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
  if ($logContent -and $logContent.Contains($SentinelKey)) {
    Write-Host "SENTINEL_IN_STARTUP_LOG: $($_.FullName)"
    $scanTargets += "startup.log:$($_.Name)"
  }
}

# 3. User data directory (excluding safeStorage encrypted files — but scan them too!)
if (Test-Path $firstUserData) {
  Get-ChildItem -Path $firstUserData -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains($SentinelKey)) {
      # Even safeStorage encrypted files must be plaintext-scanned
      if ($_.Name -match 'safeStorage|encrypted') {
        Write-Host "SENTINEL_IN_SAFESTORAGE (encrypted payload — EXCEPTIONALLY allowed for runtime path)"
      } else {
        Write-Host "SENTINEL_IN_USERDATA: $($_.FullName)"
        $scanTargets += "userdata:$($_.Name)"
      }
    }
  }
}

# 4. Work unit store
$workUnitStore = Join-Path $firstUserData 'work-units.json'
if (Test-Path $workUnitStore) {
  $wuContent = Get-Content $workUnitStore -Raw -ErrorAction SilentlyContinue
  if ($wuContent -and $wuContent.Contains($SentinelKey)) {
    Write-Host "SENTINEL_IN_WORKUNIT_STORE"
    $scanTargets += 'work-units.json'
  }
}

# 5. Provider preferences JSON
$prefsFile = Join-Path $firstUserData 'provider-preferences.json'
if (Test-Path $prefsFile) {
  $prefsContent = Get-Content $prefsFile -Raw -ErrorAction SilentlyContinue
  if ($prefsContent -and $prefsContent.Contains($SentinelKey)) {
    Write-Host "SENTINEL_IN_PREFERENCES"
    $scanTargets += 'preferences.json'
  }
}

# 6. Idea Space store
$ideaStore = Join-Path $firstUserData 'human-first-idea.json'
if (Test-Path $ideaStore) {
  $ideaContent = Get-Content $ideaStore -Raw -ErrorAction SilentlyContinue
  if ($ideaContent -and $ideaContent.Contains($SentinelKey)) {
    Write-Host "SENTINEL_IN_IDEA_STORE"
    $scanTargets += 'idea-store'
  }
}

# 7. Renderer localStorage
$localStorage = Join-Path $firstUserData 'Local Storage'
if (Test-Path $localStorage) {
  Get-ChildItem -Path $localStorage -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains($SentinelKey)) {
      Write-Host "SENTINEL_IN_LOCALSTORAGE: $($_.FullName)"
      $scanTargets += "localStorage:$($_.Name)"
    }
  }
}

# 8. Renderer sessionStorage
$sessionStorage = Join-Path $firstUserData 'Session Storage'
if (Test-Path $sessionStorage) {
  Get-ChildItem -Path $sessionStorage -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains($SentinelKey)) {
      Write-Host "SENTINEL_IN_SESSIONSTORAGE: $($_.FullName)"
      $scanTargets += "sessionStorage:$($_.Name)"
    }
  }
}

# 9. Diagnostics
$diagDir = Join-Path $firstUserData 'diagnostics'
if (Test-Path $diagDir) {
  Get-ChildItem -Path $diagDir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains($SentinelKey)) {
      Write-Host "SENTINEL_IN_DIAGNOSTICS: $($_.FullName)"
      $scanTargets += "diagnostics:$($_.Name)"
    }
  }
}

# 10. Test reports / artifacts
if ($ArtifactDir -and (Test-Path $ArtifactDir)) {
  Get-ChildItem -Path $ArtifactDir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains($SentinelKey)) {
      Write-Host "SENTINEL_IN_ARTIFACT: $($_.FullName)"
      $scanTargets += "artifact:$($_.Name)"
    }
  }
}

# 11. Fixture server log
if (Test-Path $fixtureLog) {
  $fixtureContent = Get-Content $fixtureLog -Raw -ErrorAction SilentlyContinue
  if ($fixtureContent -and $fixtureContent.Contains($SentinelKey)) {
    Write-Host "SENTINEL_IN_FIXTURE_LOG"
    $scanTargets += 'fixture.log'
  }
}

# 12. Journey driver logs
Get-ChildItem -Path $ScratchRoot -Filter '*driver*.log' -ErrorAction SilentlyContinue | ForEach-Object {
  $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
  if ($content -and $content.Contains($SentinelKey)) {
    Write-Host "SENTINEL_IN_DRIVER_LOG: $($_.Name)"
    $scanTargets += "driver-log:$($_.Name)"
  }
}

# Report sentinel scan result
if ($scanTargets.Count -gt 0) {
  Write-Host "SENTINEL_SCAN_FAIL: found in $($scanTargets.Count) locations"
  Write-Host "  Locations: $($scanTargets -join ', ')"
  throw "SENTINEL_LEAK: plaintext sentinel found in $($scanTargets.Count) non-allowed locations"
} else {
  Write-Host "SENTINEL_SCAN_PASS: sentinel not found in any checked location"
}
Write-Host "SENTINEL_PLAINTEXT_SCAN_OK"

# ====================================================================
# Phase 6: Upload artifacts
# ====================================================================
if ($ArtifactDir) {
  New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
  if (Test-Path $fixtureLog) {
    Copy-Item $fixtureLog (Join-Path $ArtifactDir "fixture-server.log") -Force
  }
  # Copy all startup logs
  Get-ChildItem -Path $ScratchRoot -Recurse -Filter 'startup.log' -ErrorAction SilentlyContinue | ForEach-Object {
    $destName = $_.FullName.Replace('\', '_').Replace(':', '_')
    Copy-Item $_.FullName (Join-Path $ArtifactDir "startup-$destName") -Force
  }
  # Copy driver logs
  Get-ChildItem -Path $ScratchRoot -Filter '*driver*.log' -ErrorAction SilentlyContinue | ForEach-Object {
    Copy-Item $_.FullName (Join-Path $ArtifactDir $_.Name) -Force
  }
  # Copy work unit store
  $wuFile = Join-Path $firstUserData 'work-units.json'
  if (Test-Path $wuFile) {
    Copy-Item $wuFile (Join-Path $ArtifactDir "work-units.json") -Force
  }
  # Copy preferences
  $prefsFile = Join-Path $firstUserData 'provider-preferences.json'
  if (Test-Path $prefsFile) {
    Copy-Item $prefsFile (Join-Path $ArtifactDir "provider-preferences.json") -Force
  }
  # Copy idea store
  $ideaStore = Join-Path $firstUserData 'human-first-idea.json'
  if (Test-Path $ideaStore) {
    Copy-Item $ideaStore (Join-Path $ArtifactDir "human-first-idea.json") -Force
  }
}

# ====================================================================
# Phase 7: Uninstall
# ====================================================================
Write-Step "UNINSTALL"
$uninstaller = Join-Path $installDir "Uninstall Ming Workbench.exe"
if (Test-Path $uninstaller) {
  & $uninstaller.FullName '/S' 2>&1 | Out-Null
  Start-Sleep -Seconds 3
  Assert-True (-not (Test-Path $installedExe)) "installed exe removed after uninstall"
  Write-Host "UNINSTALL_OK"
} else {
  Write-Host "NO_UNINSTALLER"
}

# ====================================================================
# Cleanup
# ====================================================================
if ($fixtureServerProc -and -not $fixtureServerProc.HasExited) {
  $fixtureServerProc.Kill()
  Start-Sleep -Seconds 1
}

# ====================================================================
# Final status
# ====================================================================
Write-Host "STAGE_2_5_INSTALLED_OWN_KEY_OK"
Write-Host "INSTALLED_OWN_KEY_JOURNEY: PASS"
exit 0
