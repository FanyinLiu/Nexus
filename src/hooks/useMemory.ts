import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearDailyMemoriesForDay,
  createManualMemory,
  getRecentDailyEntries,
  mergeDailyMemories,
  mergeMemories,
  parseMemoryArchive,
  serializeMemoryArchive,
  warmupMemoryVectorModel,
} from '../features/memory'
import {
  loadDailyMemories,
  loadMemories,
  openTextFileWithFallback,
  saveDailyMemories,
  saveMemories,
  saveTextFileWithFallback,
} from '../lib'
import type {
  AppSettings,
  DailyMemoryEntry,
  DailyMemoryStore,
  MemoryItem,
} from '../types'

type UseMemoryParams = {
  settings: AppSettings
}

export function useMemory({ settings }: UseMemoryParams) {
  const [memories, setMemories] = useState<MemoryItem[]>(() => loadMemories())
  const [dailyMemories, setDailyMemories] = useState<DailyMemoryStore>(() => loadDailyMemories())
  const memoriesRef = useRef(memories)
  const dailyMemoriesRef = useRef(dailyMemories)
  const settingsRef = useRef(settings)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    memoriesRef.current = memories
  }, [memories])

  useEffect(() => {
    dailyMemoriesRef.current = dailyMemories
  }, [dailyMemories])

  useEffect(() => {
    saveMemories(memories)
  }, [memories])

  useEffect(() => {
    saveDailyMemories(dailyMemories)
  }, [dailyMemories])

  useEffect(() => {
    if (settings.memorySearchMode === 'keyword') return

    void warmupMemoryVectorModel(settings.memoryEmbeddingModel).catch(() => undefined)
  }, [settings.memoryEmbeddingModel, settings.memorySearchMode])

  const recentDailyMemoryEntries = getRecentDailyEntries(dailyMemories, 1).slice(0, 8)

  const appendDailyMemoryEntries = useCallback((entries: DailyMemoryEntry[]) => {
    if (!entries.length) {
      return dailyMemoriesRef.current
    }

    const nextDailyMemories = mergeDailyMemories(
      dailyMemoriesRef.current,
      entries,
      settingsRef.current.memoryDiaryRetentionDays,
    )

    dailyMemoriesRef.current = nextDailyMemories
    setDailyMemories(nextDailyMemories)
    return nextDailyMemories
  }, [])

  const addManualMemory = useCallback((content: string) => {
    const nextMemories = mergeMemories(memoriesRef.current, [createManualMemory(content)])
    memoriesRef.current = nextMemories
    setMemories(nextMemories)
  }, [])

  const removeMemory = useCallback((id: string) => {
    setMemories((current) => {
      const nextMemories = current.filter((memory) => memory.id !== id)
      memoriesRef.current = nextMemories
      return nextMemories
    })
  }, [])

  const updateMemory = useCallback((id: string, content: string) => {
    const normalizedContent = content.trim()
    if (!normalizedContent) {
      throw new Error('记忆内容不能为空。')
    }

    setMemories((current) => {
      const nextMemories = current.map((memory) => (
        memory.id === id
          ? {
              ...memory,
              content: normalizedContent,
              lastUsedAt: new Date().toISOString(),
            }
          : memory
      ))
      memoriesRef.current = nextMemories
      return nextMemories
    })
  }, [])

  const clearTodayDailyMemory = useCallback(() => {
    const nextDailyMemories = clearDailyMemoriesForDay(dailyMemoriesRef.current)
    dailyMemoriesRef.current = nextDailyMemories
    setDailyMemories(nextDailyMemories)
  }, [])

  const updateDailyEntry = useCallback((id: string, day: string, content: string) => {
    const normalizedContent = content.trim()
    if (!normalizedContent) {
      throw new Error('日志内容不能为空。')
    }

    setDailyMemories((current) => {
      const dayEntries = current[day]
      if (!dayEntries) return current

      const nextEntries = dayEntries.map((entry) => (
        entry.id === id ? { ...entry, content: normalizedContent } : entry
      ))

      const nextStore = { ...current, [day]: nextEntries }
      dailyMemoriesRef.current = nextStore
      return nextStore
    })
  }, [])

  const removeDailyEntry = useCallback((id: string, day: string) => {
    setDailyMemories((current) => {
      const dayEntries = current[day]
      if (!dayEntries) return current

      const nextEntries = dayEntries.filter((entry) => entry.id !== id)
      const nextStore = { ...current }

      if (nextEntries.length) {
        nextStore[day] = nextEntries
      } else {
        delete nextStore[day]
      }

      dailyMemoriesRef.current = nextStore
      return nextStore
    })
  }, [])

  const exportMemoryArchive = useCallback(async () => {
    const fileNameDate = new Date().toISOString().slice(0, 10)
    const exportContent = serializeMemoryArchive(memoriesRef.current, dailyMemoriesRef.current)

    return saveTextFileWithFallback({
      title: '导出记忆库',
      defaultFileName: `desktop-pet-memory-${fileNameDate}.json`,
      content: exportContent,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
  }, [])

  const importMemoryArchive = useCallback(async () => {
    const result = await openTextFileWithFallback({
      title: '导入记忆库',
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })

    if (result.canceled || !result.content) {
      return result
    }

    const importedArchive = parseMemoryArchive(result.content)
    memoriesRef.current = importedArchive.memories
    dailyMemoriesRef.current = importedArchive.dailyMemories
    setMemories(importedArchive.memories)
    setDailyMemories(importedArchive.dailyMemories)

    return {
      canceled: false,
      filePath: result.filePath,
      message: `已导入 ${importedArchive.memories.length} 条长期记忆，${Object.keys(importedArchive.dailyMemories).length} 天日记。`,
    }
  }, [])

  const clearMemoryArchive = useCallback(async () => {
    memoriesRef.current = []
    dailyMemoriesRef.current = {}
    setMemories([])
    setDailyMemories({})

    return {
      canceled: false,
      message: '长期记忆和每日日志都已清空。',
    }
  }, [])

  return {
    memories,
    memoriesRef,
    dailyMemories,
    dailyMemoriesRef,
    recentDailyMemoryEntries,
    setMemories,
    setDailyMemories,
    appendDailyMemoryEntries,
    addManualMemory,
    removeMemory,
    updateMemory,
    clearTodayDailyMemory,
    updateDailyEntry,
    removeDailyEntry,
    exportMemoryArchive,
    importMemoryArchive,
    clearMemoryArchive,
  }
}
