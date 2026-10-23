/**
 * Draft versus the last settings that were actually stored.
 *
 * Dirty checking and the next save's field diff share that snapshot. The
 * snapshot has to move before the save promise resolves: a microphone denial
 * saves again in the same click, and the React state from the first save has
 * not rendered yet. A ref updated inside the save is what that second diff sees.
 */

import { useCallback, useMemo, useRef, useState, type SetStateAction } from 'react'
import type { PetModelDefinition } from '../../features/pet/index.ts'
import type { AppSettings } from '../../types/index.ts'
import {
  buildSettingsSavePayload,
  ensureDraftPetModelPreset,
  mergeHydratedSettingsSecrets,
} from './settingsDraftModel.ts'

function sameSettingsPayload(left: AppSettings, right: AppSettings): boolean {
  return JSON.stringify(buildSettingsSavePayload(left))
    === JSON.stringify(buildSettingsSavePayload(right))
}

export function useSettingsDraftState(settings: AppSettings) {
  const [draft, setDraftState] = useState(settings)
  const [baseline, setBaseline] = useState(settings)
  // Assigned only when the stored snapshot changes. Rendering must not copy
  // state back into these, or a save that has not re-rendered yet is lost.
  const draftRef = useRef(settings)
  const baselineRef = useRef(settings)
  const initialThemeIdRef = useRef(settings.themeId)
  const initialColorSchemeRef = useRef(settings.themeColorScheme)

  const setDraft = useCallback((action: SetStateAction<AppSettings>) => {
    const next = typeof action === 'function' ? action(draftRef.current) : action
    draftRef.current = next
    setDraftState(next)
  }, [])

  const resetDraftForOpen = useCallback((nextSettings: AppSettings) => {
    initialThemeIdRef.current = nextSettings.themeId
    initialColorSchemeRef.current = nextSettings.themeColorScheme
    baselineRef.current = nextSettings
    draftRef.current = nextSettings
    setBaseline(nextSettings)
    setDraftState(nextSettings)
  }, [])

  const getRollbackThemeId = useCallback(() => initialThemeIdRef.current, [])
  const getRollbackColorScheme = useCallback(() => initialColorSchemeRef.current, [])

  const mergeHydratedSecrets = useCallback((incoming: AppSettings) => {
    const nextBaseline = mergeHydratedSettingsSecrets(baselineRef.current, incoming)
    const nextDraft = mergeHydratedSettingsSecrets(draftRef.current, incoming)
    if (nextBaseline !== baselineRef.current) {
      baselineRef.current = nextBaseline
      setBaseline(nextBaseline)
    }
    if (nextDraft !== draftRef.current) {
      draftRef.current = nextDraft
      setDraftState(nextDraft)
    }
  }, [])

  const ensurePetModelPreset = useCallback((
    petModelPresets: readonly Pick<PetModelDefinition, 'id'>[],
  ) => {
    const next = ensureDraftPetModelPreset(draftRef.current, petModelPresets)
    if (next === draftRef.current) return
    draftRef.current = next
    setDraftState(next)
  }, [])

  const patchCommittedField = useCallback(<K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K],
  ) => {
    if (draftRef.current[key] !== value) {
      draftRef.current = { ...draftRef.current, [key]: value }
      setDraftState(draftRef.current)
    }
    if (baselineRef.current[key] !== value) {
      baselineRef.current = { ...baselineRef.current, [key]: value }
      setBaseline(baselineRef.current)
    }
  }, [])

  /**
   * The store finished this save. Later diffs use `persisted`, not the
   * snapshot from when the drawer opened. A draft edited while the save was
   * in flight stays on screen; an untouched draft adopts the stored value so
   * a normalized field does not look unsaved.
   */
  const rememberSavedSettings = useCallback((persisted: AppSettings, requested: AppSettings) => {
    baselineRef.current = persisted
    setBaseline(persisted)
    if (!sameSettingsPayload(draftRef.current, requested)) return
    draftRef.current = persisted
    setDraftState(persisted)
  }, [])

  const createSavePayload = useCallback(
    () => buildSettingsSavePayload(draft),
    [draft],
  )
  const isDirty = useMemo(
    () => JSON.stringify(buildSettingsSavePayload(draft))
      !== JSON.stringify(buildSettingsSavePayload(baseline)),
    [baseline, draft],
  )

  return {
    draft,
    baseline,
    baselineRef,
    setDraft,
    resetDraftForOpen,
    getRollbackThemeId,
    getRollbackColorScheme,
    mergeHydratedSecrets,
    ensurePetModelPreset,
    patchCommittedField,
    rememberSavedSettings,
    createSavePayload,
    isDirty,
  }
}
