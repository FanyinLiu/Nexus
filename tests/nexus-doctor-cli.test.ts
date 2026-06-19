import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { test } from 'node:test'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

test('nexus doctor JSON report is parseable and does not leak API keys', async () => {
  const secret = 'sk-test-nexus-doctor-secret'
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/nexus-doctor.mjs',
    '--json',
    '--skip-network',
    '--provider',
    'mystery',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: secret,
    },
  })

  assert.equal(stdout.includes('Nexus Doctor'), false)
  assert.equal(stdout.includes(secret), false)

  const report = JSON.parse(stdout)
  assert.equal(report.schemaVersion, 1)
  assert.equal(report.mode.provider, 'auto')
  assert.equal(report.mode.skipNetwork, true)
  assert.equal(report.privacy.includesApiKeys, false)
  assert.equal(report.privacy.includesMessageContent, false)
  assert.equal(report.privacy.includesModelOutput, false)
  assert.equal(report.privacy.includesProviderSecrets, false)
  assert.ok(Array.isArray(report.checks))
  assert.ok(report.checks.some((check: { title?: string }) => check.title === '未知文本路径参数'))
  assert.ok(report.checks.some((check: { title?: string }) => check.title === 'DeepSeek 环境变量存在'))
})

test('nexus doctor default output remains human readable', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    'scripts/nexus-doctor.mjs',
    '--skip-network',
    '--provider',
    'deepseek',
  ], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DEEPSEEK_API_KEY: '',
    },
  })

  assert.match(stdout, /^Nexus Doctor/m)
  assert.match(stdout, /Nexus 预览服务检查已跳过/)
  assert.match(stdout, /Summary:/)
})
