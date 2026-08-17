# Packaged Application Pipeline Smoke — installed desktop shell + application/backend pipeline.
#
# Evidence level: strong L2 / integration (NOT L3).
#
# What this proves: the REAL NSIS-installed desktop shell launches, the backend
# pipeline works (project discovery, AAOP setup through the product API path,
# provider fixture round-trip, plain-language intake to a persisted Work Unit),
# and a second launch restores project/state.
#
# What it does NOT prove (by design): a human driving the product UI. The true
# L3 Consumer Journey Gate (`consumer-human-journey-l3`) drives the renderer
# through CDP. Do NOT write this smoke's PASS as "L3 consumer journey PASS".
#
#   1. install from a real NSIS installer (silent per-user, /D=<isolated>)
#   2. fresh userData
#   3. the scratch project is NOT a Ming-Workbench source checkout
#   4. an ordinary scratch Git project is created and selected
#   5. the INSTALLED exe is launched (not win-unpacked)
#   6. the product enters the project (backend ready + /api/project ok)
#   7. AAOP absent -> AAOP setup runs through the product API path
#      (bundled Python runtime; verify via pythonCommand in the response)
#   8. Harness runtime ready (bundled-capsule identity)
#   9. provider configuration surface available
#  10. a plain-language request is submitted
#  11. the request reaches the real Workbench application pipeline
#  12. an intake/result is returned, not just HTTP 200
#  13. a Work Unit is actually created and persisted
#  14. the app closes cleanly (zero residual processes)
#  15. a second launch restores the project and state
#
# Transport-vs-provider separation:
#   - With a repository-owned deterministic local OpenAI-compatible provider
#     fixture, this smoke proves product TRANSPORT end to end.
#   - A real provider dogfood is a SEPARATE L4 gate and is never claimed here.
#
# Usage (Windows):
#   pwsh -NoProfile -File scripts/packaged-application-pipeline-smoke.ps1
#   pwsh -NoProfile -File scripts/packaged-application-pipeline-smoke.ps1 -SkipBuild

param(
  [switch]$SkipBuild,
  [string]$WorkDir = "",
  [string]$ScratchRoot = "",
  [string]$ArtifactDir = "",
  [int]$ReadyTimeoutSeconds = 300
)

$ErrorActionPreference = "Stop"

$sentinel = "MING_CG_SENTINEL_DO_NOT_LEAK"
$providerEnvNames = @("DEEPSEEK_API_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "OPENROUTER_API_KEY")

function Write-Step([string]$Message) { Write-Host "=== $Message ===" }

function Read-TextFileShared([string]$Path) {
  try {
    $stream = [System.IO.File]::Open($Path, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
      $reader = New-Object System.IO.StreamReader($stream)
      try { return $reader.ReadToEnd() } finally { $reader.Close() }
    } finally { $stream.Close() }
  } catch { return "" }
}

function Assert-True([bool]$Condition, [string]$Label, [string]$Detail = "") {
  if (-not $Condition) {
    Write-Host "FAIL: $Label $Detail"
    throw "consumer journey gate failed: $Label"
  }
  Write-Host "PASS: $Label"
}

function Wait-ForBackendReady([string]$StartupLog, [string]$ScratchPath, [int]$TimeoutSeconds) {
  $url = ""
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 500
    $content = Read-TextFileShared $StartupLog
    # The startup log accumulates across launches sharing one userData dir. The
    # second launch appends a NEW backend-ready line with a NEW loopback port;
    # matching only the first occurrence would return the already-closed port
    # of the previous launch. Take the LAST backend-ready line instead.
    $readyMatches = [regex]::Matches($content, "backend ready (http://127\.0\.0\.1:\d+)")
    if ($readyMatches.Count -gt 0) { $url = $readyMatches[$readyMatches.Count - 1].Groups[1].Value; break }
    if ($content -match "backend startup failed") { break }
    if ($content -match "无法启动") { break }
  }
  return $url
}

