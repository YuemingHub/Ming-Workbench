import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const preset = readFileSync(
  new URL('../harness/presets/development-aaop/agent.cordis.yml', import.meta.url),
  'utf8',
)
const overlay = readFileSync(
  new URL('../harness/workbench.cordis.patch.yml', import.meta.url),
  'utf8',
)

const requiredCapabilities = [
  '@deepseek-ai/dsh-agent-instructions',
  '@deepseek-ai/dsh-tool-bash',
  '@deepseek-ai/dsh-tool-pwsh',
  '@deepseek-ai/dsh-tool-jobs',
  '@deepseek-ai/dsh-tool-fs',
  '@deepseek-ai/dsh-tool-fs-search',
  '@deepseek-ai/dsh-skill-filesystem',
  '@deepseek-ai/dsh-tool-skill',
  '@deepseek-ai/dsh-compaction-basic',
  '@deepseek-ai/dsh-tool-ask-user',
  '@deepseek-ai/dsh-tool-todo',
  '@deepseek-ai/dsh-tool-web',
]

const intentionallyAbsentExecutionExpansion = [
  '@deepseek-ai/dsh-tool-subagent',
  '@deepseek-ai/dsh-tool-workflow',
  '@deepseek-ai/dsh-tool-ralph',
  '@deepseek-ai/dsh-tool-goal',
]

test('Workbench overlay selects its repository-owned development preset root', () => {
  assert.match(overlay, /id: agent-presets/)
  assert.match(overlay, /default: development-aaop/)
  assert.match(overlay, /MING_WORKBENCH_ROOT/)
  assert.match(overlay, /harness\/presets/)
  assert.match(overlay, /includeUserRoot: true/)
})

test('development preset exposes the minimum single-agent execution surface', () => {
  for (const capability of requiredCapabilities) {
    assert.ok(preset.includes(capability), `missing required capability: ${capability}`)
  }

  assert.match(preset, /allowParallelInProgress: false/)
})

test('development preset cannot silently expand into a Task Pod or workflow', () => {
  for (const capability of intentionallyAbsentExecutionExpansion) {
    assert.equal(
      preset.includes(capability),
      false,
      `single-agent preset unexpectedly exposes ${capability}`,
    )
  }
})

test('development persona preserves protected-effect and evidence boundaries', () => {
  assert.match(preset, /Do not infer permission to write a protected\/default\/production branch/)
  assert.match(preset, /deploy/)
  assert.match(preset, /use credentials/)
  assert.match(preset, /incur cost/)
  assert.match(preset, /access real-user data/)
  assert.match(preset, /repository-native evidence/)
  assert.match(preset, /report concrete evidence/)
})
