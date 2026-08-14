/**
 * Pure validation functions for the Electron desktop shell trust boundary.
 * These have no Electron dependency and can be unit-tested directly.
 */

export function urlOrigin(url) {
  try {
    // Use a dummy base so relative URLs resolve deterministically.
    // Relative URLs will resolve to the dummy base origin and almost
    // certainly not match the real loopback origin.
    return new URL(url, 'http://127.0.0.1:0').origin
  } catch {
    return null
  }
}

export function isAllowedBackendUrl(url, activeBackendOrigin) {
  if (!activeBackendOrigin) return false
  const origin = urlOrigin(url)
  return origin !== null && origin === activeBackendOrigin
}

export function isTrustedDesktopSender(senderUrl, expectedOrigin) {
  if (!expectedOrigin) return false
  const origin = urlOrigin(senderUrl)
  return origin !== null && origin === expectedOrigin
}
