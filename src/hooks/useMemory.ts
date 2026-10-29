import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  clearDailyMemoriesForDay,
  createManualMemory,
  getRecentDailyEntries,
  mergeDailyMemories,
  mergeMemories,
  parseMemoryArchive,
  reindexMemoriesForEmbeddingModel,
  serializeMemoryArchive,
  warmupMemoryVectorModel,
} from '../features/memory/index.ts'
import {
  getMemoryEmbeddingBackendStatus,
  isOllamaMemoryModel,
  resolveOllamaEmbedBaseUrl,
  setOllamaEmbedBaseUrl,
} from '../features/memory/ollamaEmbedding.ts'
import { commitLongTermMemoryCap } from '../features/memory/memoryCapCommit.ts'
import {
  isAutoMemoryEmbeddingModel,
  resolveAutoMemoryEmbedding,
} from '../features/memory/memoryEmbeddingAuto.ts'
import { formatMemoriesForPersonaFile } from '../features/memory/memoryPersistence.ts'
import {
  applyLongTermMemoryCap,
  loadDailyMemories,
  loadMemories,
  openTextFileWithFallback,
  saveDailyMemories,
  saveMemories,
  saveTextFileWithFallback,
  isMemoryLocalDataAuthorityActive,
  MEMORY_LOCAL_DATA_AUTHORITY_CHANGED_EVENT,
  readMemoryFromLocalData,
  syncMemoryToLocalData,
} from '../lib/index.ts'
import { purgeClearedMemories, purgeDeletedMemory } from '../lib/storage/purgeMemoryStores.ts'
import { useTranslation } from '../i18n/useTranslation.ts'
import type {
  AppSettings,
  DailyMemoryEntry,
  DailyMemoryStore,
  MemoryItem,
} from '../types/index.ts'

type UseMemoryParams = {
  settings: AppSettings
}

/** Enough of each row that a remote copy does not write itself back. */
function memorySyncSignature(items: readonly MemoryItem[]): string {
  return items.map((item) => (
    `${item.id}:${item.updatedAt ?? ''}:${item.status ?? ''}:${item.loopStatus ?? ''}:${item.loopDueAt ?? ''}:${item.loopPlace ?? ''}:${item.content.length}`
  )).join('|')
}

