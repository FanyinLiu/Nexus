/**
 * One persona resolution for every generation path.
 *
 * Chat, proactive V2 ticks, and Sunday letters used to read different
 * persona sources, so a default install had no persona for V2 and letters.
 * All three now ask this resolver, which walks one chain:
 *
 *   active profile dir → global SOUL.md → settings.systemPrompt → bundled default
 *
 * Source semantics:
 * - `profile`: the on-disk persona keeps its own style/examples/memory.
 * - `soul` / `systemPrompt`: identity text is synthesized into a persona.
 *   The bundled style and few-shot examples ride along only while the text
 *   still equals a shipped default; a user's own text never inherits them.
 * - `builtin`: last resort when every text source is empty. Read-only seed
 *   content — nothing is written to userData.
 *
 * The renderer cannot stat files, so the loader reports the profile soul's
 * mtime and the resolver records it with the cached entry. A soul-saved
 * broadcast drops cached profiles, which covers saves from any window.
 */

import type { AppSettings } from '../../types'
import { getDefaultSystemPrompt } from '../../lib/settingsMigrations.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { DEFAULT_PERSONA_PROFILE_ID, type LoadedPersona } from '../autonomy/v2/personaTypes.ts'
import { BUNDLED_DEFAULT_PERSONA } from './bundledPersona.ts'
import { PERSONA_SOUL_SAVED_CHANNEL } from './personaEvents.ts'

export type PersonaSource = 'profile' | 'soul' | 'systemPrompt' | 'builtin'

/** A persona plus the identity the prompt needs to address both sides. */
export interface ResolvedPersona extends LoadedPersona {
  source: PersonaSource
  companionName: string
  userName: string
}

/** Settings fields the chain reads. The chat flag is deliberately absent. */
export type PersonaResolverSettings = Pick<
  AppSettings,
  'activeCharacterProfileId' | 'systemPrompt' | 'uiLanguage' | 'companionName' | 'userName'
>

/** IPC surface used by the resolver. A missing method means "step absent". */
export interface PersonaBridge {
  loadProfile?: (profileId: string) => Promise<LoadedPersona | null | undefined>
  loadSoul?: () => Promise<string | null | undefined>
}

export type PersonaCache = Map<string, LoadedPersona & { source: PersonaSource }>

export interface ResolveActivePersonaDeps {
  bridge?: PersonaBridge
  /** Seed persona used as the last fallback and for default-text style. */
  bundled?: LoadedPersona
  defaultProfileId?: string
  /**
   * Cache of profile hits, keyed by the active profile id. Pass a fresh Map
   * in tests so cases cannot see each other's profiles.
   */
  cache?: PersonaCache
}

const defaultCache: PersonaCache = new Map()
let cacheObserverBound = false

/** Drop cached profile personas. Called by the soul-saved broadcast. */
export function invalidateResolvedPersonaCache(cache: PersonaCache = defaultCache): void {
  cache.clear()
}

function bindCacheObserver(): void {
  if (cacheObserverBound) return
  cacheObserverBound = true
  if (typeof BroadcastChannel === 'undefined') return
  try {
    const channel = new BroadcastChannel(PERSONA_SOUL_SAVED_CHANNEL)
    channel.addEventListener('message', () => invalidateResolvedPersonaCache())
    // Keep the node --test process free to exit; browsers have no unref.
    const unref = (channel as unknown as { unref?: () => void }).unref
    if (typeof unref === 'function') unref.call(channel)
  } catch (error) {
    console.warn('[persona] soul-saved listener unavailable:', getRedactedLogErrorMessage(error))
  }
}

function rendererBridge(): PersonaBridge {
  if (typeof window === 'undefined') return {}
  const desktopPet = window.desktopPet
  const loadProfile = desktopPet?.personaLoadProfile
  const loadSoul = desktopPet?.personaLoadSoul
  return {
    ...(typeof loadProfile === 'function'
      ? { loadProfile: (profileId: string) => loadProfile(profileId) }
      : {}),
    ...(typeof loadSoul === 'function' ? { loadSoul: () => loadSoul() } : {}),
  }
}

function normalizeLoadedPersona(persona: LoadedPersona): LoadedPersona {
  return {
    id: typeof persona.id === 'string' ? persona.id : '',
    rootDir: typeof persona.rootDir === 'string' ? persona.rootDir : '',
    soul: typeof persona.soul === 'string' ? persona.soul : '',
    memory: typeof persona.memory === 'string' ? persona.memory : '',
    examplesRaw: typeof persona.examplesRaw === 'string' ? persona.examplesRaw : '',
    examples: Array.isArray(persona.examples) ? persona.examples : [],
    style: persona.style && typeof persona.style === 'object' ? persona.style : {},
    voice: persona.voice && typeof persona.voice === 'object' ? persona.voice : {},
    tools: persona.tools && typeof persona.tools === 'object' ? persona.tools : {},
    present: persona.present === true,
    ...(typeof persona.soulMtimeMs === 'number' && Number.isFinite(persona.soulMtimeMs)
      ? { soulMtimeMs: persona.soulMtimeMs }
      : {}),
  }
}

