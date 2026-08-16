import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  defaultProviderPreferences,
  normalizeProviderPreferences,
  loadProviderPreferences,
  saveProviderPreferences,
  clearProviderPreferences,
} from '../desktop/preferences.mjs'

function freshDir() {
  return mkdtempSync(join(tmpdir(), 'mw-prefs-'))
}

test('default provider preferences are the reviewed DeepSeek contract', () => {
  const defaults = defaultProviderPreferences()
  assert.equal(defaults.provider, 'deepseek-official')
  assert.equal(defaults.model, 'deepseek-v4-pro')
  assert.equal(defaults.baseUrl, '')
})

test('save then load round-trips non-secret preferences under userData', () => {
  const dir = freshDir()
  try {
    const saved = saveProviderPreferences(
      { provider: 'deepseek-official', model: 'my-custom-model', baseUrl: 'https://api.example.com' },
      dir,
    )
    assert.equal(saved.model, 'my-custom-model')

    const loaded = loadProviderPreferences(dir)
    assert.equal(loaded.provider, 'deepseek-official')
    assert.equal(loaded.model, 'my-custom-model')
    assert.equal(loaded.baseUrl, 'https://api.example.com')

    // The stored file is plain JSON but never contains a key field.
    const raw = readFileSync(join(dir, 'provider-preferences.json'), 'utf8')
    assert.ok(!raw.includes('key'), 'preferences file must never store a secret')
  } finally {
    clearProviderPreferences(dir)
  }
})

test('missing or corrupt preferences fall back to defaults', () => {
  const dir = freshDir()
  try {
    assert.deepEqual(loadProviderPreferences(dir), defaultProviderPreferences())
  } finally {
    clearProviderPreferences(dir)
  }
})

test('normalize trims, bounds and drops unknown fields', () => {
  assert.deepEqual(
    normalizeProviderPreferences({
      provider: '  deepseek-official  ',
      model: ' deepseek-v4-pro ',
      baseUrl: '   ',
      apiKey: 'SHOULD-NOT-SURVIVE',
    }),
    { provider: 'deepseek-official', model: 'deepseek-v4-pro', baseUrl: '' },
  )
  assert.deepEqual(
    normalizeProviderPreferences({ provider: 'x'.repeat(300), model: '', baseUrl: 'y'.repeat(600) }),
    defaultProviderPreferences(),
  )
  assert.deepEqual(normalizeProviderPreferences(null), defaultProviderPreferences())
})
