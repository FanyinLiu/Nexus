import assert from 'node:assert/strict'
import test from 'node:test'

import {
  PET_LOAD_FALLBACK_RETRY_ID,
  PET_LOAD_FALLBACK_RETRY_URL,
  buildPetLoadFallbackUrl,
  renderPetLoadFallbackPage,
} from '../electron/windowLoadFallback.js'
import {
  MAIN_MESSAGE_LOCALES,
  translateMainMessage,
} from '../electron/mainMessages.js'

test('the fallback page carries the retry copy in all five locales', () => {
  assert.equal(
    translateMainMessage('petLoadFallback.message', undefined, 'zh-CN'),
    'Nexus 没能加载出来，点一下重试',
    'the zh-CN copy is the product-approved sentence',
  )

  for (const locale of MAIN_MESSAGE_LOCALES) {
    const message = translateMainMessage('petLoadFallback.message', undefined, locale)
    const retryLabel = translateMainMessage('petLoadFallback.retry', undefined, locale)
    assert.ok(message.trim().length > 0, `${locale} has no fallback message`)
    assert.ok(retryLabel.trim().length > 0, `${locale} has no retry label`)
    assert.ok(!message.includes('://'), `${locale} fallback message must not show a URL`)
    assert.ok(!/ERR_[A-Z_]+/u.test(message), `${locale} fallback message must not show an error code`)

    const html = renderPetLoadFallbackPage({
      message,
      retryLabel,
      retryUrl: PET_LOAD_FALLBACK_RETRY_URL,
    })
    assert.ok(html.includes(message), `${locale} message missing from the rendered page`)
    assert.ok(html.includes(retryLabel), `${locale} retry label missing from the rendered page`)
  }
})

test('the fallback URL is a self-contained local page with a retry control', () => {
  const url = buildPetLoadFallbackUrl()
  assert.match(url, /^data:text\/html;charset=utf-8,/u)

  const html = decodeURIComponent(url.replace(/^data:text\/html;charset=utf-8,/u, ''))
  assert.ok(html.includes('<!doctype html>'))
  assert.ok(html.includes(`id="${PET_LOAD_FALLBACK_RETRY_ID}"`))
  assert.ok(html.includes('type="button"'))
  assert.ok(html.includes(`data-href="${PET_LOAD_FALLBACK_RETRY_URL}"`))
  assert.ok(!html.includes('<link'), 'the page must not depend on the app stylesheet')
})

test('fallback copy is escaped before it reaches the page markup', () => {
  const html = renderPetLoadFallbackPage({
    message: '<script>alert(1)</script>',
    retryLabel: '"retry"',
    retryUrl: PET_LOAD_FALLBACK_RETRY_URL,
  })
  assert.ok(!html.includes('<script>alert(1)</script>'))
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'))
  assert.ok(html.includes('&quot;retry&quot;'))
})
