import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import type {
  CodexPetGalleryCatalogResult,
  PetModelDefinition,
  SpritePetCreatorKitInspection,
} from '../../features/pet'
import type { ConnectionResult } from '../settingsDrawerSupport'
import type { AppSettings } from '../../types'

export type UsePetModelImportOptions = {
  onImportPetModel: () => Promise<{
    model: PetModelDefinition
    message: string
  } | null>
  onImportCodexPetGallery?: (input: string) => Promise<{
    model: PetModelDefinition
    message: string
  }>
  onListCodexPetGallery?: (query?: string) => Promise<CodexPetGalleryCatalogResult>
  onCreateCodexPetCreatorKit?: (payload: {
    displayName?: string
    concept?: string
  }) => Promise<{
    id: string
    displayName: string
    directoryPath: string
    directoryPathDisplay?: string
    sourceRowsDirectory?: string
    sourceRowsDirectoryDisplay?: string
    message: string
  }>
  onInspectCodexPetCreatorKit?: (payload?: { kitDirectory?: string }) => Promise<SpritePetCreatorKitInspection | null>
  onAssembleCodexPetCreatorKit?: (payload?: { kitDirectory?: string }) => Promise<{
    model: PetModelDefinition
    message: string
    packageDirectory?: string
    packageDirectoryDisplay?: string
    manifestPath?: string
    manifestPathDisplay?: string
    spritesheetPath?: string
    spritesheetPathDisplay?: string
    reportPath?: string
    reportPathDisplay?: string
    visualAuditPath?: string
    visualAuditPathDisplay?: string
    archivePath?: string
    archivePathDisplay?: string
  } | null>
  onInstallCodexPetCreatorKitToCodex?: (payload: {
    kitDirectory: string
    manifestPath: string
  }) => Promise<{
    ok: boolean
    id: string
    directoryPath: string
    directoryPathDisplay?: string
    manifestPath: string
    manifestPathDisplay?: string
    message: string
  }>
  onOpenCodexPetCreatorKitPath?: (payload: {
    kitDirectory: string
    targetPath: string
    mode?: 'open' | 'reveal'
  }) => Promise<{
    ok: boolean
    message: string
  }>
  onCreateSpritePetFromImage?: () => Promise<{
    model: PetModelDefinition
    message: string
    packageDirectory?: string
    packageDirectoryDisplay?: string
    manifestPath?: string
    manifestPathDisplay?: string
    spritesheetPath?: string
    spritesheetPathDisplay?: string
    visualAuditPath?: string
    visualAuditPathDisplay?: string
    archivePath?: string
    archivePathDisplay?: string
  } | null>
  onSelectImportedPetModel?: (petModelId: string) => Promise<void> | void
  setDraft: Dispatch<SetStateAction<AppSettings>>
}