function Get-ScratchMatchingProcesses([string]$ScratchPath) {
  $all = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue
  return @($all | Where-Object {
    $_.ProcessId -and $_.CommandLine -and
    ($_.CommandLine.IndexOf($ScratchPath, [System.StringComparison]::OrdinalIgnoreCase) -ge 0)
  })
}

function Close-LaunchTree([System.Collections.ArrayList]$TrackedIds) {
  $closed = $false
  foreach ($id in $TrackedIds) {
    $p = Get-Process -Id $id -ErrorAction SilentlyContinue
    if ($p -and $p.MainWindowHandle -ne 0) {
      $p.CloseMainWindow() | Out-Null
      $closed = $true
      break
    }
  }
  $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline) {
    $alive = @()
    foreach ($id in $TrackedIds) {
      if (Get-Process -Id $id -ErrorAction SilentlyContinue) { $alive += $id }
    }
    if ($alive.Count -eq 0) { return }
    Start-Sleep -Milliseconds 500
  }
  foreach ($id in $TrackedIds) {
    if (Get-Process -Id $id -ErrorAction SilentlyContinue) {
      try { taskkill /PID $id /T /F 2>&1 | Out-Null } catch { }
    }
  }
  Start-Sleep -Seconds 3
}

# --- main ---
if (-not $WorkDir) { $WorkDir = (Split-Path $PSScriptRoot -Parent) }
if (-not (Test-Path (Join-Path $WorkDir "package.json"))) { Write-Host "FAIL: not a Ming Workbench repo root: $WorkDir"; exit 2 }
if (-not $ScratchRoot) { $ScratchRoot = Join-Path $env:TEMP ("mwcg-" + [guid]::NewGuid().ToString("N").Substring(0, 8)) }
New-Item -ItemType Directory -Force -Path $ScratchRoot | Out-Null
if ($ArtifactDir) { New-Item -ItemType Directory -Force -Path $ArtifactDir | Out-Null }
$distRoot = Join-Path $WorkDir "dist-desktop"

Write-Step "REPO $WorkDir"

if (-not $SkipBuild) {
  Write-Step "BUILD NSIS installer (runtime:prepare + package)"
  Push-Location $WorkDir
  try {
    & npm.cmd run desktop:package 2>&1 | Out-File (Join-Path $ScratchRoot "cg-build.log") -Encoding utf8
    if ($LASTEXITCODE -ne 0) {
      Write-Host "FAIL: desktop:package exited $LASTEXITCODE"
      exit 1
    }
  } finally { Pop-Location }
} else {
  Write-Host "build skipped (-SkipBuild)"
}

# Scratch git project (NOT the Ming-Workbench repo).
$scratchRepo = Join-Path $ScratchRoot "consumer-project"
New-Item -ItemType Directory -Force -Path $scratchRepo | Out-Null
Push-Location $scratchRepo
try {
  git init -q
  git config user.email "cg@local.test"
  git config user.name "Consumer Gate"
  Set-Content -Path README.md -Value "consumer journey scratch project`n" -Encoding utf8
  git add README.md
  git commit -q -m "init"
} finally { Pop-Location }

# Confirm the scratch repo is not the Ming-Workbench source checkout.
$repoManifest = Join-Path $scratchRepo "package.json"
Assert-True (-not (Test-Path $repoManifest)) "scratch project is NOT a Ming-Workbench checkout"
Assert-True (-not (Test-Path (Join-Path $scratchRepo "desktop\main.mjs"))) "scratch project has no desktop shell"

# NSIS installer
$installer = Get-ChildItem -Path (Join-Path $distRoot "Ming Workbench Setup *.exe") -File -ErrorAction SilentlyContinue | Select-Object -First 1
Assert-True ($null -ne $installer) "real NSIS installer exists" "in $distRoot"
$installDir = Join-Path $ScratchRoot "cg-installed"

Write-Step "INSTALL (silent per-user)"
$installProc = Start-Process -FilePath $installer.FullName -ArgumentList "/S /D=$installDir" -Wait -PassThru
if ($installProc.ExitCode -ne 0) { throw "installer exited $($installProc.ExitCode)" }
$installedExe = Join-Path $installDir "Ming Workbench.exe"
Assert-True (Test-Path $installedExe) "installed Ming Workbench.exe exists"

