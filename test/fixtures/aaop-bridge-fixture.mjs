#!/usr/bin/env node
/**
 * Project-side AAOP bridge fixture for the first closed loop.
 *
 * A real project with AAOP installed declares bridge commands that run
 * `python .aaop/tools/aaop.py ready|status|prompt`. The scratch project used
 * to exercise the first closed loop is not AAOP-installed, so it declares its
 * own bridge commands pointing here instead. This is the project's choice of
 * bridge, not a modification of AAOP core: `runProjectAaopBridge` spawns it for
 * real as a subprocess and reads its real stdout, exactly as it would the
 * canonical Python tool.
 *
 * Usage: node aaop-bridge-fixture.mjs <ready|status|prompt> [projectRoot]
 */

const operation = process.argv[2]
const projectRoot = process.argv[3] ?? process.cwd()

const READY = [
  'AAOP READY',
  '  version: fixture-1.0',
  '  project: scratch-readme',
  '  health: healthy',
  '  working contract: collaborative (fixture)',
].join('\n')

const STATUS = [
  'situation: feature-change',
  'route: feature-change',
  'frontier: README.md holds Version: OLD; authorized change to Version: NEW is within scope.',
  'open human questions: none',
].join('\n')

const PROMPT = [
  'Grounded developer intake for the README version change.',
  'The repository carries README.md with Version: OLD.',
  'Smallest authorized slice: README.md only.',
  'Verification: repository readback of README Version: NEW.',
].join('\n')

switch (operation) {
  case 'ready':
    process.stdout.write(`${READY}\n`)
    break
  case 'status':
    process.stdout.write(`${STATUS}\n`)
    break
  case 'prompt':
    process.stdout.write(`${PROMPT}\n`)
    break
  default:
    process.stderr.write(`unknown bridge operation: ${operation ?? '<none>'}\n`)
    process.exit(2)
}

void projectRoot
