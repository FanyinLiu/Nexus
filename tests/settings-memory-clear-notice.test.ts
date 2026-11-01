/**
 * The memory-archive clear line is rendered from the status object, not from
 * its text: a failed clear owns the error tone, while "nothing to clear" is a
 * neutral notice. These tests mount the real MemorySectionV3 on top of
 * useMemoryArchiveActions and click the real clear button.
 */

import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'

import React from 'react'

import {
  useMemoryArchiveActions,
  type UseMemoryArchiveActionsOptions,
} from '../src/components/settingsDrawerHooks/useMemoryArchiveActions.ts'
import type { ConfirmFn } from '../src/components/useConfirm.ts'
import { t } from '../src/i18n/runtime.ts'
import { setConsolePassthrough } from '../src/lib/logger.ts'
import type { AppSettings, PlatformProfile } from '../src/types/index.ts'

setConsolePassthrough(false)

register(new URL('./helpers/bundler-import-hooks.mjs', import.meta.url))

const { MemorySectionV3 } = await import('../src/features/settingsV3/MemorySectionV3.tsx')
const { SettingsV3Notice } = await import('../src/features/settingsV3/SettingsV3Primitives.tsx')

type MemorySectionProps = React.ComponentProps<typeof MemorySectionV3>

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = {
  deps?: readonly unknown[]
  callback?: () => void | (() => void)
  cleanup?: () => void
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
      const setState = (next: unknown) => {
        const resolved = typeof next === 'function'
          ? (next as (prev: unknown) => unknown)(slots[index])
          : next
        if (Object.is(resolved, slots[index])) return
        slots[index] = resolved
        if (commit) rerender = true
      }
      return [slots[index], setState]
    },
    useReducer(reducer: (state: unknown, action: unknown) => unknown, initial: unknown) {
      const [state, setState] = this.useState(initial) as [unknown, (next: unknown) => void]
      return [state, (action: unknown) => setState(reducer(state, action))] as const
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useMemo(fn: () => unknown) {
      cursor += 1
      return fn()
    },
    useSyncExternalStore(_subscribe: unknown, getSnapshot: () => unknown) {
      cursor += 1
      return getSnapshot()
    },
    useContext() {
      cursor += 1
      return null
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++
      const prev = effects[index]
      const changed = !prev
        || deps === undefined
        || prev.deps === undefined
        || deps.length !== prev.deps.length
        || deps.some((dep, i) => !Object.is(dep, prev.deps![i]))
      if (changed) effects[index] = { deps, callback, cleanup: prev?.cleanup, run: true }
    },
  }

  function renderNow() {
    cursor = 0
    rerender = false
    depth += 1
    if (depth > 6) throw new Error('renderer did not settle')
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
    unmount() {
      for (const slot of effects) slot?.cleanup?.()
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

function collectStrings(node: unknown, found: string[] = []): string[] {
  if (typeof node === 'string') {
    found.push(node)
    return found
  }
  if (Array.isArray(node)) {
    for (const child of node) collectStrings(child, found)
    return found
  }
  if (!isElement(node)) return found
  for (const value of Object.values(node.props)) {
    if (typeof value === 'string') found.push(value)
  }
  collectStrings(node.props.children, found)
  return found
}

const memoryDraft = {
  uiLanguage: 'zh-CN',
  companionName: '星绘',
  memoryPaused: false,
  activeWindowContextEnabled: false,
  clipboardContextEnabled: false,
  companionAwarenessPaused: false,
  contextAwarenessEnabled: false,
  screenContextEnabled: false,
  screenOcrLanguage: 'chi_sim',
  screenVlmEnabled: false,
  screenVlmBaseUrl: '',
  screenVlmApiKey: '',
  screenVlmModel: '',
  memorySearchMode: 'hybrid',
  memoryEmbeddingModel: '',
  memoryRerankEnabled: false,
  memoryDailyRecallCount: 3,
  memoryLongTermRecallCount: 3,
  memorySemanticRecallCount: 3,
  memoryDiaryRetentionDays: 30,
} as unknown as AppSettings

const testPlatformProfile = {
  platform: 'unknown',
  desktopContext: {
    activeWindowSupported: true,
    activeWindowAvailable: true,
    activeWindowDependencyHint: null,
    screenshotSupported: true,
    screenshotAvailable: true,
    screenshotDependencyHint: null,
    clipboardSupported: true,
    clipboardAvailable: true,
  },
} as unknown as PlatformProfile

function memorySectionProps(
  options: UseMemoryArchiveActionsOptions,
  archive: ReturnType<typeof useMemoryArchiveActions>,
): MemorySectionProps {
  return {
    active: true,
    confirm: options.confirm,
    draft: memoryDraft,
    platformProfile: testPlatformProfile,
    setDraft: () => {},
    memories: options.memories,
    dailyMemoryEntries: options.dailyMemoryEntries,
    uiLanguage: 'zh-CN',
    memorySearchModeOptions: [{ value: 'hybrid', label: 'Hybrid', hint: '' }],
    selectedMemorySearchMode: { value: 'hybrid', label: 'Hybrid', hint: '' },
    exportingMemoryArchive: archive.exportingMemoryArchive,
    importingMemoryArchive: archive.importingMemoryArchive,
    clearingMemoryArchive: archive.clearingMemoryArchive,
    chatBusy: false,
    memoryArchiveStatus: archive.memoryArchiveStatus,
    memoryClearStatus: archive.memoryClearStatus,
    onExportMemoryArchive: archive.handleExportMemoryArchive,
    onImportMemoryArchive: archive.handleImportMemoryArchive,
    onClearMemoryArchive: archive.handleClearMemoryArchive,
    onAddManualMemory: () => {},
    onUpdateMemory: () => {},
    onSetMemoryEnabled: () => {},
    onCommitMemoryPaused: () => {},
    onRemoveMemory: () => {},
    onClearDailyMemory: () => {},
  }
}

/**
 * The real section component, driven by the real archive hook. Calling the
 * section directly (instead of returning its element) lets the fake dispatcher
 * execute its hooks in one pass.
 */
function MemoryClearSection(options: UseMemoryArchiveActionsOptions) {
  const archive = useMemoryArchiveActions(options)
  return MemorySectionV3.type(memorySectionProps(options, archive))
}

function installWindow(inboxEntries: string[]) {
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, String(value)) },
        removeItem: (key: string) => { storage.delete(key) },
      },
      desktopPet: {
        listProactiveInbox: async () => ({
          entries: inboxEntries.map((id) => ({ id })),
          unreadCount: 0,
          removedIds: [],
        }),
      },
    },
    configurable: true,
    writable: true,
  })
}

