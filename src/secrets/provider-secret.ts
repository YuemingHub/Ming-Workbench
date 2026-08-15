/**
 * Provider secret management types and interfaces.
 *
 * The actual Electron safeStorage implementation lives in
 * desktop/provider-secret.mjs (main process only). This module provides
 * the type surface for the rest of the Workbench code without pulling
 * in an Electron dependency that would break Node.js test execution.
 */

export interface ProviderSecretState {
  hasSecret: boolean
}

export interface ProviderSecretStore {
  load(): string | null
  save(plaintext: string): void
  clear(): void
  has(): boolean
}

/**
 * No-op store for environments without Electron safeStorage
 * (e.g., tests, web-only mode). Returns null/has=false.
 */
export const noopProviderSecretStore: ProviderSecretStore = {
  load: () => null,
  save: () => {},
  clear: () => {},
  has: () => false,
}
