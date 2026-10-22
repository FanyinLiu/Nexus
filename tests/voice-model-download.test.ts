import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import React from 'react'

import {
  countLocalModelsStillNeeded,
  missingVoiceModelIds,
  voiceModelDownloadPayload,
  voiceSettingsStatusKey,
  buildLocalModelRows,
} from '../src/features/setup/localModelRepair.ts'
import {
  selectMissingVoiceModelIds,
  speechModelIdForProvider,
} from '../shared/voiceModelDownloads.js'
import { ensureLocaleLoaded } from '../src/i18n/runtime.ts'
import { voiceStartClick } from '../src/features/voiceProfile/voiceReady.ts'
import type { AppSettings, PlatformProfile } from '../src/types/index.ts'

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { LocalVoiceModelsPanel } = await import('../src/features/settingsV3/LocalVoiceModelsPanel.tsx')
const { VoiceSectionV3 } = await import('../src/features/settingsV3/VoiceSectionV3.tsx')

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = {
  deps?: readonly unknown[]
  cleanup?: () => void
  callback?: () => void | (() => void)
  run?: boolean
}

function createRenderer<P>(component: (props: P) => unknown) {
  const slots: unknown[] = []
  const effects: EffectSlot[] = []
  let cursor = 0
  let props: P
  let tree: unknown
  let commit = false
  let rerender = false
  let depth = 0

  const dispatcher = {
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) {
        slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      }
      const setState = (value: unknown) => {
        const next = typeof value === 'function'
          ? (value as (prev: unknown) => unknown)(slots[index])
          : value
        if (Object.is(next, slots[index])) return
        slots[index] = next
        if (commit) rerender = true
      }
      return [slots[index], setState]
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback(fn: unknown) {
      cursor += 1
      return fn
    },
    useMemo(fn: () => unknown) {
      cursor += 1
      return fn()
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++
      const prev = effects[index]
      const changed = !prev
        || deps === undefined
        || prev.deps === undefined
        || deps.length !== prev.deps.length
        || deps.some((dep, i) => !Object.is(dep, prev.deps![i]))
      if (changed) {
        effects[index] = { deps, cleanup: prev?.cleanup, callback, run: true }
      }
    },
    useLayoutEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      this.useEffect(callback, deps)
    },
  }

  function renderNow() {
    cursor = 0
    rerender = false
    depth += 1
    if (depth > 8) throw new Error('renderer did not settle')
    commit = true
    reactInternals.H = dispatcher
    try {
      tree = component(props)
      for (const slot of effects) {
        if (!slot?.run) continue
        slot.run = false
        slot.cleanup?.()
        const cleanup = slot.callback?.()
        slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
      }
    } finally {
      reactInternals.H = null
      commit = false
    }
    if (rerender) renderNow()
    depth -= 1
  }

  return {
    render(next: P) {
      props = next
      depth = 0
      renderNow()
      return tree
    },
  }
}

type ElementLike = {
  type: unknown
  props: Record<string, unknown> & { children?: unknown }
}

function isElement(node: unknown): node is ElementLike {
  return Boolean(node) && typeof node === 'object' && node !== null && 'props' in node
}

function findElements(
  node: unknown,
  predicate: (element: ElementLike) => boolean,
  found: ElementLike[] = [],
): ElementLike[] {
  if (Array.isArray(node)) {
    for (const child of node) findElements(child, predicate, found)
    return found
  }
  if (!isElement(node)) return found
  if (predicate(node)) found.push(node)
  findElements(node.props.children, predicate, found)
  return found
}

function collectText(node: unknown, found: string[] = []): string[] {
  if (Array.isArray(node)) {
    for (const child of node) collectText(child, found)
    return found
  }
  if (typeof node === 'string' || typeof node === 'number') {
    found.push(String(node))
    return found
  }
  if (!isElement(node)) return found
  collectText(node.props.children, found)
  return found
}

