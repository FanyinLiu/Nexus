import assert from 'node:assert/strict'
import test from 'node:test'

import { createRendererReloadGuard, shouldReloadAfterRendererGone } from '../electron/crashRecovery.js'
import { crashDialogCopy, externalOpenDialogCopy, normalizeDialogLocale, rendererStuckDialogCopy } from '../electron/userFacingDialogs.js'

test('renderer reload covers crashes and stops after repeated failures', () => {
  assert.equal(shouldReloadAfterRendererGone({ reason: 'crashed' }), true)
  assert.equal(shouldReloadAfterRendererGone({ reason: 'oom' }), true)
  assert.equal(shouldReloadAfterRendererGone({ reason: 'abnormal-exit' }), true)
  assert.equal(shouldReloadAfterRendererGone({ reason: 'clean-exit' }), false)
  assert.equal(shouldReloadAfterRendererGone({ reason: 'killed' }), false)
  assert.equal(shouldReloadAfterRendererGone(null), false)

  let now = 1_000
  const guard = createRendererReloadGuard({
    limit: 3,
    windowMs: 30_000,
    now: () => now,
  })
  assert.equal(guard.allow(7), true)
  assert.equal(guard.allow(7), true)
  assert.equal(guard.allow(7), true)
  assert.equal(guard.allow(7), false)
  assert.equal(guard.allow(8), true)
  now += 30_000
  assert.equal(guard.allow(7), true)
})

test('crash and external-open dialogs stay localized and free of diagnostics', () => {
  assert.equal(normalizeDialogLocale('zh-Hant-TW'), 'zh-TW')
  assert.equal(normalizeDialogLocale('zh_CN'), 'zh-CN')
  assert.equal(normalizeDialogLocale('ja-JP'), 'ja')
  assert.equal(normalizeDialogLocale('ko-KR'), 'ko')
  assert.equal(normalizeDialogLocale('en-GB'), 'en-US')
  assert.equal(normalizeDialogLocale('fr'), 'en-US')

  for (const locale of ['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko']) {
    const crash = crashDialogCopy(locale)
    const stuck = rendererStuckDialogCopy(locale)
    const open = externalOpenDialogCopy(locale)
    const text = `${crash.title}\n${crash.message}\n${stuck.title}\n${stuck.message}\n${open.title}\n${open.message}\n${open.open}\n${open.cancel}`
    assert.equal(text.includes('stack'), false)
    assert.equal(text.includes('uncaught'), false)
    assert.equal(/\/Users\/|\/home\/|sk-|Bearer /u.test(text), false)
    assert.ok(crash.title.length > 0)
    assert.ok(crash.message.length > 0)
    assert.notEqual(open.open, open.cancel)
  }

  assert.equal(crashDialogCopy('zh-TW').message.includes('設定'), true)
  assert.equal(externalOpenDialogCopy('ja').open, '開く')
})