async function loadProfileChain(
  bridge: PersonaBridge,
  activeId: string,
  defaultId: string,
): Promise<LoadedPersona | null> {
  const load = bridge.loadProfile
  if (!load) return null
  const ids = activeId && activeId !== defaultId ? [activeId, defaultId] : [defaultId]
  for (const id of ids) {
    try {
      const loaded = await load(id)
      if (loaded?.present) return normalizeLoadedPersona(loaded)
    } catch (error) {
      console.warn('[persona] profile load failed:', getRedactedLogErrorMessage(error))
    }
  }
  return null
}

async function loadGlobalSoul(bridge: PersonaBridge): Promise<string> {
  if (!bridge.loadSoul) return ''
  try {
    const soul = await bridge.loadSoul()
    return typeof soul === 'string' ? soul : ''
  } catch (error) {
    console.warn('[persona] soul file load failed:', getRedactedLogErrorMessage(error))
    return ''
  }
}

/**
 * True while the text still equals one of the shipped defaults. Such a user
 * has never picked a persona of their own, so the bundled voice may speak for
 * them; anything else would be putting words in their mouth.
 */
function isShippedDefaultText(text: string, uiLanguage: AppSettings['uiLanguage']): boolean {
  const trimmed = text.trim()
  if (!trimmed) return false
  return trimmed === getDefaultSystemPrompt(uiLanguage).trim()
    || trimmed === getDefaultSystemPrompt('en-US').trim()
}

function textSourcePersona(options: {
  text: string
  source: Extract<PersonaSource, 'soul' | 'systemPrompt'>
  settings: PersonaResolverSettings
  profile: LoadedPersona | null
  bundled: LoadedPersona
  defaultProfileId: string
}): LoadedPersona & { source: PersonaSource } {
  const { text, source, settings, profile, bundled, defaultProfileId } = options
  const inheritBundled = isShippedDefaultText(text, settings.uiLanguage)
  // A profile may hold style/memory without a soul. Keep those files when
  // the identity text itself has to come from a later step in the chain.
  const profileWithoutSoul = profile?.present === true && !profile.soul.trim() ? profile : null
  const styleSource = profileWithoutSoul ? profileWithoutSoul.style : (inheritBundled ? bundled.style : {})
  const examplesSource = profileWithoutSoul
    ? profileWithoutSoul.examples
    : (inheritBundled ? bundled.examples : [])
  const examplesRawSource = profileWithoutSoul
    ? profileWithoutSoul.examplesRaw
    : (inheritBundled ? bundled.examplesRaw : '')
  return {
    id: profile?.id || defaultProfileId,
    rootDir: profile?.rootDir || '',
    soul: text,
    memory: profile?.memory ?? '',
    examplesRaw: examplesRawSource,
    examples: examplesSource,
    style: styleSource,
    voice: profileWithoutSoul ? profileWithoutSoul.voice : (inheritBundled ? bundled.voice : {}),
    tools: profileWithoutSoul ? profileWithoutSoul.tools : (inheritBundled ? bundled.tools : {}),
    present: true,
    source,
  }
}

function withNames(
  persona: LoadedPersona & { source: PersonaSource },
  settings: PersonaResolverSettings,
): ResolvedPersona {
  return {
    ...persona,
    companionName: typeof settings.companionName === 'string' ? settings.companionName.trim() : '',
    userName: typeof settings.userName === 'string' ? settings.userName.trim() : '',
  }
}

/**
 * Resolve the persona every generation path should use for these settings.
 * Never throws: a failed source is logged (redacted) and the chain continues,
 * ending at the bundled seed persona.
 */
export async function resolveActivePersona(
  settings: PersonaResolverSettings,
  deps: ResolveActivePersonaDeps = {},
): Promise<ResolvedPersona> {
  const bridge = deps.bridge ?? rendererBridge()
  const bundled = deps.bundled ?? BUNDLED_DEFAULT_PERSONA
  const defaultProfileId = deps.defaultProfileId ?? DEFAULT_PERSONA_PROFILE_ID
  const activeId = String(settings.activeCharacterProfileId ?? '').trim()
  const cache = deps.cache ?? defaultCache
  if (deps.cache == null) bindCacheObserver()

  const cached = cache.get(activeId || defaultProfileId)
  if (cached) return withNames(cached, settings)

  const profile = await loadProfileChain(bridge, activeId, defaultProfileId)
  if (profile?.soul.trim()) {
    const resolved = { ...profile, source: 'profile' as const }
    cache.set(activeId || profile.id || defaultProfileId, resolved)
    return withNames(resolved, settings)
  }

  const soulText = await loadGlobalSoul(bridge)
  if (soulText !== '') {
    return withNames(textSourcePersona({
      text: soulText,
      source: 'soul',
      settings,
      profile,
      bundled,
      defaultProfileId,
    }), settings)
  }

  const systemPrompt = typeof settings.systemPrompt === 'string' ? settings.systemPrompt : ''
  if (systemPrompt !== '') {
    return withNames(textSourcePersona({
      text: systemPrompt,
      source: 'systemPrompt',
      settings,
      profile,
      bundled,
      defaultProfileId,
    }), settings)
  }

  return withNames({
    ...bundled,
    id: bundled.id || profile?.id || defaultProfileId,
    memory: profile?.memory ?? bundled.memory,
    present: true,
    source: 'builtin',
  }, settings)
}
