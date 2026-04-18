import assert from 'node:assert/strict'
import { test } from 'node:test'

import { applyChatOutputTransforms } from '../src/features/chat/chatOutputTransforms.ts'
import type { ChatOutputTransformRule } from '../src/types/app.ts'

function rule(partial: Partial<ChatOutputTransformRule>): ChatOutputTransformRule {
  return {
    id: partial.id ?? 'r',
    label: partial.label ?? '',
    find: partial.find ?? '',
    replace: partial.replace ?? '',
    flags: partial.flags ?? '',
    enabled: partial.enabled !== false,
  }
}

test('no rules → passthrough', () => {
  assert.equal(applyChatOutputTransforms('hello', []), 'hello')
  assert.equal(applyChatOutputTransforms('hello', null), 'hello')
  assert.equal(applyChatOutputTransforms('hello', undefined), 'hello')
})

test('strips *action* markdown when configured', () => {
  const r = rule({ find: '\\*[^*]+\\*', flags: 'g' })
  assert.equal(
    applyChatOutputTransforms('hi *waves* there', [r]),
    'hi  there',
  )
})

test('hides <think> blocks (multiline via s flag)', () => {
  const r = rule({ find: '<think>[\\s\\S]*?</think>', flags: 'g' })
  const input = 'before <think>inner\ntwo lines</think> after'
  assert.equal(applyChatOutputTransforms(input, [r]), 'before  after')
})

test('later rules see earlier rule output', () => {
  const strip = rule({ id: 'a', find: '\\[hide:[^\\]]+\\]', flags: 'g', replace: '' })
  const collapse = rule({ id: 'b', find: '\\s{2,}', flags: 'g', replace: ' ' })
  const input = 'one  [hide:raw]   two'
  assert.equal(applyChatOutputTransforms(input, [strip, collapse]), 'one two')
})

test('disabled rules are skipped', () => {
  const r = rule({ find: 'cat', flags: 'g', replace: 'dog', enabled: false })
  assert.equal(applyChatOutputTransforms('a cat', [r]), 'a cat')
})

test('malformed regex does not crash the reply', () => {
  const broken = rule({ id: 'broken', find: '(unclosed', flags: 'g' })
  const good = rule({ id: 'good', find: 'foo', flags: 'g', replace: 'bar' })
  // Broken rule silently skipped; good rule still runs.
  assert.equal(applyChatOutputTransforms('foo', [broken, good]), 'bar')
})

test('supports capture group back-references in replacement', () => {
  const r = rule({ find: '(\\w+)@(\\w+)', flags: 'g', replace: '$2/$1' })
  assert.equal(applyChatOutputTransforms('alice@bob', [r]), 'bob/alice')
})

test('empty content is a no-op', () => {
  const r = rule({ find: 'x', flags: 'g', replace: 'y' })
  assert.equal(applyChatOutputTransforms('', [r]), '')
})
