import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { buildOpenSourceUiReferenceAuditReport } from '../scripts/open-source-ui-reference-audit.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('open-source UI reference refresh check is opt-in only', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT)

  assert.equal(report.summary.ok, true)
  assert.equal(report.referenceRefreshCheck, null)
})

test('open-source UI reference audit builds manual reference refresh checks when requested', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    referenceRefreshCheck: true,
    referenceRefreshDate: '2026-06-29',
    referenceRefreshResolver: (reference) => ({
      ok: true,
      branch: reference.observedHead.branch,
      commit: reference.id === 'chatbox'
        ? '1111111111111111111111111111111111111111'
        : reference.observedHead.commit,
    }),
  })

  assert.equal(report.summary.ok, true)
  assert.equal(report.referenceRefreshCheck?.checkedAt, '2026-06-29')
  assert.equal(report.referenceRefreshCheck?.manualOnly, true)
  assert.equal(report.referenceRefreshCheck?.liveNetwork, true)
  assert.equal(report.referenceRefreshCheck?.changedCount, 1)
  assert.equal(report.referenceRefreshCheck?.failedCount, 0)
  assert.equal(report.referenceRefreshCheck?.items.find((item) => item.id === 'chatbox')?.status, 'changed')
  assert.equal(report.errors.referenceRefreshIssues.length, 0)
})

test('open-source UI reference audit reports explicit reference refresh failures', () => {
  const report = buildOpenSourceUiReferenceAuditReport(ROOT, {
    referenceRefreshCheck: true,
    referenceRefreshDate: '2026-06-29',
    referenceRefreshResolver: (reference) => reference.id === 'open-webui'
      ? { ok: false, error: 'network unavailable' }
      : {
        ok: true,
        branch: reference.observedHead.branch,
        commit: reference.observedHead.commit,
      },
  })

  assert.equal(report.summary.ok, false)
  assert.equal(report.referenceRefreshCheck?.failedCount, 1)
  assert.equal(report.referenceRefreshCheck?.items.find((item) => item.id === 'open-webui')?.status, 'failed')
  assert.ok(report.errors.referenceRefreshIssues.some((item) => item.reference === 'Open WebUI'))
})
