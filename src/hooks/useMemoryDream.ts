import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildDreamPrompt,
  createInitialDreamLog,
  incrementDreamSessionCount,
  parseDreamResponse,
  recordDreamResult,
  shouldRunDream,
} from '../features/autonomy/memoryDream'
import {
  AUTONOMY_DREAM_LOG_STORAGE_KEY,
  readJson,
  writeJson,
} from '../lib/storage'
import type {
  AppSettings,
  DailyMemoryStore,
  MemoryDreamLog,
  MemoryDreamResult,
  MemoryItem,
} from '../types'

export type UseMemoryDreamOptions = {
  settingsRef: React.RefObject<AppSettings>
  memoriesRef: React.RefObject<MemoryItem[]>
  dailyMemoriesRef: React.RefObject<DailyMemoryStore>
  setMemories: (updater: (prev: MemoryItem[]) => MemoryItem[]) => void
  enterDreaming: () => void
  exitDreaming: () => void
  appendDebugConsoleEvent: (event: { source: 'autonomy'; title: string; detail: string }) => void
}

export function useMemoryDream({
  settingsRef,
  memoriesRef,
  dailyMemoriesRef,
  setMemories,
  enterDreaming,
  exitDreaming,
  appendDebugConsoleEvent,
}: UseMemoryDreamOptions) {
  const [dreamLog, setDreamLog] = useState<MemoryDreamLog>(
    () => readJson(AUTONOMY_DREAM_LOG_STORAGE_KEY, createInitialDreamLog()),
  )
  const dreamLogRef = useRef(dreamLog)
  const dreamRunningRef = useRef(false)

  useEffect(() => {
    dreamLogRef.current = dreamLog
    writeJson(AUTONOMY_DREAM_LOG_STORAGE_KEY, dreamLog)
  }, [dreamLog])

  const runDream = useCallback(async () => {
    if (dreamRunningRef.current) return
    const settings = settingsRef.current
    if (!settings.autonomyEnabled || !settings.autonomyDreamEnabled) return
    if (!shouldRunDream(dreamLogRef.current, settings)) return

    dreamRunningRef.current = true
    enterDreaming()

    const startedAt = new Date().toISOString()
    // Flatten DailyMemoryStore into a flat array of DailyMemoryEntry
    const dailyEntries = Object.values(dailyMemoriesRef.current).flat()

    appendDebugConsoleEvent({
      source: 'autonomy',
      title: '开始记忆整理（Dream）',
      detail: `日记条目: ${dailyEntries.length}, 现有记忆: ${memoriesRef.current.length}`,
    })

    try {
      const { system, user } = buildDreamPrompt(
        dailyEntries,
        memoriesRef.current,
        settings,
      )

      // Use the existing chat completion bridge
      const response = await window.desktopPet?.completeChat?.({
        providerId: settings.apiProviderId,
        baseUrl: settings.apiBaseUrl,
        apiKey: settings.apiKey,
        model: settings.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        maxTokens: 2000,
      })

      if (!response?.content) {
        throw new Error('Dream LLM returned empty response')
      }

      const ops = parseDreamResponse(response.content)
      const now = new Date().toISOString()

      // Apply operations
      setMemories((prevMemories) => {
        let updated = [...prevMemories]

        // Prune
        if (ops.pruneIds.length > 0) {
          const pruneSet = new Set(ops.pruneIds)
          updated = updated.filter((m) => !pruneSet.has(m.id))
        }

        // Update
        for (const upd of ops.updates) {
          const idx = updated.findIndex((m) => m.id === upd.id)
          if (idx >= 0) {
            updated[idx] = { ...updated[idx], content: upd.content, lastUsedAt: now }
          }
        }

        // Add new
        for (const newMem of ops.newMemories) {
          updated.push({
            id: crypto.randomUUID().slice(0, 8),
            content: newMem.content,
            category: (newMem.category as MemoryItem['category']) || 'reference',
            source: 'dream',
            createdAt: now,
            importance: (newMem.importance as MemoryItem['importance']) || 'normal',
          })
        }

        return updated
      })

      const result: MemoryDreamResult = {
        mergedTopics: ops.updates.length,
        prunedEntries: ops.pruneIds.length,
        newEntries: ops.newMemories.length,
        startedAt,
        completedAt: new Date().toISOString(),
      }

      setDreamLog((prev) => recordDreamResult(prev, result))

      appendDebugConsoleEvent({
        source: 'autonomy',
        title: '记忆整理完成',
        detail: `新增 ${result.newEntries}, 更新 ${result.mergedTopics}, 清理 ${result.prunedEntries}`,
      })
    } catch (error) {
      appendDebugConsoleEvent({
        source: 'autonomy',
        title: '记忆整理失败',
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      dreamRunningRef.current = false
      exitDreaming()
    }
  }, [settingsRef, memoriesRef, dailyMemoriesRef, setMemories, enterDreaming, exitDreaming, appendDebugConsoleEvent])

  /** Call after each chat session to track sessions-since-dream. */
  const incrementSessionCount = useCallback(() => {
    setDreamLog((prev) => incrementDreamSessionCount(prev))
  }, [])

  return {
    dreamLog,
    runDream,
    incrementSessionCount,
  }
}