export function usePetModelImport({
  onImportPetModel,
  onImportCodexPetGallery,
  onListCodexPetGallery,
  onCreateCodexPetCreatorKit,
  onInspectCodexPetCreatorKit,
  onAssembleCodexPetCreatorKit,
  onInstallCodexPetCreatorKitToCodex,
  onOpenCodexPetCreatorKitPath,
  onCreateSpritePetFromImage,
  onSelectImportedPetModel,
  setDraft,
}: UsePetModelImportOptions) {
  const { t } = useTranslation()
  const [importingPetModel, setImportingPetModel] = useState(false)
  const [petModelStatus, setPetModelStatus] = useState<ConnectionResult | null>(null)
  const [codexPetCatalog, setCodexPetCatalog] = useState<CodexPetGalleryCatalogResult | null>(null)
  const [codexPetCatalogLoading, setCodexPetCatalogLoading] = useState(false)
  const [codexPetCatalogStatus, setCodexPetCatalogStatus] = useState<ConnectionResult | null>(null)
  const [creatingCreatorKit, setCreatingCreatorKit] = useState(false)
  const [inspectingCreatorKit, setInspectingCreatorKit] = useState(false)
  const [creatorKitInspection, setCreatorKitInspection] = useState<SpritePetCreatorKitInspection | null>(null)
  const [assemblingCreatorKit, setAssemblingCreatorKit] = useState(false)
  const [lastCreatorKitDirectory, setLastCreatorKitDirectory] = useState('')
  const [lastCreatorKitDirectoryDisplay, setLastCreatorKitDirectoryDisplay] = useState('')
  const [lastCreatorKitSourceRowsDirectory, setLastCreatorKitSourceRowsDirectory] = useState('')
  const [lastCreatorKitSourceRowsDirectoryDisplay, setLastCreatorKitSourceRowsDirectoryDisplay] = useState('')
  const [assembledCreatorKitPackage, setAssembledCreatorKitPackage] = useState<{
    packageDirectory: string
    packageDirectoryDisplay?: string
    manifestPath: string
    manifestPathDisplay?: string
    visualAuditPath?: string
    visualAuditPathDisplay?: string
    archivePath?: string
    archivePathDisplay?: string
  } | null>(null)
  const [generatedSpritePetPackage, setGeneratedSpritePetPackage] = useState<{
    packageDirectory: string
    packageDirectoryDisplay?: string
    manifestPath: string
    manifestPathDisplay?: string
    visualAuditPath?: string
    visualAuditPathDisplay?: string
    archivePath?: string
    archivePathDisplay?: string
  } | null>(null)

  function getPetImportErrorMessage(error: unknown) {
    return getRedactedLogErrorMessage(error) || t('settings.pet.import_error')
  }

  async function handleImportPetModel() {
    setImportingPetModel(true)
    setPetModelStatus(null)

    try {
      const result = await onImportPetModel()

      if (!result) {
        return
      }

      setDraft((current) => ({
        ...current,
        petModelId: result.model.id,
      }))
      await onSelectImportedPetModel?.(result.model.id)
      setPetModelStatus({
        ok: true,
        message: result.message,
      })
    } catch (error) {
      setPetModelStatus({
        ok: false,
        message: getPetImportErrorMessage(error),
      })
    } finally {
      setImportingPetModel(false)
    }
  }

  async function handleImportCodexPetGallery(input: string) {
    if (!onImportCodexPetGallery) {
      return
    }

    setImportingPetModel(true)
    setPetModelStatus(null)

    try {
      const result = await onImportCodexPetGallery(input)

      setDraft((current) => ({
        ...current,
        petModelId: result.model.id,
      }))
      await onSelectImportedPetModel?.(result.model.id)
      setPetModelStatus({
        ok: true,
        message: result.message,
      })
    } catch (error) {
      setPetModelStatus({
        ok: false,
        message: getPetImportErrorMessage(error),
      })
    } finally {
      setImportingPetModel(false)
    }
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

  async function handleCreateSpritePetFromImage() {
    if (!onCreateSpritePetFromImage) {
      return
    }

    setImportingPetModel(true)
    setPetModelStatus(null)

    try {
      const result = await onCreateSpritePetFromImage()

      if (!result) {
        return
      }

      setDraft((current) => ({
        ...current,
        petModelId: result.model.id,
      }))
      await onSelectImportedPetModel?.(result.model.id)
      if (result.packageDirectory && result.manifestPath) {
        setGeneratedSpritePetPackage({
          packageDirectory: result.packageDirectory,
          packageDirectoryDisplay: result.packageDirectoryDisplay,
          manifestPath: result.manifestPath,
          manifestPathDisplay: result.manifestPathDisplay,
          visualAuditPath: result.visualAuditPath,
          visualAuditPathDisplay: result.visualAuditPathDisplay,
          archivePath: result.archivePath,
          archivePathDisplay: result.archivePathDisplay,
        })
      }
      setPetModelStatus({
        ok: true,
        message: result.message,
      })
    } catch (error) {
      setPetModelStatus({
        ok: false,
        message: getPetImportErrorMessage(error),
      })
    } finally {
      setImportingPetModel(false)
    }
  }

  async function handleCreateCodexPetCreatorKit(payload: {
    displayName?: string
    concept?: string
  }) {
    if (!onCreateCodexPetCreatorKit) {
      return
    }

    setCreatingCreatorKit(true)
    setPetModelStatus(null)

    try {
      const result = await onCreateCodexPetCreatorKit(payload)
      setLastCreatorKitDirectory(result.directoryPath)
      setLastCreatorKitDirectoryDisplay(result.directoryPathDisplay ?? result.directoryPath)
      setLastCreatorKitSourceRowsDirectory(result.sourceRowsDirectory ?? '')
      setLastCreatorKitSourceRowsDirectoryDisplay(result.sourceRowsDirectoryDisplay ?? result.sourceRowsDirectory ?? '')
      setCreatorKitInspection(null)
      setAssembledCreatorKitPackage(null)
      setPetModelStatus({
        ok: true,
        message: result.message,
      })
    } catch (error) {
      setPetModelStatus({
        ok: false,
        message: getPetImportErrorMessage(error),
      })
    } finally {
      setCreatingCreatorKit(false)
    }
  }

  async function handleInspectCodexPetCreatorKit() {
    if (!onInspectCodexPetCreatorKit) {
      return
    }

    setInspectingCreatorKit(true)
    setPetModelStatus(null)

    try {
      const result = await onInspectCodexPetCreatorKit(
        lastCreatorKitDirectory ? { kitDirectory: lastCreatorKitDirectory } : undefined,
      )
      if (!result) {
        return
      }

      setCreatorKitInspection(result)
      setLastCreatorKitDirectory(result.kitDirectory)
      setLastCreatorKitDirectoryDisplay(result.kitDirectoryDisplay ?? result.kitDirectory)
      setLastCreatorKitSourceRowsDirectory(result.sourceRowsDirectory ?? '')
      setLastCreatorKitSourceRowsDirectoryDisplay(result.sourceRowsDirectoryDisplay ?? result.sourceRowsDirectory ?? '')
      setPetModelStatus({
        ok: result.ready,
        message: result.message,
      })
    } catch (error) {
      setPetModelStatus({
        ok: false,
        message: getPetImportErrorMessage(error),
      })
    } finally {
      setInspectingCreatorKit(false)
    }
  }

  async function handleAssembleCodexPetCreatorKit() {
    if (!onAssembleCodexPetCreatorKit) {
      return
    }

    setAssemblingCreatorKit(true)
    setPetModelStatus(null)

    try {
      const result = await onAssembleCodexPetCreatorKit(
        lastCreatorKitDirectory ? { kitDirectory: lastCreatorKitDirectory } : undefined,
      )
      if (!result) {
        return
      }

      setDraft((current) => ({
        ...current,
        petModelId: result.model.id,
      }))
      await onSelectImportedPetModel?.(result.model.id)
      if (result.packageDirectory && result.manifestPath) {
        setAssembledCreatorKitPackage({
          packageDirectory: result.packageDirectory,
          packageDirectoryDisplay: result.packageDirectoryDisplay,
          manifestPath: result.manifestPath,
          manifestPathDisplay: result.manifestPathDisplay,
          visualAuditPath: result.visualAuditPath,
          visualAuditPathDisplay: result.visualAuditPathDisplay,
          archivePath: result.archivePath,
          archivePathDisplay: result.archivePathDisplay,
        })
      }
      setPetModelStatus({
        ok: true,
        message: result.message,
      })
    } catch (error) {
      setPetModelStatus({
        ok: false,
        message: getPetImportErrorMessage(error),
      })
    } finally {
      setAssemblingCreatorKit(false)
    }
  }

  async function handleOpenCodexPetCreatorKitPath(payload: {
    kitDirectory: string
    targetPath: string
    mode?: 'open' | 'reveal'
  }) {
    if (!onOpenCodexPetCreatorKitPath) {
      return
    }

    setPetModelStatus(null)

    try {
      const result = await onOpenCodexPetCreatorKitPath(payload)
      setPetModelStatus({
        ok: result.ok,
        message: result.message,
      })
    } catch (error) {
      setPetModelStatus({
        ok: false,
        message: getPetImportErrorMessage(error),
      })
    }
  }

  async function handleInstallCodexPetCreatorKitToCodex() {
    if (!onInstallCodexPetCreatorKitToCodex || !assembledCreatorKitPackage || !lastCreatorKitDirectory) {
      return
    }

    setPetModelStatus(null)

    try {
      const result = await onInstallCodexPetCreatorKitToCodex({
        kitDirectory: lastCreatorKitDirectory,
        manifestPath: assembledCreatorKitPackage.manifestPath,
      })
      setPetModelStatus({
        ok: result.ok,
        message: result.message,
      })
    } catch (error) {
      setPetModelStatus({
        ok: false,
        message: getPetImportErrorMessage(error),
      })
    }
  }

  async function handleInstallGeneratedSpritePetPackageToCodex() {
    if (!onInstallCodexPetCreatorKitToCodex || !generatedSpritePetPackage) {
      return
    }

    setPetModelStatus(null)

    try {
      const result = await onInstallCodexPetCreatorKitToCodex({
        kitDirectory: generatedSpritePetPackage.packageDirectory,
        manifestPath: generatedSpritePetPackage.manifestPath,
      })
      setPetModelStatus({
        ok: result.ok,
        message: result.message,
      })
    } catch (error) {
      setPetModelStatus({
        ok: false,
        message: getPetImportErrorMessage(error),
      })
    }
  }

  function resetPetModelImport() {
    setPetModelStatus(null)
    setImportingPetModel(false)
    setCodexPetCatalog(null)
    setCodexPetCatalogLoading(false)
    setCodexPetCatalogStatus(null)
    setCreatingCreatorKit(false)
    setInspectingCreatorKit(false)
    setCreatorKitInspection(null)
    setAssemblingCreatorKit(false)
    setLastCreatorKitDirectory('')
    setLastCreatorKitDirectoryDisplay('')
    setLastCreatorKitSourceRowsDirectory('')
    setLastCreatorKitSourceRowsDirectoryDisplay('')
    setAssembledCreatorKitPackage(null)
    setGeneratedSpritePetPackage(null)
  }

  return {
    importingPetModel,
    petModelStatus,
    codexPetCatalog,
    codexPetCatalogLoading,
    codexPetCatalogStatus,
    creatingCreatorKit,
    inspectingCreatorKit,
    creatorKitInspection,
    assemblingCreatorKit,
    lastCreatorKitDirectory,
    lastCreatorKitDirectoryDisplay,
    lastCreatorKitSourceRowsDirectory,
    lastCreatorKitSourceRowsDirectoryDisplay,
    assembledCreatorKitPackage,
    generatedSpritePetPackage,
    handleImportPetModel,
    handleImportCodexPetGallery,
    handleLoadCodexPetGallery,
    handleCreateCodexPetCreatorKit,
    handleInspectCodexPetCreatorKit,
    handleAssembleCodexPetCreatorKit,
    handleInstallCodexPetCreatorKitToCodex,
    handleInstallGeneratedSpritePetPackageToCodex,
    handleOpenCodexPetCreatorKitPath,
    handleCreateSpritePetFromImage,
    resetPetModelImport,
  }
}
