import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import vm from 'node:vm'

import {
  PET_LOAD_FALLBACK_PATH,
  PET_LOAD_FALLBACK_RETRY_URL,
} from '../electron/windowLoadFallback.js'

const fallbackHtml = readFileSync(PET_LOAD_FALLBACK_PATH, 'utf8')

const COPY = {
  'zh-CN': {
    message: 'Nexus 没能加载出来，点一下重试',
    retry: '重试',
    retrying: '重试中…',
  },
  'zh-TW': {
    message: 'Nexus 沒能載入，點一下重試',
    retry: '重試',
    retrying: '重試中…',
  },
  'en-US': {
    message: "Nexus didn't load. Click to try again.",
    retry: 'Try again',
    retrying: 'Trying…',
  },
  ja: {
    message: 'Nexus を読み込めませんでした。クリックしてもう一度試してください。',
    retry: 'もう一度試す',
    retrying: '再試行中…',
  },
  ko: {
    message: 'Nexus를 불러오지 못했어요. 눌러서 다시 시도해 주세요.',
    retry: '다시 시도',
    retrying: '다시 시도하는 중…',
  },
}

function renderWith({ search = '', language = '' } = {}) {
  const script = fallbackHtml.match(/<script>([\s\S]*?)<\/script>/u)?.[1]
  assert.ok(script, 'the fallback page has an inline script')

  let clickHandler = null
  const elements = {
    'nexus-pet-message': { textContent: '' },
    'nexus-pet-retry': {
      textContent: '',
      disabled: false,
      addEventListener: (_event, handler) => {
        clickHandler = handler
      },
    },
  }
  const window = {
    location: { search, href: '' },
    navigator: { language },
  }
  const document = {
    documentElement: { lang: '' },
    getElementById: (id) => elements[id] ?? null,
  }

  vm.runInNewContext(script, { window, document, URLSearchParams })
  return {
    lang: document.documentElement.lang,
    message: elements['nexus-pet-message'].textContent,
    button: elements['nexus-pet-retry'],
    location: window.location,
    click: () => clickHandler(),
  }
}

test('the fallback page bakes the five product-approved locales into the HTML', () => {
  assert.match(fallbackHtml, /^<!doctype html>/u)
  assert.ok(fallbackHtml.includes('id="nexus-pet-retry"'), 'the page has a retry control')
  assert.ok(fallbackHtml.includes('type="button"'))
  assert.ok(!fallbackHtml.includes('data:text/html'), 'the page is not built as a data URL')
  assert.ok(!fallbackHtml.includes('<link'), 'the page must not depend on the app stylesheet')

  for (const [locale, copy] of Object.entries(COPY)) {
    assert.ok(fallbackHtml.includes(copy.message), `${locale} message missing from the page`)
    assert.ok(fallbackHtml.includes(copy.retry), `${locale} retry label missing from the page`)
    assert.ok(fallbackHtml.includes(copy.retrying), `${locale} retrying label missing from the page`)
  }

  assert.ok(fallbackHtml.includes(PET_LOAD_FALLBACK_RETRY_URL), 'the retry marker is baked in')
  assert.ok(!/ERR_[A-Z_]+/u.test(fallbackHtml), 'the page never renders an Electron error code')
  assert.ok(!/https?:\/\//u.test(fallbackHtml), 'the page never renders an http(s) URL')
  assert.ok(!fallbackHtml.includes('file://'), 'the page never renders a file URL')
})

test('the page reads the lang query first', () => {
  for (const [locale, copy] of Object.entries(COPY)) {
    const page = renderWith({ search: `?lang=${encodeURIComponent(locale)}` })
    assert.equal(page.message, copy.message, `${locale} message from the query`)
    assert.equal(page.button.textContent, copy.retry, `${locale} button from the query`)
    assert.equal(page.lang, locale)
  }
})

test('the page falls back to navigator.language and then to English', () => {
  assert.equal(renderWith({ language: 'ko-KR' }).message, COPY.ko.message)
  assert.equal(renderWith({ language: 'zh-Hant-TW' }).message, COPY['zh-TW'].message)
  assert.equal(renderWith({ language: 'zh-Hans-CN' }).message, COPY['zh-CN'].message)
  assert.equal(renderWith({ language: 'en-GB' }).message, COPY['en-US'].message)
  assert.equal(renderWith({ language: 'fr-FR' }).message, COPY['en-US'].message)
  assert.equal(renderWith({ language: '' }).message, COPY['en-US'].message)
  assert.equal(renderWith({ search: '?lang=fr' }).message, COPY['en-US'].message)
})

test('the retry button navigates to the fixed marker without any bridge call', () => {
  const page = renderWith({ search: '?lang=zh-CN' })
  page.click()

  assert.equal(page.button.disabled, true, 'the button cannot be clicked twice')
  assert.equal(page.button.textContent, COPY['zh-CN'].retrying)
  assert.equal(page.location.href, PET_LOAD_FALLBACK_RETRY_URL, 'the button uses the fixed marker')
  assert.ok(!fallbackHtml.includes('desktopPet'), 'the page never uses the preload bridge')
  assert.ok(!fallbackHtml.includes('ipcRenderer'), 'the page never talks to IPC')
})
