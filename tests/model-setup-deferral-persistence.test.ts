import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { createModelSetupDeferralStore } from '../electron/services/modelSetupDeferralStore.js'
import { createModelSetupRequestGate } from '../electron/services/modelSetupRequestGate.js'

function openGate(file: string) {
  let focused = 0
  const store = createModelSetupDeferralStore({ getStorePath: () => file })
  const gate = createModelSetupRequestGate({
    deliver: () => { focused += 1 },
    loadDeferral: () => store.load(),
    saveDeferral: (state) => store.save(state),
  })
  return {
    gate,
    get focused() { return focused },
  }
}

test('a declined installer stays declined after the gate reloads from disk', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-model-setup-deferral-'))
  const file = join(dir, 'model-setup-deferral.json')
  try {
    const first = openGate(file)
    assert.equal(first.gate.request(), true)
    assert.equal(first.focused, 1, 'the panel is raised before the refusal')

    first.gate.decline()
    await first.gate.whenPersisted()

    const restarted = openGate(file)
    assert.equal(restarted.gate.isDeclined(), true)
    assert.equal(restarted.gate.isReminderOwed(), true, 'the reminder was not shown before the restart')
    assert.equal(restarted.gate.request(), false, 'the installer is not armed again')
    assert.equal(restarted.focused, 0, 'the chat panel is not focused again')
    assert.equal(restarted.gate.consume(), false)

    assert.equal(restarted.gate.claimReminder(), true, 'the restart still owes the one reminder')
    await restarted.gate.whenPersisted()

    const afterReminder = openGate(file)
    assert.equal(afterReminder.gate.claimReminder(), false, 'the reminder is shown once in total')
    assert.equal(afterReminder.gate.request(), false)
    assert.equal(afterReminder.focused, 0, 'a later voice action still does not focus the panel')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a decline that is not followed by the reminder still reminds once after restart', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-model-setup-deferral-'))
  const file = join(dir, 'model-setup-deferral.json')
  try {
    const first = openGate(file)
    first.gate.decline()
    await first.gate.whenPersisted()

    const restarted = openGate(file)
    assert.equal(restarted.gate.claimReminder(), true)
    assert.equal(restarted.gate.claimReminder(), false)
    await restarted.gate.whenPersisted()

    const again = openGate(file)
    assert.equal(again.gate.isDeclined(), true)
    assert.equal(again.gate.isReminderOwed(), false)
    assert.equal(again.gate.request(), false)
    assert.equal(again.focused, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an unreadable deferral file does not invent a refusal', () => {
  const dir = mkdtempSync(join(tmpdir(), 'nexus-model-setup-deferral-'))
  const file = join(dir, 'model-setup-deferral.json')
  try {
    writeFileSync(file, '{not json')
    const gate = openGate(file)
    assert.equal(gate.gate.isDeclined(), false)
    assert.equal(gate.gate.request(), true)
    assert.equal(gate.focused, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
