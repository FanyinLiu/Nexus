/**
 * The SOUL card reads and writes the persona text chat actually uses.
 *
 * An active profile's soul.md wins, then the global SOUL file, then
 * settings.systemPrompt — the same chain the chat prompt builder uses.
 * A legacy localStorage note is copied once into an empty override and then
 * removed. Saves use the existing panel-only persona channel and do nothing
 * when this window is not allowed to write.
 */

import { PERSONA_SOUL_MAX_CHARS } from '../../../shared/personaSoul.js'
import { normalizePersonaSpeechStyle } from '../../../shared/speechStyle.js'
import { loadActiveProfilePersona } from '../chat/systemPromptBuilder.ts'
import { invalidateResolvedPersonaCache } from '../persona/resolveActivePersona.ts'
import { PERSONA_SOUL_SAVED_CHANNEL } from '../persona/personaEvents.ts'
import { DEFAULT_PERSONA_PROFILE_ID, type PersonaSpeechStyle } from '../autonomy/v2/personaTypes.ts'
import type { AppSettings } from '../../types/app.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { canUsePanelOnlyBridge } from '../../lib/windowCapability.ts'
import { clearCompanionSoul, loadCompanionSoul } from '../../lib/storage/companionSoul.ts'

export type SoulCardTarget =
  | { kind: 'profile'; profileId: string }
  | { kind: 'soul-file' }

export interface SoulCardNote {
  /** Text the model will receive on the next reply. */
  text: string
  updatedAt: string | null
  target: SoulCardTarget
  /** Structured dials that shape how she talks, when the profile has them. */
  speechStyle?: PersonaSpeechStyle
}

type LoadedSoul = SoulCardNote & {
  /** Raw override file. Empty means the fallback chain is what the model sees. */
  overrideText: string
}

export type SoulCardSettings = Pick<
  AppSettings,
  'activeCharacterProfileId' | 'systemPrompt'
>

export type SoulCardSaveResult =
  | { ok: true; note: SoulCardNote; restoredDefault: boolean }
  | { ok: false; reason: 'too-long' | 'rejected' }

/**
 * Load the persona text the next chat reply will use, migrating a legacy
 * note into an empty override first.
 */
export async function loadSoulCard(settings: SoulCardSettings): Promise<SoulCardNote> {
  try {
    const note = await readEffectiveSoul(settings)
    return visibleNote(await migrateLegacySoul(note))
  } catch (error) {
    console.warn('[memory] soul load failed:', getRedactedLogErrorMessage(error))
    return {
      text: typeof settings.systemPrompt === 'string' ? settings.systemPrompt : '',
      updatedAt: null,
      target: { kind: 'soul-file' },
    }
  }
}

/**
 * Write the card draft to the persona source chat will read next.
 * A blank draft clears the override so the fallback applies again.
 * An oversized draft is refused and nothing is written.
 */
export async function saveSoulCard(
  settings: SoulCardSettings,
  text: string,
): Promise<SoulCardSaveResult> {
  const content = text.replace(/\r\n/g, '\n').trim()
  if (content.length > PERSONA_SOUL_MAX_CHARS) {
    return { ok: false, reason: 'too-long' }
  }
  try {
    const current = await readEffectiveSoul(settings)
    const written = await writeSoul(current.target, content)
    if (written == null) return { ok: false, reason: 'rejected' }
    const fresh = await readEffectiveSoul(settings)
    return {
      ok: true,
      restoredDefault: written === '',
      note: {
        text: fresh.text,
        updatedAt: new Date().toISOString(),
        target: fresh.target,
      },
    }
  } catch (error) {
    console.warn('[memory] soul save failed:', getRedactedLogErrorMessage(error))
    return { ok: false, reason: 'rejected' }
  }
}

export type SoulStyleSaveResult =
  | { ok: true; speechStyle: PersonaSpeechStyle }
  | { ok: false; reason: 'rejected' }

/**
 * Save the SOUL card's speech dials into the active profile's style.json.
 *
 * The card may be showing the global SOUL file while the dials still belong
 * to a profile, so the write goes to the active profile id (or the bundled
 * default) and the main process creates the directory when it is missing.
 * Other style.json fields are preserved by the writer.
 */