function confirmRecorder(accepted = true) {
  const calls: Array<{ message: string; tone?: 'danger' | 'default' }> = []
  const confirm: ConfirmFn = async (options) => {
    calls.push({ message: options.message, tone: options.tone })
    return accepted
  }
  return { confirm, calls }
}

function makeOptions(
  confirm: ConfirmFn,
  overrides: Partial<UseMemoryArchiveActionsOptions> = {},
): UseMemoryArchiveActionsOptions {
  return {
    memories: [],
    dailyMemoryEntries: [],
    confirm,
    onExportMemoryArchive: async () => ({ canceled: true, message: '' }),
    onImportMemoryArchive: async () => ({ canceled: true, message: '' }),
    onClearMemoryArchive: async () => ({ canceled: false, message: 'cleared' }),
    ...overrides,
  }
}

function clearButton(tree: unknown): ElementLike {
  const label = t('settings.memory.long_term.clear')
  const buttons = findElements(tree, (element) => (
    element.type === 'button'
    && element.props.className === 'is-danger'
    && element.props.children === label
  ))
  assert.ok(buttons[0], 'expected the memory-archive clear button')
  return buttons[0]
}

function notice(tree: unknown): ElementLike {
  const notices = findElements(tree, (element) => element.type === SettingsV3Notice)
  const clearNotices = notices.filter((element) => (
    element.props.title === t('settings.memory.clear_error')
    || element.props.title === t('settings.memory.clear_empty_hint')
  ))
  assert.ok(clearNotices[0], 'expected the memory-clear notice')
  return clearNotices[0]
}

test('"nothing to clear" renders as a neutral notice, not an error', async () => {
  installWindow([])
  const { confirm, calls } = confirmRecorder()
  const options = makeOptions(confirm)
  const renderer = createRenderer(MemoryClearSection)
  try {
    const tree = renderer.render(options)
    await (clearButton(tree).props.onClick as () => Promise<void>)()

    const after = renderer.render(options)
    const rendered = notice(after)
    assert.equal(rendered.props.title, t('settings.memory.clear_empty_hint'))
    assert.equal(rendered.props.tone, 'info')
    assert.equal(calls.length, 0)
  } finally {
    renderer.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})

test('a failed clear renders the localized error tone and leaks no path or secret', async () => {
  installWindow(['msg-1'])
  const { confirm, calls } = confirmRecorder()
  const options = makeOptions(confirm, {
    onClearMemoryArchive: async () => {
      throw new Error('ENOENT /Users/x/secret')
    },
  })
  const renderer = createRenderer(MemoryClearSection)
  try {
    const tree = renderer.render(options)
    await (clearButton(tree).props.onClick as () => Promise<void>)()

    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.tone, 'danger')

    const after = renderer.render(options)
    const rendered = notice(after)
    assert.equal(rendered.props.title, t('settings.memory.clear_error'))
    assert.equal(rendered.props.tone, 'error')

    const renderedStrings = collectStrings(after)
    for (const text of renderedStrings) {
      assert.equal(text.includes('ENOENT'), false, text)
      assert.equal(text.includes('secret'), false, text)
      assert.equal(text.includes('/Users'), false, text)
    }
  } finally {
    renderer.unmount()
    delete (globalThis as { window?: unknown }).window
  }
})
