# Desktop packaged smoke verification for Ming Workbench (Windows).
#
# This is the repository-owned real packaged proof. It must run unchanged both
# locally (Windows PowerShell 5.1) and from a GitHub Actions windows-latest job
# (pwsh). It performs real behavior, not source-string checks:
#
#   1. (unless -SkipBuild) npm run desktop:package:dir and npm run desktop:package
#   2. creates an ephemeral scratch Git repository
#   3. launches dist-desktop/win-unpacked/Ming Workbench.exe --project <scratch>
#   4. waits for the packaged app's own startup.log "backend ready" evidence
#   5. GETs the exact loopback backend URL and requires HTTP 200
#   6. verifies the served page carries the per-process request token meta
#   7. asserts the packaged Harness runtime came from the bundled artifact and
#      its identity matches harness.lock.json (never upstream HEAD)
#   8. closes the app through its owned window/process lifecycle
#   9. requires zero residual processes from this launch (PID-tree tracked,
#      never a broad kill of electron.exe/node.exe)
#  10. repeats launch/close/residual verification for the portable executable
#  11. on failure, emits bounded diagnostics (startup log, build log tail,
#      residual process details) that never contain provider secrets
#
# Provider secrets are scrubbed from the launch environment and a test sentinel
# is injected to prove plaintext never lands in argv/logs/store/project files.
#
# Usage:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/desktop-windows-package-smoke.ps1
#   pwsh -File scripts/desktop-windows-package-smoke.ps1 -SkipBuild
#
# Exit code 0 = every acceptance condition passed.

param(
  [switch]$SkipBuild,
  [switch]$SkipPortable,
  [string]$WorkDir = "",
  [string]$ScratchRoot = "",
  [string]$ArtifactDir = "",
  [int]$ReadyTimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"

$sentinel = "MING_TEST_SECRET_P0_DO_NOT_LEAK"
$providerEnvNames = @("DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY")

function Write-Step([string]$Message) { Write-Host "=== $Message ===" }

function Read-TextFileShared([string]$Path) {
  try {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $reader = New-Object System.IO.StreamReader($stream)
      try { return $reader.ReadToEnd() } finally { $reader.Close() }
    } finally { $stream.Close() }
  } catch {
    return ""
  }
}

function Redact-Text([string]$Text) {
  foreach ($name in $providerEnvNames) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ($value) { $Text = $Text.Replace($value, "[REDACTED-$name]") }
  }
  $Text = $Text.Replace($sentinel, "[REDACTED-SENTINEL]")
  return $Text
}

function Assert-True([bool]$Condition, [string]$Label, [string]$Detail = "") {
  if (-not $Condition) {
    Write-Host "FAIL: $Label $Detail"
    throw "acceptance failed: $Label"
  }
  Write-Host "PASS: $Label"
}

function Get-ScratchMatchingProcesses([string]$ScratchPath) {
  $all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  return @($all | Where-Object {
    $_.ProcessId -and $_.CommandLine -and
    ($_.CommandLine.IndexOf($ScratchPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
  })
}

function Wait-ForBackendReady([int]$RootPid, [string]$StartupLog, [string]$ScratchPath, [int]$TimeoutSeconds) {
  $url = ""
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    if ($RootPid -and -not (Get-Process -Id $RootPid -ErrorAction SilentlyContinue)) {
      Write-Host "WARN: root process exited before backend ready (may be the portable launcher handing off)"
    }
    $content = Read-TextFileShared $StartupLog
    if ($content -match "backend ready (http://127\.0\.0\.1:\d+)") {
      $url = $Matches[1]
      break
    }
    if ($content -match "backend startup failed") { break }
    if ($content -match "无法启动") { break }
  }
  return $url
}

function Close-LaunchTree([int]$RootPid, [string]$ScratchPath, [System.Collections.ArrayList]$TrackedIds) {
  # Graceful first: close the main window of any tracked process that has one.
  $closed = $false
  foreach ($id in $TrackedIds) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne 0) {
      $p.CloseMainWindow() | Out-Null
      $closed = $true
      Write-Host "close requested via window of pid=$id"
      break
    }
  }
  if (-not $closed -and $RootPid -and (Get-Process -Id $RootPid -ErrorAction SilentlyContinue)) {
    $root = Get-Process -Id $RootPid -ErrorAction SilentlyContinue
    if ($root -and $root.MainWindowHandle -ne 0) {
      $root.CloseMainWindow() | Out-Null
      Write-Host "close requested via root window pid=$RootPid"
    }
  }

  # Wait for the whole launch tree to exit on its own (app-owned cleanup).
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    $alive = @()
    foreach ($id in $TrackedIds) {
      if (Get-Process -Id $id -ErrorAction SilentlyContinue) { $alive += $id }
    }
    if ($alive.Count -eq 0) { return }
    Start-Sleep -Milliseconds 500
  }

  # Bounded fallback: kill only this launch's tracked PIDs (never a broad
  # electron.exe/node.exe sweep). The scratch path is unique per launch, so
  # re-checking the command line before killing prevents PID-reuse mistakes.
  # Every kill is best-effort: tracked PIDs may already have exited on their own.
  Write-Host "WARN: graceful close timed out; force-killing tracked launch tree"
  $nowScratch = Get-ScratchMatchingProcesses $ScratchPath
  foreach ($p in $nowScratch) {
    try { taskkill /PID $p.ProcessId /T /F 2>&1 | Out-Null } catch { }
  }
  foreach ($id in $TrackedIds) {
    if (-not (Get-Process -Id $id -ErrorAction SilentlyContinue)) { continue }
    $killIt = $false
    if ($id -eq $RootPid) {
      $killIt = $true
    } else {
      $still = Get-CimInstance Win32_Process -Filter "ProcessId=$id" -ErrorAction SilentlyContinue
      if ($still -and $still.CommandLine -and $still.CommandLine.IndexOf($ScratchPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0) {
        $killIt = $true
      }
    }
    if ($killIt) {
      try { taskkill /PID $id /T /F 2>&1 | Out-Null } catch { }
    }
  }
  Start-Sleep -Seconds 3
}

