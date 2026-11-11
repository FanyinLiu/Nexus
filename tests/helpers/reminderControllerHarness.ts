/**
 * Shared controller harness for the reminder delivery and playback tests.
 *
 * The reminder suites drive the real controller, the real companion-notice
 * hook and the real pet-dialog bubble hook through a hand-rolled React
 * dispatcher, so the production pipeline (chat line, bubble, speech, timers)
 * is what gets asserted. The renderer stub, the fake clock and the session
 * builder live here so a second reminder suite can reuse them instead of
 * copying the harness; test cases and their assertions stay in the test files.
 *
 * The hooks are imported statically below, so callers must register the
 * bundler import hooks before importing this module (dynamic import after
 * `register`).
 */

import React from 'react'

import type { CompanionNoticePayload } from '../../src/hooks/chat/types.ts'
import type { AppSettings, PetDialogBubbleState, ReminderTask } from '../../src/types/index.ts'

const { usePetDialogBubbles } = await import('../../src/hooks/chat/usePetDialogBubbles.ts')
const { useCompanionNotices } = await import('../../src/hooks/chat/useCompanionNotices.ts')
const { useReminderController } = await import('../../src/app/controllers/useReminderController.ts')

type ReactInternals = { H: unknown }
export const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = {
  deps?: readonly unknown[]
  callback?: () => void | (() => void)
  cleanup?: () => void
  run?: boolean
}

type CallbackSlot = { fn: unknown; deps?: readonly unknown[] }

function depsChanged(previous: readonly unknown[] | undefined, next: readonly unknown[] | undefined) {
  if (!previous || !next) return true
  return previous.length !== next.length || next.some((dep, index) => !Object.is(dep, previous[index]))
}

type Timer = { at: number; callback: () => void }

function createClock() {
  let now = 0
  let nextId = 1
  const timers = new Map<number, Timer>()

  return {
    setTimeout(callback: () => void, delay?: number) {
      const id = nextId++
      timers.set(id, { at: now + (delay ?? 0), callback })
      return id
    },
    clearTimeout(id: number) {
      timers.delete(id)
    },
    tick(ms: number) {
      const target = now + ms
      for (;;) {
        let next: { id: number; timer: Timer } | null = null
        for (const [id, timer] of timers) {
          if (timer.at > target) continue
          if (!next || timer.at < next.timer.at) next = { id, timer }
        }
        if (!next) break
        timers.delete(next.id)
        now = next.timer.at
        next.timer.callback()
      }
      now = target
    },
  }
}

type ControllerOptions = Parameters<typeof useReminderController>[0]
type NoticeDependencies = Parameters<typeof useCompanionNotices>[0]

type ProbeProps = {
  settingsRef: ControllerOptions['settingsRef']
  runtimeSnapshot: ControllerOptions['runtimeSnapshot']
  reminderTasks: ControllerOptions['reminderTaskStore']['reminderTasks']
  setReminderTasks: ControllerOptions['reminderTaskStore']['setReminderTasks']
  ctx: NoticeDependencies['ctx']
  t: NoticeDependencies['t']
  busyRef: NoticeDependencies['busyRef']
  appendChatMessage: NoticeDependencies['appendChatMessage']
  setError: NoticeDependencies['setError']
  appendSystemMessage: ControllerOptions['chat']['appendSystemMessage']
  sendMessage: ControllerOptions['chat']['sendMessage']
  updatePetStatus: ControllerOptions['pet']['updatePetStatus']
  appendDebugConsoleEvent: ControllerOptions['debugConsole']['appendDebugConsoleEvent']
}

type ControllerApi = {
  bubble: PetDialogBubbleState | null
  hide: () => void
  trigger: (task: ReminderTask) => Promise<void>
  push: (payload: CompanionNoticePayload) => Promise<void>
  flush: () => Promise<void>
}

function ControllerProbe(props: ProbeProps): ControllerApi {
  const bubbles = usePetDialogBubbles()
  const notices = useCompanionNotices({
    ctx: props.ctx,
    t: props.t,
    busyRef: props.busyRef,
    appendChatMessage: props.appendChatMessage,
    presentPetDialogBubble: bubbles.presentPetDialogBubble,
    setError: props.setError,
  })
  const controller = useReminderController({
    view: 'panel',
    settingsRef: props.settingsRef,
    runtimeSnapshot: props.runtimeSnapshot,
    focusState: 'active',
    chat: {
      pushCompanionNotice: notices.pushCompanionNotice,
      appendSystemMessage: props.appendSystemMessage,
      sendMessage: props.sendMessage,
    },
    pet: { updatePetStatus: props.updatePetStatus },
    debugConsole: { appendDebugConsoleEvent: props.appendDebugConsoleEvent },
    reminderTaskStore: {
      reminderTasks: props.reminderTasks,
      setReminderTasks: props.setReminderTasks,
    },
  })

  return {
    bubble: bubbles.petDialogBubble,
    hide: bubbles.hidePetDialogBubble,
    trigger: controller.handleReminderTaskTrigger,
    push: notices.pushCompanionNotice,
    flush: notices.flushDeferredCompanionNotices,
  }
}

