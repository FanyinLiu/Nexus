/**
 * The future-self capsule letter card, rendered to static markup.
 *
 * The card is the user's own letter: it must show the authored text verbatim
 * (line breaks included, nothing truncated) and must never gain a pet avatar,
 * the companion's name or an action button — those would claim the letter as
 * something the companion said.
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import { register } from 'node:module'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

import { ensureLocaleLoaded, setLocale } from '../src/i18n/runtime.ts'
import type { ChatSheetV2Message } from '../src/features/uiV2/ChatSheetV2.tsx'

register(new URL('./helpers/tsx-test-loader.mjs', import.meta.url))
const { CapsuleLetterCard } = await import('../src/components/CapsuleLetterCard.tsx')
const { MessageBubble } = await import('../src/components/MessageBubble.tsx')
const { ChatSheetV2 } = await import('../src/features/uiV2/ChatSheetV2.tsx')

await ensureLocaleLoaded('zh-CN')
setLocale('zh-CN')

const LETTER_BODY = '希望你还在坚持早上跑步。\n如果累了，就慢一点，但别停下。\n还有，记得给妈妈打电话。'
const WRITTEN_AT = new Date(2025, 10, 1, 12, 0, 0).toISOString()

const labels = {
  title: '对话',
  backToCompanion: '回到她身边',
  close: '关闭',
  userName: '你',
  messageList: '消息',
  messageInput: '说点什么',
  inputPlaceholder: '说点什么',
  send: '发送',
  emptyHistory: '还没有消息',
  emptyGuidance: '随便说一句',
  starterPrompts: ['今天怎么样', '在做什么'] as const,
  busyStatus: '正在想',
  errorTitle: '出错了',
  editRetry: '改一下再试',
  viewNewMessages: '有新消息',
  cancel: '停下',
}

function renderCard(letter: {
  title?: string
  body: string
  writtenAt: string
}) {
  return renderToStaticMarkup(React.createElement(CapsuleLetterCard, { letter }))
}

test('the card renders the default header, the verbatim letter and the writing date', () => {
  const html = renderCard({ body: LETTER_BODY, writtenAt: WRITTEN_AT })

  assert.match(html, /class="capsule-letter-card"/)
  assert.match(html, /给今天的你/)
  assert.match(html, /希望你还在坚持早上跑步。/)
  assert.match(html, /如果累了，就慢一点，但别停下。/)
  assert.match(html, /还有，记得给妈妈打电话。/)
  assert.match(html, /写于 2025年11月1日/)
  // The authored line breaks survive into the markup; CSS keeps them visible.
  assert.ok(html.includes('希望你还在坚持早上跑步。\n如果累了'), 'line breaks must survive')
})

test("a titled capsule renders the user's own header instead of the default", () => {
  const html = renderCard({ title: '给明年的自己', body: LETTER_BODY, writtenAt: WRITTEN_AT })

  assert.match(html, /给明年的自己/)
  assert.doesNotMatch(html, /给今天的你/)
})

test('the card carries no avatar, no companion name and no buttons', () => {
  const html = renderCard({ title: '给明年的自己', body: LETTER_BODY, writtenAt: WRITTEN_AT })

  assert.doesNotMatch(html, /<button|<img|avatar|aria-label="星绘"|星绘/)
  assert.doesNotMatch(html, /class="[^"]*(avatar|speaker)/)
  // Two paragraphs of copy plus the date line: no interactive surface at all.
  assert.equal((html.match(/<p /g) ?? []).length, 3)
})

test('a ~3000 character letter is rendered in full, never clipped', () => {
  const longBody = `${'练'.repeat(1500)}\n${'习'.repeat(1500)}`
  const html = renderCard({ body: longBody, writtenAt: WRITTEN_AT })

  assert.ok(html.includes(longBody), 'the whole letter must reach the card')
  assert.doesNotMatch(html, /…/)
})

test('the card is never wrapped in quotes', () => {
  const html = renderCard({ body: LETTER_BODY, writtenAt: WRITTEN_AT })

  assert.doesNotMatch(html, /「|」|“|”/)
  assert.doesNotMatch(html, /&quot;/)
})

test('V2 chat renders the opener bubble and then the letter card', () => {
  const messages: ChatSheetV2Message[] = [{
    id: 'msg-capsule',
    role: 'assistant',
    content: '你300 天前写给今天的信，到了。',
    capsuleLetter: {
      title: '给明年的自己',
      body: LETTER_BODY,
      writtenAt: WRITTEN_AT,
    },
  }]

  const html = renderToStaticMarkup(React.createElement(ChatSheetV2, {
    messages,
    companionName: '星绘',
    inputValue: '',
    labels,
    onInputChange: () => undefined,
    onSend: () => undefined,
    busy: false,
    error: null,
    onCancel: () => undefined,
    onClose: () => undefined,
  }))

  const openerIndex = html.indexOf('你300 天前写给今天的信，到了。')
  const cardIndex = html.indexOf('class="capsule-letter-card"')
  assert.ok(openerIndex >= 0, 'the opener is a normal chat message')
  assert.ok(cardIndex >= 0, 'the letter card follows it')
  assert.ok(cardIndex > openerIndex, 'the card sits below the opener')
  assert.match(html, /给明年的自己/)
  assert.match(html, /希望你还在坚持早上跑步。/)
  assert.match(html, /写于 2025年11月1日/)

  // The card region itself still has no avatar, name or button.
  const cardHtml = html.slice(cardIndex, html.indexOf('</article>', cardIndex))
  assert.doesNotMatch(cardHtml, /星绘|<button|<img/)
})

test('a capsule chat message without a card renders as the plain opener', () => {
  const html = renderToStaticMarkup(React.createElement(ChatSheetV2, {
    messages: [{
      id: 'msg-plain',
      role: 'assistant',
      content: '你300 天前写给今天的信，到了。',
    }],
    companionName: '星绘',
    inputValue: '',
    labels,
    onInputChange: () => undefined,
    onSend: () => undefined,
    busy: false,
    error: null,
    onCancel: () => undefined,
    onClose: () => undefined,
  }))

  assert.match(html, /你300 天前写给今天的信，到了。/)
  assert.doesNotMatch(html, /capsule-letter-card/)
})

test('the legacy panel message bubble renders the same letter card', () => {
  const html = renderToStaticMarkup(React.createElement(MessageBubble, {
    message: {
      id: 'msg-capsule',
      role: 'assistant',
      content: '你300 天前写给今天的信，到了。',
      createdAt: WRITTEN_AT,
      capsuleLetter: {
        title: '给明年的自己',
        body: LETTER_BODY,
        writtenAt: WRITTEN_AT,
      },
    },
    assistantName: '星绘',
  }))

  assert.match(html, /你300 天前写给今天的信，到了。/)
  assert.match(html, /class="capsule-letter-card"/)
  assert.match(html, /给明年的自己/)
  assert.match(html, /希望你还在坚持早上跑步。/)
  assert.match(html, /写于 2025年11月1日/)

  const cardHtml = html.slice(html.indexOf('class="capsule-letter-card"'))
  assert.doesNotMatch(cardHtml, /星绘|<button|<img/)
})

// ── Card visuals ───────────────────────────────────────────────────────────

test('the letter card stylesheet uses the paper-card spec values, light and dark', async () => {
  const css = await fs.promises.readFile(
    new URL('../src/components/capsule-letter-card.css', import.meta.url),
    'utf8',
  )
  const rule = (selector: string) => {
    const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\n\\}`))
    assert.ok(match, `missing rule for ${selector}`)
    return match[1] ?? ''
  }

  const card = rule('.capsule-letter-card')
  assert.match(card, /padding:\s*16px 18px/)
  assert.match(card, /margin:\s*6px 0 12px/)
  assert.match(card, /width:\s*100%/)
  assert.match(card, /border-radius:\s*var\(--nx-radius-card, 16px\)/)
  assert.match(card, /border:\s*1px solid color-mix\(in srgb, var\(--capsule-letter-amber\) 28%, #e8dfd0\)/)
  assert.match(card, /background:\s*color-mix\(in srgb, var\(--capsule-letter-amber\) 14%, #f7f2ea\)/)
  assert.match(card, /box-shadow:\s*0 4px 18px rgba\(60, 40, 20, 0\.06\)/)
  assert.match(card, /animation:\s*capsule-letter-card-fade-in 180ms ease-out/)
  assert.doesNotMatch(card, /transform|scale/)

  const title = rule('.capsule-letter-card__title')
  assert.match(title, /color:\s*#4a4035/)
  assert.match(title, /font-size:\s*14px/)
  assert.match(title, /font-weight:\s*600/)
  assert.match(title, /line-height:\s*1\.4/)

  const body = rule('.capsule-letter-card__body')
  assert.match(body, /color:\s*#3d3429/)
  assert.match(body, /font-size:\s*14px/)
  assert.match(body, /font-weight:\s*400/)
  assert.match(body, /line-height:\s*1\.7/)
  assert.match(body, /white-space:\s*pre-wrap/)

  const date = rule('.capsule-letter-card__date')
  assert.match(date, /color:\s*#8a7e70/)
  assert.match(date, /font-size:\s*12px/)
  assert.match(date, /text-align:\s*right/)

  // Night / black override every paper colour with the warm dark set.
  assert.match(css, /html\[data-color-scheme='dark'\] \.capsule-letter-card,/)
  assert.match(css, /html\[data-theme='system-dark'\] \.capsule-letter-card,/)
  assert.match(css, /html\[data-theme='system-black'\] \.capsule-letter-card \{[\s\S]*?border-color: rgba\(230, 210, 180, 0\.12\)/)
  assert.match(css, /background: color-mix\(in srgb, var\(--capsule-letter-amber\) 10%, #26221e\)/)
  assert.match(css, /box-shadow: 0 4px 18px rgba\(0, 0, 0, 0\.22\)/)
  assert.match(css, /\.capsule-letter-card__title \{\s*color: #e8dfd4/)
  assert.match(css, /\.capsule-letter-card__body \{\s*color: #d8d0c6/)
  assert.match(css, /\.capsule-letter-card__date \{\s*color: #9a9084/)

  // The fade-in is opacity-only and switched off under reduced motion.
  const keyframes = css.match(/@keyframes capsule-letter-card-fade-in \{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.match(keyframes, /opacity:\s*0/)
  assert.match(keyframes, /opacity:\s*1/)
  assert.doesNotMatch(keyframes, /transform|scale|bounce/)
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.capsule-letter-card \{\s*animation: none/)
})
