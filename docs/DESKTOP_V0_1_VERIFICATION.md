# Ming Workbench Desktop v0.1 — Local verification record

Branch: `agent/electron-desktop-v0-1`
Base: `main@fafbdeab255d189a38bdd5400796b142deba25f2`

## Environment

| Item | Value |
| --- | --- |
| OS | Microsoft Windows NT 10.0.26200.0 (win32, x64 / AMD64) |
| System Node | v24.19.0 |
| Electron | v43.4.0 |
| electron-builder | 26.15.3 |
| Harness pin | @deepseek-ai/dsh 0.1.0-rc.5 @ 47f943859bef60e4160492346772ded9b24f765a |
| AAOP | 1.2.0 (canonical stable bootstrap) |
| Python | 3.12.10 (`python`, not `python3`) |
| Provider | no `DEEPSEEK_API_KEY` in environment; positive Intake verified with the official Harness bundled mock LLM |

## Executed commands and results

| Command | Exit code | Result |
| --- | --- | --- |
| `npm install` | 0 | 0 vulnerabilities; electron 43.4.0 + electron-builder 26.15.3 installed |
| `npm run check` | 0 | `tsc --noEmit` clean |
| `npm test` | 0 | 89/89 tests pass (83 existing + 6 new desktop-shell contract tests) |
| `npm run harness:prepare` | 0 | exact reviewed Harness checkout prepared and identity-verified |
| `npm run doctor:harness` | 0 | `MING WORKBENCH HARNESS READY: 0.1.0-rc.5 @ 47f9438...` |
| `npm run desktop:dev` | launched | Electron dev shell opened; window ready + backend ready |
| `npm run desktop:package` | 0 | `dist-desktop/Ming Workbench 0.0.1.exe` (portable, ~89 MB) built |
| `npm run desktop:package:dir` | 0 | `dist-desktop/win-unpacked/Ming Workbench.exe` built |

## Dev-mode behavior (desktop:dev)

1. **Launch**: Electron window opened; `MING_DESKTOP_WINDOW_READY` and
   `MING_WORKBENCH_READY http://127.0.0.1:<port>` observed.
2. **Project selection**: native directory picker (or `--project <path>` /
   persisted last project). Server fixes the selected project.
3. **Onboarding**: repo selected as project → `setup-required` with an open
   `authorization` Gate on a `needs-human` Work Unit.
4. **AAOP setup**: after explicit `authorize:true`, canonical stable bootstrap
   installed AAOP 1.2.0 → project became `ready`.
5. **Ordinary-language Intake (positive)**: through the Harness ACP transport
   against the bundled mock LLM → HTTP 200, Work Unit `state: ready`, Gate
   closed, route `understand-review`, session evidence (non-authoritative), next
   frontier shown.
6. **Provider unavailable**: with the provider unreachable → HTTP 503
   `intake-unavailable`, `retryable: true`, original request preserved, no
   fabricated Work Unit/result/evidence.
7. **Security**: no-token API call → 403; browser-supplied `projectRoot` in the
   request body ignored (server-fixed path used in the response).
8. **Clean close**: WM_CLOSE on the main window → 0 residual electron/node
   processes; no orphaned Harness ACP child after Intake.

## Packaged behavior

`dist-desktop/win-unpacked/Ming Workbench.exe` **was actually launched and
exercised** (not just built):

- window + backend ready; packaged `resources/app` paths resolved correctly;
- `/api/project` → `ready`, AAOP 1.2.0;
- full read-only Intake through the packaged backend against the bundled mock
  LLM (with `MING_HARNESS_CHECKOUT` + mock provider env) → HTTP 200, Work Unit
  `ready`, route `understand-review`, evidence present;
- clean close → 0 residual `Ming Workbench.exe` / backend `node` processes.

`dist-desktop/Ming Workbench 0.0.1.exe` (portable) **was actually launched**:

- self-extracts to a temp dir, forwards `--project`, starts the backend sidecar,
  serves the UI, `/api/project` → `ready`, AAOP 1.2.0;
- clean close → 0 residual processes.

## Tested project paths

| Path | Outcome |
| --- | --- |
| `D:\My-AI-live\AI-project\Ming-Workbench-main` | onboarding `setup-required` Gate |
| `C:\Users\User\AppData\Local\Temp\opencode\ming-test-project` | AAOP 1.2.0 installed; `ready`; Intake ran |

## Issues found and fixed during this slice

1. `scripts/prepare-harness.mjs` — `execFileSync('npx.cmd', …)` fails with
   `EINVAL` on Windows (`.cmd` cannot be spawned directly); added a shell
   fallback for win32 `.cmd`.
2. Four existing tests hard-coded POSIX absolute paths and failed on Windows;
   assertions now use `path.resolve(...)` (platform-aware).
3. `@electron/get` binary download failed (`undici` fetch error) in this
   environment; Electron dist was installed manually and verified.
4. electron-builder intermittently failed with `EPERM` renaming the freshly
   extracted Electron dir (transient Windows Defender lock). Worked around by
   setting `build.electronDist` to `node_modules/electron/dist` so packaging
   copies the existing verified Electron instead of re-downloading/re-extracting.
5. Packaged backend crashed with `ERR_MODULE_NOT_FOUND: Cannot find package
   'zod'` — `@agentclientprotocol/sdk` declares `zod` as a peer dependency but
   the packaged app only bundles `dependencies`; added `zod` to `dependencies`.
6. Backend child stdout was not forwarded to the desktop host, hiding the
   handshake/ready line; backend.mjs now pipes it to `process.stdout`.

## Scoped blockers / notes (not faked green)

- **Artifact signing**: no code-signing certificate; portable/win-unpacked
  artifacts are unsigned (`signAndEditExecutable: false`). Windows SmartScreen
  warning is expected. Recorded, not a blocker for v0.1.
- **App icon**: default Electron icon used (no custom `.ico` supplied).
- **Harness checkout at runtime**: the reviewed Harness checkout (~1 GB with
  install) is not bundled into the package. Real Intake in a packaged app
  requires `MING_HARNESS_CHECKOUT` pointing at the reviewed checkout. Packaged
  Intake was verified with the local checkout + bundled mock LLM.
- **Real provider**: no `DEEPSEEK_API_KEY` present locally, so the positive
  Intake path used the official Harness mock LLM; the real provider path is
  covered by the repo's hosted `harness-acp-smoke` workflow. Provider-unavailable
  recoverable behavior was verified live (HTTP 503).
- **Renderer security**: verified structurally by the `desktop-shell` contract
  test (sandbox, contextIsolation, `nodeIntegration: false`, narrow preload API)
  and live (403 without token; browser project-root tampering ignored).

## Renderer capability boundary

- Renderer webPreferences: `nodeIntegration: false`, `contextIsolation: true`,
  `sandbox: true`.
- Preload exposes only `mingWorkbench.selectProject()` and `mingWorkbench.quit()`.
  It never exposes `require`, `process`, `fs`, `child_process`, `shell`, or raw
  `ipcRenderer` (asserted by test).
- Navigation restricted to the loopback Workbench backend; new windows, webviews,
  and browser permission requests denied.
