import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const expected = '0.1.0-rc.5'

try {
  const pkg = require('@deepseek-ai/dsh/package.json')
  const detected = pkg.version
  if (detected !== expected) {
    console.error(`MING WORKBENCH NOT READY: expected @deepseek-ai/dsh@${expected}, detected ${detected}`)
    process.exitCode = 2
  } else {
    console.log(`MING WORKBENCH READY: @deepseek-ai/dsh@${detected}`)
  }
} catch (error) {
  console.error(`MING WORKBENCH NOT READY: @deepseek-ai/dsh is not installed (${error.message})`)
  process.exitCode = 1
}