export async function saveSoulSpeechStyle(
  settings: SoulCardSettings,
  style: PersonaSpeechStyle,
): Promise<SoulStyleSaveResult> {
  const normalized = normalizePersonaSpeechStyle(style)
  if (!normalized) return { ok: false, reason: 'rejected' }
  if (!(await canUsePanelOnlyBridge())) return { ok: false, reason: 'rejected' }
  const save = window.desktopPet?.personaSaveStyle
  if (!save) return { ok: false, reason: 'rejected' }
  try {
    const current = await readEffectiveSoul(settings)
    const profileId = current.target.kind === 'profile'
      ? current.target.profileId
      : (settings.activeCharacterProfileId?.trim() || DEFAULT_PERSONA_PROFILE_ID)
    const result = await save({ profileId, speechStyle: normalized })
    if (!result?.ok) return { ok: false, reason: 'rejected' }
    publishPersonaSoulSaved()
    invalidateResolvedPersonaCache()
    return { ok: true, speechStyle: normalized }
  } catch (error) {
    console.warn('[memory] speech style save failed:', getRedactedLogErrorMessage(error))
    return { ok: false, reason: 'rejected' }
  }
}

/** Same truthiness as `profileSoul || globalSoul || systemPrompt` in the prompt builder. */function effectivePersonaText(profileSoul: string, globalSoul: string, systemPrompt: string): string {
  const selected = profileSoul || globalSoul || systemPrompt
  return typeof selected === 'string' ? selected : ''
}

function visibleNote(note: LoadedSoul): SoulCardNote {
  return {
    text: note.text,
    updatedAt: note.updatedAt,
    target: note.target,
    ...(note.speechStyle ? { speechStyle: note.speechStyle } : {}),
  }
}

async function readEffectiveSoul(settings: SoulCardSettings): Promise<LoadedSoul> {
  const globalSoul = await readGlobalSoul()
  const systemPrompt = typeof settings.systemPrompt === 'string' ? settings.systemPrompt : ''
  const profile = await loadActiveProfilePersona(settings)
  if (profile?.present && profile.id.trim()) {
    const overrideText = typeof profile.soul === 'string' ? profile.soul : ''
    const speechStyle = normalizePersonaSpeechStyle(profile.style?.speechStyle)
    return {
      text: effectivePersonaText(overrideText, globalSoul, systemPrompt),
      overrideText,
      updatedAt: null,
      target: { kind: 'profile', profileId: profile.id },
      ...(speechStyle ? { speechStyle } : {}),
    }
  }
  return {
    text: effectivePersonaText('', globalSoul, systemPrompt),
    overrideText: globalSoul,
    updatedAt: null,
    target: { kind: 'soul-file' },
  }
}

async function readGlobalSoul(): Promise<string> {
  try {
    const soul = await window.desktopPet?.personaLoadSoul?.()
    return typeof soul === 'string' ? soul : ''
  } catch (error) {
    console.warn('[memory] soul load failed:', getRedactedLogErrorMessage(error))
    return ''
  }
}

/**
 * Copy the legacy note only when the live override is empty, then drop the
 * note so a later empty override cannot pick it up again. A refused write
 * leaves the note in place for a later attempt. Emptiness here is the file,
 * not the system-prompt fallback the card may be showing.
 */
async function migrateLegacySoul(note: LoadedSoul): Promise<LoadedSoul> {
  const legacy = loadCompanionSoul()
  if (!legacy.text.trim() || note.overrideText.trim()) {
    clearCompanionSoul()
    return note
  }
  const written = await writeSoul(note.target, legacy.text)
  if (written == null) return note
  clearCompanionSoul()
  return { ...note, text: written, overrideText: written, updatedAt: legacy.updatedAt }
}

async function writeSoul(target: SoulCardTarget, text: string): Promise<string | null> {
  if (!(await canUsePanelOnlyBridge())) return null
  const save = window.desktopPet?.personaSaveSoul
  if (!save) return null
  const content = text.replace(/\r\n/g, '\n').trim()
  try {
    const result = await save(
      target.kind === 'profile'
        ? { content, profileId: target.profileId }
        : { content },
    )
    if (!result?.ok) return null
  } catch (error) {
    console.warn('[memory] soul save failed:', getRedactedLogErrorMessage(error))
    return null
  }
  publishPersonaSoulSaved()
  // Same-window saves are not delivered to the writer's own BroadcastChannel,
  // so drop the cached persona here as well.
  invalidateResolvedPersonaCache()
  return content
}

function publishPersonaSoulSaved(): void {
  if (typeof BroadcastChannel === 'undefined') return
  const channel = new BroadcastChannel(PERSONA_SOUL_SAVED_CHANNEL)
  try {
    channel.postMessage({ saved: true })
  } catch (error) {
    console.warn('[memory] soul save notice failed:', getRedactedLogErrorMessage(error))
  } finally {
    channel.close()
  }
}
