# Windows packaged smoke workflow

`desktop-windows-package-smoke.yml` proves the **packaged** desktop artifact on a
real Windows runner — not just `electron-builder` success.

## What it does (per job)

1. `npm install`, `build:test`, typecheck, unit tests
2. creates an ephemeral scratch Git project
3. `npm run desktop:package:dir` and `npm run desktop:package`
4. actually launches `dist-desktop/win-unpacked/Ming Workbench.exe --project <scratch>`
5. waits for the packaged `startup.log` "backend ready" line, extracts the
   loopback URL, GETs it and requires HTTP 200
6. closes the window, waits for process exit, verifies **zero residual
   processes** (no Workbench / backend / Harness process referencing the
   scratch project)
7. repeats launch/close/residual verification for the portable exe
8. uploads only non-secret smoke logs on failure

## Why it lives in `workflows.dist/` (temporarily)

The branch author's GitHub token lacks the `workflow` scope, which GitHub
requires for **creating** a new workflow file (updating existing ones is
allowed, creating new ones is not). The file is therefore shipped here,
version-controlled, so the exact intended content is reviewable in PR #22.

To activate: refresh the token with `gh auth refresh -s workflow`, then move
this file into `.github/workflows/` and push:

```powershell
gh auth refresh -s workflow
git mv .github/workflows.dist/desktop-windows-package-smoke.yml .github/workflows/desktop-windows-package-smoke.yml
git commit -m "ci(desktop): activate Windows packaged smoke workflow"
git push
```

The workflow triggers on PRs touching `desktop/**`, `scripts/start-local-web.mjs`,
`src/web/**`, `src/hosts/**`, `src/persistence/**`, `package.json`,
`.workbench/vendor/**`, or the workflow file itself.
