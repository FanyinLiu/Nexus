import assert from 'node:assert/strict'
import { readFile as readFileRaw } from 'node:fs/promises'
import test from 'node:test'

function readFile(path: URL, encoding: 'utf8') {
  return readFileRaw(path, encoding).then((source) => source.replace(/\r\n?/g, '\n'))
}

const voiceSectionPath = new URL('../src/features/settingsV3/VoiceSectionV3.tsx', import.meta.url)
const activeSectionPath = new URL('../src/components/SettingsDrawerActiveSection.tsx', import.meta.url)
const drawerPath = new URL('../src/components/SettingsDrawer.tsx', import.meta.url)
const drawerV2Path = new URL('../src/components/SettingsDrawerV2.tsx', import.meta.url)
const shellV2Path = new URL('../src/features/uiV2/SettingsShellV2.tsx', import.meta.url)
const overlaysPath = new URL('../src/app/controllers/useAppOverlays.ts', import.meta.url)

test('Settings Voice uses the runtime voice state and maps every action explicitly', async () => {
  const [voice, activeSection, overlays] = await Promise.all([
    readFile(voiceSectionPath, 'utf8'),
    readFile(activeSectionPath, 'utf8'),
    readFile(overlaysPath, 'utf8'),
  ])

  assert.match(voice, /voiceState: VoiceState/)
  assert.match(voice, /continuousVoiceActive: boolean/)
  assert.match(voice, /saveError: boolean/)
  assert.match(voice, /saving: boolean/)
  assert.match(voice, /voiceActionPending: boolean/)
  assert.match(activeSection, /voiceState=\{voiceState\}/)
  assert.match(activeSection, /continuousVoiceActive=\{continuousVoiceActive\}/)
  assert.match(activeSection, /saveError=\{saveError\}/)
  assert.match(activeSection, /saving=\{saving\}/)
  assert.match(activeSection, /voiceActionPending=\{voiceActionPending\}/)
  assert.match(overlays, /voiceState: voice\.voiceState/)
  assert.match(voice, /voiceState === 'idle'[\s\S]*?ui_v2\.start_voice/)
  assert.match(voice, /voiceState === 'listening'[\s\S]*?panel\.voice\.stop_listening/)
  assert.match(voice, /voiceState === 'processing'[\s\S]*?panel\.voice\.cancel_reply/)
  assert.match(voice, /panel\.voice\.interrupt_response/)
  assert.match(voice, /onStartVoiceConversation\(\)/)
  assert.match(voice, /onStopVoiceConversation\(\)/)
  assert.match(voice, /onCancelVoiceTurn\(\)/)
  assert.match(voice, /continuousVoiceActive[\s\S]*?panel\.voice\.stop_continuous/)
  const toolbar = voice.match(/<SettingsV3Toolbar>([\s\S]*?)<\/SettingsV3Toolbar>/)?.[1] ?? ''
  const runtimeButton = toolbar.match(/<button[\s\S]*?runtimeVoiceLabel[\s\S]*?<\/button>/)?.[0] ?? ''
  const runtimeButtonIndex = toolbar.indexOf('aria-label={runtimeVoiceLabel}')
  const smokeButtonIndex = toolbar.indexOf('onClick={onRunAudioSmokeTest}')
  assert.ok(runtimeButton, 'runtime voice action should be the first toolbar button')
  assert.ok(smokeButtonIndex >= 0, 'audio smoke action should remain in the same toolbar')
  assert.ok(runtimeButtonIndex >= 0 && runtimeButtonIndex < smokeButtonIndex)
  assert.doesNotMatch(runtimeButton, /PetControlIcon|<svg/)
  assert.doesNotMatch(voice, /import \{ PetControlIcon \}/)
  assert.match(voice, /role="status" aria-live="polite" aria-atomic="true"/)
  assert.match(voice, /tone="error" title=\{ti\('settings\.save_failed_fallback'\)\}/)
  assert.match(voice, /aria-busy=\{runtimeVoicePending \? 'true' : undefined\}/)
})

