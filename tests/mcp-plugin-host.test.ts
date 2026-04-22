import { test } from 'node:test'
import assert from 'node:assert/strict'

import { parseArgsString } from '../electron/services/mcpHost.js'
import { hashCommand, isPluginCommandTrusted } from '../electron/services/pluginHostUtils.js'

// ── parseArgsString ─────────────────────────────────────────────────────

test('parseArgsString: returns empty array for falsy input', () => {
  assert.deepEqual(parseArgsString(null), [])
  assert.deepEqual(parseArgsString(undefined), [])
  assert.deepEqual(parseArgsString(''), [])
})

test('parseArgsString: returns empty array for whitespace-only input', () => {
  assert.deepEqual(parseArgsString('   '), [])
  assert.deepEqual(parseArgsString('\n\n'), [])
  assert.deepEqual(parseArgsString('  \t  '), [])
})

test('parseArgsString: splits simple space-separated args', () => {
  assert.deepEqual(parseArgsString('--port 3000'), ['--port', '3000'])
  assert.deepEqual(parseArgsString('a b c'), ['a', 'b', 'c'])
})

test('parseArgsString: handles double-quoted args with spaces', () => {
  assert.deepEqual(
    parseArgsString('--root "F:\\my data" --verbose'),
    ['--root', 'F:\\my data', '--verbose'],
  )
})

test('parseArgsString: handles single-quoted args with spaces', () => {
  assert.deepEqual(
    parseArgsString("--name 'hello world'"),
    ['--name', 'hello world'],
  )
})

test('parseArgsString: joins newlines into a single line before parsing', () => {
  assert.deepEqual(
    parseArgsString('--host\nlocalhost\n--port\n8080'),
    ['--host', 'localhost', '--port', '8080'],
  )
})

test('parseArgsString: handles \\r\\n line endings', () => {
  assert.deepEqual(
    parseArgsString('--a\r\n--b'),
    ['--a', '--b'],
  )
})

test('parseArgsString: strips quotes from values, keeping inner content', () => {
  assert.deepEqual(parseArgsString('"hello"'), ['hello'])
  assert.deepEqual(parseArgsString("'hello'"), ['hello'])
})

test('parseArgsString: handles multiple spaces and tabs between args', () => {
  assert.deepEqual(parseArgsString('a   b\t\tc'), ['a', 'b', 'c'])
})

test('parseArgsString: quoted arg adjacent to unquoted text merges them', () => {
  // e.g. --prefix"/some path" → --prefix/some path  (quotes stripped, text concatenated)
  assert.deepEqual(parseArgsString('--prefix"/some path"'), ['--prefix/some path'])
})

test('parseArgsString: empty quotes produce no token', () => {
  // "" by itself: quote opens/closes, current stays empty, never pushed
  assert.deepEqual(parseArgsString('a "" b'), ['a', 'b'])
})

test('parseArgsString: coerces non-string input via String()', () => {
  assert.deepEqual(parseArgsString(42 as unknown as string), ['42'])
})

// ── hashCommand ─────────────────────────────────────────────────────────

test('hashCommand: returns a 16-char hex string', () => {
  const hash = hashCommand('node', ['server.js'])
  assert.equal(hash.length, 16)
  assert.match(hash, /^[0-9a-f]{16}$/)
})

test('hashCommand: same input produces same hash', () => {
  const a = hashCommand('npx', ['@mcp/server', '--port', '3000'])
  const b = hashCommand('npx', ['@mcp/server', '--port', '3000'])
  assert.equal(a, b)
})

test('hashCommand: different args produce different hashes', () => {
  const a = hashCommand('node', ['a.js'])
  const b = hashCommand('node', ['b.js'])
  assert.notEqual(a, b)
})

test('hashCommand: different commands produce different hashes', () => {
  const a = hashCommand('node', ['server.js'])
  const b = hashCommand('python', ['server.js'])
  assert.notEqual(a, b)
})

test('hashCommand: args order matters', () => {
  const a = hashCommand('cmd', ['--a', '--b'])
  const b = hashCommand('cmd', ['--b', '--a'])
  assert.notEqual(a, b)
})

test('hashCommand: defaults to empty args array', () => {
  const a = hashCommand('node')
  const b = hashCommand('node', [])
  assert.equal(a, b)
})

// ── isPluginCommandTrusted ──────────────────────────────────────────────

test('isPluginCommandTrusted: returns false when plugin not in approved map', () => {
  const approved = new Map<string, string>()
  const plugin = { id: 'foo', command: 'node', args: ['s.js'] }
  assert.equal(isPluginCommandTrusted(plugin, approved), false)
})

test('isPluginCommandTrusted: returns false when stored hash is empty (migrated entry)', () => {
  const approved = new Map([['foo', '']])
  const plugin = { id: 'foo', command: 'node', args: ['s.js'] }
  assert.equal(isPluginCommandTrusted(plugin, approved), false)
})

test('isPluginCommandTrusted: returns true when hash matches', () => {
  const plugin = { id: 'bar', command: 'npx', args: ['serve'] }
  const hash = hashCommand('npx', ['serve'])
  const approved = new Map([['bar', hash]])
  assert.equal(isPluginCommandTrusted(plugin, approved), true)
})

test('isPluginCommandTrusted: returns false when command changed', () => {
  const oldHash = hashCommand('node', ['old.js'])
  const approved = new Map([['baz', oldHash]])
  const plugin = { id: 'baz', command: 'node', args: ['new.js'] }
  assert.equal(isPluginCommandTrusted(plugin, approved), false)
})
