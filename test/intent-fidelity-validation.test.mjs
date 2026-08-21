import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const corpusPath = resolve(process.cwd(), 'validation', 'p6.3', 'intent-fidelity-corpus.json')

test('P6.3 corpus stays small and ordinary-language only', async () => {
  const corpus = JSON.parse(await readFile(corpusPath, 'utf8'))
  assert.ok(Array.isArray(corpus.cases))
  assert.ok(corpus.cases.length > 0 && corpus.cases.length <= 5)
  for (const item of corpus.cases) {
    assert.match(item.id, /^[a-z0-9-]+$/)
    assert.ok(item.raw_intent.length > 0)
    assert.ok(item.follow_up.length > 0)
    assert.ok(item.evaluation_anchors.problem.length > 0)
    assert.ok(item.evaluation_anchors.implicit_constraints.length > 0)
    assert.ok(item.evaluation_anchors.must_confirm.length > 0)
    assert.ok(item.evaluation_anchors.avoid.length > 0)
    assert.doesNotMatch(item.raw_intent, /Todo|App|API|Workflow|数据库|开发|代码/i)
  }
})