const catalog = [
  { id: 'kws-en', label: 'English wake word', sizeLabel: '1 MB', required: true, present: false },
  { id: 'kws-zh', label: 'Chinese wake word', sizeLabel: '1 MB', required: true, present: true },
  { id: 'vad', label: 'Speech detection', sizeLabel: '1 MB', required: true, present: false },
  { id: 'sensevoice', label: 'SenseVoice', sizeLabel: '80 MB', required: false, present: false },
  { id: 'paraformer-zh-en', label: 'Paraformer', sizeLabel: '80 MB', required: false, present: false },
]

test('the voice download includes the selected listener and ignores every other provider', () => {
  assert.equal(speechModelIdForProvider('local-sensevoice'), 'sensevoice')
  assert.equal(speechModelIdForProvider('local-paraformer'), 'paraformer-zh-en')
  assert.equal(speechModelIdForProvider('zhipu-stt'), null)
  assert.equal(speechModelIdForProvider(undefined), null)

  assert.deepEqual(selectMissingVoiceModelIds(catalog, 'local-sensevoice'), ['kws-en', 'vad', 'sensevoice'])
  assert.deepEqual(selectMissingVoiceModelIds(catalog, 'local-paraformer'), ['kws-en', 'vad', 'paraformer-zh-en'])
  assert.deepEqual(selectMissingVoiceModelIds(catalog, 'zhipu-stt'), ['kws-en', 'vad'])
  assert.deepEqual(selectMissingVoiceModelIds(catalog, undefined), ['kws-en', 'vad'])
  assert.deepEqual(
    selectMissingVoiceModelIds(
      catalog.map((model) => model.id === 'sensevoice' ? { ...model, present: true } : model),
      'local-sensevoice',
    ),
    ['kws-en', 'vad'],
  )
  assert.deepEqual(
    selectMissingVoiceModelIds([{ id: 'vad', required: true, present: false }], 'local-sensevoice'),
    ['vad'],
    'a speech model that is not in the catalog is not invented',
  )

  assert.deepEqual(voiceModelDownloadPayload('local-sensevoice'), { speechInputProviderId: 'local-sensevoice' })
  assert.equal(voiceModelDownloadPayload('zhipu-stt'), undefined)
  assert.equal(voiceSettingsStatusKey(null), null)
  assert.equal(voiceSettingsStatusKey(0), 'settings.voice.status_all_clear')
  assert.equal(voiceSettingsStatusKey(1), 'settings.voice.status_models_missing_one')
  assert.equal(voiceSettingsStatusKey(4), 'settings.voice.status_models_missing_other')
})

test('installed wake-word models still leave the selected speech model to download', () => {
  const models = catalog.map((model) => (
    model.required ? { ...model, present: true } : model
  ))
  assert.deepEqual(missingVoiceModelIds(models, 'local-sensevoice'), ['sensevoice'])
  assert.equal(countLocalModelsStillNeeded(buildLocalModelRows(models, {})), 0)
})

test('Download missing models fetches the selected speech model', async () => {
  const calls: unknown[] = []
  const inventory = {
    models: catalog.map((model) => ({ ...model, present: model.required })),
    ready: true,
    missingRequired: [] as string[],
    disk: { ok: true },
  }
  Object.assign(globalThis, {
    window: {
      desktopPet: {
        modelsGetInventory: async () => inventory,
        modelsDownloadMissing: async (payload?: { speechInputProviderId?: string }) => {
          calls.push(payload)
          return {
            results: [{ id: 'sensevoice', ok: true }],
            inventory: {
              ...inventory,
              models: inventory.models.map((model) => (
                model.id === 'sensevoice' ? { ...model, present: true } : model
              )),
            },
          }
        },
        subscribeModelsProgress: () => () => {},
      },
      setTimeout,
      clearTimeout,
    },
  })

  const view = createRenderer(LocalVoiceModelsPanel)
  const panelProps = {
    uiLanguage: 'zh-CN' as const,
    speechInputProviderId: 'local-sensevoice',
  }
  view.render(panelProps)
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
  const tree = view.render(panelProps)
  const button = findElements(tree, (element) => (
    element.props.className === 'primary-button settings-v3-voice-models__download'
  ))[0]
  assert.ok(button, 'the button stays available when only the speech model is missing')
  assert.equal(collectText(button).join(''), '下载缺失模型')
  ;(button.props.onClick as () => void)()
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
  assert.deepEqual(calls, [{ speechInputProviderId: 'local-sensevoice' }])
})

