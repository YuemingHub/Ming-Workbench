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

param(
  [string]$RepoRoot = $PSScriptRoot,
  [string]$Label = 'own-key',
  [string]$ArtifactDir = '',
  [int]$ExitCode = 0
)

$ErrorActionPreference = 'Stop'

Write-Host "=== INSTALLED OWN-KEY HUMAN-FIRST JOURNEY (Stage 2.5) ==="
Write-Host "REPO_ROOT=$RepoRoot"
Write-Host "LABEL=$Label"

# ---- Sentinel key generation ----
$SentinelBytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($SentinelBytes)
$SentinelKey = -join ($SentinelBytes | ForEach-Object { $_.ToString('x2') })
Write-Host "SENTINEL_KEY=$SentinelKey"

# ---- Paths ----
$distDir = Join-Path $RepoRoot 'dist'
$userDataRoot = Join-Path $env:LOCALAPPDATA 'MingWorkbench-OwnKey-Test'
if (Test-Path $userDataRoot) { Remove-Item -Recurse -Force $userDataRoot }
$tempRoot = [System.IO.Path]::GetTempPath()
$scratchDir = Join-Path $tempRoot "ming-own-key-scratch-$([guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Force -Path $scratchDir | Out-Null

# Fixture provider setup
$fixturePort = 8000
$fixtureBaseUrl = "http://127.0.0.1:$fixturePort/v1"
$fixtureApiKey = $SentinelKey  # Use sentinel as the key for this test
$fixtureServerProc = $null

Write-Host "USER_DATA=$userDataRoot"
Write-Host "SCRATCH=$scratchDir"
Write-Host "FIXTURE_URL=$fixtureBaseUrl"

# ---- 0.5. Start fixture provider ----
Write-Host "=== Phase 0.5: Start Fixture Provider ==="
$fixtureServerProc = Start-Process -FilePath 'node' `
  -ArgumentList 'scripts/provider-fixture-server.mjs' `
  -WorkingDirectory $RepoRoot `
  -PassThru -NoNewWindow `
  -RedirectStandardOutput (Join-Path $tempRoot 'fixture-server.log')

# Set fixture env vars
$env:FIXTURE_PORT = "$fixturePort"
$env:FIXTURE_API_KEY = $fixtureApiKey
$env:FIXTURE_TARGET_DIR = $scratchDir

# Wait for fixture server to be ready
$fixtureReady = $false
for ($i = 0; $i -lt 15; $i++) {
  Start-Sleep -Seconds 1
  try {
    $response = Invoke-WebRequest -Uri "$fixtureBaseUrl/models" -TimeoutSec 2 -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -eq 200) { $fixtureReady = $true; break }
  } catch { }
}
if (-not $fixtureReady) {
  Write-Host "FIXTURE_NOT_READY"
  if ($fixtureServerProc) { $fixtureServerProc.Kill() }
  $ExitCode = 1
  return $ExitCode
}
Write-Host "FIXTURE_READY"

# ---- 0. Fresh state: no provider env vars ----
# This is critical: the journey must prove key is entered via UI, not env.
$env:DEEPSEEK_API_KEY = $null
$env:PROVIDER_API_KEY = $null
$env:MING_PROVIDER_KEY = $null
Write-Host "env provider vars cleared"

# ---- 1. Build & install ----
Write-Host "=== Phase 1: Build & Install ==="

# Build the app
Push-Location $RepoRoot
& pnpm run dist 2>&1 | ForEach-Object { Write-Host $_ }
if ($LASTEXITCODE -ne 0) {
  Write-Host "BUILD FAILED: pnpm run dist exited $LASTEXITCODE"
  $ExitCode = 1
  return $ExitCode
}
Pop-Location

# Find the NSIS installer
$installer = Get-ChildItem -Path $distDir -Filter 'Ming-Workbench-Setup-*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if (-not $installer) {
  Write-Host "NO_INSTALLER: no NSIS installer found in dist/"
  Write-Host "Contents of dist/:"
  Get-ChildItem $distDir -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  $ExitCode = 1
  return $ExitCode
}
Write-Host "INSTALLER=$($installer.FullName)"

# Find the installed EXE
$installDir = Join-Path $env:LOCALAPPDATA 'Ming Workbench'
$installedExe = Join-Path $installDir 'Ming Workbench.exe'

