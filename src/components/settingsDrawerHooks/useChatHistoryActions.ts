import { useState } from 'react'
import type { ConnectionResult } from '../settingsDrawerSupport'

export type UseChatHistoryActionsOptions = {
  chatMessageCount: number
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
  onExportChatHistory,
  onImportChatHistory,
  onClearChatHistory,
}: UseChatHistoryActionsOptions) {
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
        message: error instanceof Error ? error.message : '导出聊天记录失败，请稍后再试。',
      })
    } finally {
      setExportingChatHistory(false)
    }
  }

  async function handleImportChatHistory() {
    if (chatMessageCount > 0) {
      const confirmed = window.confirm('导入会替换当前聊天记录，但不会改动记忆库。要继续吗？')
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
        message: error instanceof Error ? error.message : '导入聊天记录失败，请稍后再试。',
      })
    } finally {
      setImportingChatHistory(false)
    }
  }

  async function handleClearChatHistory() {
    if (!chatMessageCount) {
      setChatHistoryStatus({
        ok: false,
        message: '当前没有可清空的聊天记录。',
      })
      return
    }

    const confirmed = window.confirm('确认清空当前聊天记录吗？这不会删除长期记忆和每日日志。')
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
        message: error instanceof Error ? error.message : '清空聊天记录失败，请稍后再试。',
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
