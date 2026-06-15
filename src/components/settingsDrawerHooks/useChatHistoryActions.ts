import { useState } from 'react'
import { useTranslation } from '../../i18n/useTranslation.ts'
import type { ConfirmFn } from '../useConfirm.ts'
import type { ConnectionResult } from '../settingsDrawerSupport'

export type UseChatHistoryActionsOptions = {
  chatMessageCount: number
  confirm: ConfirmFn
  onExportChatHistory: () => Promise<{
    canceled: boolean
    filePath?: string
    message: string
  }>
  onImportChatHistory: () => Promise<{
    canceled: boolean
    filePath?: string
    message: string
  }>
  onClearChatHistory: () => Promise<{
    canceled: boolean
    message: string
  }>
}

export function useChatHistoryActions({
  chatMessageCount,
  confirm,
  onExportChatHistory,
  onImportChatHistory,
  onClearChatHistory,
}: UseChatHistoryActionsOptions) {
  const { t } = useTranslation()
  const [chatHistoryStatus, setChatHistoryStatus] = useState<ConnectionResult | null>(null)
  const [exportingChatHistory, setExportingChatHistory] = useState(false)
  const [importingChatHistory, setImportingChatHistory] = useState(false)
  const [clearingChatHistory, setClearingChatHistory] = useState(false)

  async function handleExportChatHistory() {
    setExportingChatHistory(true)
    setChatHistoryStatus(null)

    try {
      const result = await onExportChatHistory()
      if (result.canceled) {
        return
      }

      setChatHistoryStatus({
        ok: true,
        message: result.message,
      })
    } catch (error) {
      setChatHistoryStatus({
        ok: false,
        message: error instanceof Error ? error.message : t('settings.chat_history.export_error'),
      })
    } finally {
      setExportingChatHistory(false)
    }
  }

  async function handleImportChatHistory() {
    if (chatMessageCount > 0) {
      const confirmed = await confirm({ message: t('settings.chat_history.import_confirm'), tone: 'danger' })
      if (!confirmed) {
        return
      }
    }

    setImportingChatHistory(true)
    setChatHistoryStatus(null)

    try {
      const result = await onImportChatHistory()
      if (result.canceled) {
        return
      }

      setChatHistoryStatus({
        ok: true,
        message: result.message,
      })
    } catch (error) {
      setChatHistoryStatus({
        ok: false,
        message: error instanceof Error ? error.message : t('settings.chat_history.import_error'),
      })
    } finally {
      setImportingChatHistory(false)
    }
  }

  async function handleClearChatHistory() {
    if (!chatMessageCount) {
      setChatHistoryStatus({
        ok: false,
        message: t('settings.chat_history.nothing_to_clear'),
      })
      return
    }

    const confirmed = await confirm({ message: t('settings.chat_history.clear_confirm'), tone: 'danger' })
    if (!confirmed) {
      return
    }

    setClearingChatHistory(true)
    setChatHistoryStatus(null)

    try {
      const result = await onClearChatHistory()
      if (result.canceled) {
        return
      }

      setChatHistoryStatus({
        ok: true,
        message: result.message,
      })
    } catch (error) {
      setChatHistoryStatus({
        ok: false,
        message: error instanceof Error ? error.message : t('settings.chat_history.clear_error'),
      })
    } finally {
      setClearingChatHistory(false)
    }
  }

  function resetChatHistory() {
    setChatHistoryStatus(null)
    setExportingChatHistory(false)
    setImportingChatHistory(false)
    setClearingChatHistory(false)
  }

  return {
    chatHistoryStatus,
    exportingChatHistory,
    importingChatHistory,
    clearingChatHistory,
    handleExportChatHistory,
    handleImportChatHistory,
    handleClearChatHistory,
    resetChatHistory,
  }
}
