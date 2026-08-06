import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildReleaseTrustReport,
  parseReleaseTrustArgs,
} from '../scripts/release-trust-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('release trust audit does not inspect or serialize secret values', () => {
  const reportText = JSON.stringify(buildReleaseTrustReport())

  assert.match(reportText, /APPLE_API_KEY_ID/)
  assert.doesNotMatch(reportText, /sk-[A-Za-z0-9]/)
  assert.doesNotMatch(reportText, /-----BEGIN PRIVATE KEY-----/)
})

test('release trust argument parser accepts only explicit hard-gate profiles', () => {
  assert.deepEqual(parseReleaseTrustArgs(['--require-unsigned', 'all', '--json']), {
    json: true,
    includeSigningReadiness: false,
    requireSigned: null,
    requireUnsigned: 'all',
  })
  assert.deepEqual(parseReleaseTrustArgs(['--require-signed=windows']), {
    json: false,
    includeSigningReadiness: true,
    requireSigned: 'windows',
    requireUnsigned: null,
  })

  for (const argv of [
    ['--require-unsigned', 'typo'],
    ['--require-signed', 'typo'],
    ['--require-unsigned'],
    ['--require-signed', '--json'],
    ['--require-unsigned='],
    ['--require-signed=all', '--require-unsigned=all'],
    ['--require-signed=mac', '--require-signed=mac'],
    ['--unknown'],
    ['windows'],
  ]) {
    assert.throws(() => parseReleaseTrustArgs(argv), /requires one of|mutually exclusive|only be provided once|unknown argument/)
  }
})

test('release trust CLI fails closed before auditing malformed gate arguments', () => {
  for (const args of [
    ['--require-unsigned', 'typo'],
    ['--require-signed'],
    ['--unknown'],
  ]) {
    const result = spawnSync(process.execPath, ['scripts/release-trust-audit.mjs', ...args], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    assert.equal(result.status, 2)
    assert.match(result.stderr, /Release trust audit argument error:/)
    assert.equal(result.stdout, '')
  }
})
