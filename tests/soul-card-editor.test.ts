import assert from 'node:assert/strict'
import { register } from 'node:module'
import { test } from 'node:test'
import React from 'react'

import { PERSONA_SOUL_MAX_CHARS } from '../shared/personaSoul.js'
import { releaseSoulCardDraft } from '../src/features/settingsV3/soulCardDraftSession.ts'

// JSX in the card does not survive type-stripping, and the card imports CSS.
// Import before any test installs `window`: the storage core opens a
// BroadcastChannel when window already exists, and that channel keeps the
// test process alive.
register(new URL('./helpers/tsx-test-loader.mjs', import.meta.url))
const { MemoryPortraitCardsV3 } = await import('../src/features/settingsV3/MemoryPortraitCardsV3.tsx')

const PROMPT = 'ENGLISH-DEFAULT-PROMPT'
const BUTTON_TEXT = 'saved-from-the-save-button'

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = { deps?: readonly unknown[]; cleanup?: () => void }

function createHookRenderer<P, R>(hookFn: (props: P) => R) {
  const slots: unknown[] = []
  const effects: EffectSlot[] = []
  let cursor = 0
  let pending: Array<{ index: number; callback: () => void | (() => void) }> = []

  const dispatcher = {
    useState(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) {
        slots[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial
      }
      const setState = (value: unknown) => {
        slots[index] = typeof value === 'function'
          ? (value as (prev: unknown) => unknown)(slots[index])
          : value
      }
      return [slots[index], setState]
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useContext() {
      cursor++
      return null
    },
    useCallback(fn: unknown) {
      cursor++
      return fn
    },
    useMemo(fn: () => unknown) {
      cursor++
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
        effects[index] = { deps }
        pending.push({ index, callback })
      }
    },
  }

  function render(props: P): R {
    cursor = 0
    pending = []
    reactInternals.H = dispatcher
    let result: R
    try {
      result = hookFn(props)
    } finally {
      reactInternals.H = null
    }
    for (const { index, callback } of pending) {
      const slot = effects[index]
      slot.cleanup?.()
      const cleanup = callback()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
    return result
  }

  function unmount() {
    for (const effect of effects) effect?.cleanup?.()
  }

  return { render, unmount }
}

type SaveCall = { content: string; profileId?: string }

function installWindow() {
  releaseSoulCardDraft()
  const storage = new Map<string, string>()
  const saves: SaveCall[] = []
  const globalSoul = { value: '' }
  const desktopPet = {
    isPanelWindow: async () => true,
    personaLoadMemory: async () => '',
    personaLoadSoul: async () => globalSoul.value,
    personaSaveSoul: async (payload: SaveCall) => {
      saves.push({ content: payload.content, profileId: payload.profileId })
      if (payload.content.length > PERSONA_SOUL_MAX_CHARS) return { ok: false }
      globalSoul.value = payload.content
      return { ok: true }
    },
    personaLoadProfile: async (id: string) => ({
      id,
      present: false,
      soul: '',
      memory: '',
      examplesRaw: '',
      examples: [],
      style: {},
      voice: {},
      tools: {},
      rootDir: `personas/${id}`,
    }),
  }
  const win = Object.assign(new EventTarget(), {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => { storage.set(key, String(value)) },
      removeItem: (key: string) => { storage.delete(key) },
      clear: () => { storage.clear() },
    },
    desktopPet,
  })
  Object.defineProperty(globalThis, 'window', {
    value: win,
    configurable: true,
    writable: true,
  })
  return { saves, globalSoul }
}

function visibleText(node: unknown): string {
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(visibleText).join('')
  if (!node || typeof node !== 'object') return ''
  const props = (node as { props?: { children?: unknown } }).props
  return props ? visibleText(props.children) : ''
}

function findProps(
  node: unknown,
  match: (props: Record<string, unknown>) => boolean,
): Record<string, unknown> | undefined {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findProps(child, match)
      if (found) return found
    }
    return undefined
  }
  if (!node || typeof node !== 'object') return undefined
  const props = (node as { props?: Record<string, unknown> }).props
  if (!props) return undefined
  if (match(props)) return props
  return findProps(props.children, match)
}

function click(props: Record<string, unknown> | undefined) {
  assert.equal(typeof props?.onClick, 'function')
  ;(props.onClick as () => void)()
}

async function settle() {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve))
}

const cardProps = {
  settings: {
    profilePersonaInChatEnabled: false,
    activeCharacterProfileId: '',
    systemPrompt: PROMPT,
  },
  memories: [],
  onRemoveMemory: () => {},
}