test('a cloud listener does not add a speech model to the download', () => {
  const models = catalog.map((model) => ({ ...model, present: model.required }))
  assert.deepEqual(missingVoiceModelIds(models, 'zhipu-stt'), [])
  assert.equal(voiceModelDownloadPayload('zhipu-stt'), undefined)
})

test('voice settings say how many models are missing, including one', () => {
  const Inner = (VoiceSectionV3 as unknown as { type: (props: unknown) => unknown }).type
  const view = createRenderer(Inner)
  const draft = {
    companionName: '星绘',
    speechInputEnabled: true,
    speechOutputEnabled: false,
    continuousVoiceModeEnabled: false,
    voiceActivityDetectionEnabled: false,
    voiceTriggerMode: 'direct_send',
    speechInputProviderId: 'local-sensevoice',
    wakeWord: '星绘',
    vadSensitivity: 'high',
    voiceInterruptionEnabled: false,
    speechInputFailoverEnabled: false,
    speechOutputFailoverEnabled: false,
    wakewordAlwaysOn: false,
    wakewordSessionIdleTimeoutMs: 9_000,
  } as AppSettings
  const base = {
    active: true,
    audioSmokeStatus: null,
    draft,
    dirty: false,
    continuousVoiceActive: false,
    loadingSpeechVoices: false,
    onApplySpeechOutputPreset: () => {},
    onLoadSpeechVoices: () => {},
    onPreviewSpeech: () => {},
    onRunAudioSmokeTest: () => {},
    onRunSpeechInputConnectionTest: () => {},
    onRunSpeechOutputConnectionTest: () => {},
    onStartVoiceConversation: async () => {},
    onStopVoiceConversation: () => {},
    onCancelVoiceTurn: () => {},
    platformProfile: {
      platform: 'darwin',
      voice: {
        speechInputSupported: true,
        speechInputAvailable: true,
        speechOutputSupported: true,
        speechOutputAvailable: true,
        continuousVoiceSupported: true,
        vadSupported: true,
        wakewordSupported: true,
        dependencyHint: null,
      },
    } as PlatformProfile,
    previewingSpeech: false,
    speechInputEvidence: null,
    speechOutputEvidence: null,
    runningAudioSmoke: false,
    saveError: false,
    saving: false,
    setDraft: () => {},
    setSpeechPreviewText: () => {},
    speechPreviewStatus: null,
    speechPreviewText: '',
    speechVoiceOptions: [],
    speechVoiceStatus: null,
    testingInputTarget: null,
    testingOutputTarget: null,
    uiLanguage: 'zh-CN' as const,
    voiceActionPending: false,
    voiceState: 'idle' as const,
  }

  const titlesFor = (modelGapCount: number) => {
    const tree = view.render({ ...base, modelGapCount })
    return findElements(tree, (element) => typeof element.props.title === 'string')
      .map((element) => String(element.props.title))
  }

  assert.ok(titlesFor(1).includes('还差 1 个模型没装'))
  assert.equal(titlesFor(1).includes('语音一切正常'), false)
  assert.ok(titlesFor(2).includes('还差 2 个模型没装'))
  assert.ok(titlesFor(0).includes('语音一切正常'))
})

function noticeTitles(node: unknown): string[] {
  return findElements(node, (element) => typeof element.props.title === 'string')
    .map((element) => String(element.props.title))
}

async function renderModelsPanel(
  inventory: unknown,
  props: { uiLanguage: 'zh-CN' | 'en-US'; speechInputProviderId: string; onMissingCount?: (count: number | null) => void },
) {
  Object.assign(globalThis, {
    window: {
      desktopPet: {
        modelsGetInventory: async () => inventory,
        subscribeModelsProgress: () => () => {},
      },
    },
  })
  const view = createRenderer(LocalVoiceModelsPanel)
  view.render(props)
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
  return view.render(props)
}

