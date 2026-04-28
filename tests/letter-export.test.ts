import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  buildLetterFilename,
  escapeHtml,
  renderLetterHtml,
} from '../src/features/letter/letterExport.ts'
import type { SavedLetter } from '../src/features/letter/letterStore.ts'

function letter(overrides: Partial<SavedLetter> = {}): SavedLetter {
  return {
    id: 'l1',
    letterDate: '2026-04-26',
    createdAt: '2026-04-26T20:00:00Z',
    personaId: 'default',
    uiLanguage: 'en-US',
    content: {
      greeting: 'Dear you,',
      summary: 'This week was full of small things.',
      suggestion: 'Consider resting on Sunday.',
      intention: 'Hold the thread you opened on Tuesday.',
      experiment: 'Try one quiet evening with no plans.',
      closing: 'Until next Sunday — Nexus',
    },
    weekDayCount: 5,
    themes: ['rest', 'quiet'],
    ...overrides,
  }
}

// ── escapeHtml ───────────────────────────────────────────────────────────

test('escapeHtml: all five characters escaped', () => {
  const out = escapeHtml(`<script>alert("x")&'</script>`)
  assert.equal(out, '&lt;script&gt;alert(&quot;x&quot;)&amp;&#39;&lt;/script&gt;')
})

test('escapeHtml: plain text passes through', () => {
  assert.equal(escapeHtml('Hello there'), 'Hello there')
})

// ── buildLetterFilename ──────────────────────────────────────────────────

test('filename: uses letterDate verbatim when valid', () => {
  assert.equal(buildLetterFilename(letter()), 'nexus-letter-2026-04-26.html')
})

test('filename: strips non-date characters defensively', () => {
  const f = buildLetterFilename(letter({ letterDate: '2026-04-26<script>' }))
  assert.equal(f, 'nexus-letter-2026-04-26.html')
})

test('filename: falls back to "letter" when date is empty', () => {
  const f = buildLetterFilename(letter({ letterDate: '' }))
  assert.equal(f, 'nexus-letter-letter.html')
})

// ── renderLetterHtml ─────────────────────────────────────────────────────

test('render: produces a complete HTML5 document', () => {
  const html = renderLetterHtml(letter())
  assert.match(html, /^<!DOCTYPE html>/)
  assert.match(html, /<html lang="en-US">/)
  assert.match(html, /<\/html>\s*$/)
})

test('render: includes all six paragraph types when non-empty', () => {
  const html = renderLetterHtml(letter())
  assert.match(html, /Dear you/)
  assert.match(html, /full of small things/)
  assert.match(html, /resting on Sunday/)
  assert.match(html, /Tuesday/)
  assert.match(html, /one quiet evening/)
  assert.match(html, /Until next Sunday/)
})

test('render: skips empty paragraphs (e.g. greeting omitted) gracefully', () => {
  const html = renderLetterHtml(
    letter({
      content: {
        greeting: '',
        summary: 'Just a short note this week.',
        suggestion: '',
        intention: '',
        experiment: '',
        closing: 'Take care.',
      },
    }),
  )
  // No empty <p></p> blocks
  assert.ok(!html.includes('<p></p>'))
  assert.match(html, /Just a short note/)
  assert.match(html, /Take care\./)
})

test('render: HTML-escapes user-controlled content (defence-in-depth)', () => {
  const html = renderLetterHtml(
    letter({
      content: {
        greeting: '<script>alert(1)</script>',
        summary: '',
        suggestion: '',
        intention: '',
        experiment: '',
        closing: '',
      },
    }),
  )
  // Should not contain a live script tag
  assert.ok(!html.includes('<script>alert(1)</script>'))
  // Escaped form should be present
  assert.match(html, /&lt;script&gt;/)
})

test('render: zh-CN locale gets zh-CN header + html lang attribute', () => {
  const html = renderLetterHtml(letter({ uiLanguage: 'zh-CN' }))
  assert.match(html, /<html lang="zh-CN">/)
  assert.match(html, /给你的一封信/)
})

test('render: each of the 5 locales produces distinct headers', () => {
  const locales = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko'] as const
  const docs = locales.map((l) => renderLetterHtml(letter({ uiLanguage: l })))
  // Each should have its own lang attribute and header
  for (let i = 0; i < docs.length; i += 1) {
    assert.ok(docs[i].includes(`lang="${locales[i]}"`))
  }
  // Headers should differ across locales — extract the eyebrow text
  const headers = docs.map((d) => /class="eyebrow">([^<]+)</.exec(d)?.[1] ?? '')
  assert.equal(new Set(headers).size, locales.length)
})

test('render: closing paragraph gets the .closing CSS class', () => {
  const html = renderLetterHtml(letter())
  assert.match(html, /class="closing">Until next Sunday/)
})

test('render: print stylesheet hides footer for clean Cmd+P output', () => {
  const html = renderLetterHtml(letter())
  assert.match(html, /@media print/)
  assert.match(html, /footer\s*\{\s*display:\s*none/)
})