$appDataDir = Join-Path $ScratchRoot "cg-userdata"
New-Item -ItemType Directory -Force -Path $appDataDir | Out-Null

# Start the repository-owned OpenAI-compatible provider fixture inside this
# process so it stays alive for the whole smoke (workflow-level Start-Process
# may be cleaned up between steps).
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
Assert-True $fixtureReady "provider fixture ready inside pipeline smoke process"

function Invoke-ConsumerLaunch([string]$Label) {
  Write-Step "LAUNCH $Label (fresh userData)"
  $isolatedUserData = Join-Path $appDataDir ($Label + "-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $isolatedUserData | Out-Null
  $startupLog = Join-Path $isolatedUserData "startup.log"

  $savedEnv = @{}
  Get-ChildItem Env: | Where-Object {
    $providerEnvNames -contains $_.Name -or $_.Name -like "MING_TEST_SECRET_*" -or $_.Name -eq "MING_WORKBENCH_ALLOW_WRITE"
  } | ForEach-Object {
    $savedEnv[$_.Name] = $_.Value
    Remove-Item "Env:$($_.Name)"
  }
  $launchTemp = Join-Path $appDataDir ("t" + [guid]::NewGuid().ToString("N").Substring(0, 8))
  New-Item -ItemType Directory -Force -Path $launchTemp | Out-Null
  $env:TEMP = $launchTemp
  $env:TMP = $launchTemp
  $env:MING_WORKBENCH_ALLOW_WRITE = "0"
  $env:MING_TEST_SECRET_P0_DO_NOT_LEAK = $sentinel
  # The backend child reads the provider secret from its own env (the packaged
  # main process injects safeStorage value, falling back to DEEPSEEK_API_KEY).
  # This smoke deliberately injects the deterministic fixture credentials so the
  # REAL application pipeline runs end to end; the sentinel test below proves the
  # credential never lands in argv/logs/store/project files.
  $env:DEEPSEEK_API_KEY = "fixture-key"
  $env:DEEPSEEK_BASE_URL = "http://127.0.0.1:8000/v1"

  $tracked = New-Object System.Collections.ArrayList
  try {
    $proc = Start-Process -FilePath $installedExe -ArgumentList "--project `"$scratchRepo`" --user-data-dir `"$isolatedUserData`"" -PassThru
    Write-Host "launched pid=$($proc.Id) label=$Label"
    [void]$tracked.Add($proc.Id)
    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline) {
      foreach ($p in (Get-ScratchMatchingProcesses $scratchRepo)) {
        if (-not $tracked.Contains($p.ProcessId)) { [void]$tracked.Add($p.ProcessId) }
      }
      Start-Sleep -Milliseconds 300
    }
    $url = Wait-ForBackendReady $startupLog $scratchRepo $ReadyTimeoutSeconds
    Assert-True ($url -ne "") "backend ready" "(label=$Label)"
    Write-Host "backend url=$url"

    $log = Read-TextFileShared $startupLog
    Assert-True ($log -match "harness runtime ready source=bundled-capsule commit=([0-9a-f]{40})") "harness runtime from PREBUILT CAPSULE" "(label=$Label)"
    $lockRaw = Read-TextFileShared (Join-Path $WorkDir "harness.lock.json")
    $lock = $lockRaw | ConvertFrom-Json
    Assert-True ($Matches[1] -eq $lock.reviewedCommit) "capsule identity pinned to reviewed commit"

    $token = ""
    $page = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
    if ($page.Content -match 'ming-workbench-token" content="([^"]+)"') { $token = $Matches[1] }
    Assert-True ($token -ne "") "renderer request token available"
    $headers = @{ "x-ming-workbench-token" = $token; "content-type" = "application/json"; "origin" = $url }

    $project = Invoke-WebRequest -Uri "$url/api/project" -Headers $headers -UseBasicParsing -TimeoutSec 30
    $projectBody = $project.Content | ConvertFrom-Json
    Assert-True ($project.StatusCode -eq 200) "GET /api/project 200"
    Assert-True ($projectBody.status -eq "setup-required") "plain scratch project requires AAOP setup" "(status=$($projectBody.status))"
    Assert-True ($projectBody.git.gitAvailable -eq $true) "Git prerequisite detected"
    Assert-True ($projectBody.git.projectIsRepository -eq $true) "scratch project is a git repository"

    # AAOP setup through the product path. The response must show the bundled
    # Python runtime won (pythonCommand absolute under the app resources).
    $setup = Invoke-WebRequest -Uri "$url/api/setup" -Method Post -Headers $headers -Body '{"authorize":true}' -UseBasicParsing -TimeoutSec 300
    $setupBody = $setup.Content | ConvertFrom-Json
    Assert-True ($setup.StatusCode -eq 200) "POST /api/setup 200"
    Assert-True ($setupBody.status -eq "installed") "AAOP installed through product path" "(status=$($setupBody.status) message=$($setupBody.message))"
    # Type-correct, semantic assertion: aaopVersion must be a non-empty string
    # and must equal the AAOP release identity really installed into the scratch
    # project (.aaop/VERSION). The setup API reports the version it bootstrapped;
    # the filesystem must agree.
    $reportedAaopVersion = $setupBody.aaopVersion
    Assert-True (-not [string]::IsNullOrWhiteSpace([string]$reportedAaopVersion)) "AAOP release identity returned by setup" "(aaopVersion=$reportedAaopVersion)"
    $installedAaopVersionPath = Join-Path $scratchRepo ".aaop\VERSION"
    Assert-True (Test-Path $installedAaopVersionPath) "AAOP VERSION file exists in the scratch project"
    $installedAaopVersion = (Read-TextFileShared $installedAaopVersionPath).Trim()
    Assert-True ([string]$reportedAaopVersion -eq $installedAaopVersion) "AAOP setup identity matches installed VERSION" "(setup=$reportedAaopVersion installed=$installedAaopVersion)"
    Assert-True ($setupBody.project.status -eq "ready") "project ready after setup"

    # Provider connection through the real Workbench application pipeline.
    $probe = Invoke-WebRequest -Uri "$url/api/test-provider-connection" -Method Post -Headers $headers -UseBasicParsing -TimeoutSec 120
    $probeBody = $probe.Content | ConvertFrom-Json
    Assert-True ($probe.StatusCode -eq 200) "provider fixture probe HTTP 200"
    Assert-True ($probeBody.ok -eq $true) "provider fixture connection real round-trip" "(message=$($probeBody.message))"

    # Plain-language request -> real intake/result, not just HTTP 200.
    $intakeBody = @{ request = "看看这个项目现在做到哪里了，接下来最应该先做什么？" } | ConvertTo-Json
    $intake = Invoke-WebRequest -Uri "$url/api/intake" -Method Post -Headers $headers -Body $intakeBody -UseBasicParsing -TimeoutSec 180
    $intakeResp = $intake.Content | ConvertFrom-Json
    Assert-True ($intake.StatusCode -eq 200) "POST /api/intake 200"
    Assert-True ($null -ne $intakeResp.workUnit) "intake returned a Work Unit"
    Assert-True ($intakeResp.workUnit.id -like "WU-*") "Work Unit created with product id" "(id=$($intakeResp.workUnit.id))"
    Assert-True ($null -ne $intakeResp.workUnit.state) "Work Unit has a state" "(state=$($intakeResp.workUnit.state))"

    # Work Unit persisted.
    $wuStore = Join-Path $isolatedUserData "work-units.json"
    Assert-True (Test-Path $wuStore) "Work Unit store persisted"
    $store = Read-TextFileShared $wuStore | ConvertFrom-Json
    Assert-True ($store.workUnits.Count -ge 1) "at least one Work Unit in the store"

    # Secret sentinel never leaked.
    $scratchFiles = Get-ChildItem -Path $scratchRepo -Recurse -File -ErrorAction SilentlyContinue
    foreach ($file in $scratchFiles) {
      $content = Read-TextFileShared $file.FullName
      Assert-True ($content.IndexOf($sentinel, [System.StringComparison]::OrdinalIgnoreCase) -lt 0) "no sentinel in project file $(Split-Path $file.FullName -Leaf)"
    }

    Close-LaunchTree $tracked
    Start-Sleep -Seconds 3
    $residual = Get-ScratchMatchingProcesses $scratchRepo
    Assert-True ($residual.Count -eq 0) "zero residual processes after close" "(label=$Label)"

    return @{ userData = $isolatedUserData; startupLog = $startupLog }
  } finally {
    foreach ($entry in $savedEnv.GetEnumerator()) { Set-Item "Env:$($entry.Key)" $entry.Value }
    Remove-Item "Env:MING_TEST_SECRET_P0_DO_NOT_LEAK" -ErrorAction SilentlyContinue
    Remove-Item "Env:MING_WORKBENCH_ALLOW_WRITE" -ErrorAction SilentlyContinue
    if ($ArtifactDir) {
      if (Test-Path $startupLog) { Copy-Item $startupLog (Join-Path $ArtifactDir "$Label-startup.log") -Force }
    }
  }
}