test('the voice panel is not ready while the selected speech model is missing', async () => {
  await ensureLocaleLoaded('en-US')
  await ensureLocaleLoaded('zh-CN')
  const requiredInstalled = {
    models: catalog.map((model) => ({ ...model, present: model.required })),
    ready: true,
    missingRequired: [] as string[],
    disk: { ok: true },
  }
  const gap = await renderModelsPanel(requiredInstalled, {
    uiLanguage: 'en-US',
    speechInputProviderId: 'local-sensevoice',
  })
  assert.equal(noticeTitles(gap).includes('The required local voice models are installed.'), false)
  assert.ok(collectText(gap).includes('1 model still needs to be downloaded.'))
  assert.equal(collectText(gap).includes('1 models still need to be downloaded.'), false)

  const twoMissing = {
    ...requiredInstalled,
    ready: false,
    missingRequired: ['vad'],
    models: requiredInstalled.models.map((model) => (
      model.id === 'vad' ? { ...model, present: false } : model
    )),
  }
  const plural = await renderModelsPanel(twoMissing, {
    uiLanguage: 'en-US',
    speechInputProviderId: 'local-sensevoice',
  })
  assert.ok(collectText(plural).includes('2 models still need to be downloaded.'))

  const ready = await renderModelsPanel({
    ...requiredInstalled,
    models: requiredInstalled.models.map((model) => ({ ...model, present: true })),
  }, {
    uiLanguage: 'zh-CN',
    speechInputProviderId: 'local-sensevoice',
  })
  assert.ok(noticeTitles(ready).includes('需要的本地语音模型都已安装。'))
  assert.equal(collectText(ready).join('').includes('还有 1 个模型需要下载'), false)
})

test('voice settings follow the live inventory gap, including the selected speech model', async () => {
  const Inner = (VoiceSectionV3 as unknown as { type: (props: unknown) => unknown }).type
  const section = createRenderer(Inner)
  const draft = {
    companionName: '星绘',
    speechInputEnabled: true,
    speechOutputEnabled: false,
    continuousVoiceModeEnabled: false,
    voiceActivityDetectionEnabled: false,
    voiceTriggerMode: 'direct_send',
    speechInputProviderId: 'local-sensevoice',
    wakeWord: '星绘',
    vadSensitivity: 'high',
    voiceInterruptionEnabled: false,
    speechInputFailoverEnabled: false,
    speechOutputFailoverEnabled: false,
    wakewordAlwaysOn: false,
    wakewordSessionIdleTimeoutMs: 9_000,
  } as AppSettings
  const base = {
    active: true,
    audioSmokeStatus: null,
    draft,
    dirty: false,
    continuousVoiceActive: false,
    loadingSpeechVoices: false,
    onApplySpeechOutputPreset: () => {},
    onLoadSpeechVoices: () => {},
    onPreviewSpeech: () => {},
    onRunAudioSmokeTest: () => {},
    onRunSpeechInputConnectionTest: () => {},
    onRunSpeechOutputConnectionTest: () => {},
    onStartVoiceConversation: async () => {},
    onStopVoiceConversation: () => {},
    onCancelVoiceTurn: () => {},
    platformProfile: {
      platform: 'darwin',
      voice: {
        speechInputSupported: true,
        speechInputAvailable: true,
        speechOutputSupported: true,
        speechOutputAvailable: true,
        continuousVoiceSupported: true,
        vadSupported: true,
        wakewordSupported: true,
        dependencyHint: null,
      },
    } as PlatformProfile,
    previewingSpeech: false,
    speechInputEvidence: null,
    speechOutputEvidence: null,
    runningAudioSmoke: false,
    saveError: false,
    saving: false,
    setDraft: () => {},
    setSpeechPreviewText: () => {},
    speechPreviewStatus: null,
    speechPreviewText: '',
    speechVoiceOptions: [],
    speechVoiceStatus: null,
    testingInputTarget: null,
    testingOutputTarget: null,
    uiLanguage: 'zh-CN' as const,
    voiceActionPending: false,
    voiceState: 'idle' as const,
  }
  const first = section.render(base)
  const panel = findElements(first, (element) => element.type === LocalVoiceModelsPanel)[0]
  assert.ok(panel?.props.onMissingCount, 'the voice page must report the live model gap')
  const inventory = {
    models: catalog.map((model) => ({ ...model, present: model.required })),
    ready: true,
    missingRequired: [] as string[],
    disk: { ok: true },
  }
  await renderModelsPanel(inventory, {
    uiLanguage: panel.props.uiLanguage as 'zh-CN',
    speechInputProviderId: String(panel.props.speechInputProviderId),
    onMissingCount: panel.props.onMissingCount as (count: number | null) => void,
  })
  const titles = noticeTitles(section.render(base))
  assert.ok(titles.includes('还差 1 个模型没装'))
  assert.equal(titles.includes('语音一切正常'), false)
})

