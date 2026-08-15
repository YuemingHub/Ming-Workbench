# Windows packaged smoke workflow

`desktop-windows-package-smoke.yml` proves the **packaged** desktop artifact on a
real Windows runner — not just `electron-builder` success.

## Design: thin workflow over a repository-owned script

All real smoke logic lives in the repository-owned PowerShell script
`scripts/desktop-windows-package-smoke.ps1`, so the workflow is a thin runner
(checkout, install, call the script, upload diagnostics). The YAML must never
become a second implementation of the test.

The script (running either locally or on `windows-latest`):

1. runs `npm run desktop:package:dir` and `npm run desktop:package`
2. creates an ephemeral scratch Git repository
3. launches `dist-desktop/win-unpacked/Ming Workbench.exe --project <scratch>`
   with an isolated `%APPDATA%` (fresh user data, no developer-machine residue)
4. waits for the packaged app's own `startup.log` "backend ready" line (no fixed
   sleep), extracts the exact loopback URL, GETs it and requires HTTP 200 plus
   the per-process request-token meta
5. asserts the packaged Harness runtime was prepared from the bundled artifact
   and its identity matches `harness.lock.json` (pinned reviewed commit, never
   upstream HEAD)
6. closes the app through its owned window/process lifecycle and requires zero
   residual processes from that launch (PID-tree tracked; never a broad
   electron.exe/node.exe kill)
7. repeats launch/close/residual verification for the portable exe
8. injects a test secret sentinel into the launch environment and verifies
   plaintext never appears in argv/startup log/work-unit store/project files
9. emits only bounded, secret-free diagnostics on failure and returns non-zero

## Run locally

```powershell
npm run desktop:package:smoke
# or, reusing an existing build:
pwsh -File scripts/desktop-windows-package-smoke.ps1 -SkipBuild
```

## Activation status

**2026-08-15:** the workflow has been activated — moved to
`.github/workflows/desktop-windows-package-smoke.yml` and pushed. The
`workflows.dist/` copy is retained as an archived duplicate; the active file
lives in `.github/workflows/`.

To re-archive (if the workflow is ever removed): move it back here and commit.

The workflow triggers on PRs touching `desktop/**`, `scripts/start-local-web.mjs`,
`scripts/desktop-windows-package-smoke.ps1`, `src/web/**`, `src/hosts/**`,
`src/persistence/**`, `package.json`, `.workbench/vendor/**`, or the workflow
file itself.
