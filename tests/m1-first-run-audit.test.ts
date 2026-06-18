import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { test } from 'node:test'
import { promisify } from 'node:util'

import {
  buildM1FirstRunAuditReport,
  M1_FIRST_RUN_AUDIT_GATE,
  M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE,
  parseM1FirstRunAuditArgs,
} from '../scripts/m1-first-run-audit.mjs'
import packageJson from '../package.json' with { type: 'json' }

const execFileAsync = promisify(execFile)

test('m1 first-run audit args support sample, input, output and readiness', () => {
  assert.deepEqual(parseM1FirstRunAuditArgs([
    '--sample',
    '--input',
    'ignored-when-sample.json',
    '--generated-at=2026-06-18T08:00:00Z',
    '--output',
    'artifacts/v1/m1-first-run-audit.json',
    '--require-ready',
  ]), {
    generatedAt: '2026-06-18T08:00:00Z',
    help: false,
    inputPath: 'ignored-when-sample.json',
    outputPath: 'artifacts/v1/m1-first-run-audit.json',
    requireReady: true,
    sample: true,
  })
})

test('m1 first-run sample report is ready and private-safe', () => {
  const report = buildM1FirstRunAuditReport(undefined, '2026-06-18T08:00:00Z')
  const json = JSON.stringify(report)

  assert.equal(report.gate, M1_FIRST_RUN_AUDIT_GATE)
  assert.equal(report.generatedAt, '2026-06-18T08:00:00.000Z')
  assert.equal(report.ok, true)
  assert.equal(report.overallStatus, 'ready')
  assert.equal(report.targetMilestone, 'M1')
  assert.equal(report.budget.withinFiveMinutes, true)
  assert.equal(report.budget.totalBudgetMinutes, 4)
  assert.equal(report.readiness.ok, true)
  assert.deepEqual(report.readiness.blockingItemIds, [])
  assert.deepEqual(report.readiness.warningItemIds, [])
  assert.equal(report.modelSetup.providerId, 'ollama')
  assert.equal(report.modelSetup.baseUrlPresent, true)
  assert.equal(report.modelSetup.modelPresent, true)
  assert.equal(report.modelSetup.apiKeyRequired, false)
  assert.equal(report.modelSetup.apiKeyPresent, false)
  assert.equal(report.modelSetup.apiKeySatisfied, true)
  assert.equal(report.modelSetup.connectionChecked, true)
  assert.deepEqual(report.modelSetup.repairActionIds, [])
  assert.equal(report.firstConversation.evidencePresent, true)
  assert.deepEqual(report.nextActions, [])
  assert.equal(report.privacy.artifactContentsCopied, false)
  assert.equal(json.includes('Release User'), false)
  assert.equal(json.includes('sample-token'), false)
  assert.equal(json.includes('http://localhost'), false)
  assert.equal(json.includes('127.0.0.1'), false)
  assert.equal(json.includes('qwen3:8b'), false)
})

test('m1 first-run audit reports model repair and first conversation gaps', () => {
  const report = buildM1FirstRunAuditReport({
    settings: {
      apiBaseUrl: '',
      apiKey: '',
      apiProviderId: 'openai',
      model: '',
    },
    budget: {
      firstConversationBudgetMinutes: 1,
      installBudgetMinutes: 3,
      modelSetupBudgetMinutes: 2,
    },
    modelSetup: {
      connectionChecked: false,
      providerReachable: false,
    },
    firstConversation: {
      attempted: false,
      succeeded: false,
    },
  }, '2026-06-18T08:00:00Z')

  assert.equal(report.ok, false)
  assert.equal(report.overallStatus, 'needs-first-run-work')
  assert.equal(report.budget.withinFiveMinutes, false)
  assert.equal(report.readiness.ok, false)
  assert.ok(report.readiness.blockingItemIds.includes('text_model'))
  assert.ok(report.modelSetup.blockedReasonIds.includes('missing-base-url'))
  assert.ok(report.modelSetup.blockedReasonIds.includes('missing-model'))
  assert.ok(report.modelSetup.blockedReasonIds.includes('missing-api-key'))
  assert.ok(report.modelSetup.blockedReasonIds.includes('connection-not-checked'))
  assert.ok(report.modelSetup.blockedReasonIds.includes('provider-unreachable'))
  assert.ok(report.modelSetup.repairActionIds.includes('set-text-provider-base-url'))
  assert.ok(report.modelSetup.repairActionIds.includes('select-text-model'))
  assert.ok(report.modelSetup.repairActionIds.includes('add-provider-api-key'))
  assert.ok(report.modelSetup.repairActionIds.includes('check-text-provider-connection'))
  assert.ok(report.modelSetup.repairActionIds.includes('check-remote-provider-status'))
  assert.ok(report.nextActions.includes('rerun-companion-readiness'))
  assert.ok(report.nextActions.includes('tighten-first-run-five-minute-budget'))
  assert.ok(report.nextActions.includes('run-first-conversation-smoke'))
})

