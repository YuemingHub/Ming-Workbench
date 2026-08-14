import test from 'node:test'
import assert from 'node:assert/strict'
import {
  urlOrigin,
  isAllowedBackendUrl,
  isTrustedDesktopSender,
} from '../desktop/validation.mjs'

test('urlOrigin returns the origin for valid loopback URLs', () => {
  assert.equal(urlOrigin('http://127.0.0.1:43127'), 'http://127.0.0.1:43127')
  assert.equal(urlOrigin('http://127.0.0.1:43127/foo/bar'), 'http://127.0.0.1:43127')
  // Port 80 is the HTTP default and is normalized away by the URL standard.
  assert.equal(urlOrigin('http://127.0.0.1:80'), 'http://127.0.0.1')
})

test('urlOrigin returns null for URLs that throw the constructor', () => {
  assert.equal(urlOrigin('http://'), null)
})

test('urlOrigin resolves empty/relative input to the dummy base origin', () => {
  // The dummy base origin is never a real Workbench backend origin, so
  // exact comparison in isAllowedBackendUrl / isTrustedDesktopSender
  // still rejects these. Document actual behavior.
  assert.equal(urlOrigin(''), 'http://127.0.0.1:0')
  assert.equal(urlOrigin('.'), 'http://127.0.0.1:0')
})

test('urlOrigin is lenient for weird but parseable input', () => {
  // The URL standard with a base URL is lenient; document actual behavior.
  assert.equal(urlOrigin(':::'), 'http://127.0.0.1:0')
})

test('isAllowedBackendUrl accepts only the exact active backend origin', () => {
  const exactOrigin = 'http://127.0.0.1:43127'

  // Same origin, various paths — allowed.
  assert.ok(isAllowedBackendUrl('http://127.0.0.1:43127/', exactOrigin))
  assert.ok(isAllowedBackendUrl('http://127.0.0.1:43127/api/project', exactOrigin))
  assert.ok(isAllowedBackendUrl('http://127.0.0.1:43127/style.css', exactOrigin))

  // Same host, different port — denied.
  assert.ok(!isAllowedBackendUrl('http://127.0.0.1:9999/', exactOrigin))
  assert.ok(!isAllowedBackendUrl('http://127.0.0.1:9999/api/intake', exactOrigin))

  // localhost instead of 127.0.0.1 — denied.
  assert.ok(!isAllowedBackendUrl('http://localhost:43127/', exactOrigin))

  // Non-loopback origin — denied.
  assert.ok(!isAllowedBackendUrl('http://evil.example/', exactOrigin))
  assert.ok(!isAllowedBackendUrl('https://127.0.0.1:43127/', exactOrigin))

  // Empty/null active origin — nothing allowed.
  assert.ok(!isAllowedBackendUrl('http://127.0.0.1:43127/', ''))
  assert.ok(!isAllowedBackendUrl('http://127.0.0.1:43127/', null))
  assert.ok(!isAllowedBackendUrl('http://127.0.0.1:43127/', undefined))

  // Non-HTTP schemes produce null origin — denied.
  assert.ok(!isAllowedBackendUrl('file:///C:/Users/', exactOrigin))
  assert.ok(!isAllowedBackendUrl('javascript:alert(1)', exactOrigin))
  assert.ok(!isAllowedBackendUrl('ftp://127.0.0.1:21/', exactOrigin))
})

test('isAllowedBackendUrl origin extraction is strict (no path confusion)', () => {
  // Paths containing "127.0.0.1" must not confuse origin comparison.
  assert.ok(!isAllowedBackendUrl(
    'http://127.0.0.1:43127.evil.example/',
    'http://127.0.0.1:43127',
  ))
  assert.ok(!isAllowedBackendUrl(
    'http://127.0.0.1:43127@evil.example/',
    'http://127.0.0.1:43127',
  ))
})

test('isTrustedDesktopSender accepts only the exact expected origin', () => {
  const expectedOrigin = 'http://127.0.0.1:43127'

  assert.ok(isTrustedDesktopSender('http://127.0.0.1:43127/', expectedOrigin))
  assert.ok(isTrustedDesktopSender('http://127.0.0.1:43127/app.html', expectedOrigin))

  assert.ok(!isTrustedDesktopSender('http://127.0.0.1:9999/', expectedOrigin))
  assert.ok(!isTrustedDesktopSender('http://localhost:43127/', expectedOrigin))
  assert.ok(!isTrustedDesktopSender('http://evil.example/', expectedOrigin))
  assert.ok(!isTrustedDesktopSender('', expectedOrigin))

  // Empty expected origin — nothing trusted.
  assert.ok(!isTrustedDesktopSender('http://127.0.0.1:43127/', ''))
})

test('isTrustedDesktopSender rejects non-HTTP URLs', () => {
  const expectedOrigin = 'http://127.0.0.1:43127'
  assert.ok(!isTrustedDesktopSender('file:///C:/test.html', expectedOrigin))
  assert.ok(!isTrustedDesktopSender('data:text/html,<h1>', expectedOrigin))
})
