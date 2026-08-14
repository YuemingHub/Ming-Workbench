import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const lock = JSON.parse(readFileSync(resolve(root, 'harness.lock.json'), 'utf8'))
const requireHarness = process.argv.includes('--require-harness')
const checkout = process.env.MING_HARNESS_CHECKOUT

const expectedCommit = lock.reviewedCommit
const expectedVersion = lock.sourcePackage?.version

if (!expectedCommit || !expectedVersion) {
  console.error('MING WORKBENCH NOT READY: harness.lock.json is missing the reviewed commit or source package version.')
  process.exit(2)
}

console.log(`MING WORKBENCH PIN READY: DeepSeek Harness ${expectedVersion} @ ${expectedCommit}`)

if (!checkout) {
  if (requireHarness) {
    console.error('MING WORKBENCH HARNESS NOT READY: set MING_HARNESS_CHECKOUT to the reviewed DeepSeek Harness source checkout.')
    process.exit(1)
  }

  console.log('MING WORKBENCH CORE READY: external Harness checkout is not configured in this environment.')
  process.exit(0)
}

try {
  const packagePath = resolve(checkout, lock.sourcePackage.path)
  const pkg = JSON.parse(readFileSync(packagePath, 'utf8'))
  const detectedVersion = pkg.version
  const detectedCommit = execFileSync('git', ['-C', checkout, 'rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim()

  if (detectedVersion !== expectedVersion || detectedCommit !== expectedCommit) {
    console.error(
      `MING WORKBENCH HARNESS NOT READY: expected ${expectedVersion} @ ${expectedCommit}, detected ${detectedVersion} @ ${detectedCommit}.`,
    )
    process.exit(2)
  }

  console.log(`MING WORKBENCH HARNESS READY: ${detectedVersion} @ ${detectedCommit}`)
} catch (error) {
  console.error(`MING WORKBENCH HARNESS NOT READY: ${error.message}`)
  process.exit(1)
}