test('m1 first-run audit reports local Ollama repair without leaking endpoints', () => {
  const report = buildM1FirstRunAuditReport({
    settings: {
      apiBaseUrl: 'http://localhost:11434/v1',
      apiProviderId: 'ollama',
      model: 'private-local-model',
    },
    budget: {
      firstConversationBudgetMinutes: 1,
      installBudgetMinutes: 1,
      modelSetupBudgetMinutes: 2,
    },
    modelSetup: {
      connectionChecked: true,
      modelAvailable: false,
      providerReachable: true,
    },
    firstConversation: {
      attempted: true,
      latencyMs: 1500,
      succeeded: false,
    },
  }, '2026-06-18T08:00:00Z')
  const json = JSON.stringify(report)

  assert.equal(report.ok, false)
  assert.equal(report.modelSetup.localProvider, true)
  assert.ok(report.modelSetup.repairActionIds.includes('pull-ollama-model'))
  assert.ok(report.nextActions.includes('retry-first-conversation-after-model-repair'))
  assert.equal(json.includes('http://localhost:11434/v1'), false)
  assert.equal(json.includes('private-local-model'), false)
})

test('m1 first-run audit derives model repair from text connection results', () => {
  const report = buildM1FirstRunAuditReport({
    settings: {
      apiBaseUrl: 'http://localhost:11434/v1',
      apiProviderId: 'ollama',
      model: 'private-local-model',
    },
    budget: {
      firstConversationBudgetMinutes: 1,
      installBudgetMinutes: 1,
      modelSetupBudgetMinutes: 2,
    },
    textConnectionResult: {
      checkedAt: '2026-06-18T08:00:05.000Z',
      message: 'Ollama connected but requested model is missing.',
      ok: false,
      status: 'model_missing',
    },
    firstConversation: {
      attempted: true,
      latencyMs: 1500,
      succeeded: false,
    },
  }, '2026-06-18T08:00:00Z')
  const json = JSON.stringify(report)

  assert.equal(report.ok, false)
  assert.equal(report.modelSetup.connectionChecked, true)
  assert.equal(report.modelSetup.providerReachable, true)
  assert.equal(report.modelSetup.modelAvailable, false)
  assert.ok(report.modelSetup.repairActionIds.includes('pull-ollama-model'))
  assert.equal(json.includes('http://localhost:11434/v1'), false)
  assert.equal(json.includes('private-local-model'), false)
})

test('m1 first-run audit can merge private-safe operator first conversation evidence', () => {
  const report = buildM1FirstRunAuditReport({
    settings: {
      apiBaseUrl: 'http://localhost:11434/v1',
      apiProviderId: 'ollama',
      model: 'private-local-model',
    },
    budget: {
      firstConversationBudgetMinutes: 1,
      installBudgetMinutes: 1,
      modelSetupBudgetMinutes: 2,
    },
    operatorEvidence: {
      gate: M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE,
      ok: true,
      modelSetup: {
        connectionChecked: true,
        modelAvailable: true,
        providerId: 'ollama',
        providerReachable: true,
      },
      firstConversation: {
        attempted: true,
        evidencePresent: true,
        latencyMs: 1600,
        latencyWithinBudget: true,
        succeeded: true,
      },
    },
  }, '2026-06-18T08:00:00Z')
  const json = JSON.stringify(report)

  assert.equal(report.ok, true)
  assert.equal(report.firstConversation.evidencePresent, true)
  assert.equal(report.firstConversation.latencyMs, 1600)
  assert.equal(report.modelSetup.connectionChecked, true)
  assert.equal(report.modelSetup.modelAvailable, true)
  assert.deepEqual(report.nextActions, [])
  assert.equal(json.includes('private-local-model'), false)
  assert.equal(json.includes('http://localhost:11434/v1'), false)
})