export function useMemory({ settings }: UseMemoryParams) {
  const { t } = useTranslation()
  const [memories, setMemories] = useState<MemoryItem[]>(() => applyLongTermMemoryCap(loadMemories()).kept)
  const [dailyMemories, setDailyMemories] = useState<DailyMemoryStore>(() => loadDailyMemories())
  const [memoryAuthorityActive, setMemoryAuthorityActive] = useState(() => isMemoryLocalDataAuthorityActive())
  const memoryAuthorityHydratedRef = useRef(!memoryAuthorityActive)
  const memoryAuthoritySyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const handleAuthorityChange = () => setMemoryAuthorityActive(isMemoryLocalDataAuthorityActive())
    window.addEventListener(MEMORY_LOCAL_DATA_AUTHORITY_CHANGED_EVENT, handleAuthorityChange)
    return () => window.removeEventListener(MEMORY_LOCAL_DATA_AUTHORITY_CHANGED_EVENT, handleAuthorityChange)
  }, [])
  const memoriesRef = useRef(memories)
  const capEnforcedRef = useRef(false)
  const dailyMemoriesRef = useRef(dailyMemories)

  useEffect(() => {
    if (capEnforcedRef.current) return
    capEnforcedRef.current = true
    const loaded = loadMemories()
    const { kept, evicted } = commitLongTermMemoryCap(loaded)
    if (!evicted.length) return
    // Initial state is already the capped list. The save effect skips that
    // first value, so write the survivors here or the over-cap blob stays
    // on disk until the next edit.
    memoriesRef.current = kept
    saveMemories(kept)
  }, [])
  const settingsRef = useRef(settings)

  useEffect(() => {
    settingsRef.current = settings
  }, [settings])

  useEffect(() => {
    memoriesRef.current = memories
  }, [memories])

  const memoriesSaveSkipRef = useRef(true)
  const lastSavedMemorySignatureRef = useRef('')
  const dailyMemoriesSaveSkipRef = useRef(true)

  useEffect(() => {
    dailyMemoriesRef.current = dailyMemories
  }, [dailyMemories])

  useEffect(() => {
    const signature = memorySyncSignature(memories)
    if (memoriesSaveSkipRef.current) {
      memoriesSaveSkipRef.current = false
      lastSavedMemorySignatureRef.current = signature
      return
    }
    if (signature === lastSavedMemorySignatureRef.current) return
    lastSavedMemorySignatureRef.current = signature
    saveMemories(memories)
  }, [memories])

  useEffect(() => {
    if (dailyMemoriesSaveSkipRef.current) {
      dailyMemoriesSaveSkipRef.current = false
      return
    }
    saveDailyMemories(dailyMemories)
  }, [dailyMemories])

  useEffect(() => {
    if (!memoryAuthorityActive) {
      memoryAuthorityHydratedRef.current = true
      return
    }

    let cancelled = false
    memoryAuthorityHydratedRef.current = false
    void readMemoryFromLocalData().then((result) => {
      if (cancelled) return
      if (result.memories && result.daily) {
        memoriesRef.current = result.memories
        dailyMemoriesRef.current = result.daily.reduce<DailyMemoryStore>((store, entry) => {
          store[entry.day] = [...(store[entry.day] ?? []), entry]
          return store
        }, {})
        setMemories(result.memories)
        setDailyMemories(dailyMemoriesRef.current)
      }
      memoryAuthorityHydratedRef.current = true
    })

    return () => {
      cancelled = true
    }
  }, [memoryAuthorityActive])

  useEffect(() => {
    if (!memoryAuthorityActive || !memoryAuthorityHydratedRef.current) return
    if (memoryAuthoritySyncTimerRef.current) clearTimeout(memoryAuthoritySyncTimerRef.current)
    memoryAuthoritySyncTimerRef.current = setTimeout(() => {
      void syncMemoryToLocalData(memoriesRef.current, dailyMemoriesRef.current)
    }, 250)
    return () => {
      if (memoryAuthoritySyncTimerRef.current) clearTimeout(memoryAuthoritySyncTimerRef.current)
    }
  }, [dailyMemories, memories, memoryAuthorityActive])

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
    const onReplace = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail
      if (!Array.isArray(detail)) return
      const next = detail as MemoryItem[]
      memoriesRef.current = next
      setMemories(next)
    }
    window.addEventListener('nexus:memories-replaced', onReplace)
    return () => window.removeEventListener('nexus:memories-replaced', onReplace)
  }, [])

  // Ollama memory embeddings reuse the chat Ollama address when the chat
  // provider is Ollama (minus its /v1 suffix), else the local default.
  useEffect(() => {
    setOllamaEmbedBaseUrl(resolveOllamaEmbedBaseUrl({
      apiProviderId: settings.apiProviderId,
      apiBaseUrl: settings.apiBaseUrl,
    }))
  }, [settings.apiProviderId, settings.apiBaseUrl])

  useEffect(() => {
    const model = settings.memoryEmbeddingModel
    const keywordOnly = settings.memorySearchMode === 'keyword'
    const activeMemories = () => memoriesRef.current.filter((memory) => (
      memory.enabled !== false && memory.status !== 'superseded' && memory.status !== 'archived'
    ))

    if (isAutoMemoryEmbeddingModel(model)) {
      // Auto: pick qwen3 when Ollama is up with the model already pulled,
      // else the local hash. Detection is one short GET in the main
      // process; the re-embed after a switch runs in the background and
      // recall stays on the hash until it finishes.
      const baseUrl = resolveOllamaEmbedBaseUrl({
        apiProviderId: settings.apiProviderId,
        apiBaseUrl: settings.apiBaseUrl,
      })
      const timerId = window.setTimeout(() => {
        void resolveAutoMemoryEmbedding({
          baseUrl,
          reindex: keywordOnly
            ? undefined
            : (target) => reindexMemoriesForEmbeddingModel(activeMemories(), target),
        }).catch(() => undefined)
      }, 500)
      return () => window.clearTimeout(timerId)
    }

    if (keywordOnly) return

    // Defer warmup to avoid blocking startup render
    const timerId = window.setTimeout(() => {
      void warmupMemoryVectorModel(model)
        .then(() => {
          // After switching to an Ollama model, re-embed the store in the
          // background so the main-process index stops holding vectors from
          // the previous model and the first recall stays fast.
          const status = getMemoryEmbeddingBackendStatus()
          if (!isOllamaMemoryModel(model) || status.state !== 'ready' || status.model !== model) return
          return reindexMemoriesForEmbeddingModel(activeMemories(), model)
        })
        .catch(() => undefined)
    }, 3_000)
    return () => window.clearTimeout(timerId)
  }, [settings.memoryEmbeddingModel, settings.memorySearchMode, settings.apiBaseUrl, settings.apiProviderId])

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
    const current = memoriesRef.current
    const target = current.find((memory) => memory.id === id)
    const nextMemories = current.filter((memory) => memory.id !== id)
    memoriesRef.current = nextMemories
    setMemories(nextMemories)
    // The shared purge scrubs snapshots, evidence, persona, and vectors.
    // A second plaintext pass would race that write.
    if (target) purgeDeletedMemory(target)
  }, [])

  const patchMemory = useCallback((
    id: string,
    patch: Partial<Pick<MemoryItem, 'content' | 'loopStatus' | 'loopDueAt' | 'loopDueText' | 'loopSnoozeUntil' | 'loopSurfacedCount' | 'loopLastSurfacedAt' | 'pinned' | 'userEdited' | 'importance'>>,
  ) => {
    setMemories((current) => {
      const nextMemories = current.map((memory) => {
        if (memory.id !== id) return memory
        const content = typeof patch.content === 'string' ? patch.content.trim() : memory.content
        if (!content) return memory
        return {
          ...memory,
          ...patch,
          content,
          ...(typeof patch.content === 'string' ? { userEdited: true } : {}),
          updatedAt: new Date().toISOString(),
        }
      })
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
              userEdited: true,
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

  const applyRemoteMemories = useCallback((next: MemoryItem[]) => {
    memoriesSaveSkipRef.current = true
    lastSavedMemorySignatureRef.current = memorySyncSignature(next)
    memoriesRef.current = next
    setMemories(next)
  }, [])

  const clearMemoryArchive = useCallback(async () => {
    const currentMemories = memoriesRef.current
    const currentDaily = dailyMemoriesRef.current
    purgeClearedMemories(currentMemories, currentDaily)
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
    applyRemoteMemories,
    setDailyMemories,
    appendDailyMemoryEntries,
    addManualMemory,
    removeMemory,
    updateMemory,
    patchMemory,
    setMemoryEnabled,
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
    applyRemoteMemories,
    setDailyMemories,
    appendDailyMemoryEntries,
    addManualMemory,
    removeMemory,
    updateMemory,
    patchMemory,
    setMemoryEnabled,
    clearTodayDailyMemory,
    updateDailyEntry,
    removeDailyEntry,
    exportMemoryArchive,
    importMemoryArchive,
    clearMemoryArchive,
  ])
}