test('settings shows an in-flight listener download and will not start another', async () => {
  await ensureLocaleLoaded('zh-CN')
  const calls: unknown[] = []
  const inventory = {
    models: catalog.map((model) => ({
      ...model,
      present: model.required || model.id === 'paraformer-zh-en',
    })),
    ready: true,
    missingRequired: [] as string[],
    disk: { ok: true },
    downloading: ['sensevoice'],
  }
  Object.assign(globalThis, {
    window: {
      desktopPet: {
        modelsGetInventory: async () => inventory,
        modelsDownloadMissing: async (payload?: unknown) => {
          calls.push(payload)
          return { results: [], inventory }
        },
        subscribeModelsProgress: () => () => {},
      },
    },
  })
  const view = createRenderer(LocalVoiceModelsPanel)
  const props = {
    uiLanguage: 'zh-CN' as const,
    speechInputProviderId: 'local-sensevoice',
  }
  view.render(props)
  for (let i = 0; i < 12; i += 1) await Promise.resolve()
  const tree = view.render(props)
  const text = collectText(tree).join('\n')
  assert.ok(text.includes('正在下载 0%') || text.includes('正在下载'))
  assert.equal(text.includes('未下载'), false)
  const button = findElements(tree, (element) => (
    element.props.className === 'primary-button settings-v3-voice-models__download'
  ))[0]
  assert.ok(button)
  assert.equal(button.props.disabled, true)
  ;(button.props.onClick as () => void)()
  for (let i = 0; i < 8; i += 1) await Promise.resolve()
  assert.deepEqual(calls, [])
})

