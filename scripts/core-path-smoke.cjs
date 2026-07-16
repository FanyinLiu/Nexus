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
if (process.platform === 'linux') {
  app.commandLine.appendSwitch('no-sandbox')
  app.commandLine.appendSwitch('disable-setuid-sandbox')
}

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
  try {
    fs.rmSync(userDataRoot, {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 5 : 0,
      retryDelay: 100,
    })
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : 'unknown'
    console.warn('[core-path-smoke] temp cleanup skipped', { code })
  }
}

async function snapshot(window) {
  return window.webContents.executeJavaScript(`
    (() => {
      const v2Root = document.querySelector('.nexus-panel-v2')
      const v2Stage = document.querySelector('.nexus-panel-v2__stage')
      const v2Utility = document.querySelector('.nexus-panel-v2__utility[data-settings-opener="true"]')
      const v2Menu = document.querySelector('.nexus-panel-v2__menu')
      const v2MenuButtons = document.querySelectorAll('.nexus-panel-v2__menu button')
      const chatSheet = document.querySelector('.chat-sheet-v2')
      const chatInput = document.querySelector('.chat-sheet-v2__input')
      const chatSend = document.querySelector('.chat-sheet-v2__send')
      const chatBack = document.querySelector('.chat-sheet-v2__back')
      const root = document.querySelector('.desktop-pet-root--panel')
      const panel = document.querySelector('.panel-window')
      const toolbar = document.querySelector('.companion-chat__toolbar')
      const settingsButton = document.querySelector('.panel-window__header-actions--hero .panel-window__icon-button')
      const composer = document.querySelector('.companion-chat__composer textarea')
      const sendButton = document.querySelector('.composer__actions .primary-button')
      const settingsDrawer = document.querySelector('.settings-drawer')
      const settingsV2 = document.querySelector('.settings-v2')
      const settingsV2Home = document.querySelector('.settings-v2__home')
      const settingsV2HomeCards = Array.from(document.querySelectorAll('.settings-v2__home-card'))
      const settingsV2LastHomeCard = settingsV2HomeCards[settingsV2HomeCards.length - 1]
      const settingsHome = document.querySelector('.settings-home')
      const modelCard = document.querySelector('.settings-home-card[data-section="model"]')
      const modelPage = document.querySelector('.settings-page[data-section="model"]')
      const isVisible = (element) => {
        if (!element) return false
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0
      }
      const activeModelSection = document.querySelector('.settings-model-section.is-active')
      const modelGrid = Array.from(document.querySelectorAll('.settings-model-source-grid'))
        .find((element) => isVisible(element))
      const selectedProvider = Array.from(document.querySelectorAll('.settings-model-source-card.is-selected'))
        .find((element) => isVisible(element) && !element.disabled)
      const modelDetail = Array.from(document.querySelectorAll('.settings-model-detail-card'))
        .find((element) => isVisible(element))
      const modelTestButton = Array.from(document.querySelectorAll('.settings-model-test-button'))
        .find((element) => isVisible(element) && !element.disabled)
      const modelFieldCount = Array.from(document.querySelectorAll('.settings-model-detail-fields :is(input, select)'))
        .filter((element) => isVisible(element)).length
      const modelV3Page = document.querySelector('.settings-v3-page')
      const modelV3Fields = modelV3Page
        ? Array.from(modelV3Page.querySelectorAll('select.settings-v3-action, input, textarea'))
          .filter((element) => isVisible(element) && !element.disabled)
        : []
      const modelV3TestButton = modelV3Page
        ? Array.from(modelV3Page.querySelectorAll('.settings-v3-toolbar button'))
          .find((element) => isVisible(element) && !element.disabled)
        : null
      const hasV3ModelContent = Boolean(isVisible(modelV3Page) && modelV3Fields.length >= 2)
      const settingsV2Destination = settingsV2?.getAttribute('data-settings-v2-destination') ?? null
      const hasV2ModelContent = Boolean(
        settingsV2Destination === 'advanced'
        && (isVisible(activeModelSection) || modelGrid || modelDetail || hasV3ModelContent),
      )
      const panelSurface = v2Root ? 'v2' : (root || panel ? 'legacy' : 'unknown')
      const panelRect = (v2Root || panel)?.getBoundingClientRect()
      return {
        panelSurface,
        hasV2Root: Boolean(v2Root),
        hasV2Stage: Boolean(v2Stage),
        hasV2Utility: Boolean(v2Utility),
        hasV2Menu: Boolean(v2Menu),
        v2MenuButtonCount: v2MenuButtons.length,
        chatEntry: {
          hasSheet: Boolean(chatSheet),
          hasInput: Boolean(chatInput),
          hasSend: Boolean(chatSend),
          hasBack: Boolean(chatBack),
        },
        hasRoot: Boolean(root),
        hasPanel: Boolean(panel),
        hasToolbar: Boolean(toolbar),
        hasSettingsButton: Boolean(settingsButton),
        hasComposer: Boolean(composer),
        hasSendButton: Boolean(sendButton),
        hasSettingsDrawer: Boolean(settingsDrawer),
        hasSettingsV2: Boolean(settingsV2),
        hasSettingsV2Home: Boolean(settingsV2Home),
        hasSettingsV2AdvancedCard: Boolean(settingsV2Home && settingsV2LastHomeCard),
        settingsV2HomeCardCount: settingsV2HomeCards.length,
        settingsV2Destination,
        hasV2ModelContent,
        hasSettingsHome: Boolean(settingsHome),
        hasModelCard: Boolean(modelCard),
        hasModelPage: Boolean(modelPage || hasV2ModelContent),
        hasModelGrid: Boolean(modelGrid),
        hasSelectedProvider: Boolean(selectedProvider),
        hasModelDetail: Boolean(modelDetail),
        hasModelTestButton: Boolean(modelTestButton || modelV3TestButton),
        hasV3ModelContent,
        hasV3ModelTestButton: Boolean(modelV3TestButton),
        v3ModelFieldCount: modelV3Fields.length,
        modelFieldCount: Math.max(modelFieldCount, modelV3Fields.length),
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

function isV2PanelReady(state) {
  return state.panelSurface === 'v2'
    ? state.hasV2Root
      && state.hasV2Stage
      && state.hasV2Utility
      && state.panelWidth >= 240
      && state.panelHeight >= 500
    : state.hasRoot
      && state.hasPanel
      && state.hasToolbar
      && state.hasSettingsButton
      && state.hasComposer
      && state.hasSendButton
      && state.panelWidth >= 240
      && state.panelHeight >= 500
}

function isSettingsEntryReady(state) {
  const v2Ready = state.hasSettingsV2
    && (
      (state.hasSettingsV2Home && state.hasSettingsV2AdvancedCard)
      || (state.settingsV2Destination === 'advanced' && state.hasV2ModelContent)
    )
  const legacyReady = state.hasSettingsHome && state.hasModelCard
    || state.hasModelPage && !state.hasSettingsV2
  return state.hasSettingsDrawer && (v2Ready || legacyReady)
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
    const panelReady = await waitFor(window, 'panel ready', isV2PanelReady)
    let chatEntry = null
    let settingsPath = 'legacy-settings-button'

    if (panelReady.panelSurface === 'v2') {
      await click(window, '.nexus-panel-v2__utility[data-settings-opener="true"]', 'open V2 utility menu')
      await waitFor(window, 'V2 utility menu ready', (state) => (
        state.hasV2Menu && state.v2MenuButtonCount >= 2
      ))
      await click(window, '.nexus-panel-v2__menu button:first-of-type', 'open V2 text chat')
      chatEntry = await waitFor(window, 'V2 chat sheet ready', (state) => (
        state.chatEntry.hasSheet
        && state.chatEntry.hasInput
        && state.chatEntry.hasSend
        && state.chatEntry.hasBack
      ))
      await click(window, '.chat-sheet-v2__back', 'return from V2 text chat')
      await waitFor(window, 'V2 companion surface restored', (state) => (
        state.hasV2Root && state.hasV2Utility && !state.chatEntry.hasSheet
      ))
      await click(window, '.nexus-panel-v2__utility[data-settings-opener="true"]', 'reopen V2 utility menu')
      await waitFor(window, 'V2 settings menu ready', (state) => (
        state.hasV2Menu && state.v2MenuButtonCount >= 2
      ))
      await click(window, '.nexus-panel-v2__menu button:nth-of-type(2)', 'open V2 settings')
      settingsPath = 'v2-menu-settings-button'
    } else {
      await click(window, '.panel-window__header-actions--hero .panel-window__icon-button', 'open legacy settings')
    }

    const settingsEntry = await waitFor(window, 'settings entry ready', isSettingsEntryReady)
    const settingsSurface = settingsEntry.hasSettingsV2 ? 'v2' : 'legacy'

    if (settingsSurface === 'v2' && settingsEntry.hasSettingsV2Home) {
      await click(window, '.settings-v2__home-card:last-of-type', 'open V2 advanced settings')
    } else if (settingsSurface === 'legacy' && !settingsEntry.hasModelPage) {
      await click(window, '.settings-home-card[data-section="model"]', 'open legacy model settings')
    }

    const modelPage = await waitFor(window, 'model settings ready', (state) => (
      state.hasSettingsDrawer
      && state.hasModelPage
      && (state.settingsV2Destination !== 'home' || !state.hasSettingsV2)
      && (
        (state.hasModelGrid && state.hasSelectedProvider)
        || (state.hasModelDetail && state.hasModelTestButton)
        || (state.hasV3ModelContent && state.hasV3ModelTestButton && state.v3ModelFieldCount >= 2)
      )
    ))

    if (!modelPage.hasModelDetail && !modelPage.hasV3ModelTestButton) {
      await click(window, '.settings-model-source-card.is-selected', 'open selected provider detail')
    }

    const modelDetail = await waitFor(window, 'model detail ready', (state) => (
      (state.hasModelDetail && state.hasModelTestButton && state.modelFieldCount >= 2)
      || (state.hasV3ModelContent && state.hasV3ModelTestButton && state.v3ModelFieldCount >= 2)
    ))

    const report = {
      ok: true,
      panelReady,
      panelSurface: panelReady.panelSurface,
      chatEntry,
      settingsPath,
      settingsSurface,
      settingsEntry,
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
