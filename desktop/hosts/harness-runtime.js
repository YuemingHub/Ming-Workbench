/**
 * Desktop-specific Harness runtime preparation.
 * This module is Electron-only and lives in desktop/ because it imports
 * Electron main-process modules. The pure TypeScript interface lives in
 * src/hosts/harness-runtime.ts for testability.
 */

import { prepareHarnessRuntime } from '../../src/hosts/harness-runtime.js'

export async function prepareDesktopHarnessRuntime({ workbenchRoot, harnessCheckout }) {
  return prepareHarnessRuntime({ workbenchRoot, harnessCheckout })
}
