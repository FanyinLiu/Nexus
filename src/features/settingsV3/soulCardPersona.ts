/**
 * The SOUL card reads and writes the persona text chat actually uses.
 *
 * An active profile persona wins; otherwise the global SOUL file. A legacy
 * localStorage note is copied once into an empty target and then removed.
 * Saves use the existing panel-only persona channel and do nothing when this
 * window is not allowed to write.
 */

import { loadActiveProfilePersona } from '../chat/systemPromptBuilder.ts'
import type { AppSettings } from '../../types/app.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { canUsePanelOnlyBridge } from '../../lib/windowCapability.ts'
import { clearCompanionSoul, loadCompanionSoul } from '../../lib/storage/companionSoul.ts'

/** Cross-window notice that soul text was written. The body is not the text. */
export const PERSONA_SOUL_SAVED_CHANNEL = 'nexus-persona-soul'

export type SoulCardTarget =
  | { kind: 'profile'; profileId: string }
  | { kind: 'soul-file' }

export interface SoulCardNote {
  text: string
  updatedAt: string | null
  target: SoulCardTarget
}

export type SoulCardSettings = Pick<AppSettings, 'profilePersonaInChatEnabled' | 'activeCharacterProfileId'>

/**
 * Load the persona text the next chat reply will use, migrating a legacy
 * note into an empty target first.
 */
export async function loadSoulCard(settings: SoulCardSettings): Promise<SoulCardNote> {
  try {
    const note = await readEffectiveSoul(settings)
    return await migrateLegacySoul(note)
  } catch (error) {
    console.warn('[memory] soul load failed:', getRedactedLogErrorMessage(error))
    return { text: '', updatedAt: null, target: { kind: 'soul-file' } }
  }
}

/**
 * Write the card draft to the persona source chat will read next.
 * Returns null when the write is refused.
 */
export async function saveSoulCard(
  settings: SoulCardSettings,
  text: string,
): Promise<SoulCardNote | null> {
  try {
    const current = await readEffectiveSoul(settings)
    const written = await writeSoul(current.target, text)
    if (written == null) return null
    return {
      text: written,
      updatedAt: new Date().toISOString(),
      target: current.target,
    }
  } catch (error) {
    console.warn('[memory] soul save failed:', getRedactedLogErrorMessage(error))
    return null
  }
}

async function readEffectiveSoul(settings: SoulCardSettings): Promise<SoulCardNote> {
  const profile = await loadActiveProfilePersona(settings)
  if (profile?.present && profile.id.trim()) {
    return {
      text: profile.soul ?? '',
      updatedAt: null,
      target: { kind: 'profile', profileId: profile.id },
    }
  }
  const soul = await readGlobalSoul()
  return { text: soul, updatedAt: null, target: { kind: 'soul-file' } }
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
 * Copy the legacy note only when the live target is empty, then drop the
 * note so a later empty target cannot pick it up again. A refused write
 * leaves the note in place for a later attempt.
 */
async function migrateLegacySoul(note: SoulCardNote): Promise<SoulCardNote> {
  const legacy = loadCompanionSoul()
  if (!legacy.text.trim()) {
    clearCompanionSoul()
    return note
  }
  if (note.text.trim()) {
    clearCompanionSoul()
    return note
  }
  const written = await writeSoul(note.target, legacy.text)
  if (written == null) return note
  clearCompanionSoul()
  return { ...note, text: written, updatedAt: legacy.updatedAt }
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