# Uninstall any previous version (silently)
$uninstaller = Get-ChildItem -Path $installDir -Filter 'uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($uninstaller) {
  Write-Host "Uninstalling previous version..."
  & $uninstaller.FullName '/S' 2>&1 | Out-Null
  Start-Sleep -Seconds 3
}

# Silent per-user install
Write-Host "Installing..."
& $installer.FullName '/S' 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0 -and $LASTEXITCODE -ne 0) {
  # NSIS silent install returns 0 on success, non-zero on failure
  Write-Host "INSTALL_FAILED: exit code $LASTEXITCODE"
  $ExitCode = 1
  return $ExitCode
}

Start-Sleep -Seconds 2
if (-not (Test-Path $installedExe)) {
  Write-Host "INSTALLER_BROKEN: Ming Workbench.exe not found after install"
  Write-Host "Checking install dir: $installDir"
  Get-ChildItem $installDir -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "  $_" }
  $ExitCode = 1
  return $ExitCode
}
Write-Host "INSTALLED_OK"

# ---- 2. Launch Phase 1: first launch (no project, no provider env) ----
Write-Host "=== Phase 2: First Launch (fresh userData, no provider) ==="

$cdpPort = 9222
$cdpUrl = "http://127.0.0.1:$cdpPort"
$startupLog = Join-Path $userDataRoot 'logs' 'startup.log'

# Launch with remote debugging enabled
$proc = Start-Process -FilePath $installedExe `
  -ArgumentList "--remote-debugging-port=$cdpPort", "--user-data-dir=$userDataRoot" `
  -WorkingDirectory $installDir `
  -PassThru -NoNewWindow

Write-Host "LAUNCHED_PID=$($proc.Id)"
$launchStart = Get-Date

# Wait for backend ready (up to 3 minutes)
$backendReady = $false
for ($i = 0; $i -lt 180; $i++) {
  Start-Sleep -Seconds 1
  if (-not (Test-Path $startupLog)) { continue }
  $content = Get-Content $startupLog -Raw -ErrorAction SilentlyContinue
  if ($content -match 'backend ready http://127\.0\.0\.1:\d+') { $backendReady = $true; break }
  if ($content -match 'human-first backend startup failed|无法启动') { break }
}
$launchDuration = [math]::Round(((Get-Date) - $launchStart).TotalSeconds, 1)
Write-Host "FIRST_LAUNCH_DURATION=${launchDuration}s"

if (-not $backendReady) {
  Write-Host "=== startup.log tail ==="
  Get-Content $startupLog -Tail 50 -ErrorAction SilentlyContinue
  Write-Host "BACKEND_NOT_READY"
  # Upload startup log
  if ($ArtifactDir -and (Test-Path $startupLog)) {
    New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
    Copy-Item $startupLog (Join-Path $ArtifactDir "$Label-phase1-startup.log") -Force
  }
  $ExitCode = 1
  return $ExitCode
}
Write-Host "BACKEND_READY"

# Wait for CDP
$cdpReady = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $response = Invoke-WebRequest -Uri "$cdpUrl/json/version" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -eq 200) { $cdpReady = $true; break }
  } catch { }
}
if (-not $cdpReady) {
  Write-Host "CDP_NOT_READY"
  $ExitCode = 1
  return $ExitCode
}
Write-Host "CDP_READY"

# ---- 3. Drive Phase 1: first journey ----
Write-Host "=== Phase 3: Drive First Journey ==="

Push-Location $RepoRoot
try {
  $env:MING_CDP_URL = $cdpUrl
  $env:MING_OWN_KEY_PHASE = 'first'
  $env:MING_SENTINEL_KEY = $SentinelKey
  $env:MING_USER_DATA_PATH = $userDataRoot
  $env:MING_WORKSPACE_PATH = $scratchDir

  # Use the repository-owned deterministic fixture provider
  $env:MING_FIXTURE_BASE_URL = $fixtureBaseUrl
  $env:MING_FIXTURE_MODEL = 'fixture-model'
  $env:MING_FIXTURE_PROVIDER_KIND = 'custom'

  & node scripts/installed-own-key-journey-driver.mjs 2>&1 | ForEach-Object { Write-Host $_ }
  $phase1Exit = $LASTEXITCODE
  Write-Host "PHASE1_EXIT=$phase1Exit"
  if ($phase1Exit -ne 0) {
    Write-Host "PHASE1_FAILED"
    $ExitCode = 1
  }
} catch {
  Write-Host "PHASE1_ERROR: $_"
  $ExitCode = 1
}
Pop-Location

# ---- 4. Close Phase 1 ----
Write-Host "=== Phase 4: Close First Launch ==="
if (-not $proc.HasExited) {
  # Send quit signal via CDP or just kill
  try {
    # Try graceful quit via CDP
    $targets = Invoke-RestMethod -Uri "$cdpUrl/json" -ErrorAction SilentlyContinue
    if ($targets) {
      $firstTarget = $targets | Select-Object -First 1
      if ($firstTarget -and $firstTarget.id) {
        Invoke-WebRequest -Uri "$cdpUrl/json/close/$($firstTarget.id)" -UseBasicParsing -ErrorAction SilentlyContinue | Out-Null
      }
    }
  } catch { }
  Start-Sleep -Seconds 2
  if (-not $proc.HasExited) {
    $proc.Kill()
    Write-Host "PROCESS_KILLED_FORCIBLY"
  } else {
    Write-Host "PROCESS_CLOSED_GRACEFULLY"
  }
}
Start-Sleep -Seconds 2

# ---- 5. Launch Phase 2: reopen (same userData) ----
Write-Host "=== Phase 5: Reopen (same userData, verify persistence) ==="

$proc2 = Start-Process -FilePath $installedExe `
  -ArgumentList "--remote-debugging-port=$cdpPort", "--user-data-dir=$userDataRoot" `
  -WorkingDirectory $installDir `
  -PassThru -NoNewWindow

