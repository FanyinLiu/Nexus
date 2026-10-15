import { useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { humanizeError } from '../../lib/humanizeError.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { extractPetIpcErrorCode } from '../../../shared/petErrorCodes.js'
import {
  formatPetModelImportPresentation,
  type PetUserMessageResult,
  type CodexPetGalleryCatalogResult,
  type PetModelImportResult,
  type PetModelDefinition,
} from '../../features/pet'
import type { ConnectionResult } from '../settingsDrawerSupport.ts'
import type { AppSettings } from '../../types'

export type UsePetModelImportOptions = {
  onImportPetModel: () => Promise<PetModelImportResult | null>
  onImportCodexPetGallery?: (input: string) => Promise<{
    model: PetModelDefinition
    message: string
  }>
  onListCodexPetGallery?: (query?: string) => Promise<CodexPetGalleryCatalogResult>
  onSelectImportedPetModel?: (petModelId: string) => Promise<void> | void
  setDraft: Dispatch<SetStateAction<AppSettings>>
}

export function usePetModelImport({
  onImportPetModel,
  onImportCodexPetGallery,
  onListCodexPetGallery,
  onSelectImportedPetModel,
  setDraft,
}: UsePetModelImportOptions) {
  const { t } = useTranslation()
  const importingPetModelRef = useRef(false)
  const [importingPetModel, setImportingPetModel] = useState(false)
  const [petModelStatus, setPetModelStatus] = useState<ConnectionResult | null>(null)
  const [codexPetCatalog, setCodexPetCatalog] = useState<CodexPetGalleryCatalogResult | null>(null)
  const [codexPetCatalogLoading, setCodexPetCatalogLoading] = useState(false)
  const [codexPetCatalogStatus, setCodexPetCatalogStatus] = useState<ConnectionResult | null>(null)

  function getPetImportErrorMessage(error: unknown) {
    if (extractPetIpcErrorCode(error)) {
      return humanizeError(error, 'pet')
    }
    return getRedactedLogErrorMessage(error) || t('settings.pet.import_error')
  }

  function presentPetUserMessage(result: PetUserMessageResult) {
    return formatPetModelImportPresentation(result, t).message
  }

  async function runPetModelImport(work: () => Promise<void>) {
    if (importingPetModelRef.current) return
    importingPetModelRef.current = true
    setImportingPetModel(true)
    setPetModelStatus(null)
    try {
      await work()
    } catch (error) {
      setPetModelStatus({
        ok: false,
        message: getPetImportErrorMessage(error),
      })
    } finally {
      importingPetModelRef.current = false
      setImportingPetModel(false)
    }
  }

  async function handleImportPetModel() {
    await runPetModelImport(async () => {
      const result = await onImportPetModel()
      if (!result) return

      const presentation = formatPetModelImportPresentation(result, t)
      if (!result.model) {
        setPetModelStatus({
          ok: false,
          message: presentation.message,
          recommendation: presentation.recommendation,
        })
        return
      }

      const importedModel = result.model
      setDraft((current) => ({
        ...current,
        petModelId: importedModel.id,
      }))
      await onSelectImportedPetModel?.(importedModel.id)
      setPetModelStatus({
        ok: true,
        message: presentation.message,
        recommendation: presentation.recommendation,
      })
    })
  }

  async function handleImportCodexPetGallery(input: string) {
    if (!onImportCodexPetGallery) {
      return
    }

    await runPetModelImport(async () => {
      const result = await onImportCodexPetGallery(input)

      setDraft((current) => ({
        ...current,
        petModelId: result.model.id,
      }))
      await onSelectImportedPetModel?.(result.model.id)
      setPetModelStatus({
        ok: true,
        message: presentPetUserMessage(result),
      })
    })
  }

  async function handleLoadCodexPetGallery(query = '') {
    if (!onListCodexPetGallery) {
      return
    }

    setCodexPetCatalogLoading(true)
    setCodexPetCatalogStatus(null)

    try {
      const result = await onListCodexPetGallery(query)
      setCodexPetCatalog(result)
      setCodexPetCatalogStatus({
        ok: true,
        message: t('settings.chat.codex_pet_catalog_count', {
          shown: result.pets.length,
          matched: result.matchedCount,
          total: result.totalCount,
        }),
      })
    } catch (error) {
      setCodexPetCatalogStatus({
        ok: false,
        message: getPetImportErrorMessage(error),
      })
    } finally {
      setCodexPetCatalogLoading(false)
    }
  }


  function resetPetModelImport() {
    importingPetModelRef.current = false
    setPetModelStatus(null)
    setImportingPetModel(false)
    setCodexPetCatalog(null)
    setCodexPetCatalogLoading(false)
    setCodexPetCatalogStatus(null)
  }

  return {
    importingPetModel,
    petModelStatus,
    codexPetCatalog,
    codexPetCatalogLoading,
    codexPetCatalogStatus,
    handleImportPetModel,
    handleImportCodexPetGallery,
    handleLoadCodexPetGallery,
    resetPetModelImport,
  }
}
