import assert from 'node:assert/strict'
import test from 'node:test'
import { formatExceptionDetails } from '../scripts/lib/cdp-exception-details.mjs'
import { quitWithDeadline } from '../scripts/lib/quit-with-deadline.mjs'

test('formatExceptionDetails includes description, exception text and 1-based location', () => {
  const message = formatExceptionDetails({
    text: 'Uncaught',
    url: 'https://example.test/renderer.js',
    lineNumber: 3,
    columnNumber: 8,
    exception: {
      type: 'object',
      className: 'Error',
      description: 'Error: gaze probe failed\n    at sampleGaze (renderer.js:4:9)',
    },
    stackTrace: {
      callFrames: [
        { functionName: 'sampleGaze', url: 'https://example.test/renderer.js', lineNumber: 3, columnNumber: 8 },
      ],
    },
  })
  assert.match(message, /Error: gaze probe failed/)
  assert.match(message, /Exception text: Uncaught/)
  assert.match(message, /URL: https:\/\/example\.test\/renderer\.js/)
  assert.match(message, /Line: 4/)
  assert.match(message, /Column: 9/)
  assert.match(message, /#0 sampleGaze \(https:\/\/example\.test\/renderer\.js:4:9\)/)
})

test('formatExceptionDetails falls back to value, class name and bare details', () => {
  const thrownValue = formatExceptionDetails({
    text: 'Uncaught', url: 'renderer.js', lineNumber: 0, columnNumber: 0, exception: { value: 'boom' },
  })
  assert.match(thrownValue, /boom/)
  assert.match(thrownValue, /Line: 1/)
  assert.match(thrownValue, /Column: 1/)

  const thrownClass = formatExceptionDetails({ text: 'Uncaught', exception: { className: 'TypeError' } })
  assert.match(thrownClass, /TypeError/)
  assert.match(thrownClass, /URL: <anonymous>/)

  const bare = formatExceptionDetails({ text: 'Uncaught', lineNumber: 2, columnNumber: 4 })
  assert.match(bare, /Uncaught/)
  assert.match(bare, /Line: 3/)
  assert.match(bare, /Column: 5/)
  assert.doesNotMatch(bare, /undefined/)

  assert.doesNotMatch(formatExceptionDetails(undefined), /undefined/)
})

test('quitWithDeadline resolves on a normal quit without killing the process', async () => {
  const signals: string[] = []
  const application = {
    waitForEvent: async () => undefined,
    evaluate: async () => undefined,
    close: async () => undefined,
    process: () => ({ kill: (signal: string) => { signals.push(signal); return true } }),
  }
  const outcome = await quitWithDeadline({ application, timeoutMs: 200, closeTimeoutMs: 200 })
  assert.equal(outcome, 'quit')
  assert.deepEqual(signals, [])
})

test('quitWithDeadline SIGKILLs when quit and close both hang', async () => {
  const signals: string[] = []
  const application = {
    waitForEvent: () => new Promise(() => {}),
    evaluate: async () => undefined,
    close: () => new Promise(() => {}),
    process: () => ({ kill: (signal: string) => { signals.push(signal); return true } }),
  }
  const outcome = await quitWithDeadline({ application, timeoutMs: 20, closeTimeoutMs: 20 })
  assert.equal(outcome, 'kill')
  assert.deepEqual(signals, ['SIGKILL'])
})