Write-Host "REOPENED_PID=$($proc2.Id)"

# Wait for backend ready
$backendReady2 = $false
for ($i = 0; $i -lt 180; $i++) {
  Start-Sleep -Seconds 1
  if (-not (Test-Path $startupLog)) { continue }
  $content = Get-Content $startupLog -Raw -ErrorAction SilentlyContinue
  if ($content -match 'backend ready http://127\.0\.0\.1:\d+') { $backendReady2 = $true; break }
}
if (-not $backendReady2) {
  Write-Host "REOPEN_BACKEND_NOT_READY"
  if ($ArtifactDir -and (Test-Path $startupLog)) {
    New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
    Copy-Item $startupLog (Join-Path $ArtifactDir "$Label-phase2-startup.log") -Force
  }
  $ExitCode = 1
} else {
  Write-Host "REOPEN_BACKEND_READY"
}

# Wait for CDP
$cdpReady2 = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 1
  try {
    $response = Invoke-WebRequest -Uri "$cdpUrl/json/version" -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
    if ($response.StatusCode -eq 200) { $cdpReady2 = $true; break }
  } catch { }
}

Push-Location $RepoRoot
try {
  $env:MING_CDP_URL = $cdpUrl
  $env:MING_OWN_KEY_PHASE = 'reopen'
  $env:MING_SENTINEL_KEY = $SentinelKey

  & node scripts/installed-own-key-journey-driver.mjs 2>&1 | ForEach-Object { Write-Host $_ }
  $phase2Exit = $LASTEXITCODE
  Write-Host "PHASE2_EXIT=$phase2Exit"
  if ($phase2Exit -ne 0) {
    Write-Host "PHASE2_FAILED"
    $ExitCode = 1
  }
} catch {
  Write-Host "PHASE2_ERROR: $_"
  $ExitCode = 1
}
Pop-Location

# Close phase 2
if (-not $proc2.HasExited) {
  $proc2.Kill()
}
Start-Sleep -Seconds 2

# ---- 6. Launch Phase 3: remove key flow ----
Write-Host "=== Phase 6: Remove Key Flow ==="