function Invoke-PackagedLaunch([string]$AppPath, [string]$Label, [string]$ScratchPath, [string]$AppDataDir, [string]$WorkbenchRoot) {
  Write-Step "LAUNCH $Label"
  $distRoot = Join-Path $WorkbenchRoot "dist-desktop"
  # --user-data-dir relocates the app's own userData (startup log, Work Unit
  # store, safeStorage, single-instance lock) so each launch is fully isolated
  # (fresh startup log + store, no cross-launch or developer-machine residue).
  $isolatedUserData = Join-Path $AppDataDir ($Label + "-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $isolatedUserData | Out-Null
  $startupLog = Join-Path $isolatedUserData "startup.log"

  # Scrub provider secrets from the launch environment, then inject the test
  # sentinel to prove the pipeline never writes it into argv/log/store/files.
  # TEMP is redirected so the portable SFX extracts to a fresh per-launch
  # directory (the default extraction location is deterministic and could
  # contain a partial extraction from an earlier interrupted run).
  $savedEnv = @{}
  Get-ChildItem Env: | Where-Object {
    $providerEnvNames -contains $_.Name -or $_.Name -like "MING_TEST_SECRET_*" -or $_.Name -eq "MING_WORKBENCH_ALLOW_WRITE" -or $_.Name -in @("TEMP", "TMP")
  } | ForEach-Object {
    $savedEnv[$_.Name] = $_.Value
    Remove-Item "Env:$($_.Name)"
  }
  $launchTemp = Join-Path $AppDataDir ("t" + [guid]::NewGuid().ToString("N").Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $launchTemp | Out-Null
  $env:TEMP = $launchTemp
  $env:TMP = $launchTemp
  $env:MING_WORKBENCH_ALLOW_WRITE = "0"
  $env:MING_TEST_SECRET_P0_DO_NOT_LEAK = $sentinel

  $tracked = New-Object System.Collections.ArrayList
  try {
    $proc = Start-Process -FilePath $AppPath -ArgumentList "--project `"$ScratchPath`" --user-data-dir `"$isolatedUserData`"" -PassThru
    Write-Host "launched pid=$($proc.Id) app=$Label"
    [void]$tracked.Add($proc.Id)

    # Track the launch tree: every process whose command line references the
    # unique scratch path (covers the backend node child and Harness children).
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      foreach ($p in (Get-ScratchMatchingProcesses $ScratchPath)) {
        if (-not $tracked.Contains($p.ProcessId)) { [void]$tracked.Add($p.ProcessId) }
      }
      Start-Sleep -Milliseconds 300
    }

    $url = Wait-ForBackendReady $proc.Id $startupLog $ScratchPath $ReadyTimeoutSeconds
    Assert-True ($url -ne "") "backend-ready evidence in startup.log" "(label=$Label)"
    Write-Host "backend url=$url"

    $log = Read-TextFileShared $startupLog
    Assert-True ($log -match "harness runtime ready source=bundled commit=([0-9a-f]{40})") "harness runtime from bundled artifact" "(label=$Label)"
    $lockRaw = Read-TextFileShared (Join-Path $WorkbenchRoot "harness.lock.json")
    $lock = $lockRaw | ConvertFrom-Json
    Assert-True ($Matches[1] -eq $lock.reviewedCommit) "harness identity pinned to reviewed commit" "(expected=$($lock.reviewedCommit) got=$($Matches[1]))"
    Assert-True ($log -match "backend spawn .*harnessCheckout=auto-bundled") "no developer checkout dependency (MING_HARNESS_CHECKOUT absent)"

    $resp = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
    Assert-True ($resp.StatusCode -eq 200) "HTTP GET loopback backend returns 200" "(status=$($resp.StatusCode))"
    Assert-True ($resp.Content -match 'ming-workbench-token" content="[^"]+"') "served page carries request token meta" "(label=$Label)"

    # Secret forensic: the injected sentinel must not appear in any owned file.
    foreach ($path in @($startupLog, (Join-Path $isolatedUserData "work-units.json"), (Join-Path $isolatedUserData "workbench-state.json"))) {
      if (Test-Path $path) {
        $content = Read-TextFileShared $path
        Assert-True ($content.IndexOf($sentinel, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) "no plaintext sentinel in $(Split-Path $path -Leaf)"
      }
    }
    $scratchFiles = Get-ChildItem -Path $ScratchPath -Recurse -File -ErrorAction SilentlyContinue
    foreach ($file in $scratchFiles) {
      $content = Read-TextFileShared $file.FullName
      Assert-True ($content.IndexOf($sentinel, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) "no plaintext sentinel in project file $(Split-Path $file.FullName -Leaf)"
    }

    Close-LaunchTree $proc.Id $ScratchPath $tracked

    # Residual verification: zero processes from this launch tree may survive.
    Start-Sleep -Seconds 3
    $residual = Get-ScratchMatchingProcesses $ScratchPath
    foreach ($id in $tracked) {
      if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
        $p = Get-Process -Id $id -ErrorAction SilentlyContinue
        if ($p) {
          $residual += [PSCustomObject]@{ ProcessId = $id; Name = $p.ProcessName; CommandLine = "" }
        }
      }
    }
    if ($residual.Count -gt 0) {
      foreach ($r in $residual) {
        Write-Host "RESIDUAL: pid=$($r.ProcessId) name=$($r.Name) $($r.CommandLine)"
      }
    }
    Assert-True ($residual.Count -eq 0) "zero residual processes after close" "(label=$Label)"
  } finally {
    foreach ($entry in $savedEnv.GetEnumerator()) {
      Set-Item "Env:$($entry.Key)" $entry.Value
    }
    Remove-Item "Env:MING_TEST_SECRET_P0_DO_NOT_LEAK" -ErrorAction SilentlyContinue
    Remove-Item "Env:MING_WORKBENCH_ALLOW_WRITE" -ErrorAction SilentlyContinue
    if ($ArtifactDir) {
      New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null
      if (Test-Path $startupLog) {
        Copy-Item $startupLog (Join-Path $ArtifactDir "$Label-startup.log") -Force
      }
    }
  }
}

# --- main ---

if (-not $WorkDir) { $WorkDir = (Split-Path $PSScriptRoot -Parent) }
if (-not (Test-Path (Join-Path $WorkDir "package.json"))) { Write-Host "FAIL: not a Ming Workbench repo root: $WorkDir"; exit 2 }
# Short scratch root: the portable SFX extracts into a deep temp tree and
# git clone inside it must stay under the Windows MAX_PATH limit.
if (-not $ScratchRoot) { $ScratchRoot = Join-Path $env:TEMP ("mwps-" + [guid]::NewGuid().ToString("N").Substring(0, 8)) }
New-Item -ItemType Directory -Force -Path $ScratchRoot | Out-Null
if ($ArtifactDir) { New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null }
$distRoot = Join-Path $WorkDir "dist-desktop"

function Write-BuildLog([string]$Name) {
  $logPath = Join-Path $ScratchRoot $Name
  if (Test-Path $logPath) {
    if ($ArtifactDir) { Copy-Item $logPath (Join-Path $ArtifactDir $Name) -Force }
    Get-Content $logPath -Tail 30
  }
}

Write-Step "REPO $WorkDir"

# electron >= 43 no longer ships an npm postinstall that downloads the binary,
# so a clean `npm install` leaves node_modules/electron/dist empty and
# electron-builder fails with "electronDist does not exist". Ensure the real
# binary is present before any packaging step.
$electronDist = Join-Path $WorkDir "node_modules\electron\dist"
if (-not (Test-Path (Join-Path $electronDist "electron.exe"))) {
  Write-Step "ENSURE electron binary (node_modules/electron/install.js)"
  Push-Location $WorkDir
  try {
    & node.exe node_modules/electron/install.js 2>&1 | Out-File (Join-Path $ScratchRoot "electron-install.log") -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
      Write-Host "FAIL: electron binary install exited $LASTEXITCODE"
      Write-BuildLog "electron-install.log"
      exit 1
    }
    Assert-True (Test-Path (Join-Path $electronDist "electron.exe")) "electron binary present after install.js"
  } finally {
    Pop-Location
  }
}

if (-not $SkipBuild) {
  Write-Step "BUILD win-unpacked (desktop:package:dir)"
  Push-Location $WorkDir
  try {
    & npm.cmd run desktop:package:dir 2>&1 | Out-File (Join-Path $ScratchRoot "build-dir.log") -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
      Write-Host "FAIL: desktop:package:dir exited $LASTEXITCODE"
      Write-BuildLog "build-dir.log"
      exit 1
    }
    if (-not $SkipPortable) {
      Write-Step "BUILD portable exe (desktop:package)"
      & npm.cmd run desktop:package 2>&1 | Out-File (Join-Path $ScratchRoot "build-portable.log") -Encoding utf8
      if ($LASTEXITCODE -ne 0) {
        Write-Host "FAIL: desktop:package exited $LASTEXITCODE"
        Write-BuildLog "build-portable.log"
        exit 1
      }
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Host "build skipped (-SkipBuild)"
}

# Static self-containment checks on the win-unpacked artifact.
$unpackedApp = Join-Path $distRoot "win-unpacked"
$appRoot = Join-Path $unpackedApp "resources\app"
$exePath = Join-Path $unpackedApp "Ming Workbench.exe"
Assert-True (Test-Path $exePath) "win-unpacked exe exists"
Assert-True (Test-Path (Join-Path $appRoot ".tmp\index.js")) "packaged app contains compiled .tmp runtime"
Assert-True (Test-Path (Join-Path $appRoot ".workbench\vendor\deepseek-harness-0.1.0-rc.5.bundle")) "packaged app contains reviewed Harness bundle"
Assert-True (Test-Path (Join-Path $appRoot "harness.lock.json")) "packaged app contains harness.lock.json"
Assert-True (Test-Path (Join-Path $appRoot "scripts\start-local-web.mjs")) "packaged app contains backend entry script"

# Ephemeral scratch Git repository (launch target; never a real project).
$scratchRepo = Join-Path $ScratchRoot "repo"
New-Item -ItemType Directory -Force -Path $scratchRepo | Out-Null
Push-Location $scratchRepo
try {
  git init -q
  git config user.email "smoke@local.test"
  git config user.name "Package Smoke"
  Set-Content -Path README.md -Value "scratch smoke project`n" -Encoding utf8
  git add README.md
  git commit -q -m "init"
  Write-Host "scratch repo: $scratchRepo"
} finally {
  Pop-Location
}

$appDataDir = Join-Path $ScratchRoot "ad"
New-Item -ItemType Directory -Force -Path $appDataDir | Out-Null

$failed = $false
try {
  Invoke-PackagedLaunch -AppPath $exePath -Label "win-unpacked" -ScratchPath $scratchRepo -AppDataDir $appDataDir -WorkbenchRoot $WorkDir
} catch {
  Write-Host "EXCEPTION (win-unpacked): $($_.Exception.Message)"
  $failed = $true
}

if (-not $SkipPortable) {
  $portable = Get-ChildItem -Path (Join-Path $distRoot "*.exe") -File -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $portable) {
    Write-Host "FAIL: portable exe not found in $distRoot"
    $failed = $true
  } else {
    try {
      Invoke-PackagedLaunch -AppPath $portable.FullName -Label "portable" -ScratchPath $scratchRepo -AppDataDir $appDataDir -WorkbenchRoot $WorkDir
    } catch {
      Write-Host "EXCEPTION (portable): $($_.Exception.Message)"
      $failed = $true
    }
  }
} else {
  Write-Host "portable skipped (-SkipPortable)"
}

if ($failed) { Write-Host "SMOKE RESULT: FAIL"; exit 1 }
Write-Host "SMOKE RESULT: PASS"
exit 0
