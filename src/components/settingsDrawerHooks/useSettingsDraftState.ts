import { useCallback, useMemo, useRef, useState } from 'react'
import type { PetModelDefinition } from '../../features/pet/index.ts'
import type { AppSettings } from '../../types/index.ts'
import {
  buildSettingsSavePayload,
  ensureDraftPetModelPreset,
  mergeHydratedSettingsSecrets,
} from './settingsDraftModel.ts'

export function useSettingsDraftState(settings: AppSettings) {
  const [draft, setDraft] = useState(settings)
  const [baseline, setBaseline] = useState(settings)
  const initialThemeIdRef = useRef(settings.themeId)

  const resetDraftForOpen = useCallback((nextSettings: AppSettings) => {
    initialThemeIdRef.current = nextSettings.themeId
    setBaseline(nextSettings)
    setDraft(nextSettings)
  }, [])

  const getRollbackThemeId = useCallback(() => initialThemeIdRef.current, [])

  const mergeHydratedSecrets = useCallback((incoming: AppSettings) => {
    setBaseline((current) => mergeHydratedSettingsSecrets(current, incoming))
    setDraft((current) => mergeHydratedSettingsSecrets(current, incoming))
  }, [])

  const ensurePetModelPreset = useCallback((
    petModelPresets: readonly Pick<PetModelDefinition, 'id'>[],
  ) => {
    setDraft((current) => ensureDraftPetModelPreset(current, petModelPresets))
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
    setDraft,
    resetDraftForOpen,
    getRollbackThemeId,
    mergeHydratedSecrets,
    ensurePetModelPreset,
    createSavePayload,
    isDirty,
  }
}
