import { shorten } from '../lib/common.ts'
import { pickTranslatedUiText } from '../lib/uiLanguage.ts'
import type {
  AppSettings,
  MemoryItem,
  PetTouchZone,
  TranslationKey,
  UiLanguage,
  VoiceState,
  WindowView,
} from '../types/index.ts'

type Translator = (
  key: TranslationKey,
  params?: Parameters<typeof pickTranslatedUiText>[2],
) => string

const VOICE_STATE_KEYS: Record<VoiceState, TranslationKey> = {
  idle: 'voice_state.idle',
  listening: 'voice_state.listening',
  processing: 'voice_state.processing',
  speaking: 'voice_state.speaking',
}

export function getVoiceStateLabel(state: VoiceState, ti: Translator): string {
  return ti(VOICE_STATE_KEYS[state])
}

// Short one-liners shown in the pet status bubble when the user clicks the
// corresponding zone of the Live2D mascot. The tap handler also triggers a
// matching expression slot + "hit" motion group via the Live2D canvas, so
// these strings are pure flavour — they fire together with the visual reaction.
// Pool is intentionally wide (6 per zone) so repeated tapping doesn't read
// as a script. `pickHoverReaction` rolls a uniform random pick per tap and
// returns the already-localized message.
const HOVER_REACTION_KEYS: Record<PetTouchZone, readonly TranslationKey[]> = {
  head: [
    'touch.head.1', 'touch.head.2', 'touch.head.3',
    'touch.head.4', 'touch.head.5', 'touch.head.6',
  ],
  face: [
    'touch.face.1', 'touch.face.2', 'touch.face.3',
    'touch.face.4', 'touch.face.5', 'touch.face.6',
  ],
  body: [
    'touch.body.1', 'touch.body.2', 'touch.body.3',
    'touch.body.4', 'touch.body.5', 'touch.body.6',
  ],
}

export function pickHoverReaction(zone: PetTouchZone, ti: Translator): string {
  const pool = HOVER_REACTION_KEYS[zone]
  const key = pool[Math.floor(Math.random() * pool.length)] ?? pool[0]
  return ti(key)
}

export const STARTUP_GREETING_DURATION_MS = 9_200
export const STARTUP_GREETING_SESSION_KEY = 'nexus:startup-greeting-shown'
export const VOICE_TRIGGER_DIRECT_SEND_MIGRATION_KEY = 'nexus:voice-trigger-direct-send-migration-v1'

/** Synchronous initial guess from URL params (safe for useState initializers). */
export function getWindowViewSync(): WindowView {
  return new URLSearchParams(window.location.search).get('view') === 'panel'
    ? 'panel'
    : 'pet'
}

/** Async check that also consults the Electron preload bridge. */
export async function getWindowView(): Promise<WindowView> {
  if (await window.desktopPet?.isPanelWindow?.()) {
    return 'panel'
  }
  return getWindowViewSync()
}

export type PanelSection = 'chat' | 'settings'

export function getInitialPanelSection(): PanelSection {
  return new URLSearchParams(window.location.search).get('section') === 'settings'
    ? 'settings'
    : 'chat'
}

export function getInitialSettingsSectionId(): string | null {
  const searchParams = new URLSearchParams(window.location.search)
  if (searchParams.get('section') !== 'settings') return null
  const value = searchParams.get('settingsSection')?.trim()
  return value ? value : null
}

export function syncWindowViewToUrl(
  view: WindowView,
  section?: PanelSection,
  settingsSectionId?: string | null,
): void {
  const url = new URL(window.location.href)
  url.searchParams.set('view', view)

  if (view === 'panel') {
    const nextSection = section ?? 'chat'
    url.searchParams.set('section', nextSection)
    if (nextSection === 'settings' && settingsSectionId) {
      url.searchParams.set('settingsSection', settingsSectionId)
    } else {
      url.searchParams.delete('settingsSection')
    }
  } else {
    url.searchParams.delete('section')
    url.searchParams.delete('settingsSection')
  }

  window.history.replaceState(window.history.state, '', url)
}

export function getImage4PreviewModeSync(): boolean {
  return new URLSearchParams(window.location.search).get('image4Preview') === '1'
}

export function getImage4RhythmGridModeSync(): boolean {
  return new URLSearchParams(window.location.search).get('image4Grid') === '1'
}

export function getImage4SnapshotModeSync(): boolean {
  return new URLSearchParams(window.location.search).get('image4Snapshot') === '1'
}

export function getImage4StatePreviewSync(): string | null {
  const value = new URLSearchParams(window.location.search).get('image4State')
  return value === 'idle' || value === 'attentive' || value === 'speaking' || value === 'resting'
    ? value
    : null
}

export function getTimeGreeting(ti: Translator): string {
  const hour = new Date().getHours()

  if (hour < 5) return ti('time_greeting.deep_night')
  if (hour < 11) return ti('time_greeting.morning')
  if (hour < 14) return ti('time_greeting.noon')
  if (hour < 18) return ti('time_greeting.afternoon')
  return ti('time_greeting.evening')
}

/**
 * Decorative emoji that pairs with the current time-greeting. Rendered
 * only in visual UI (welcome panel) — never concatenated into copy that
 * could end up in TTS, since "☀️" gets read as "sun emoji" by some
 * speech engines.
 */
export function getTimeGreetingEmoji(date = new Date()): string {
  const hour = date.getHours()
  if (hour < 5) return '🌙'
  if (hour < 11) return '☀️'
  if (hour < 14) return '🌤️'
  if (hour < 18) return '⛅'
  if (hour < 22) return '🌇'
  return '🌃'
}

export function getLiveTranscriptLabel(voiceState: VoiceState, ti: Translator): string {
  return voiceState === 'listening'
    ? ti('live_transcript.recognizing')
    : ti('live_transcript.result')
}

export function buildStartupGreetingText(
  settings: AppSettings,
  memories: MemoryItem[],
  ti: Translator,
): string {
  const greeting = getTimeGreeting(ti)
  const latestMemory = memories[0]?.content

  if (latestMemory) {
    return ti('startup_greeting.with_memory', {
      greeting,
      userName: settings.userName,
      memory: shorten(latestMemory, 20),
    })
  }

  return ti('startup_greeting.plain', {
    greeting,
    userName: settings.userName,
    companionName: settings.companionName,
  })
}

/** Helper for callers that don't already have a ti() — builds one on the fly. */
export function makeTranslator(uiLanguage: UiLanguage): Translator {
  return (key, params) => pickTranslatedUiText(uiLanguage, key, params)
}
