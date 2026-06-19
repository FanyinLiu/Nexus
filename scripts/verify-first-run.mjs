#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const npmBin = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function run(label, command, args, options = {}) {
  console.log(`\n[verify:first-run] ${label}`)
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: 'inherit',
    ...options,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}`)
  }
}

function runJson(label, command, args, options = {}) {
  console.log(`\n[verify:first-run] ${label}`)
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${result.status}: ${result.stderr || result.stdout}`)
  }
  return JSON.parse(result.stdout || '{}')
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

try {
  const sentinelSecret = 'sk-verify-first-run-sentinel'
  const doctor = runJson('doctor JSON privacy/startup report', process.execPath, [
    'scripts/nexus-doctor.mjs',
    '--json',
    '--skip-network',
  ], {
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: sentinelSecret,
    },
  })

  assert(doctor.schemaVersion === 1, 'doctor report schemaVersion must be 1')
  assert(doctor.mode?.skipNetwork === true, 'doctor report must be generated with skipNetwork=true')
  assert(doctor.summary?.error === 0, 'doctor report must not contain errors')
  assert(doctor.privacy?.includesApiKeys === false, 'doctor report must not include API keys')
  assert(doctor.privacy?.includesMessageContent === false, 'doctor report must not include message content')
  assert(doctor.privacy?.includesModelOutput === false, 'doctor report must not include model output')
  assert(doctor.privacy?.includesProviderSecrets === false, 'doctor report must not include provider secrets')
  assert(!JSON.stringify(doctor).includes(sentinelSecret), 'doctor report leaked a sentinel API key')

  console.log(`[verify:first-run] doctor summary: ${doctor.summary.ok} ok, ${doctor.summary.warn} warnings, ${doctor.summary.info} info`)

  run('focused first-run tests', process.execPath, [
    '--experimental-strip-types',
    '--test',
    'tests/connection-preflight.test.ts',
    'tests/connection-repair.test.ts',
    'tests/onboarding-guide-support.test.ts',
    'tests/companion-readiness.test.ts',
    'tests/startup-status-view.test.ts',
    'tests/storage-ui-state.test.ts',
    'tests/nexus-doctor-cli.test.ts',
    'tests/chat-runtime.test.ts',
  ])

  run('i18n audit', npmBin, ['run', 'i18n:audit'])

  console.log('\n[verify:first-run] First-run repair gate passed.')
} catch (error) {
  console.error(`\n[verify:first-run] ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
