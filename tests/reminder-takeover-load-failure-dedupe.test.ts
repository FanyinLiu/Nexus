import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { createRetiredPanelTakeover } from '../electron/retiredPanelTakeover.js'
import { createReminderDeliveryLedger } from '../electron/services/reminderDeliveryLedger.js'

async function flushMicrotasks() {
  for (let index = 0; index < 5; index += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve))
  }
}

test('a takeover panel load failure rebuilds on the next tick and the due reminder lands once', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'nexus-takeover-ledger-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  let now = 1_000_000
  const dueAt = now + 1_000
  const ledger = createReminderDeliveryLedger({
    getStorePath: () => path.join(dir, 'reminder-deliveries.json'),
    now: () => now,
  })
  let attempts = 0
  let panelExists = false
  let ready = 0
  let deliveries = 0
  let resolveFirst: ((win: unknown) => void) | null = null
  const panel = {}

  const deliverDue = async () => {
    if (!panelExists || now < dueAt) return
    if (await ledger.has('task-gap', dueAt)) return
    await ledger.record('task-gap', dueAt)
    deliveries += 1
  }

  const takeover = createRetiredPanelTakeover({
    getSnapshot: () => ({ petOnline: false }),
    hasPanelWindow: () => panelExists,
    createHiddenPanel: () => {
      attempts += 1
      if (attempts === 1) {
        return new Promise((resolve) => { resolveFirst = resolve })
      }
      panelExists = true
      return Promise.resolve(panel)
    },
    onHiddenPanelReady: () => {
      ready += 1
    },
    now: () => now,
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
  })

  try {
    takeover.start()
    assert.equal(attempts, 1)
    assert.equal(takeover.tick(), 'creating', 'the pending build is not duplicated')

    // The first renderer failed before it could load; the window is gone and
    // the takeover slot is empty while the due instant passes.
    resolveFirst?.(null)
    await flushMicrotasks()
    now = dueAt
    assert.equal(takeover.tick(), 'backoff', 'a failed build waits for its retry delay')
    now = 1_005_000
    assert.equal(takeover.tick(), 'created', 'the next allowed tick rebuilds instead of staying panel_present')
    await flushMicrotasks()

    assert.equal(ready, 1)
    await deliverDue()
    assert.equal(deliveries, 1, 'the reminder due during the gap is delivered once')
    await deliverDue()
    assert.equal(deliveries, 1, 'the main ledger rejects the duplicate delivery')
  } finally {
    takeover.stop()
    await ledger.flush()
  }
})
