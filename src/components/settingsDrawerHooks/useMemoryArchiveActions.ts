import { useState } from 'react'
import type { ConnectionResult } from '../settingsDrawerSupport'
import type { DailyMemoryEntry, MemoryItem } from '../../types'

export type UseMemoryArchiveActionsOptions = {
  memories: MemoryItem[]
  dailyMemoryEntries: DailyMemoryEntry[]
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
  onExportMemoryArchive,
  onImportMemoryArchive,
  onClearMemoryArchive,
}: UseMemoryArchiveActionsOptions) {
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
        message: error instanceof Error ? error.message : '导出记忆库失败，请稍后再试。',
      })
    } finally {
      setExportingMemoryArchive(false)
    }
  }

  async function handleImportMemoryArchive() {
    if (memories.length || dailyMemoryEntries.length) {
      const confirmed = window.confirm('导入会替换当前长期记忆和每日日志。要继续吗？')
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
        message: error instanceof Error ? error.message : '导入记忆库失败，请稍后再试。',
      })
    } finally {
      setImportingMemoryArchive(false)
    }
  }

  async function handleClearMemoryArchive() {
    if (!memories.length && !dailyMemoryEntries.length) {
      setMemoryArchiveStatus({
        ok: false,
        message: '当前没有可清空的记忆内容。',
      })
      return
    }

    const confirmed = window.confirm('确认清空当前长期记忆和每日日志吗？')
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
        message: error instanceof Error ? error.message : '清空记忆库失败，请稍后再试。',
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
