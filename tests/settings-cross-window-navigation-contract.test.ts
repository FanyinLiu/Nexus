import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createSettingsReturnFocusCoordinator } from '../electron/settingsReturnFocus.js'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

function sliceBetween(source: string, startMarker: string, endMarker: string) {
  const start = source.indexOf(startMarker)
  const end = source.indexOf(endMarker, start + startMarker.length)
  assert.ok(start >= 0, `missing source marker: ${startMarker}`)
  assert.ok(end > start, `missing source end marker: ${endMarker}`)
  return source.slice(start, end)
}

function createFocusCoordinatorHarness() {
  let mainAlive = true
  const calls = {
    show: 0,
    focus: 0,
    moveTop: 0,
    send: 0,
  }

  return {
    calls,
    setMainAlive(value: boolean) {
      mainAlive = value
    },
    coordinator: createSettingsReturnFocusCoordinator(() => {
      if (!mainAlive) return
      calls.show += 1
      calls.focus += 1
      calls.moveTop += 1
      calls.send += 1
    }),
  }
}

test('production settings return coordinator consumes every return event exactly once', () => {
  const visible = createFocusCoordinatorHarness()
  visible.coordinator.request()
  visible.coordinator.request()
  assert.equal(visible.coordinator.isPending(), true)
  assert.equal(visible.coordinator.consume(), true, 'visible panel hide consumes the pending return')
  assert.deepEqual(visible.calls, { show: 1, focus: 1, moveTop: 1, send: 1 })
  assert.equal(visible.coordinator.consume(), false, 'late closed event cannot focus twice')
  assert.deepEqual(visible.calls, { show: 1, focus: 1, moveTop: 1, send: 1 })

  const closedOnly = createFocusCoordinatorHarness()
  closedOnly.coordinator.request()
  assert.equal(closedOnly.coordinator.consume(), true)
  assert.deepEqual(closedOnly.calls, { show: 1, focus: 1, moveTop: 1, send: 1 })

  const hiddenPanel = createFocusCoordinatorHarness()
  hiddenPanel.coordinator.request()
  assert.equal(hiddenPanel.coordinator.consume(), true, 'hidden panel consumes directly')
  assert.deepEqual(hiddenPanel.calls, { show: 1, focus: 1, moveTop: 1, send: 1 })

  const destroyedPanel = createFocusCoordinatorHarness()
  destroyedPanel.setMainAlive(false)
  destroyedPanel.coordinator.request()
  assert.equal(destroyedPanel.coordinator.consume(), true, 'destroyed Pet still consumes stale pending')
  assert.deepEqual(destroyedPanel.calls, { show: 0, focus: 0, moveTop: 0, send: 0 })
  destroyedPanel.setMainAlive(true)
  assert.equal(destroyedPanel.coordinator.consume(), false, 'a new Pet cannot be focused by an old event')

  const panelOrigin = createFocusCoordinatorHarness()
  panelOrigin.coordinator.request()
  panelOrigin.coordinator.cancel()
  assert.equal(panelOrigin.coordinator.consume(), false, 'Panel-origin close cancels Pet return')
  assert.deepEqual(panelOrigin.calls, { show: 0, focus: 0, moveTop: 0, send: 0 })
  assert.equal(panelOrigin.coordinator.consume(), false, 'closePanel and late events remain inert')

  let callbackCalls = 0
  const throwing = createSettingsReturnFocusCoordinator(() => {
    callbackCalls += 1
    throw new Error('focus callback failed')
  })
  throwing.request()
  assert.throws(() => throwing.consume(), /focus callback failed/)
  assert.equal(callbackCalls, 1)
  assert.equal(throwing.isPending(), false, 'callback failure must not restore pending')
  assert.equal(throwing.consume(), false)
})

