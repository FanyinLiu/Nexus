const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { app, BrowserWindow } = require('electron')

const ROOT = path.join(__dirname, '..')
const DIST_INDEX = path.join(ROOT, 'dist', 'index.html')
const OUTPUT_DIR = path.join(ROOT, 'output', 'core-path-smoke')
const TIMEOUT_MS = Number.parseInt(process.env.CORE_PATH_SMOKE_TIMEOUT_MS || '15000', 10)

if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.log('[core-path-smoke] skipped: no Linux display server is available')
  process.exit(0)
}

const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-core-path-smoke-'))
const preloadPath = path.join(userDataRoot, 'core-path-smoke-preload.cjs')
app.setPath('userData', userDataRoot)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')
app.commandLine.appendSwitch('disable-features', 'UseSkiaRenderer')

fs.writeFileSync(preloadPath, `
try {
  window.localStorage.setItem('nexus:onboarding', JSON.stringify({
    completedAt: '2026-06-23T00:00:00.000Z',
    firstConversationAt: '2026-06-23T00:02:00.000Z',
    firstConversationElapsedMs: 120000
  }))
  window.sessionStorage.setItem('nexus:startup-greeting-shown', '1')
  window.sessionStorage.setItem('nexus.modelSetup.dismissedUntilRestart', '1')
} catch (error) {
  console.error('[core-path-smoke-preload] failed to seed local state', error)
}
`)

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function cleanupTempUserData() {
  fs.rmSync(userDataRoot, { recursive: true, force: true })
}

async function snapshot(window) {
  return window.webContents.executeJavaScript(`
    (() => {
      const root = document.querySelector('.desktop-pet-root--panel')
      const panel = document.querySelector('.panel-window')
      const toolbar = document.querySelector('.companion-chat__toolbar')
      const settingsButton = document.querySelector('.panel-window__header-actions--hero .panel-window__icon-button')
      const composer = document.querySelector('.companion-chat__composer textarea')
      const sendButton = document.querySelector('.composer__actions .primary-button')
      const settingsDrawer = document.querySelector('.settings-drawer')
      const settingsHome = document.querySelector('.settings-home')
      const modelCard = document.querySelector('.settings-home-card[data-section="model"]')
      const modelPage = document.querySelector('.settings-page[data-section="model"]')
      const modelGrid = document.querySelector('.settings-model-source-grid')
      const selectedProvider = document.querySelector('.settings-model-source-card.is-selected')
      const modelDetail = document.querySelector('.settings-model-detail-card')
      const modelTestButton = document.querySelector('.settings-model-test-button')
      const modelFieldCount = document.querySelectorAll('.settings-model-detail-fields :is(input, select)').length
      const panelRect = panel?.getBoundingClientRect()
      return {
        hasRoot: Boolean(root),
        hasPanel: Boolean(panel),
        hasToolbar: Boolean(toolbar),
        hasSettingsButton: Boolean(settingsButton),
        hasComposer: Boolean(composer),
        hasSendButton: Boolean(sendButton),
        hasSettingsDrawer: Boolean(settingsDrawer),
        hasSettingsHome: Boolean(settingsHome),
        hasModelCard: Boolean(modelCard),
        hasModelPage: Boolean(modelPage),
        hasModelGrid: Boolean(modelGrid),
        hasSelectedProvider: Boolean(selectedProvider),
        hasModelDetail: Boolean(modelDetail),
        hasModelTestButton: Boolean(modelTestButton),
        modelFieldCount,
        hasOnboarding: Boolean(document.querySelector('.onboarding-backdrop, .onboarding-card')),
        hasModelSetup: Boolean(document.querySelector('.model-setup-backdrop, .model-setup-card')),
        hasErrorFallback: Boolean(document.querySelector('.app-error-fallback')),
        panelWidth: Math.round(panelRect?.width ?? 0),
        panelHeight: Math.round(panelRect?.height ?? 0),
        bodyText: document.body.innerText.slice(0, 300),
      }
    })()
  `)
}