test('idle start is disabled only by draft input/platform readiness, not by dirty state', async () => {
  const voice = await readFile(voiceSectionPath, 'utf8')
  const disabledStart = voice.indexOf('const runtimeVoiceDisabled = ')
  const disabledEnd = voice.indexOf('\n  const handleRuntimeVoiceAction', disabledStart)
  const disabledExpression = voice.slice(disabledStart, disabledEnd >= 0 ? disabledEnd : undefined)
  assert.match(disabledExpression, /voiceState === 'idle'/)
  assert.match(disabledExpression, /draft\.speechInputEnabled/)
  assert.match(disabledExpression, /inputAvailable/)
  assert.match(disabledExpression, /!continuousVoiceActive/)
  assert.match(disabledExpression, /runtimeVoicePending/)
  assert.doesNotMatch(disabledExpression, /dirty/)

  const actionStart = voice.indexOf('const handleRuntimeVoiceAction = () => {')
  const actionEnd = voice.indexOf('\n\n  return (', actionStart)
  const action = voice.slice(actionStart, actionEnd >= 0 ? actionEnd : undefined)
  assert.match(action, /continuousVoiceActive[\s\S]*?onStopVoiceConversation\(\)/)
  assert.match(action, /voiceState === 'listening'[\s\S]*?onStopVoiceConversation\(\)/)
  assert.match(action, /voiceState === 'processing'[\s\S]*?onCancelVoiceTurn\(\)/)
  assert.match(action, /else \{[\s\S]*?onStopVoiceConversation\(\)/)
  assert.doesNotMatch(action, /dirty|inputAvailable|commitSettingsDraft/)
})

test('dirty idle start commits before close/focus restoration and rAF start, failing closed', async () => {
  const [drawer, overlays] = await Promise.all([
    readFile(drawerPath, 'utf8'),
    readFile(overlaysPath, 'utf8'),
  ])
  const startHandlerStart = drawer.indexOf('async function handleStartVoiceConversation() {')
  const startHandlerEnd = drawer.indexOf('\n\n  function handleOpenSettingsSection', startHandlerStart)
  const startHandler = drawer.slice(startHandlerStart, startHandlerEnd >= 0 ? startHandlerEnd : undefined)
  assert.match(drawer, /function commitDraft\(\): Promise<void>[\s\S]*?commitSettingsDraft\(/)
  assert.match(startHandler, /if \(isDirty\)[\s\S]*?await commitDraft\(\)/)
  assert.match(startHandler, /if \(voiceActionPendingRef\.current \|\| saveInFlightRef\.current\) return/)
  assert.match(startHandler, /voiceActionPendingRef\.current = true/)
  assert.match(startHandler, /finally \{[\s\S]*?voiceActionPendingRef\.current = false/)
  assert.match(startHandler, /else \{\s*onClose\(\)\s*\}/)
  assert.match(startHandler, /restoreSettingsOpenerFocus\(\(\) => \{[\s\S]*?requestAnimationFrame\(\(\) => onStartVoiceConversation\(\)\)/)
  assert.match(drawer, /const saveInFlightRef = useRef<Promise<void> \| null>\(null\)/)
  assert.match(drawer, /if \(saveInFlightRef\.current\) return saveInFlightRef\.current/)
  assert.match(drawer, /setSaving\(true\)/)
  assert.match(drawer, /setSaving\(false\)/)
  assert.match(drawer, /setSaveError\(true\)/)
  assert.match(drawer, /onKeyDown=\{handleSettingsDialogKeyDown\}/)
  const [drawerV2, shellV2] = await Promise.all([
    readFile(drawerV2Path, 'utf8'),
    readFile(shellV2Path, 'utf8'),
  ])
  assert.match(drawerV2, /onDialogKeyDown: KeyboardEventHandler<HTMLElement>/)
  assert.match(drawerV2, /saving=\{saving\}/)
  assert.match(drawerV2, /settings\.autonomy\.notifications\.saving/)
  assert.match(shellV2, /canDiscard = dirty && !saving/)
  assert.match(shellV2, /canSave = dirty && !saving/)
  assert.match(overlays, /await applySettingsSave\(nextSettings, \{[\s\S]*?closeSettings: true/)
  assert.match(overlays, /chat\.appendSystemMessage\([\s\S]*?throw error/)
})

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

test('voice start controller behavior is single-flight, fail-closed, and retryable', async () => {
  let pending = false
  let saveCalls = 0
  let closeCalls = 0
  let focusCalls = 0
  let startCalls = 0
  let saveFailure = true
  let deferred = createDeferred<void>()

  const start = async () => {
    if (pending) return
    pending = true
    saveCalls += 1
    try {
      await deferred.promise
      if (saveFailure) throw new Error('redacted fixture failure')
      closeCalls += 1
      focusCalls += 1
      startCalls += 1
    } finally {
      pending = false
    }
  }

  const first = start()
  const second = start()
  assert.equal(pending, true)
  assert.equal(saveCalls, 1)
  deferred.reject(new Error('fixture'))
  await assert.rejects(first)
  await second
  assert.equal(closeCalls, 0)
  assert.equal(focusCalls, 0)
  assert.equal(startCalls, 0)

  saveFailure = false
  deferred = createDeferred<void>()
  const retry = start()
  deferred.resolve()
  await retry
  assert.equal(saveCalls, 2)
  assert.equal(closeCalls, 1)
  assert.equal(focusCalls, 1)
  assert.equal(startCalls, 1)
})
