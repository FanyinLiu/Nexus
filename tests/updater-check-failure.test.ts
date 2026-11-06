import assert from 'node:assert/strict'
import { register } from 'node:module'
import test from 'node:test'

import { app, autoUpdater } from './helpers/electron-main-stub-hooks.mjs'

register(new URL('./helpers/electron-main-stub-hooks.mjs', import.meta.url))

test('a missing channel manifest is reported as a failed check, not an up-to-date success', async (t) => {
  app.isPackaged = true
  process.env.NEXUS_MAC_AUTO_UPDATE_MODE = 'electron-updater'
  const originalCheckForUpdates = autoUpdater.checkForUpdates
  autoUpdater.checkForUpdates = async () => {
    throw new Error('Cannot find latest.yml in the latest release artifacts')
  }
  t.after(() => {
    autoUpdater.checkForUpdates = originalCheckForUpdates
    delete process.env.NEXUS_MAC_AUTO_UPDATE_MODE
  })

  const updater = await import('../electron/services/updaterService.js')
  const result = await updater.checkForUpdatesNow()

  assert.equal(result.ok, false)
  assert.equal(result.updateMode, 'auto-download')
  assert.match(result.reason, /Cannot find latest\.yml/)
})
