/**
 * Isolated UI fixture around the real Electron main/preload and settings route.
 * Download transport and accepted generation are deterministic substitutes;
 * cancel and small-image rejection still execute the production IPC handler.
 * No image is uploaded and no OS permission or model download is requested.
 */
const fs = require('node:fs')
const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { EventEmitter } = require('node:events')
const https = require('node:https')
const { syncBuiltinESMExports } = require('node:module')
const { app, dialog, ipcMain, net, session, systemPreferences } = require('electron')

const profile = process.env.NEXUS_PORTRAIT_FLOW_SMOKE_PROFILE
if (!profile || !fs.existsSync(path.join(profile, '.portrait-flow-smoke-profile'))) {
  throw new Error('Portrait smoke requires a runner-created isolated profile')
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
  } catch { return false }
}
const nativeFetch = globalThis.fetch
globalThis.fetch = (url, options) => isLoopback(url)
  ? nativeFetch(url, options) : Promise.reject(new Error('Portrait smoke blocks external network'))
const electronFetch = net.fetch.bind(net)
net.fetch = (url, options) => isLoopback(url)
  ? electronFetch(url, options) : Promise.reject(new Error('Portrait smoke blocks external network'))
https.get = () => {
  const request = new EventEmitter()
  request.destroy = () => request
  process.nextTick(() => request.emit('error', new Error('Portrait smoke blocks optional HTTPS probes')))
  return request
}
syncBuiltinESMExports()
app.whenReady().then(() => {
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (details, callback) => {
    callback({ cancel: !isLoopback(details.url) })
  })
  const current = session.defaultSession
  const setRequest = current.setPermissionRequestHandler.bind(current)
  const setCheck = current.setPermissionCheckHandler.bind(current)
  current.setPermissionRequestHandler = () => setRequest((_contents, _permission, callback) => callback(false))
  current.setPermissionCheckHandler = () => setCheck(() => false)
  current.setPermissionRequestHandler()
  current.setPermissionCheckHandler()
})
systemPreferences.getMediaAccessStatus = () => 'not-determined'
systemPreferences.askForMediaAccess = async () => false
dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false })
dialog.showErrorBox = (title, message) => console.error('[portrait-flow-smoke] application error', title, message)

const fixture = globalThis.__nexusPortraitFlowSmoke = {
  installed: false,
  statusCalls: 0,
  downloadCalls: 0,
  generateCalls: 0,
  nativeCancelCalls: 0,
  nativeRejectCalls: 0,
  rejectedReason: null,
  pickerMode: 'cancel',
  mockGeneration: false,
  releaseDownload: null,
  releaseGeneration: null,
  useRealPortraitHandlers: false,
  realResults: [],
}
dialog.showOpenDialog = async () => {
  if (fixture.pickerMode === 'real') return { canceled: false, filePaths: [path.join(profile, 'selected-input.png')] }
  if (fixture.pickerMode === 'small') return { canceled: false, filePaths: [path.join(profile, 'synthetic-small.png')] }
  return { canceled: true, filePaths: [] }
}

const registerHandler = ipcMain.handle.bind(ipcMain)
ipcMain.handle = (channel, listener) => registerHandler(channel, async (event, ...args) => {
  if (!['pet-model:portrait-models-status', 'pet-model:download-portrait-models', 'pet-model:generate-portrait-draft'].includes(channel)) {
    return listener(event, ...args)
  }
  // Fixture responses retain the same real sender/capability validation. No
  // renderer-provided path is accepted or injected into a generation payload.
  const { requireTrustedSender } = await import('../electron/ipc/validate.js')
  requireTrustedSender(event, channel)
  if (fixture.useRealPortraitHandlers) {
    const result = await listener(event, ...args)
    if (channel === 'pet-model:generate-portrait-draft') {
      fixture.generateCalls += 1
      const { accepted, reasonCode, stage, width, height, alphaSource, draftId } = result ?? {}
      fixture.realResults.push({ accepted, reasonCode, stage, width, height, alphaSource, draftId })
    }
    return result
  }
  if (channel === 'pet-model:portrait-models-status') {
    fixture.statusCalls += 1
    const { selectPortraitModels, describePortraitModel } = await import('../shared/portraitModels.js')
    return { releasePublished: true, models: selectPortraitModels().map((model) => ({
      ...describePortraitModel(model), installed: fixture.installed ? 'present' : 'missing',
    })) }
  }
  if (channel === 'pet-model:download-portrait-models') {
    fixture.downloadCalls += 1
    event.sender.send('pet-model:portrait-models-progress', { phase: 'downloading', receivedBytes: 25, totalBytes: 100 })
    const accepted = await new Promise((resolve) => { fixture.releaseDownload = resolve })
    fixture.releaseDownload = null
    if (!accepted) return { ok: false, code: 'network' }
    fixture.installed = true
    event.sender.send('pet-model:portrait-models-progress', { phase: 'done' })
    return { ok: true }
  }
  fixture.generateCalls += 1
  if (args[0] && Object.keys(args[0]).length) throw new Error('Portrait UI smoke expects native selection without a renderer path')
  if (fixture.mockGeneration) {
    await new Promise((resolve) => { fixture.releaseGeneration = resolve })
    fixture.releaseGeneration = null
    const png = fs.readFileSync(path.join(profile, 'synthetic-preview.png'))
    return { accepted: true, draftId: 'smoke-only-not-a-real-draft', width: 320, height: 384, alphaSource: 'mock',
      preview: { dataUrl: `data:image/png;base64,${png.toString('base64')}`, width: 320, height: 384 } }
  }
  const result = await listener(event, ...args)
  if (result === null) fixture.nativeCancelCalls += 1
  else if (result.accepted === false) {
    fixture.nativeRejectCalls += 1
    fixture.rejectedReason = result.reasonCode
  }
  return result
})

import(pathToFileURL(path.join(__dirname, '..', 'electron', 'main.js')).href).catch((error) => {
  console.error('[portrait-flow-smoke] main import failed', error)
  app.exit(1)
})