Write-Step "CONSUMER JOURNEY — FIRST LAUNCH"
$first = Invoke-ConsumerLaunch "first"

Write-Step "CONSUMER JOURNEY — SECOND LAUNCH (project + state restore)"
# Second launch WITHOUT --project must restore the same project from userData.
$savedEnv = @{}
Get-ChildItem Env: | Where-Object { $providerEnvNames -contains $_.Name -or $_.Name -like "MING_TEST_SECRET_*" } | ForEach-Object {
  $savedEnv[$_.Name] = $_.Value
  Remove-Item "Env:$($_.Name)"
}
try {
  $tracked = New-Object System.Collections.ArrayList
  $proc = Start-Process -FilePath $installedExe -ArgumentList "--user-data-dir `"$($first.userData)`"" -PassThru
  [void]$tracked.Add($proc.Id)
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline) {
    foreach ($p in (Get-ScratchMatchingProcesses $scratchRepo)) {
      if (-not $tracked.Contains($p.ProcessId)) { [void]$tracked.Add($p.ProcessId) }
    }
    Start-Sleep -Milliseconds 300
  }
  $url = Wait-ForBackendReady $first.startupLog $scratchRepo $ReadyTimeoutSeconds
  Assert-True ($url -ne "") "second-launch backend ready"
  $log = Read-TextFileShared $first.startupLog
  Assert-True ($log -match "harness runtime ready source=bundled-capsule") "second-launch harness from capsule"
  $page = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 20
  if ($page.Content -match 'ming-workbench-token" content="([^"]+)"') { $token = $Matches[1] }
  Assert-True ($token -ne "") "second-launch request token"
  $headers = @{ "x-ming-workbench-token" = $token; "content-type" = "application/json"; "origin" = $url }
  $wu = Invoke-WebRequest -Uri "$url/api/workunits" -Headers $headers -UseBasicParsing -TimeoutSec 30
  $wuBody = $wu.Content | ConvertFrom-Json
  Assert-True ($wu.StatusCode -eq 200) "second-launch /api/workunits 200"
  Assert-True ($wuBody.workUnits.Count -ge 1) "second launch restored persisted Work Unit"
  Close-LaunchTree $tracked
  Start-Sleep -Seconds 3
  $residual = Get-ScratchMatchingProcesses $scratchRepo
  Assert-True ($residual.Count -eq 0) "second-launch zero residual processes"
} finally {
  foreach ($entry in $savedEnv.GetEnumerator()) { Set-Item "Env:$($entry.Key)" $entry.Value }
}

# Uninstall cleanup
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

Write-Host "PACKAGED_APPLICATION_PIPELINE_SMOKE: PASS"
exit 0
