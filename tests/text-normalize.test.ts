import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

import {
  decodeHtmlEntities,
  escapeXml,
  normalizeWhitespace,
  stripHtml,
} from '../electron/textNormalize.js'

test('normalizeWhitespace collapses runs and trims', () => {
  assert.equal(normalizeWhitespace('  hello   world\n'), 'hello world')
  assert.equal(normalizeWhitespace(null), '')
})

test('stripHtml removes tags without gluing adjacent words', () => {
  assert.equal(stripHtml('<p>hello</p><p>world</p>'), 'hello world')
  assert.equal(stripHtml(undefined), '')
})

test('escapeXml encodes markup-sensitive characters', () => {
  assert.equal(escapeXml(`<a b="c" d='e'>&`), '&lt;a b=&quot;c&quot; d=&apos;e&apos;&gt;&amp;')
})

test('decodeHtmlEntities covers numeric, nbsp, and typographic named entities', () => {
  assert.equal(decodeHtmlEntities('A&nbsp;B &ndash; C&mdash;D&hellip;'), 'A B - C--D...')
  assert.equal(decodeHtmlEntities('&#x2F;path&#47;'), '/path/')
  assert.equal(decodeHtmlEntities('&lt;tag&gt;&amp;&quot;'), '<tag>&"')
})

test('electron consumers import the shared decoder and XML escaper', () => {
  const helpers = readFileSync(new URL('../electron/webSearchHelpers.js', import.meta.url), 'utf8')
  const edgeTts = readFileSync(new URL('../electron/services/edgeTts.js', import.meta.url), 'utf8')
  const bridge = readFileSync(new URL('../electron/services/notificationBridge.js', import.meta.url), 'utf8')
  assert.match(helpers, /import \{ decodeHtmlEntities, normalizeWhitespace, stripHtml \}/)
  assert.match(helpers, /import \{ normalizeBaseUrl \} from '\.\/netHelpers\.js'/)
  assert.doesNotMatch(helpers, /function normalizeBaseUrl/)
  assert.match(edgeTts, /import \{ escapeXml \} from '\.\.\/textNormalize\.js'/)
  assert.match(bridge, /import \{ decodeHtmlEntities, stripHtml \}/)
  assert.doesNotMatch(helpers, /function decodeHtmlEntities/)
  assert.doesNotMatch(edgeTts, /const escapeXml = /)
})
