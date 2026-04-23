import assert from 'node:assert/strict'
import { beforeEach, describe, test } from 'node:test'

import {
  clearLogs,
  createLogger,
  exportLogs,
  getLogEntries,
  getLogLevel,
  setConsolePassthrough,
  setLogLevel,
  type LogEntry,
} from '../src/lib/logger.ts'

// Silence console during tests — the logger's passthrough is on by
// default but we don't want the node:test reporter spammed.
setConsolePassthrough(false)

describe('logger basics', () => {
  beforeEach(() => {
    clearLogs()
    setLogLevel('info')
  })

  test('captures info logs with module + message + meta', () => {
    const log = createLogger('test.basic')
    log.info('hello', { answer: 42 })

    const entries = getLogEntries()
    assert.equal(entries.length, 1)
    assert.equal(entries[0].level, 'info')
    assert.equal(entries[0].module, 'test.basic')
    assert.equal(entries[0].message, 'hello')
    assert.deepEqual(entries[0].meta, { answer: 42 })
    assert.match(entries[0].ts, /^\d{4}-\d{2}-\d{2}T/)
  })

  test('supports debug / info / warn / error', () => {
    setLogLevel('debug')
    const log = createLogger('test.levels')
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    const levels = getLogEntries().map((e) => e.level)
    assert.deepEqual(levels, ['debug', 'info', 'warn', 'error'])
  })

  test('omits meta field when not provided', () => {
    const log = createLogger('test.no-meta')
    log.info('nothing to see here')

    const entry = getLogEntries()[0]
    assert.equal(entry.meta, undefined)
  })

  test('child loggers append a sub-module with dot separator', () => {
    const parent = createLogger('voice')
    const child = parent.child('vad')
    child.info('x')

    assert.equal(getLogEntries()[0].module, 'voice.vad')
  })

  test('grandchild logger chains correctly', () => {
    const log = createLogger('a').child('b').child('c')
    log.info('x')

    assert.equal(getLogEntries()[0].module, 'a.b.c')
  })
})

describe('level gate', () => {
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

    const messages = getLogEntries().map((e) => e.message)
    assert.deepEqual(messages, ['w', 'e'])
  })

  test('setLogLevel=debug captures everything', () => {
    setLogLevel('debug')
    const log = createLogger('test.gate')
    log.debug('d')
    log.info('i')

    assert.equal(getLogEntries().length, 2)
  })

  test('getLogLevel returns the current floor', () => {
    setLogLevel('error')
    assert.equal(getLogLevel(), 'error')
    setLogLevel('info')
    assert.equal(getLogLevel(), 'info')
  })
})

describe('ring buffer behavior', () => {
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
    // Oldest remaining should be entry 200 (0..199 evicted).
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

describe('filter', () => {
  beforeEach(() => {
    clearLogs()
    setLogLevel('debug')
  })

  test('filter by single level', () => {
    const log = createLogger('test.filter')
    log.info('i')
    log.warn('w')
    log.error('e')

    const warns = getLogEntries({ level: 'warn' })
    assert.equal(warns.length, 1)
    assert.equal(warns[0].level, 'warn')
  })

  test('filter by level array', () => {
    const log = createLogger('test.filter')
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')

    const dangerous = getLogEntries({ level: ['warn', 'error'] })
    assert.deepEqual(dangerous.map((e) => e.level), ['warn', 'error'])
  })

  test('filter by module prefix string', () => {
    createLogger('voice.vad').info('a')
    createLogger('voice.wakeword').info('b')
    createLogger('memory.recall').info('c')

    const voice = getLogEntries({ module: 'voice' })
    assert.equal(voice.length, 2)
    assert.ok(voice.every((e) => e.module.startsWith('voice')))
  })

  test('filter by module regex', () => {
    createLogger('voice.vad').info('a')
    createLogger('memory.vad').info('b')
    createLogger('ui.button').info('c')

    const vadish = getLogEntries({ module: /\.vad$/ })
    assert.equal(vadish.length, 2)
  })

  test('filter by since timestamp', () => {
    const log = createLogger('test.filter')
    log.info('first')
    const cutoff = new Date(Date.now() + 10).toISOString()
    // Busy-wait to push clock past cutoff.
    while (new Date().toISOString() < cutoff) { /* spin */ }
    log.info('after cutoff')

    const recent = getLogEntries({ since: cutoff })
    assert.equal(recent.length, 1)
    assert.equal(recent[0].message, 'after cutoff')
  })
})

describe('exportLogs', () => {
  beforeEach(() => {
    clearLogs()
    setLogLevel('debug')
  })

  test('produces JSONL (one JSON object per line, oldest first)', () => {
    const log = createLogger('test.export')
    log.info('first', { n: 1 })
    log.warn('second')

    const jsonl = exportLogs()
    const lines = jsonl.split('\n')
    assert.equal(lines.length, 2)

    const parsed: LogEntry[] = lines.map((l) => JSON.parse(l))
    assert.equal(parsed[0].message, 'first')
    assert.deepEqual(parsed[0].meta, { n: 1 })
    assert.equal(parsed[1].message, 'second')
    assert.equal(parsed[1].meta, undefined)
  })

  test('empty buffer exports to empty string', () => {
    assert.equal(exportLogs(), '')
  })

  test('honors filters', () => {
    createLogger('voice').info('v1')
    createLogger('voice').warn('v2')
    createLogger('memory').info('m1')

    const voiceWarns = exportLogs({ level: 'warn', module: 'voice' })
    const parsed: LogEntry[] = voiceWarns.split('\n').map((l) => JSON.parse(l))
    assert.equal(parsed.length, 1)
    assert.equal(parsed[0].message, 'v2')
  })
})
