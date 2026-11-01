import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

function read(relativePath: string) {
  return readFileSync(join(ROOT, relativePath), 'utf8')
}

function extractConnectSrc(source: string, pattern: RegExp) {
  const match = source.match(pattern)
  assert.ok(match, `connect-src missing from ${pattern}`)
  return match[1].trim()
}

test('renderer CSPs share the same explicit connect-src allowlist', () => {
  const htmlConnectSrc = extractConnectSrc(
    read('index.html'),
    /connect-src\s+([^;"]+);/,
  )
  const headerConnectSrc = extractConnectSrc(
    read('electron/rendererServer.js'),
    /"connect-src ([^"]+)"/,
  )

  assert.equal(htmlConnectSrc, headerConnectSrc)
})

test('renderer connect-src no longer allows every HTTPS origin', () => {
  const connectSrc = extractConnectSrc(
    read('index.html'),
    /connect-src\s+([^;"]+);/,
  )
  const directives = connectSrc.split(/\s+/)

  assert.ok(!directives.includes('https:'), `bare https: is still allowed: ${connectSrc}`)
  assert.ok(directives.includes("'self'"))
  assert.ok(directives.includes('data:'))
  assert.ok(directives.includes('blob:'))
  assert.ok(directives.includes('http://127.0.0.1:*'))
  assert.ok(directives.includes('https://huggingface.co'))
  assert.ok(directives.includes('https://*.huggingface.co'))
})
