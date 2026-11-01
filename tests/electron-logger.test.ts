import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'

import {
  clearLogs,
  createLogger,
  exportLogs,
  getLogEntries,
  getLogLevel,
  sanitizeLogMeta,
  setConsolePassthrough,
  setLogLevel,
} from '../electron/logger.js'

// Silence console during tests — the logger's passthrough is on by default
// but we don't want the node:test reporter spammed.
setConsolePassthrough(false)

describe('electron logger basics', () => {
  beforeEach(() => {
    clearLogs()
    setLogLevel('info')
  })

  test('captures info logs with module + message + meta', () => {
    const log = createLogger('test.basic')
    log.info('hello', { count: 42 })

    const entries = getLogEntries()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].level, 'info')
    assert.equal(entries[0].module, 'test.basic')
    assert.equal(entries[0].message, 'hello')
    assert.deepEqual(entries[0].meta, { count: 42 })
    assert.match(entries[0].ts, /^\d{4}-\d{2}-\d{2}T/)
  })

  test('supports debug / info / warn / error', () => {
    setLogLevel('debug')
    const log = createLogger('test.levels')
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    assert.deepEqual(getLogEntries().map((entry) => entry.level), ['debug', 'info', 'warn', 'error'])
  })

  test('omits meta field when not provided', () => {
    createLogger('test.no-meta').info('nothing to see here')

    assert.equal(getLogEntries()[0].meta, undefined)
  })

  test('child loggers append a sub-module with dot separator', () => {
    createLogger('voice').child('vad').info('x')

    assert.equal(getLogEntries()[0].module, 'voice.vad')
  })

  test('grandchild logger chains correctly', () => {
    createLogger('a').child('b').child('c').info('x')

    assert.equal(getLogEntries()[0].module, 'a.b.c')
  })

  test('redacts private metadata while retaining safe operational fields', () => {
    createLogger('voice').info('sending message', {
      content: 'private chat body',
      traceId: 'session-secret',
      contentLength: 17,
      source: 'voice',
      provider: 'openai',
    })

    const entry = getLogEntries()[0]
    assert.deepEqual(entry.meta, {
      content: { redacted: true, type: 'string', length: 17 },
      traceId: { redacted: true, type: 'string', length: 14 },
      contentLength: 17,
      source: 'voice',
      provider: 'openai',
    })
    assert.doesNotMatch(JSON.stringify(entry), /private chat body|session-secret/)
  })

  test('sanitizeLogMeta defaults unknown keys to metadata-only summaries', () => {
    assert.deepEqual(sanitizeLogMeta({ arbitrary: 'user value', responseLength: 9 }), {
      arbitrary: { redacted: true, type: 'string', length: 10 },
      responseLength: 9,
    })
  })
})

describe('electron logger level gate', () => {
  beforeEach(() => {
    clearLogs()
  })

  test('default minimum level is info (debug drops)', () => {
    setLogLevel('info')
    const log = createLogger('test.gate')
    log.debug('silenced')
    log.info('visible')

    const entries = getLogEntries()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].message, 'visible')
  })

  test('setLogLevel=warn drops info and debug', () => {
    setLogLevel('warn')
    const log = createLogger('test.gate')
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    assert.deepEqual(getLogEntries().map((entry) => entry.message), ['w', 'e'])
  })

  test('getLogLevel returns the current floor', () => {
    setLogLevel('error')
    assert.equal(getLogLevel(), 'error')
    setLogLevel('info')
    assert.equal(getLogLevel(), 'info')
  })
})

describe('electron logger ring buffer', () => {
  beforeEach(() => {
    clearLogs()
    setLogLevel('debug')
  })

  test('capacity caps at 500 (oldest drops first)', () => {
    const log = createLogger('test.ring')
    for (let i = 0; i < 700; i++) {
      log.info(`entry ${i}`)
    }

    const entries = getLogEntries()
    assert.equal(entries.length, 500)
    assert.equal(entries[0].message, 'entry 200')
    assert.equal(entries[entries.length - 1].message, 'entry 699')
  })

  test('clearLogs empties the ring', () => {
    const log = createLogger('test.clear')
    log.info('first')
    log.info('second')
    clearLogs()

    assert.equal(getLogEntries().length, 0)
  })
})

describe('electron logger redaction and truncation', () => {
  beforeEach(() => {
    clearLogs()
    setLogLevel('debug')
  })

  test('redacts secrets and local paths in messages', () => {
    createLogger('test.redact').warn('upstream token=sk-ABCDEF1234567890XYZ at /Users/klein/private.log')

    const [entry] = getLogEntries()
    assert.doesNotMatch(entry.message, /sk-ABCDEF1234567890XYZ/)
    assert.doesNotMatch(entry.message, /\/Users\/klein/)
    assert.match(entry.message, /token=\*\*\*/)
  })

  test('caps message length at 160 characters', () => {
    createLogger('test.truncate').info('x'.repeat(300))

    assert.equal(getLogEntries()[0].message.length, 160)
  })

  test('replaces an empty message with a diagnostic label', () => {
    createLogger('test.empty').info('   ')

    assert.equal(getLogEntries()[0].message, 'diagnostic event')
  })
})

describe('electron logger filters', () => {
  beforeEach(() => {
    clearLogs()
    setLogLevel('debug')
  })

  test('filters by module prefix and level', () => {
    createLogger('voice.vad').info('a')
    createLogger('voice.wakeword').warn('b')
    createLogger('memory.recall').info('c')

    assert.deepEqual(getLogEntries({ module: 'voice' }).map((entry) => entry.message), ['a', 'b'])
    assert.deepEqual(getLogEntries({ level: 'warn' }).map((entry) => entry.message), ['b'])
  })
})

describe('electron logger exportLogs', () => {
  beforeEach(() => {
    clearLogs()
    setLogLevel('debug')
  })

  test('produces JSONL (one JSON object per line, oldest first)', () => {
    const log = createLogger('test.export')
    log.info('first', { count: 1 })
    log.warn('second')

    const lines = exportLogs().split('\n')
    assert.equal(lines.length, 2)

    const parsed = lines.map((line) => JSON.parse(line))
    assert.equal(parsed[0].message, 'first')
    assert.deepEqual(parsed[0].meta, { count: 1 })
    assert.equal(parsed[1].message, 'second')
    assert.equal(parsed[1].meta, undefined)
  })

  test('empty buffer exports to empty string', () => {
    assert.equal(exportLogs(), '')
  })

  test('honors module filters', () => {
    createLogger('voice').info('v1')
    createLogger('voice').warn('v2')
    createLogger('memory').info('m1')

    const parsed = exportLogs({ level: 'warn', module: 'voice' })
      .split('\n')
      .map((line) => JSON.parse(line))
    assert.equal(parsed.length, 1)
    assert.equal(parsed[0].message, 'v2')
  })
})
