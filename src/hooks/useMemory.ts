import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearDailyMemoriesForDay,
  createManualMemory,
  getRecentDailyEntries,
  mergeDailyMemories,
  mergeMemories,
  parseMemoryArchive,
  serializeMemoryArchive,
  warmupMemoryVectorModel,
} from '../features/memory/index.ts'
import { formatMemoriesForPersonaFile } from '../features/memory/memoryPersistence.ts'
import {
  loadDailyMemories,
  loadMemories,
  openTextFileWithFallback,
  saveDailyMemories,
  saveMemories,
  saveTextFileWithFallback,
} from '../lib/index.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import type {
  AppSettings,
  DailyMemoryEntry,
  DailyMemoryStore,
  MemoryItem,
  MemoryImportance,
} from '../types/index.ts'

type UseMemoryParams = {
  settings: AppSettings
}

export function useMemory({ settings }: UseMemoryParams) {
  const { t } = useTranslation()
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

  const memoriesSaveSkipRef = useRef(true)
  const dailyMemoriesSaveSkipRef = useRef(true)

  useEffect(() => {
    dailyMemoriesRef.current = dailyMemories
  }, [dailyMemories])

  useEffect(() => {
    if (memoriesSaveSkipRef.current) {
      memoriesSaveSkipRef.current = false
      return
    }
    saveMemories(memories)
  }, [memories])

  useEffect(() => {
    if (dailyMemoriesSaveSkipRef.current) {
      dailyMemoriesSaveSkipRef.current = false
      return
    }
    saveDailyMemories(dailyMemories)
  }, [dailyMemories])

  // Persist top memories to persona memory.md (debounced 30s)
  const personaPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const personaPersistSkipRef = useRef(true)
  useEffect(() => {
    if (personaPersistSkipRef.current) {
      personaPersistSkipRef.current = false
      return
    }
    if (personaPersistTimerRef.current) clearTimeout(personaPersistTimerRef.current)
    personaPersistTimerRef.current = setTimeout(() => {
      void (async () => {
        try {
          const existing = await window.desktopPet?.personaLoadMemory?.() ?? ''
          const content = formatMemoriesForPersonaFile(memories, existing)
          await window.desktopPet?.personaSaveMemory?.({ content })
        } catch { /* best-effort */ }
      })()
    }, 30_000)
    return () => { if (personaPersistTimerRef.current) clearTimeout(personaPersistTimerRef.current) }
  }, [memories])

  useEffect(() => {
    if (settings.memorySearchMode === 'keyword') return

    // Defer warmup to avoid blocking startup render
    const timerId = window.setTimeout(() => {
      void warmupMemoryVectorModel(settings.memoryEmbeddingModel).catch(() => undefined)
    }, 3_000)
    return () => window.clearTimeout(timerId)
  }, [settings.memoryEmbeddingModel, settings.memorySearchMode])

  const applyRemoteMemoryState = useCallback((
    nextMemories: MemoryItem[],
    nextDailyMemories: DailyMemoryStore,
  ) => {
    memoriesSaveSkipRef.current = true
    dailyMemoriesSaveSkipRef.current = true
    personaPersistSkipRef.current = true
    memoriesRef.current = nextMemories
    dailyMemoriesRef.current = nextDailyMemories
    setMemories(nextMemories)
    setDailyMemories(nextDailyMemories)
  }, [])

  const recentDailyMemoryEntries = useMemo(
    () => getRecentDailyEntries(dailyMemories, 1).slice(0, 8),
    [dailyMemories],
  )

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
      throw new Error(t('memory.error.empty_content'))
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
  }, [t])

  const setMemoryEnabled = useCallback((id: string, enabled: boolean) => {
    setMemories((current) => {
      const nextMemories = current.map((memory) => (
        memory.id === id
          ? {
              ...memory,
              enabled,
              lastUsedAt: new Date().toISOString(),
            }
          : memory
      ))
      memoriesRef.current = nextMemories
      return nextMemories
    })
  }, [])

  const toggleMemoryPin = useCallback((id: string) => {
    setMemories((current) => {
      const nextMemories = current.map((memory) => (
        memory.id === id
          ? {
              ...memory,
              importance: memory.importance === 'pinned'
                ? 'normal'
                : ('pinned' as MemoryImportance),
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
      throw new Error(t('memory.error.empty_log'))
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
  }, [t])

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
      title: t('memory.export.title'),
      defaultFileName: `desktop-pet-memory-${fileNameDate}.json`,
      content: exportContent,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
  }, [t])

  const importMemoryArchive = useCallback(async () => {
    const result = await openTextFileWithFallback({
      title: t('memory.import.title'),
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
      message: t('memory.import.success', {
        memoryCount: importedArchive.memories.length,
        dayCount: Object.keys(importedArchive.dailyMemories).length,
      }),
    }
  }, [t])

  const clearMemoryArchive = useCallback(async () => {
    memoriesRef.current = []
    dailyMemoriesRef.current = {}
    setMemories([])
    setDailyMemories({})

    return {
      canceled: false,
      message: t('memory.clear.success'),
    }
  }, [t])

  // Memoize return so the outer `memory` object has a stable identity when
  // no observable state changed. Without this, every parent re-render hands
  // downstream consumers (useAppController's petView / panelView / overlays)
  // a fresh `memory` reference, which cascades into useMemo invalidations
  // and — where downstream effects write state back — a Max Update Depth
  // render storm.
  return useMemo(() => ({
    memories,
    memoriesRef,
    dailyMemories,
    dailyMemoriesRef,
    recentDailyMemoryEntries,
    setMemories,
    setDailyMemories,
    applyRemoteMemoryState,
    appendDailyMemoryEntries,
    addManualMemory,
    removeMemory,
    updateMemory,
    setMemoryEnabled,
    toggleMemoryPin,
    clearTodayDailyMemory,
    updateDailyEntry,
    removeDailyEntry,
    exportMemoryArchive,
    importMemoryArchive,
    clearMemoryArchive,
  }), [
    memories,
    dailyMemories,
    recentDailyMemoryEntries,
    setMemories,
    setDailyMemories,
    applyRemoteMemoryState,
    appendDailyMemoryEntries,
    addManualMemory,
    removeMemory,
    updateMemory,
    setMemoryEnabled,
    toggleMemoryPin,
    clearTodayDailyMemory,
    updateDailyEntry,
    removeDailyEntry,
    exportMemoryArchive,
    importMemoryArchive,
    clearMemoryArchive,
  ])
}
