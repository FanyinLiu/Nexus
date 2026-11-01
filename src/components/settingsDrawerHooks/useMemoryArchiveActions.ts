import { useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { createLogger } from '../../lib/logger.ts'
import type { ConfirmFn } from '../useConfirm.ts'
import type { ConnectionResult } from '../settingsDrawerSupport.ts'
import type { DailyMemoryEntry, MemoryItem } from '../../types'

const log = createLogger('settings.memoryArchive')

/**
 * The proactive inbox quotes the same memory text the clear is about to wipe,
 * so an empty archive on screen is not proof that nothing needs clearing. A
 * failed read is treated as "may have content": skipping the clear would leave
 * the inbox behind, which is the exact defect this guard prevents.
 */
async function proactiveInboxMayHaveContent(): Promise<boolean> {
  const bridge = typeof window === 'undefined' ? undefined : window.desktopPet
  if (!bridge?.listProactiveInbox) return true
  try {
    const inbox = await bridge.listProactiveInbox()
    return inbox.entries.length > 0
  } catch (error) {
    log.warn('proactive inbox read failed before memory clear', {
      source: 'proactive-inbox',
      error: getRedactedLogErrorMessage(error),
    })
    return true
  }
}

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
  const [memoryClearStatus, setMemoryClearStatus] = useState<ConnectionResult | null>(null)
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
    const inboxHasContent = (!memories.length && !dailyMemoryEntries.length)
      ? await proactiveInboxMayHaveContent()
      : false
    if (!memories.length && !dailyMemoryEntries.length && !inboxHasContent) {
      setMemoryClearStatus({
        ok: false,
        message: t('settings.memory.clear_empty_hint'),
      })
      return
    }

    const confirmed = await confirm({ message: t('settings.memory.clear_confirm'), tone: 'danger' })
    if (!confirmed) {
      return
    }

    setClearingMemoryArchive(true)
    setMemoryClearStatus(null)

    try {
      const result = await onClearMemoryArchive()
      if (result.canceled) {
        return
      }

      setMemoryClearStatus({
        ok: true,
        message: result.message,
      })
    } catch (error) {
      setMemoryClearStatus({
        ok: false,
        message: getRedactedLogErrorMessage(error) || t('settings.memory.clear_error'),
      })
    } finally {
      setClearingMemoryArchive(false)
    }
  }

  function resetMemoryArchive() {
    setMemoryArchiveStatus(null)
    setMemoryClearStatus(null)
    setExportingMemoryArchive(false)
    setImportingMemoryArchive(false)
    setClearingMemoryArchive(false)
  }

  return {
    memoryArchiveStatus,
    memoryClearStatus,
    exportingMemoryArchive,
    importingMemoryArchive,
    clearingMemoryArchive,
    handleExportMemoryArchive,
    handleImportMemoryArchive,
    handleClearMemoryArchive,
    resetMemoryArchive,
  }
}