test('the SOUL card shows the system prompt, and the Save button writes the editor text', async () => {
  const harness = installWindow()
  const renderer = createHookRenderer(MemoryPortraitCardsV3)
  try {
    let tree = renderer.render(cardProps)
    await settle()
    tree = renderer.render(cardProps)

    assert.match(visibleText(tree), new RegExp(PROMPT))
    assert.doesNotMatch(visibleText(tree), /我是星绘/)

    click(findProps(tree, (props) => props['data-soul-card'] === 'true'))
    tree = renderer.render(cardProps)
    const editor = findProps(tree, (props) => props.className === 'memory-portrait__editor')
    assert.equal(editor?.value, PROMPT)

    ;(editor?.onChange as (event: { target: { value: string } }) => void)({
      target: { value: BUTTON_TEXT },
    })
    tree = renderer.render(cardProps)
    assert.equal(harness.saves.length, 0)
    click(findProps(tree, (props) => props.className === 'memory-portrait__save'))
    await settle()

    assert.deepEqual(harness.saves, [{ content: BUTTON_TEXT, profileId: undefined }])
    assert.equal(harness.globalSoul.value, BUTTON_TEXT)
    tree = renderer.render(cardProps)
    assert.match(visibleText(tree), new RegExp(BUTTON_TEXT))
    assert.doesNotMatch(visibleText(tree), /我是星绘/)
  } finally {
    renderer.unmount()
  }
})

test('clearing the editor and saving restores the default and says so on the card', async () => {
  const harness = installWindow()
  const renderer = createHookRenderer(MemoryPortraitCardsV3)
  try {
    let tree = renderer.render(cardProps)
    await settle()
    tree = renderer.render(cardProps)
    click(findProps(tree, (props) => props['data-soul-card'] === 'true'))
    tree = renderer.render(cardProps)
    const editor = findProps(tree, (props) => props.className === 'memory-portrait__editor')
    ;(editor?.onChange as (event: { target: { value: string } }) => void)({ target: { value: '' } })
    tree = renderer.render(cardProps)
    click(findProps(tree, (props) => props.className === 'memory-portrait__save'))
    await settle()
    tree = renderer.render(cardProps)

    assert.equal(harness.globalSoul.value, '')
    assert.match(visibleText(tree), /已恢复默认/)
    assert.match(visibleText(tree), new RegExp(PROMPT))
    assert.doesNotMatch(visibleText(tree), /我是星绘/)
    const reopened = findProps(tree, (props) => props.className === 'memory-portrait__editor')
    assert.equal(reopened?.value, PROMPT)
  } finally {
    renderer.unmount()
  }
})

test('an oversized soul draft shows a message and is still in the editor after reopen', async () => {
  const harness = installWindow()
  const renderer = createHookRenderer(MemoryPortraitCardsV3)
  const tooLong = 'z'.repeat(PERSONA_SOUL_MAX_CHARS + 1)
  try {
    let tree = renderer.render(cardProps)
    await settle()
    tree = renderer.render(cardProps)
    click(findProps(tree, (props) => props['data-soul-card'] === 'true'))
    tree = renderer.render(cardProps)
    const editor = findProps(tree, (props) => props.className === 'memory-portrait__editor')
    ;(editor?.onChange as (event: { target: { value: string } }) => void)({ target: { value: tooLong } })
    tree = renderer.render(cardProps)
    click(findProps(tree, (props) => props.className === 'memory-portrait__save'))
    await settle()
    tree = renderer.render(cardProps)

    assert.match(visibleText(tree), /内容太长了，删短一点再保存/)
    assert.equal(findProps(tree, (props) => props.className === 'memory-portrait__editor')?.value, tooLong)
    assert.equal(harness.globalSoul.value, '')
    assert.equal(harness.saves.length, 0)

    click(findProps(tree, (props) => props.children === '关闭'))
    tree = renderer.render(cardProps)
    click(findProps(tree, (props) => props['data-soul-card'] === 'true'))
    tree = renderer.render(cardProps)

    assert.equal(findProps(tree, (props) => props.className === 'memory-portrait__editor')?.value, tooLong)
    assert.match(visibleText(tree), /内容太长了，删短一点再保存/)
  } finally {
    renderer.unmount()
  }
})

test('an oversized soul draft survives leaving the memory page and coming back', async () => {
  const harness = installWindow()
  const tooLong = 'q'.repeat(PERSONA_SOUL_MAX_CHARS + 1)
  const first = createHookRenderer(MemoryPortraitCardsV3)
  try {
    let tree = first.render(cardProps)
    await settle()
    tree = first.render(cardProps)
    click(findProps(tree, (props) => props['data-soul-card'] === 'true'))
    tree = first.render(cardProps)
    const editor = findProps(tree, (props) => props.className === 'memory-portrait__editor')
    ;(editor?.onChange as (event: { target: { value: string } }) => void)({ target: { value: tooLong } })
    tree = first.render(cardProps)
    click(findProps(tree, (props) => props.className === 'memory-portrait__save'))
    await settle()
    tree = first.render(cardProps)
    assert.equal(findProps(tree, (props) => props.className === 'memory-portrait__editor')?.value, tooLong)
  } finally {
    first.unmount()
  }

  const second = createHookRenderer(MemoryPortraitCardsV3)
  try {
    let tree = second.render(cardProps)
    await settle()
    tree = second.render(cardProps)
    click(findProps(tree, (props) => props['data-soul-card'] === 'true'))
    tree = second.render(cardProps)

    assert.equal(findProps(tree, (props) => props.className === 'memory-portrait__editor')?.value, tooLong)
    assert.match(visibleText(tree), /内容太长了，删短一点再保存/)
    assert.equal(harness.saves.length, 0)
    assert.equal(harness.globalSoul.value, '')
  } finally {
    second.unmount()
    releaseSoulCardDraft()
  }
})