test('settings IPC derives Pet origin and closes through the main-process return policy', async () => {
  const [ipc, manager, schemas] = await Promise.all([
    read('electron/ipc/windowIpc.js'),
    read('electron/windowManager.js'),
    read('electron/ipc/windowPayloadSchemas.js'),
  ])
  const coordinatorSource = await read('electron/settingsReturnFocus.js')

  assert.match(coordinatorSource, /pending = false[\s\S]*onConsume\(\)/)
  assert.match(coordinatorSource, /request\(\)[\s\S]*cancel\(\)[\s\S]*isPending\(\)[\s\S]*consume\(\)/)
  assert.match(coordinatorSource, /if \(!pending\) return false/)
  assert.match(manager, /createSettingsReturnFocusCoordinator/)

  const openPanelHandler = sliceBetween(ipc, "ipcMain.handle('window:open-panel'", "ipcMain.handle('window:get-panel-section'")
  assert.ok(openPanelHandler.includes('section = validateOpenPanelPayload(section)'))
  assert.ok(openPanelHandler.includes('const sourceView = getViewKind(event)'))
  assert.ok(openPanelHandler.includes("section === 'settings' && sourceView === 'pet' ? 'pet' : 'panel'"))
  assert.ok(openPanelHandler.includes('showPanelWindow(section, { settingsReturnTarget })'))
  assert.ok(schemas.includes('const panelSectionSchema = {'))
  assert.ok(schemas.includes("values: ['chat', 'chat-text', 'chat-recent', 'settings']"))
  assert.match(ipc, /validateOpenPanelPayload/)

  const showPanel = sliceBetween(manager, 'export function showPanelWindow', 'export function closeSettingsWindow')
  assert.ok(showPanel.includes("settingsReturnTarget = options?.settingsReturnTarget === 'pet' ? 'pet' : 'panel'"))
  assert.match(showPanel, /settingsReturnTarget = null/)
  assert.match(showPanel, /settingsReturnFocus\.cancel\(\)/)
  assert.doesNotMatch(showPanel, /petSettingsReturnPending/)

  const closeSettings = sliceBetween(manager, 'export function closeSettingsWindow', 'export function closePanelWindow')
  assert.match(closeSettings, /settingsReturnTarget = null/)
  assert.match(closeSettings, /setPanelSection\('chat'\)/)
  const panelReturn = closeSettings.match(/if \(returnTarget !== 'pet'\) \{[\s\S]*?\n\s*\}/)?.[0]
  assert.ok(panelReturn, 'panel-origin settings close branch should be explicit')
  assert.match(panelReturn, /settingsReturnFocus\.cancel\(\)/)
  assert.match(panelReturn, /emitPanelSection\(\)/)
  assert.doesNotMatch(panelReturn, /panelWindow\.hide|settingsReturnFocus\.consume/)
  const petReturn = closeSettings.slice(closeSettings.indexOf('settingsReturnFocus.request()'))
  assert.match(petReturn, /settingsReturnFocus\.request\(\)/)
  assert.match(petReturn, /panelWindow\.hide\(\)/)
  const directPetReturn = petReturn.slice(0, petReturn.indexOf('panelWindow.hide'))
  assert.match(directPetReturn, /settingsReturnFocus\.consume\(\)/)

  const panelManager = manager.slice(manager.indexOf('export function createPanelWindow'))
  const hideHandler = sliceBetween(panelManager, "win.on('hide', () => {", "win.on('close', (event) => {")
  const hidePendingStart = hideHandler.indexOf('if (settingsReturnFocus.isPending())')
  assert.ok(hidePendingStart >= 0, 'hide handler should consume the production coordinator')
  assert.doesNotMatch(hideHandler.slice(0, hidePendingStart), /if \(mainWindow && !mainWindow\.isDestroyed\(\)/)
  assert.match(hideHandler.slice(hidePendingStart), /settingsReturnFocus\.consume\(\)/)
  assert.match(hideHandler, /if \(mainWindow && !mainWindow\.isDestroyed\(\) && petHiddenForPanel\) \{[\s\S]*mainWindow\.showInactive\(\)/)

  const focusReturnStart = manager.indexOf('const settingsReturnFocus = createSettingsReturnFocusCoordinator(() => {')
  const focusReturnEnd = manager.indexOf('\n})', focusReturnStart)
  assert.ok(focusReturnEnd > focusReturnStart, 'production focus callback should be present')
  const focusReturn = manager.slice(focusReturnStart, focusReturnEnd)
  assert.match(focusReturn, /if \(!mainWindow \|\| mainWindow\.isDestroyed\(\)\) return/)
  assert.equal(focusReturn.match(/mainWindow\.show\(\)/g)?.length, 1)
  assert.equal(focusReturn.match(/mainWindow\.focus\(\)/g)?.length, 1)
  assert.equal(focusReturn.match(/mainWindow\.moveTop\(\)/g)?.length, 1)
  assert.equal(focusReturn.match(/mainWindow\.webContents\.send\('settings:return-focus'\)/g)?.length, 1)

  const closedHandler = sliceBetween(panelManager, "win.on('closed', () => {", "win.on('blur', () => {")
  const closedPendingStart = closedHandler.indexOf('if (settingsReturnFocus.isPending())')
  assert.ok(closedPendingStart >= 0, 'closed handler should consume the production coordinator')
  assert.doesNotMatch(closedHandler.slice(0, closedPendingStart), /mainWindow && !mainWindow\.isDestroyed\(\)/)
  assert.match(closedHandler.slice(closedPendingStart), /settingsReturnFocus\.consume\(\)/)
  assert.match(closedHandler, /else if \(mainWindow && !mainWindow\.isDestroyed\(\) && petHiddenForPanel\) \{[\s\S]*mainWindow\.showInactive\(\)/)

  const closePanel = sliceBetween(manager, 'export function closePanelWindow', 'export function showPetContextMenu')
  assert.match(closePanel, /settingsReturnFocus\.cancel\(\)/)
  assert.match(closePanel, /panelWindow\?\.hide\(\)/)
  assert.doesNotMatch(closePanel, /settingsReturnFocus\.consume|settings:return-focus/)
})

test('settings-to-onboarding switches the local modal while keeping the Panel open', async () => {
  const [overlays, bridge, app] = await Promise.all([
    read('src/app/controllers/useAppOverlays.ts'),
    read('src/app/controllers/useDesktopBridge.ts'),
    read('src/app/App.tsx'),
  ])

  const closeSettingsSurface = overlays.match(/const closeSettingsSurface = useCallback\(\(\) => \{[\s\S]*?\n\s*\}, \[setSettingsOpen, view\]\)/)?.[0]
  assert.ok(closeSettingsSurface, 'normal settings close should be present')
  assert.match(closeSettingsSurface, /setSettingsOpen\(false\)/)
  assert.match(closeSettingsSurface, /window\.desktopPet\?\.closeSettings/)

  const onboardingSwitch = overlays.match(/const closeSettingsDrawerForOnboarding = useCallback\(\(\) => \{[\s\S]*?\n\s*\}, \[setSettingsOpen, view\]\)/)?.[0]
  assert.ok(onboardingSwitch, 'settings-to-onboarding switch should be separate from normal close')
  assert.match(onboardingSwitch, /setSettingsOpen\(false\)/)
  assert.match(onboardingSwitch, /openPanel\('chat'\)/)
  assert.doesNotMatch(onboardingSwitch, /desktopPet\?\.closeSettings/)

  const openOnboarding = overlays.match(/const openOnboardingGuide = useCallback\(\(\) => \{[\s\S]*?\n\s*\}, \[closeSettingsDrawerForOnboarding\]\)/)?.[0]
  assert.ok(openOnboarding, 'onboarding opener should use the modal switch')
  assert.match(openOnboarding, /closeSettingsDrawerForOnboarding\(\)/)
  assert.match(openOnboarding, /setOnboardingOpen\(true\)/)
  assert.doesNotMatch(openOnboarding, /closeSettingsSurface\(\)/)

  const focusListenerStart = bridge.indexOf('subscribeSettingsReturnFocus')
  assert.ok(focusListenerStart >= 0, 'Pet focus-return subscription should exist')
  const focusEffectStart = bridge.lastIndexOf('useEffect(', focusListenerStart)
  const focusEffectEnd = bridge.indexOf('\n  useEffect(', focusListenerStart + 1)
  const focusEffect = bridge.slice(focusEffectStart, focusEffectEnd)
  assert.match(focusEffect, /if \(view !== 'pet'\)/)
  assert.match(focusEffect, /window\.requestAnimationFrame\(/)
  assert.match(focusEffect, /querySelector<HTMLElement>\('\[data-settings-opener="true"\]'\)/)
  assert.match(focusEffect, /return \(\) => unsubscribe\?\.\(\)/)

  const modelOverlays = [...app.matchAll(/<ModelSetupOverlay[\s\S]*?\/>/g)].map((match) => match[0])
  assert.equal(modelOverlays.length, 2, 'App should keep one model overlay per window route')
  assert.match(modelOverlays[0], /suppressed/)
  assert.match(modelOverlays[1], /suppressed=\{competingModalOpen\}/)
})

test('preload and renderer types expose optional close/focus-return compatibility hooks', async () => {
  const [preload, types] = await Promise.all([
    read('electron/preload.js'),
    read('src/vite-env.d.ts'),
  ])

  assert.match(preload, /closeSettings: \(\) => ipcRenderer\.invoke\('window:close-settings'\)/)
  const focusBridge = sliceBetween(preload, 'subscribeSettingsReturnFocus:', 'subscribePanelWindowState:')
  assert.match(focusBridge, /ipcRenderer\.on\('settings:return-focus'/)
  assert.match(focusBridge, /ipcRenderer\.removeListener\('settings:return-focus'/)
  assert.match(types, /closeSettings\?: \(\) => Promise<void>/)
  assert.match(types, /subscribeSettingsReturnFocus\?: \(listener: \(\) => void\) => \(\) => void/)
})

test('Pet context-menu settings explicitly returns to Pet while app and tray settings remain Panel-origin', async () => {
  const manager = await read('electron/windowManager.js')
  const petMenu = sliceBetween(manager, 'export function showPetContextMenu', 'export function createApplicationMenu')
  assert.match(petMenu, /showPanelWindow\('settings', \{ settingsReturnTarget: 'pet' \}\)/)

  const applicationMenu = sliceBetween(manager, 'export function createApplicationMenu', 'export function createTray')
  const tray = manager.slice(manager.indexOf('export function createTray'))
  assert.match(applicationMenu, /showPanelWindow\('settings'\)/)
  assert.match(tray, /showPanelWindow\('settings'\)/)
  assert.doesNotMatch(applicationMenu, /settingsReturnTarget: 'pet'/)
  assert.doesNotMatch(tray, /settingsReturnTarget: 'pet'/)
})
