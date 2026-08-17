# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[Project Knowledge Summary]
- Date: 2026-08-17
- Context: Discovered by Agent while fixing L2/L3 Windows packaged-app close failures in CI (Total Review round)
- Category: Troubleshooting & Debugging
- Instructions:
  - CloseMainWindow() (WM_CLOSE delivery) is unreliable on the installed NSIS build: it can return False (wmClose=False) on first launch, leaving the window open and the app alive. Smoke close verification must not depend on WM_CLOSE; use the single-instance marker channel (launch a second instance with --mw-close-instance, the running app then win.close()es through second-instance handler in desktop/main.mjs).
  - The L2/L3 close gates FAIL on timeout (instead of passing after force-kill); a force-kill fallback remains only as the last resort. Inspect close logs for `wmClose=`, `MainWindowHandle`, and `graceful close drained` lines to judge.
  - before-quit in desktop/main.mjs has a 5s bounded backend kill guard, so the app exits even if the backend tree kill stalls.

[Project Knowledge Summary]
- Date: 2026-08-17
- Context: Discovered by Agent while polling GitHub Actions runs for this repo
- Category: Environment Configuration
- Instructions:
  - In background terminals, `git credential fill` fails (returns 401 on the GitHub API call); fetch the token in the main shell first (`echo -e "protocol=https\nhost=github.com\n" | git credential fill 2>/dev/null | sed -n 's/^password=//p' > /tmp/gh_token`) and have the background command read /tmp/gh_token.
  - Job logs downloaded via `https://api.github.com/repos/{owner}/{repo}/actions/jobs/{job_id}/logs` come back as plain text (not a zip) in this environment.
