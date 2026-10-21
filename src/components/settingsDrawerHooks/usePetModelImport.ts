import { useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { humanizeError } from '../../lib/humanizeError.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { extractPetIpcErrorCode } from '../../../shared/petErrorCodes.js'
import {
  formatPetModelImportPresentation,
  type PetModelImportResult,
} from '../../features/pet'
import type { ConnectionResult } from '../settingsDrawerSupport.ts'
import type { AppSettings } from '../../types'

export type UsePetModelImportOptions = {
  onImportPetModel: () => Promise<PetModelImportResult | null>
  onSelectImportedPetModel?: (petModelId: string) => Promise<void> | void
  setDraft: Dispatch<SetStateAction<AppSettings>>
}

export function usePetModelImport({
  onImportPetModel,
  onSelectImportedPetModel,
  setDraft,
}: UsePetModelImportOptions) {
  const { t } = useTranslation()
  const importingPetModelRef = useRef(false)
  const [importingPetModel, setImportingPetModel] = useState(false)
  const [petModelStatus, setPetModelStatus] = useState<ConnectionResult | null>(null)

  function getPetImportErrorMessage(error: unknown) {
    if (extractPetIpcErrorCode(error)) {
      return humanizeError(error, 'pet')
    }
    return getRedactedLogErrorMessage(error) || t('settings.pet.import_error')
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

  function resetPetModelImport() {
    importingPetModelRef.current = false
    setPetModelStatus(null)
    setImportingPetModel(false)
  }

  return {
    importingPetModel,
    petModelStatus,
    handleImportPetModel,
    resetPetModelImport,
  }
}
