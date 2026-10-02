/**
 * Test-only launcher for the real Electron main process. The runner owns the
 * temporary profile; no renderer settings or onboarding state are seeded.
 * Permission prompts, optional downloads and sidecars are outside this smoke.
 */
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { EventEmitter } = require('node:events')
const https = require('node:https')
const { syncBuiltinESMExports } = require('node:module')
const { app, dialog, ipcMain, net, session, systemPreferences } = require('electron')

const profile = process.env.NEXUS_FIRST_USE_SMOKE_PROFILE
if (!profile || !fs.existsSync(path.join(profile, '.first-use-smoke-profile'))) {
  throw new Error('First-use smoke requires a runner-created isolated profile')
}
app.setPath('userData', profile)
app.setPath('sessionData', path.join(profile, 'session'))
const isolatedHome = path.join(profile, 'home')
fs.mkdirSync(isolatedHome, { recursive: true })
app.setPath('home', isolatedHome)
process.env.NEXUS_VAULT_USER_DATA_DIR = profile
process.env.NEXUS_PYTHON = path.join(profile, 'no-python-sidecar')
delete process.env.SMOKE_TEST
delete process.env.DESKTOP_PET_USE_DEV_SERVER

function isLoopback(value) {
  try {
    const hostname = new URL(typeof value === 'string' ? value : value.url).hostname
    return hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]'
  } catch {
    return false
  }
}

// Block external probes in both main-process fetch stacks. The provider and
// renderer still use real HTTP and the application's original IPC handlers.
const nativeFetch = globalThis.fetch
globalThis.fetch = (url, options) => {
  if (!isLoopback(url)) return Promise.reject(new Error('First-use smoke blocks external network'))
  return nativeFetch(url, options)
}
const electronFetch = net.fetch.bind(net)
net.fetch = (url, options) => {
  if (!isLoopback(url)) return Promise.reject(new Error('First-use smoke blocks external network'))
  return electronFetch(url, options)
}
https.get = () => {
  const request = new EventEmitter()
  request.destroy = () => request
  process.nextTick(() => request.emit('error', new Error('First-use smoke blocks optional HTTPS probes')))
  return request
}
syncBuiltinESMExports()
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    callback({ cancel: !isLoopback(details.url) })
  })
})

// These substitutes never grant or change an OS permission. They prevent a
// text-only fixture from asking the developer or CI desktop for microphone access.
systemPreferences.getMediaAccessStatus = () => 'not-determined'
systemPreferences.askForMediaAccess = async () => false
dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
dialog.showErrorBox = (title, message) => {
  console.error('[first-use-smoke] application error', title, message)
}

globalThis.__nexusFirstUseSmoke = { rejectNextVaultWrite: false, rejectedVaultWrites: 0 }
const registerHandler = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => registerHandler(channel, async (event, ...args) => {
  if ((channel === 'vault:store' || channel === 'vault:store-many')
    && globalThis.__nexusFirstUseSmoke.rejectNextVaultWrite) {
    globalThis.__nexusFirstUseSmoke.rejectNextVaultWrite = false
    globalThis.__nexusFirstUseSmoke.rejectedVaultWrites += 1
    throw new Error('NEXUS_SMOKE_SAVE_REJECTED')
  }
  return listener(event, ...args)
})

import(pathToFileURL(path.join(__dirname, '..', 'electron', 'main.js')).href).catch((error) => {
  console.error('[first-use-smoke] main import failed', error)
  app.exit(1)
})