function createControllerRenderer() {
  const slots: unknown[] = []
  const effects: EffectSlot[] = []
  let cursor = 0
  let props: ProbeProps
  let tree: ControllerApi | null = null
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
        else renderNow()
      }
      return [slots[index], setState]
    },
    useRef(initial: unknown) {
      const index = cursor++
      if (!(index in slots)) slots[index] = { current: initial }
      return slots[index]
    },
    useCallback(fn: unknown, deps?: readonly unknown[]) {
      const index = cursor++
      const previous = slots[index] as CallbackSlot | undefined
      if (!previous || depsChanged(previous.deps, deps)) slots[index] = { fn, deps }
      return (slots[index] as CallbackSlot).fn
    },
    useEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      const index = cursor++
      const previous = effects[index]
      const changed = !previous || depsChanged(previous.deps, deps)
      if (changed) effects[index] = { deps, callback, cleanup: previous?.cleanup, run: true }
    },
    useContext() {
      cursor += 1
      return null
    },
  }

  function renderNow() {
    cursor = 0
    rerender = false
    depth += 1
    if (depth > 8) throw new Error('controller renderer did not settle')
    commit = true
    reactInternals.H = dispatcher
    try {
      tree = ControllerProbe(props)
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
    render(next: ProbeProps) {
      props = next
      depth = 0
      renderNow()
    },
    get api() {
      return tree
    },
    unmount() {
      for (const slot of effects) slot?.cleanup?.()
    },
  }
}

function createSettings(): AppSettings {
  return {
    uiLanguage: 'zh-CN',
    contextAwarenessEnabled: false,
    activeWindowContextEnabled: false,
    companionAwarenessPaused: false,
    proactiveQuietHoursStart: 0,
    proactiveQuietHoursEnd: 0,
    proactiveAwayNotificationsEnabled: false,
  } as unknown as AppSettings
}

export function makeTask(): ReminderTask {
  return {
    id: 'task-1',
    title: 'Stand up',
    prompt: 'Time to move',
    action: { kind: 'notice' },
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    schedule: { kind: 'at', at: '2026-01-01T00:00:00.000Z' },
  }
}

export type DeliveryPayload = {
  message: { id: string; origin?: { taskId?: string; occurrenceDueAt?: number } }
}

export function createControllerSession(options: {
  deliver?: (payload: DeliveryPayload) => Promise<Record<string, unknown>>
  speakAssistantReply?: (text: string) => Promise<void>
  onError?: (value: string | null) => void
  settings?: Partial<AppSettings>
  appendChatMessage?: (message: { content: string }) => void
  telegramSendMessage?: (payload: { chatId: string; text: string }) => Promise<void>
  t?: NoticeDependencies['t']
  runtimeSnapshot?: ControllerOptions['runtimeSnapshot']
  reminderTasks?: ControllerOptions['reminderTaskStore']['reminderTasks']
  setReminderTasks?: ControllerOptions['reminderTaskStore']['setReminderTasks']
} = {}) {
  const clock = createClock()
  const inboxUpdates: string[] = []
  const storage = new Map<string, string>()
  const desktopPet: Record<string, unknown> = {
    updateProactiveInboxEntry: async (payload: { id: string; status: string }) => {
      inboxUpdates.push(`${payload.id}:${payload.status}`)
      return { updated: true, unreadCount: 0 }
    },
  }
  if (options.deliver) desktopPet.deliverProactiveMessage = options.deliver
  if (options.telegramSendMessage) desktopPet.telegramSendMessage = options.telegramSendMessage

  Object.defineProperty(globalThis, 'window', {
    value: {
      setTimeout: clock.setTimeout,
      clearTimeout: clock.clearTimeout,
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => { storage.set(key, String(value)) },
        removeItem: (key: string) => { storage.delete(key) },
      },
      desktopPet,
    },
    configurable: true,
    writable: true,
  })

  const props: ProbeProps = {
    settingsRef: { current: { ...createSettings(), ...options.settings } },
    runtimeSnapshot: options.runtimeSnapshot ?? { mood: 'idle', panelOnline: false, petOnline: false },
    reminderTasks: options.reminderTasks ?? [],
    setReminderTasks: options.setReminderTasks ?? (() => {}),
    ctx: {
      speakAssistantReply: options.speakAssistantReply ?? (async () => {}),
      voiceStateRef: { current: 'idle' },
    },
    t: options.t ?? ((key) => key),
    busyRef: { current: false },
    appendChatMessage: options.appendChatMessage ?? (() => {}),
    setError: options.onError ?? (() => {}),
    appendSystemMessage: () => {},
    sendMessage: async () => undefined,
    updatePetStatus: () => {},
    appendDebugConsoleEvent: () => {},
  }

  const renderer = createControllerRenderer()
  renderer.render(props)

  return {
    clock,
    inboxUpdates,
    readReminderTasks: () => JSON.parse(storage.get('nexus:reminder-tasks') ?? '[]') as ReminderTask[],
    get bubble() {
      return renderer.api?.bubble ?? null
    },
    trigger: (task: ReminderTask) => renderer.api!.trigger(task),
    push: (payload: CompanionNoticePayload) => renderer.api!.push(payload),
    flush: () => renderer.api!.flush(),
    hide: () => renderer.api!.hide(),
    unmount() {
      renderer.unmount()
      delete (globalThis as { window?: unknown }).window
    },
  }
}
