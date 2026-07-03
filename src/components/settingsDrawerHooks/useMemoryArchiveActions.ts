import { useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import type { ConfirmFn } from '../useConfirm.ts'
import type { ConnectionResult } from '../settingsDrawerSupport'
import type { DailyMemoryEntry, MemoryItem } from '../../types'

export type UseMemoryArchiveActionsOptions = {
  memories: MemoryItem[]
  dailyMemoryEntries: DailyMemoryEntry[]
  confirm: ConfirmFn
  onExportMemoryArchive: () => Promise<{
    canceled: boolean
    filePath?: string
    message: string
  }>
  onImportMemoryArchive: () => Promise<{
    canceled: boolean
    filePath?: string
    message: string
  }>
  onClearMemoryArchive: () => Promise<{
    canceled: boolean
    message: string
  }>
}

export function useMemoryArchiveActions({
  memories,
  dailyMemoryEntries,
  confirm,
  onExportMemoryArchive,
  onImportMemoryArchive,
  onClearMemoryArchive,
}: UseMemoryArchiveActionsOptions) {
  const { t } = useTranslation()
  const [memoryArchiveStatus, setMemoryArchiveStatus] = useState<ConnectionResult | null>(null)
  const [exportingMemoryArchive, setExportingMemoryArchive] = useState(false)
  const [importingMemoryArchive, setImportingMemoryArchive] = useState(false)
  const [clearingMemoryArchive, setClearingMemoryArchive] = useState(false)

  async function handleExportMemoryArchive() {
    setExportingMemoryArchive(true)
    setMemoryArchiveStatus(null)

    try {
      const result = await onExportMemoryArchive()
      if (result.canceled) {
        return
      }

      setMemoryArchiveStatus({
        ok: true,
        message: result.message,
      })
    } catch (error) {
      setMemoryArchiveStatus({
        ok: false,
        message: getRedactedLogErrorMessage(error) || t('settings.memory.export_error'),
      })
    } finally {
      setExportingMemoryArchive(false)
    }
  }

  async function handleImportMemoryArchive() {
    if (memories.length || dailyMemoryEntries.length) {
      const confirmed = await confirm({ message: t('settings.memory.import_confirm'), tone: 'danger' })
      if (!confirmed) {
        return
      }
    }

    setImportingMemoryArchive(true)
    setMemoryArchiveStatus(null)

    try {
      const result = await onImportMemoryArchive()
      if (result.canceled) {
        return
      }

      setMemoryArchiveStatus({
        ok: true,
        message: result.message,
      })
    } catch (error) {
      setMemoryArchiveStatus({
        ok: false,
        message: getRedactedLogErrorMessage(error) || t('settings.memory.import_error'),
      })
    } finally {
      setImportingMemoryArchive(false)
    }
  }

  async function handleClearMemoryArchive() {
    if (!memories.length && !dailyMemoryEntries.length) {
      setMemoryArchiveStatus({
        ok: false,
        message: t('settings.memory.nothing_to_clear'),
      })
      return
    }

    const confirmed = await confirm({ message: t('settings.memory.clear_confirm'), tone: 'danger' })
    if (!confirmed) {
      return
    }

    setClearingMemoryArchive(true)
    setMemoryArchiveStatus(null)

    try {
      const result = await onClearMemoryArchive()
      if (result.canceled) {
        return
      }

      setMemoryArchiveStatus({
        ok: true,
        message: result.message,
      })
    } catch (error) {
      setMemoryArchiveStatus({
        ok: false,
        message: getRedactedLogErrorMessage(error) || t('settings.memory.clear_error'),
      })
    } finally {
      setClearingMemoryArchive(false)
    }
  }

  function resetMemoryArchive() {
    setMemoryArchiveStatus(null)
    setExportingMemoryArchive(false)
    setImportingMemoryArchive(false)
    setClearingMemoryArchive(false)
  }

  return {
    memoryArchiveStatus,
    exportingMemoryArchive,
    importingMemoryArchive,
    clearingMemoryArchive,
    handleExportMemoryArchive,
    handleImportMemoryArchive,
    handleClearMemoryArchive,
    resetMemoryArchive,
  }
}