async function waitFor(window, label, predicate) {
  const startedAt = Date.now()
  let last = null

  while (Date.now() - startedAt < TIMEOUT_MS) {
    last = await snapshot(window)
    if (last.hasErrorFallback) {
      throw new Error(`${label}: app rendered error fallback: ${last.bodyText}`)
    }
    if (last.hasOnboarding) {
      throw new Error(`${label}: onboarding blocked the core path: ${last.bodyText}`)
    }
    if (last.hasModelSetup) {
      throw new Error(`${label}: model setup overlay blocked the core path: ${last.bodyText}`)
    }
    if (predicate(last)) return last
    await wait(150)
  }

  throw new Error(`${label}: timed out after ${TIMEOUT_MS}ms: ${JSON.stringify(last)}`)
}

async function click(window, selector, label) {
  const clicked = await window.webContents.executeJavaScript(`
    (() => {
      const element = document.querySelector(${JSON.stringify(selector)})
      if (!element) return false
      element.click()
      return true
    })()
  `)
  if (!clicked) {
    const last = await snapshot(window)
    throw new Error(`${label}: missing selector ${selector}: ${JSON.stringify(last)}`)
  }
}

async function main() {
  if (!fs.existsSync(DIST_INDEX)) {
    throw new Error('dist/index.html is missing. Run `npm run build` before the core path smoke.')
  }

  await app.whenReady()
  fs.mkdirSync(OUTPUT_DIR, { recursive: true })

  const window = new BrowserWindow({
    width: 860,
    height: 780,
    show: false,
    backgroundColor: '#10131a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
      preload: preloadPath,
    },
  })

  const rendererWarnings = []
  window.webContents.on('console-message', (event) => {
    if ((event.level ?? 0) >= 2) rendererWarnings.push(event.message ?? '')
  })
  window.webContents.on('render-process-gone', (_event, details) => {
    rendererWarnings.push(`renderer-process-gone:${details.reason}`)
  })

  try {
    await window.loadFile(DIST_INDEX, { query: { view: 'panel' } })
    const panelReady = await waitFor(window, 'panel ready', (state) => (
      state.hasRoot
      && state.hasPanel
      && state.hasToolbar
      && state.hasSettingsButton
      && state.hasComposer
      && state.hasSendButton
      && state.panelWidth >= 420
      && state.panelHeight >= 500
    ))

    await click(window, '.panel-window__header-actions--hero .panel-window__icon-button', 'open settings')
    const settingsHome = await waitFor(window, 'settings home ready', (state) => (
      state.hasSettingsDrawer
      && state.hasSettingsHome
      && state.hasModelCard
    ))

    await click(window, '.settings-home-card[data-section="model"]', 'open model settings')
    const modelPage = await waitFor(window, 'model settings ready', (state) => (
      state.hasSettingsDrawer
      && state.hasModelPage
      && state.hasModelGrid
      && state.hasSelectedProvider
    ))

    await click(window, '.settings-model-source-card.is-selected', 'open selected provider detail')
    const modelDetail = await waitFor(window, 'model detail ready', (state) => (
      state.hasModelDetail
      && state.hasModelTestButton
      && state.modelFieldCount >= 2
    ))

    const report = {
      ok: true,
      panelReady,
      settingsHome,
      modelPage,
      modelDetail,
      rendererWarnings: rendererWarnings.slice(0, 12),
    }
    const reportPath = path.join(OUTPUT_DIR, 'core-path-smoke.json')
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2))

    console.log('[core-path-smoke] passed', JSON.stringify({
      panel: `${panelReady.panelWidth}x${panelReady.panelHeight}`,
      modelFieldCount: modelDetail.modelFieldCount,
      reportPath,
    }))
  } finally {
    window.destroy()
    cleanupTempUserData()
    app.quit()
  }
}

main().catch((error) => {
  console.error('[core-path-smoke] failed')
  console.error(error)
  try { cleanupTempUserData() } catch {}
  app.exit(1)
})