test('m1 first-run audit does not treat operator-only evidence as full runtime readiness', () => {
  const report = buildM1FirstRunAuditReport({
    gate: M1_FIRST_RUN_OPERATOR_EVIDENCE_GATE,
    ok: true,
    budget: {
      firstConversationBudgetMinutes: 1,
      installBudgetMinutes: 1,
      modelSetupBudgetMinutes: 2,
    },
    modelSetup: {
      connectionChecked: true,
      modelAvailable: true,
      providerId: 'ollama',
      providerReachable: true,
    },
    firstConversation: {
      attempted: true,
      evidencePresent: true,
      latencyMs: 1600,
      latencyWithinBudget: true,
      succeeded: true,
    },
  }, '2026-06-18T08:00:00Z')

  assert.equal(report.ok, false)
  assert.equal(report.firstConversation.evidencePresent, true)
  assert.ok(report.nextActions.includes('merge-operator-evidence-with-runtime-m1-report'))
})

test('m1 first-run audit CLI persists reports and enforces readiness', async () => {
  const directoryPath = await mkdtemp(path.join(os.tmpdir(), 'nexus-m1-first-run-'))
  const outputPath = path.join(directoryPath, 'm1-first-run-audit.json')
  const blockedInputPath = path.join(directoryPath, 'blocked-input.json')
  try {
    const { stdout } = await execFileAsync(process.execPath, [
      '--experimental-strip-types',
      'scripts/m1-first-run-audit.mjs',
      '--sample',
      '--generated-at',
      '2026-06-18T08:00:00Z',
      '--output',
      outputPath,
      '--require-ready',
    ], { cwd: process.cwd() })
    const stdoutReport = JSON.parse(stdout)
    const fileReport = JSON.parse(await readFile(outputPath, 'utf8'))

    assert.deepEqual(fileReport, stdoutReport)
    assert.equal(fileReport.ok, true)

    await writeFile(blockedInputPath, JSON.stringify({
      settings: {
        apiBaseUrl: '',
        apiProviderId: 'openai',
        model: '',
      },
      modelSetup: {
        connectionChecked: false,
      },
      firstConversation: {
        attempted: false,
        succeeded: false,
      },
    }), 'utf8')

    await assert.rejects(
      execFileAsync(process.execPath, [
        '--experimental-strip-types',
        'scripts/m1-first-run-audit.mjs',
        '--input',
        blockedInputPath,
        '--require-ready',
      ], { cwd: process.cwd() }),
      (error: unknown) => {
        const err = error as { code?: number; stdout?: string }
        assert.equal(err.code, 1)
        const report = JSON.parse(err.stdout ?? '{}')
        assert.equal(report.ok, false)
        assert.ok(report.nextActions.includes('run-first-conversation-smoke'))
        return true
      },
    )
  } finally {
    await rm(directoryPath, { recursive: true, force: true })
  }
})

test('m1 first-run audit package and docs wiring stays available', async () => {
  const scriptText = await readFile('scripts/m1-first-run-audit.mjs', 'utf8')
  const m1Doc = await readFile('docs/V1_M1_FIRST_RUN_SETUP.md', 'utf8')
  const milestoneDoc = await readFile('docs/V1_MILESTONES.md', 'utf8')
  const roadmap = await readFile('docs/ROADMAP.md', 'utf8')
  const changelog = await readFile('CHANGELOG.md', 'utf8')

  assert.equal(packageJson.scripts?.['m1:first-run:audit'], 'node --experimental-strip-types scripts/m1-first-run-audit.mjs')
  assert.equal(packageJson.scripts?.['m1:first-run:record'], 'node scripts/m1-first-run-record.mjs')
  assert.match(scriptText, /nexus-v1-m1-first-run-audit/)
  assert.match(changelog, /M1 first-run audit/)
  assert.match(m1Doc, /m1:first-run:audit/)
  assert.match(m1Doc, /m1:first-run:record/)
  assert.match(milestoneDoc, /V1_M1_FIRST_RUN_SETUP/)
  assert.match(roadmap, /m1:first-run:audit/)
})