test('models finishing does not turn voice on, and only the start click does', async () => {
  await ensureLocaleLoaded('zh-CN')
  const untouched = { speechInputEnabled: false, speechOutputEnabled: false }
  const decision = voiceStartClick(untouched, true)
  assert.equal(untouched.speechInputEnabled, false)
  assert.equal(untouched.speechOutputEnabled, false)
  assert.deepEqual(decision, {
    enabled: true,
    patch: { speechInputEnabled: true, speechOutputEnabled: true },
  })
  assert.deepEqual(voiceStartClick(untouched, false), { enabled: false })
  const listeningOn = { speechInputEnabled: true, speechOutputEnabled: false }
  assert.deepEqual(voiceStartClick(listeningOn, true), { enabled: true })
  assert.equal(listeningOn.speechOutputEnabled, false)

  const Inner = (VoiceSectionV3 as unknown as { type: (props: unknown) => unknown }).type
  const draft = {
    companionName: '星绘',
    speechInputEnabled: true,
    speechOutputEnabled: true,
    continuousVoiceModeEnabled: false,
    voiceActivityDetectionEnabled: false,
    voiceTriggerMode: 'direct_send',
    speechInputProviderId: 'local-sensevoice',
    wakeWord: '星绘',
    vadSensitivity: 'high',
    voiceInterruptionEnabled: false,
    speechInputFailoverEnabled: false,
    speechOutputFailoverEnabled: false,
    wakewordAlwaysOn: false,
    wakewordSessionIdleTimeoutMs: 9_000,
  } as AppSettings
  let current = draft
  const started: unknown[] = []
  let draftWrites = 0
  const base = {
    active: true,
    audioSmokeStatus: null,
    dirty: false,
    continuousVoiceActive: false,
    loadingSpeechVoices: false,
    onApplySpeechOutputPreset: () => {},
    onLoadSpeechVoices: () => {},
    onPreviewSpeech: () => {},
    onRunAudioSmokeTest: () => {},
    onRunSpeechInputConnectionTest: () => {},
    onRunSpeechOutputConnectionTest: () => {},
    onStopVoiceConversation: () => {},
    onCancelVoiceTurn: () => {},
    platformProfile: {
      platform: 'darwin',
      voice: {
        speechInputSupported: true,
        speechInputAvailable: true,
        speechOutputSupported: true,
        speechOutputAvailable: true,
        continuousVoiceSupported: true,
        vadSupported: true,
        wakewordSupported: true,
        dependencyHint: null,
      },
    } as PlatformProfile,
    previewingSpeech: false,
    speechInputEvidence: null,
    speechOutputEvidence: null,
    runningAudioSmoke: false,
    saveError: false,
    saving: false,
    setSpeechPreviewText: () => {},
    speechPreviewStatus: null,
    speechPreviewText: '',
    speechVoiceOptions: [],
    speechVoiceStatus: null,
    testingInputTarget: null,
    testingOutputTarget: null,
    uiLanguage: 'zh-CN' as const,
    voiceActionPending: false,
    voiceState: 'idle' as const,
  }
  const view = createRenderer(Inner)
  const renderAt = (gap: number) => view.render({
    ...base,
    draft: current,
    modelGapCount: gap,
    setDraft: (update: AppSettings | ((prev: AppSettings) => AppSettings)) => {
      draftWrites += 1
      current = typeof update === 'function' ? update(current) : update
    },
    onStartVoiceConversation: async (patch?: unknown) => { started.push(patch) },
  })
  const switchesOf = (tree: unknown) => findElements(tree, (element) => (
    typeof element.props.checked === 'boolean' && typeof element.props.onChange === 'function'
  ))
  const startButton = (tree: unknown) => findElements(tree, (element) => (
    typeof element.props['aria-label'] === 'string'
    && String(element.props['aria-label']).includes('开始语音')
  ))[0]

  const before = renderAt(2)
  const [inputSwitch, outputSwitch] = switchesOf(before)
  assert.ok(inputSwitch && outputSwitch)
  ;(inputSwitch.props.onChange as (value: boolean) => void)(false)
  ;(outputSwitch.props.onChange as (value: boolean) => void)(false)
  assert.equal(current.speechInputEnabled, false)
  assert.equal(current.speechOutputEnabled, false)
  draftWrites = 0
  started.length = 0
  const finished = renderAt(0)
  const [inputAfter, outputAfter] = switchesOf(finished)
  assert.equal(inputAfter?.props.checked, false)
  assert.equal(outputAfter?.props.checked, false)
  assert.equal(draftWrites, 0)
  assert.deepEqual(started, [])
  assert.equal(startButton(finished)?.props.disabled, false)

  current = { ...draft, speechInputEnabled: false, speechOutputEnabled: false }
  const freshView = createRenderer(Inner)
  draftWrites = 0
  started.length = 0
  const fresh = freshView.render({
    ...base,
    draft: current,
    modelGapCount: 0,
    setDraft: () => { draftWrites += 1 },
    onStartVoiceConversation: async (patch?: unknown) => { started.push(patch) },
  })
  const [freshInput, freshOutput] = switchesOf(fresh)
  assert.equal(freshInput?.props.checked, false)
  assert.equal(freshOutput?.props.checked, false)
  assert.equal(draftWrites, 0)
  assert.deepEqual(started, [])
  const freshButton = startButton(fresh)
  assert.equal(freshButton?.props.disabled, false)
  ;(freshButton.props.onClick as () => void)()
  assert.deepEqual(started, [{ speechInputEnabled: true, speechOutputEnabled: true }])

  const waiting = freshView.render({
    ...base,
    draft: current,
    modelGapCount: 2,
    setDraft: () => {},
    onStartVoiceConversation: async () => { started.push('early') },
  })
  assert.equal(startButton(waiting)?.props.disabled, true)
})
