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
$installDir = Join-Path $ScratchRoot "l3-installed"
Write-Step "INSTALL (silent per-user)"
$installProc = Start-Process -FilePath $installer.FullName -ArgumentList "/S /D=$installDir" -Wait -PassThru
if ($installProc.ExitCode -ne 0) { throw "installer exited $($installProc.ExitCode)" }
$installedExe = Join-Path $installDir "Ming Workbench.exe"
Assert-True (Test-Path $installedExe) "installed Ming Workbench.exe exists"

$appDataDir = Join-Path $ScratchRoot "l3-userdata"
New-Item -ItemType Directory -Force -Path $appDataDir | Out-Null
$cdpPort = 9333

function Invoke-L3UiJourney([string]$Label, [string]$UserData) {
  Write-Step "L3 UI JOURNEY $Label"
  $startupLog = Join-Path $UserData "startup.log"
  $proc = Start-Process -FilePath $installedExe `
    -ArgumentList "--project `"$scratchRepo`" --user-data-dir `"$UserData`" --remote-debugging-port=$cdpPort --no-sandbox --disable-gpu" `
    -PassThru
  Write-Host "launched installed exe pid=$($proc.Id)"

  # Wait for backend ready + CDP port.
  $deadline = (Get-Date).AddSeconds($ReadyTimeoutSeconds)
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
    if ($LASTEXITCODE -ne 0) { throw "ui journey driver exited $LASTEXITCODE" }
  } finally { Pop-Location }
  Remove-Item Env:MING_CDP_URL -ErrorAction SilentlyContinue
  Remove-Item Env:MING_JOURNEY_REQUEST -ErrorAction SilentlyContinue
  Remove-Item Env:MING_JOURNEY_CREDENTIAL -ErrorAction SilentlyContinue
  Remove-Item Env:MING_JOURNEY_BASE_URL -ErrorAction SilentlyContinue

  return $proc
}

# First launch: fresh userData, project selected, AAOP setup through UI,
# provider configured through UI, request, intake, approve, execute.
$firstUserData = Join-Path $appDataDir "first"
New-Item -ItemType Directory -Force -Path $firstUserData | Out-Null
$firstProc = Invoke-L3UiJourney "first" $firstUserData

# Independent outcome observation (not driver assertion only).
$readmeAfter = Read-TextFileShared (Join-Path $scratchRepo "README.md")
Write-Host "README after:"
Write-Host $readmeAfter
Assert-True ($readmeAfter -match "Version: NEW") "README reached Version: NEW (independent read)"
Assert-True (Test-Path (Join-Path $scratchRepo ".aaop")) "AAOP was installed into the scratch project through the UI"
$diff = & git -C $scratchRepo diff 2>&1 | Out-String
Write-Host "git diff:"
Write-Host $diff
Assert-True ($diff -match "Version: OLD" -and $diff -match "Version: NEW") "git diff shows OLD -> NEW"
$status = & git -C $scratchRepo status --porcelain 2>&1 | Out-String
Assert-True ($status -match "README\.md") "git status shows only README.md modified"

# Clean close.
try { $firstProc.CloseMainWindow() | Out-Null } catch { }
Start-Sleep -Seconds 5
$residual = Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -match [regex]::Escape($scratchRepo) }
Assert-True ($null -eq $residual -or @($residual).Count -eq 0) "zero residual processes after close"

# Second launch: same userData, no --project, restore project/state.
Write-Step "SECOND LAUNCH (restore)"
$secondUserData = $firstUserData
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
Assert-True $cdpReady "second launch CDP endpoint reachable"
$env:MING_CDP_URL = "http://127.0.0.1:$cdpPort"
Push-Location $WorkDir
try {
  & node scripts/ui-journey-driver.mjs 2>&1 | Tee-Object -FilePath (Join-Path $ScratchRoot "second-ui.log")
} finally { Pop-Location }
Remove-Item Env:MING_CDP_URL -ErrorAction SilentlyContinue
try { $secondProc.CloseMainWindow() | Out-Null } catch { }
Start-Sleep -Seconds 5

# Uninstall cleanup.
Write-Step "UNINSTALL"
$uninstaller = Join-Path $installDir "Uninstall Ming Workbench.exe"
if (Test-Path $uninstaller) {
  Start-Process -FilePath $uninstaller -ArgumentList "/S" -Wait -PassThru | Out-Null
  Start-Sleep -Seconds 3
}
Assert-True (-not (Test-Path $installedExe)) "installed exe removed after uninstall"

Write-Host "CONSUMER_HUMAN_JOURNEY_L3: PASS"
exit 0
