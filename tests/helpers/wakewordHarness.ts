/**
 * Shared harness for the wake-word → model setup tests.
 *
 * Both the panel and the pet window reach the installer through the same
 * overlay save path, so the React renderer stub and the overlay props live
 * here instead of being copied into every wake-word test file.
 *
 * The renderer stub only implements the hooks the overlay uses, so a hook
 * that grows a new dependency fails loudly instead of silently rendering
 * against an incomplete dispatcher.
 */

import React from 'react'

import type { useAppOverlays } from '../../src/app/controllers/useAppOverlays.ts'
import type { AppSettings } from '../../src/types'

type ReactInternals = { H: unknown }
const reactInternals = (React as unknown as {
  __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: ReactInternals
}).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

type EffectSlot = { deps?: readonly unknown[]; cleanup?: () => void }

export type HookRenderer = {
  render: () => void
  unmount: () => void
}

/**
 * Minimal React renderer for hook-only assertions. It runs the effects of a
 * single hook function and keeps their cleanups so unmount can be asserted.
 */
export function createHookRenderer(hook: () => void): HookRenderer {
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
    useCallback(fn: unknown) {
      cursor++
      return fn
    },
    useMemo(fn: () => unknown) {
      cursor++
      return fn()
    },
    useContext() {
      cursor++
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
      if (changed) {
        effects[index] = { deps }
        pending.push({ index, callback })
      }
    },
    useLayoutEffect(callback: () => void | (() => void), deps?: readonly unknown[]) {
      this.useEffect(callback, deps)
    },
  }

  function render() {
    cursor = 0
    pending = []
    reactInternals.H = dispatcher
    try {
      hook()
    } finally {
      reactInternals.H = null
    }
    for (const { index, callback } of pending) {
      const slot = effects[index]
      slot.cleanup?.()
      const cleanup = callback()
      slot.cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
  }

  function unmount() {
    for (const effect of effects) effect?.cleanup?.()
  }

  return { render, unmount }
}

/** Props the overlay needs; everything unrelated to voice stays inert. */
export function createOverlayProps(view: 'pet' | 'panel', settings: AppSettings) {
  const noop = () => {}
  return {
    view,
    settings,
    platformProfile: { startup: { supported: false } },
    setSettings: noop,
    settingsOpen: false,
    preferredSettingsSectionId: null,
    preferredMemoryFocus: null,
    setSettingsOpen: noop,
    petModelPresets: [],
    petModelPresetsReady: true,
    petRuntimeContinuousVoiceActive: false,
    reminderTasks: [],
    debugConsoleEvents: [],
    loadPetModels: async () => [],
    memory: {
      memories: [],
      dailyMemories: [],
      recentDailyMemoryEntries: [],
      exportMemoryArchive: async () => '',
      importMemoryArchive: async () => {},
      clearMemoryArchive: async () => {},
      addManualMemory: () => {},
      updateMemory: () => {},
      patchMemory: () => {},
      setMemoryEnabled: () => {},
      removeMemory: () => {},
      clearTodayDailyMemory: () => {},
      updateDailyEntry: () => {},
      removeDailyEntry: () => {},
    },
    chat: {
      messages: [],
      busy: false,
      busyRef: { current: false },
      currentSessionId: '',
      setError: noop,
      appendSystemMessage: noop,
      appendChatMessage: noop,
      cancelActiveTurn: noop,
      exportChatHistory: async () => '',
      importChatHistory: async () => {},
      clearChatHistory: async () => {},
    },
    pet: { setMood: noop },
    voice: {
      voiceState: 'idle',
      continuousVoiceActive: false,
      toggleVoiceConversation: noop,
      stopVoiceConversation: noop,
      voiceStateRef: { current: 'idle' },
      liveTranscript: '',
      speechLevelSource: null,
      voicePipeline: null,
      voiceTrace: [],
      stopActiveSpeechOutput: noop,
      setVoiceState: noop,
      runAudioSmokeTest: async () => ({ ok: true }),
      startSpeechOutput: async () => {},
      testSpeechInputConnection: async () => ({ ok: true }),
      testSpeechOutputReadiness: async () => ({ ok: true }),
    },
    addReminderTask: () => null,
    updateReminderTask: () => null,
    removeReminderTask: () => null,
    clearDebugConsoleEvents: noop,
  } as unknown as Parameters<typeof useAppOverlays>[0]
}

/** Settings with the wake-word control switched on or off. */
export function wakewordSettings(settings: AppSettings, enabled: boolean): AppSettings {
  return {
    ...settings,
    wakewordAlwaysOn: enabled,
    voiceTriggerMode: enabled ? 'wake_word' : 'direct_send',
  }
}

/** Lets the promise chain of a settings save settle. */
export async function flushAsyncWork(): Promise<void> {
  for (let i = 0; i < 6; i += 1) await Promise.resolve()
}