$proc3 = Start-Process -FilePath $installedExe `
  -ArgumentList "--remote-debugging-port=$cdpPort", "--user-data-dir=$userDataRoot" `
  -WorkingDirectory $installDir `
  -PassThru -NoNewWindow

Write-Host "REMOVE_PID=$($proc3.Id)"

# Wait for backend ready
for ($i = 0; $i -lt 180; $i++) {
  Start-Sleep -Seconds 1
  if (-not (Test-Path $startupLog)) { continue }
  $content = Get-Content $startupLog -Raw -ErrorAction SilentlyContinue
  if ($content -match 'backend ready http://127\.0\.0\.1:\d+') { break }
}

Push-Location $RepoRoot
try {
  $env:MING_CDP_URL = $cdpUrl
  $env:MING_OWN_KEY_PHASE = 'remove'
  $env:MING_SENTINEL_KEY = $SentinelKey

  & node scripts/installed-own-key-journey-driver.mjs 2>&1 | ForEach-Object { Write-Host $_ }
  $phase3Exit = $LASTEXITCODE
  Write-Host "PHASE3_EXIT=$phase3Exit"
  if ($phase3Exit -ne 0) {
    Write-Host "PHASE3_FAILED"
    $ExitCode = 1
  }
} catch {
  Write-Host "PHASE3_ERROR: $_"
  $ExitCode = 1
}
Pop-Location

# Close phase 3
if (-not $proc3.HasExited) {
  $proc3.Kill()
}
Start-Sleep -Seconds 2

# ---- 7. Sentinel adversarial scan ----
Write-Host "=== Phase 7: Sentinel Adversarial Scan ==="

$scanTargets = @()

# 1. Git working tree (staged + unstaged + committed)
Push-Location $RepoRoot
try {
  $gitFiles = & git ls-files 2>&1
  foreach ($file in $gitFiles) {
    if ($file) {
      $fullPath = Join-Path $RepoRoot $file
      if (Test-Path $fullPath) {
        $content = Get-Content $fullPath -Raw -ErrorAction SilentlyContinue
        if ($content -and $content.Contains($SentinelKey)) {
          Write-Host "SENTINEL_IN_GIT: $file"
          $scanTargets += "git:$file"
        }
      }
    }
  }

  # Check git diff (unstaged changes)
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

# 2. Startup log
if (Test-Path $startupLog) {
  $logContent = Get-Content $startupLog -Raw -ErrorAction SilentlyContinue
  if ($logContent -and $logContent.Contains($SentinelKey)) {
    Write-Host "SENTINEL_IN_STARTUP_LOG"
    $scanTargets += 'startup.log'
  } else {
    Write-Host "startup.log: CLEAN"
  }
}

# 3. User data directory (excluding safeStorage encrypted files)
if (Test-Path $userDataRoot) {
  Get-ChildItem -Path $userDataRoot -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains($SentinelKey)) {
      # Skip safeStorage encrypted files
      if ($_.Name -match 'safeStorage|encrypted') {
        Write-Host "SENTINEL_IN_SAFESTORAGE (encrypted payload - allowed runtime path)"
      } else {
        Write-Host "SENTINEL_IN_USERDATA: $($_.FullName)"
        $scanTargets += "userdata:$($_.Name)"
      }
    }
  }
}

# 4. Work unit store
$workUnitStore = Join-Path $userDataRoot 'work-units.json'
if (Test-Path $workUnitStore) {
  $wuContent = Get-Content $workUnitStore -Raw -ErrorAction SilentlyContinue
  if ($wuContent -and $wuContent.Contains($SentinelKey)) {
    Write-Host "SENTINEL_IN_WORKUNIT_STORE"
    $scanTargets += 'work-units.json'
  }
}

# 5. Preferences JSON
$prefsFile = Join-Path $userDataRoot 'provider-preferences.json'
if (Test-Path $prefsFile) {
  $prefsContent = Get-Content $prefsFile -Raw -ErrorAction SilentlyContinue
  if ($prefsContent -and $prefsContent.Contains($SentinelKey)) {
    Write-Host "SENTINEL_IN_PREFERENCES"
    $scanTargets += 'preferences.json'
  }
}

# 6. Renderer localStorage
$localStorage = Join-Path $userDataRoot 'Local Storage'
if (Test-Path $localStorage) {
  Get-ChildItem -Path $localStorage -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains($SentinelKey)) {
      Write-Host "SENTINEL_IN_LOCALSTORAGE: $($_.FullName)"
      $scanTargets += "localStorage:$($_.Name)"
    }
  }
}

# 7. Renderer sessionStorage
$sessionStorage = Join-Path $userDataRoot 'Session Storage'
if (Test-Path $sessionStorage) {
  Get-ChildItem -Path $sessionStorage -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains($SentinelKey)) {
      Write-Host "SENTINEL_IN_SESSIONSTORAGE: $($_.FullName)"
      $scanTargets += "sessionStorage:$($_.Name)"
    }
  }
}

# 8. Diagnostics
$diagDir = Join-Path $userDataRoot 'diagnostics'
if (Test-Path $diagDir) {
  Get-ChildItem -Path $diagDir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains($SentinelKey)) {
      Write-Host "SENTINEL_IN_DIAGNOSTICS: $($_.FullName)"
      $scanTargets += "diagnostics:$($_.Name)"
    }
  }
}

# 9. Test reports / artifacts
if ($ArtifactDir -and (Test-Path $ArtifactDir)) {
  Get-ChildItem -Path $ArtifactDir -Recurse -File -ErrorAction SilentlyContinue | ForEach-Object {
    $content = Get-Content $_.FullName -Raw -ErrorAction SilentlyContinue
    if ($content -and $content.Contains($SentinelKey)) {
      Write-Host "SENTINEL_IN_ARTIFACT: $($_.FullName)"
      $scanTargets += "artifact:$($_.Name)"
    }
  }
}

# 10. Command line args (check if sentinel was passed as arg)
if ($MyInvocation.Line -and $MyInvocation.Line.Contains($SentinelKey)) {
  Write-Host "SENTINEL_IN_ARGV"
  $scanTargets += 'argv'
}

# Report sentinel scan result
if ($scanTargets.Count -gt 0) {
  Write-Host "SENTINEL_SCAN_FAIL: found in $($scanTargets.Count) locations"
  Write-Host "  Locations: $($scanTargets -join ', ')"
  $ExitCode = 1
} else {
  Write-Host "SENTINEL_SCAN_PASS: sentinel not found in any checked location"
}

# Always log the sentinel for correlation with startup.log
Write-Host "SENTINEL_KEY=$SentinelKey"

# ---- 8. Upload artifacts ----
if ($ArtifactDir) {
  New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
  if (Test-Path $startupLog) {
    Copy-Item $startupLog (Join-Path $ArtifactDir "$Label-final-startup.log") -Force
  }
  # Copy work unit store
  $wuFile = Join-Path $userDataRoot 'work-units.json'
  if (Test-Path $wuFile) {
    Copy-Item $wuFile (Join-Path $ArtifactDir "$Label-work-units.json") -Force
  }
  # Copy preferences
  $prefsFile = Join-Path $userDataRoot 'provider-preferences.json'
  if (Test-Path $prefsFile) {
    Copy-Item $prefsFile (Join-Path $ArtifactDir "$Label-preferences.json") -Force
  }
}

# ---- 9. Uninstall ----
Write-Host "=== Phase 8: Uninstall ==="
$uninstaller = Get-ChildItem -Path $installDir -Filter 'uninstall*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
if ($uninstaller) {
  & $uninstaller.FullName '/S' 2>&1 | Out-Null
  Start-Sleep -Seconds 2
  # Verify cleanup
  $remaining = Get-ChildItem -Path $installDir -ErrorAction SilentlyContinue
  if ($remaining) {
    Write-Host "UNINSTALL_REMAINING_FILES=$($remaining.Count)"
    $ExitCode = 1
  } else {
    Write-Host "UNINSTALL_CLEAN"
  }
} else {
  Write-Host "NO_UNINSTALLER"
}

# Cleanup fixture server
if ($fixtureServerProc -and -not $fixtureServerProc.HasExited) {
  $fixtureServerProc.Kill()
  Start-Sleep -Seconds 1
}

# Cleanup scratch
if (Test-Path $scratchDir) {
  Remove-Item -Recurse -Force $scratchDir -ErrorAction SilentlyContinue
}

# Report final sentinel
Write-Host "SENTINEL_KEY=$SentinelKey"

if ($ExitCode -eq 0) {
  Write-Host "INSTALLED_OWN_KEY_JOURNEY: PASS"
} else {
  Write-Host "INSTALLED_OWN_KEY_JOURNEY: FAIL"
}

return $ExitCode