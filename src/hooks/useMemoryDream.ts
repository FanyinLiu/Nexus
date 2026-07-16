import { useCallback, useEffect, useRef, useState } from 'react'
import {
  buildDreamPrompt,
  createInitialDreamLog,
  incrementDreamSessionCount,
  parseDreamResponse,
  recordDreamResult,
  shouldRunDream,
} from '../features/autonomy/memoryDream'
import { applyDecayBatch } from '../features/memory/decay'
import { clusterMemories, findBestCluster } from '../features/memory/clustering'
import { archiveMemories, identifyArchiveCandidates } from '../features/memory/coldArchive'
import { rebuildNarrative } from '../features/memory/narrativeMemory'
import {
  buildReflectionPrompt,
  extractReflectionsFromMemories,
  mergeReflections,
  parseReflectionResponse,
  selectCallbackCandidates,
  type ReflectionCandidate,
} from '../features/memory/reflectionGenerator'
import {
  enqueueCallbacks,
  loadCallbackQueue,
} from '../features/memory/callbackStore'
import { recordUsage } from '../features/metering/contextMeter'
import {
  loadEmotionHistory,
  loadRelationshipHistory,
} from '../features/autonomy/stateTimeline'
import {
  buildSkillDistillationPrompt,
  formatSkillAsMemory,
  parseSkillDistillationResponse,
} from '../features/autonomy/skillDistillation'
import {
  AUTONOMY_DREAM_LOG_STORAGE_KEY,
  MEMORY_STORAGE_KEY,
  normalizeMemoryItemsForStorage,
  onStorageChange,
  readJson,
  writeJson,
} from '../lib/storage'
import {
  mutateDreamLogAtomically,
  parseDreamLogSnapshot,
  readDreamLogAtomically,
  type DreamLogMutation,
} from '../features/autonomy/dreamLogState.ts'
import { getRedactedLogErrorMessage } from '../lib/logRedaction.ts'
import {
  acquireBackgroundChatLease,
  classifyBackgroundChatFailure,
  getBackgroundChatGate,
  recordBackgroundChatFailure,
  recordBackgroundChatSuccess,
  releaseBackgroundChatLease,
} from '../features/autonomy/backgroundChatPolicy.ts'
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
  /** Shared busy ref — when true, another LLM call (e.g. chat) is in progress. */
  busyRef?: React.RefObject<boolean>
  /** Only the background runtime owner may start Dream or call an LLM. */
  enabled?: boolean
  appendDebugConsoleEvent: (event: { source: 'autonomy'; title: string; detail: string }) => void
}

export function useMemoryDream({
  settingsRef,
  memoriesRef,
  dailyMemoriesRef,
  setMemories,
  enterDreaming,
  exitDreaming,
  busyRef,
  appendDebugConsoleEvent,
  enabled = true,
}: UseMemoryDreamOptions) {
  const [dreamLog, setDreamLog] = useState<MemoryDreamLog>(() => {
    const stored = readJson<unknown>(AUTONOMY_DREAM_LOG_STORAGE_KEY, createInitialDreamLog())
    return parseDreamLogSnapshot(stored) ?? createInitialDreamLog()
  })
  const dreamLogRef = useRef(dreamLog)
  const dreamRunningRef = useRef(false)
  const dreamStartPendingRef = useRef(false)

  const applyDreamLog = useCallback((next: MemoryDreamLog) => {
    dreamLogRef.current = next
    setDreamLog(next)
  }, [])

  useEffect(() => {
    dreamLogRef.current = dreamLog
  }, [dreamLog])

  const readLatestDreamLog = useCallback(() => readDreamLogAtomically(
    () => parseDreamLogSnapshot(
      readJson<unknown>(AUTONOMY_DREAM_LOG_STORAGE_KEY, dreamLogRef.current),
    ) ?? dreamLogRef.current,
    applyDreamLog,
  ), [applyDreamLog])

  const mutateDreamLog = useCallback((mutate: DreamLogMutation) =>
    mutateDreamLogAtomically(
      () => parseDreamLogSnapshot(
        readJson<unknown>(AUTONOMY_DREAM_LOG_STORAGE_KEY, dreamLogRef.current),
      ) ?? dreamLogRef.current,
      mutate,
      (next) => writeJson(AUTONOMY_DREAM_LOG_STORAGE_KEY, next),
      applyDreamLog,
    ), [applyDreamLog])

  useEffect(() => onStorageChange(
    AUTONOMY_DREAM_LOG_STORAGE_KEY,
    () => {
      // Storage events can arrive out of order. Re-read the shared store while
      // holding the same mutation lock, but never write here.
      void readLatestDreamLog().catch(() => undefined)
    },
  ), [readLatestDreamLog])

  const runDream = useCallback(async () => {
    if (!enabled) return
    if (dreamRunningRef.current) return
    if (dreamStartPendingRef.current) return
    dreamStartPendingRef.current = true
    try {
      if (busyRef?.current) return
      const settings = settingsRef.current
      if (settings.memoryPaused) return
      if (!settings.autonomyEnabled || !settings.autonomyDreamEnabled) return

      // A user chat may have updated this log in the other renderer. Read the
      // latest snapshot under the Dream-log lock before the run gate.
      const latestDreamLog = await readLatestDreamLog()
      if (!shouldRunDream(latestDreamLog, settings)) return
      const startedSessionsSinceDream = latestDreamLog.sessionsSinceDream

      const policyInput = {
        providerId: settings.apiProviderId,
        baseUrl: settings.apiBaseUrl,
        model: settings.model,
        apiKey: settings.apiKey,
      }
      const initialGate = getBackgroundChatGate(policyInput)
      if (!initialGate.allowed) {
        if (initialGate.shouldNotify) {
          appendDebugConsoleEvent({
            source: 'autonomy',
            title: 'Background Dream skipped',
            detail: `background:dream blocked: ${initialGate.reason}`,
          })
        }
        return
      }

      const lease = acquireBackgroundChatLease()
      if (!lease) return
      dreamRunningRef.current = true

      try {
      enterDreaming()
      const startedAt = new Date().toISOString()
      // Flatten DailyMemoryStore into a flat array of DailyMemoryEntry
      const dailyEntries = Object.values(dailyMemoriesRef.current).flat()

      appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Starting memory consolidation (Dream)',
        detail: `diary entries: ${dailyEntries.length}, existing memories: ${memoriesRef.current.length}`,
      })

      const runBackgroundChat = async (
        traceId: 'background:dream' | 'background:dream-skill' | 'background:dream-reflection',
        messages: Array<{ role: 'system' | 'user'; content: string }>,
        temperature: number,
        maxTokens: number,
      ) => {
        const gate = getBackgroundChatGate(policyInput)
        if (!gate.allowed) {
          if (gate.shouldNotify) {
            appendDebugConsoleEvent({
              source: 'autonomy',
              title: 'Background Dream step skipped',
              detail: `${traceId} blocked: ${gate.reason}`,
            })
          }
          return null
        }

        try {
          const response = await window.desktopPet?.completeChat?.({
            providerId: policyInput.providerId,
            baseUrl: policyInput.baseUrl,
            apiKey: policyInput.apiKey,
            model: policyInput.model,
            messages,
            temperature,
            maxTokens,
            traceId,
          })
          if (!response?.content) throw new Error('Background Dream returned empty response')
          recordBackgroundChatSuccess(policyInput)
          return response
        } catch (error) {
          recordBackgroundChatFailure(policyInput, classifyBackgroundChatFailure(error))
          throw error
        }
      }

      const { system, user } = buildDreamPrompt(
        dailyEntries,
        memoriesRef.current,
        settings,
      )

      const response = await runBackgroundChat(
        'background:dream',
        [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        0.3,
        2000,
      )
      if (!response?.content) return

      recordUsage('dream', `${system}\n${user}`, response.content, { modelId: settings.model })
      const ops = parseDreamResponse(response.content)
      const now = new Date().toISOString()

      // ── Skill distillation (bonus dream step — run before memory mutation) ──
      let distilledSkillCount = 0
      let distilledSkills: { content: string }[] = []
      try {
        const existingSkills = memoriesRef.current
          .filter((m) => m.content.startsWith('【技能】'))
          .map((m) => m.content)

        const skillPrompt = buildSkillDistillationPrompt(
          dailyEntries,
          existingSkills,
        )

        if (skillPrompt) {
          const skillResponse = await runBackgroundChat(
            'background:dream-skill',
            [
              { role: 'system', content: skillPrompt.system },
              { role: 'user', content: skillPrompt.user },
            ],
            0.3,
            1000,
          )

          if (skillResponse?.content) {
            recordUsage('skill_distillation', `${skillPrompt.system}\n${skillPrompt.user}`, skillResponse.content, { modelId: settings.model })
            const skills = parseSkillDistillationResponse(skillResponse.content)
            if (skills.length) {
              distilledSkills = skills.map((skill) => ({
                content: formatSkillAsMemory(skill, settings.uiLanguage),
              }))
              distilledSkillCount = skills.length
            }
          }
        }
      } catch (skillError) {
        appendDebugConsoleEvent({
          source: 'autonomy',
          title: 'Skill distillation failed',
          detail: getRedactedLogErrorMessage(skillError),
        })
      }

      // ── Reflection generation (N.E.K.O. borrow — observations about the user) ──
      let reflectionCandidates: ReflectionCandidate[] = []
      try {
        const emotionSamples = loadEmotionHistory().slice(-20)
        const relationshipSamples = loadRelationshipHistory().slice(-10)
        const emotionTrend = summarizeEmotionTrend(emotionSamples)
        const relationshipTrend = summarizeRelationshipTrend(relationshipSamples)
        const existingReflections = extractReflectionsFromMemories(memoriesRef.current)

        const reflectionPrompt = buildReflectionPrompt({
          uiLanguage: settings.uiLanguage,
          dailyEntries,
          emotionTrend,
          relationshipTrend,
          existingReflections,
        })

        if (reflectionPrompt) {
          const reflectionResponse = await runBackgroundChat(
            'background:dream-reflection',
            [
              { role: 'system', content: reflectionPrompt.system },
              { role: 'user', content: reflectionPrompt.user },
            ],
            0.4,
            600,
          )

          if (reflectionResponse?.content) {
            recordUsage(
              'reflection',
              `${reflectionPrompt.system}\n${reflectionPrompt.user}`,
              reflectionResponse.content,
              { modelId: settings.model },
            )
            reflectionCandidates = parseReflectionResponse(reflectionResponse.content)
          }
        }
      } catch (reflectionError) {
        appendDebugConsoleEvent({
          source: 'autonomy',
          title: 'Reflection generation failed',
          detail: getRedactedLogErrorMessage(reflectionError),
        })
      }

      // ── Apply all memory mutations ──
      // Side effects (archiveMemories writes to storage, clusterMemories
      // is heavy compute) must NOT live inside the setMemories updater
      // — React StrictMode runs the updater twice for purity checks,
      // which would archive the same memories twice and double-write the
      // archive store. Compute against a snapshot of the current memories
      // ref OUTSIDE the updater, then setMemories with the final array.
      const snapshot = memoriesRef.current
      let updated = [...snapshot]

      // 1. Prune
      const prunedIds = ops.pruneIds.filter((id) => updated.some((m) => m.id === id))
      if (prunedIds.length > 0) {
        const pruneSet = new Set(prunedIds)
        updated = updated.filter((m) => !pruneSet.has(m.id))
      }

      // 2. Update — link to pruned IDs (these are merges)
      for (const upd of ops.updates) {
        const idx = updated.findIndex((m) => m.id === upd.id)
        if (idx >= 0) {
          const existing = updated[idx]
          const mergedRelated = [...new Set([...(existing.relatedIds ?? []), ...prunedIds])]
          updated[idx] = { ...existing, content: upd.content, lastUsedAt: now, relatedIds: mergedRelated.length ? mergedRelated : undefined }
        }
      }

      // 3. Add new memories from dream
      for (const newMem of ops.newMemories) {
        updated.push({
          id: crypto.randomUUID().slice(0, 8),
          content: newMem.content,
          category: (newMem.category as MemoryItem['category']) || 'reference',
          source: 'dream',
          createdAt: now,
          importance: (newMem.importance as MemoryItem['importance']) || 'normal',
          relatedIds: prunedIds.length ? prunedIds : undefined,
        })
      }

      // 4. Add distilled skills
      if (distilledSkills.length > 0) {
        const skillNow = new Date().toISOString()
        for (const skill of distilledSkills) {
          updated.push({
            id: crypto.randomUUID().slice(0, 8),
            content: skill.content,
            category: 'reference' as const,
            source: 'dream' as const,
            createdAt: skillNow,
            importance: 'normal' as const,
          })
        }
      }

      // 4b. Merge new reflections (dedup by topic, cap at 20)
      if (reflectionCandidates.length > 0) {
        updated = mergeReflections(updated, reflectionCandidates, now)
      }

      // 5. Apply importance decay
      updated = applyDecayBatch(updated)

      // 6. Semantic clustering + cold archiving (side-effecting; must
      // run exactly once)
      const clusters = clusterMemories(updated)
      const clusterCount = clusters.length

      const clusterIdMap = new Map<string, string>()
      for (const cluster of clusters) {
        for (const memberId of cluster.memberIds) {
          clusterIdMap.set(memberId, cluster.id)
        }
      }
      for (const m of updated) {
        if (!clusterIdMap.has(m.id)) {
          const bestId = findBestCluster(m, clusters)
          if (bestId) clusterIdMap.set(m.id, bestId)
        }
      }

      let archivedCount = 0
      const candidates = identifyArchiveCandidates(updated)
      if (candidates.length > 0) {
        const { active } = archiveMemories(updated, candidates, clusterIdMap)
        archivedCount = candidates.length
        updated = active
      }

      const finalMemories: MemoryItem[] = updated

      // When archiveMemories ran, persist the active set synchronously in the
      // same call stack as that archive write — otherwise a crash between the
      // (synchronous) archive write and the (debounced) active-store save would
      // leave the archived items in BOTH stores (resurfacing as duplicates on
      // restart). The setMemories below still drives the UI + normal save.
      if (candidates.length > 0) {
        writeJson(MEMORY_STORAGE_KEY, normalizeMemoryItemsForStorage(finalMemories))
      }

      // Pure replacement: updater closes over `finalMemories` (already
      // computed) so a double-run produces identical output without any
      // duplicate side-effect.
      setMemories(() => finalMemories)

      // ── Rebuild narrative threads from the actual updated memories ──
      const narrativeSnapshot = rebuildNarrative(finalMemories)

      // ── Pick callback candidates for the next chat (Top retention move) ──
      let callbackCount = 0
      try {
        const pendingIds = new Set(loadCallbackQueue().map((p) => p.memoryId))
        const newCandidates = selectCallbackCandidates(finalMemories, pendingIds)
        if (newCandidates.length) {
          // 7-day TTL — feels-like-a-callback timing range; older than that
          // and "did you ever pick a gift?" stops feeling natural.
          enqueueCallbacks(newCandidates, 7 * 24 * 60 * 60 * 1000)
          callbackCount = newCandidates.length
        }
      } catch (callbackError) {
        appendDebugConsoleEvent({
          source: 'autonomy',
          title: 'Callback selection failed',
          detail: getRedactedLogErrorMessage(callbackError),
        })
      }

      const result: MemoryDreamResult = {
        mergedTopics: ops.updates.length,
        prunedEntries: ops.pruneIds.length,
        newEntries: ops.newMemories.length + distilledSkillCount,
        startedAt,
        completedAt: new Date().toISOString(),
      }

      // A panel renderer may have incremented sessions while this Dream was
      // running. Never apply the result to this renderer's stale React state:
      // merge against the latest persisted log, then update ref/state/storage
      // from that single value.
      await mutateDreamLog((latest) => recordDreamResult(latest, result, startedSessionsSinceDream))

      appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Memory consolidation completed',
        detail: `added ${ops.newMemories.length}, updated ${result.mergedTopics}, pruned ${result.prunedEntries}${distilledSkillCount ? `, skills +${distilledSkillCount}` : ''}${clusterCount ? `, clusters ${clusterCount}` : ''}${archivedCount ? `, archived ${archivedCount}` : ''}${narrativeSnapshot.threads.length ? `, narrative threads ${narrativeSnapshot.threads.length}` : ''}${callbackCount ? `, callbacks queued ${callbackCount}` : ''}`,
      })
    } catch (error) {
      appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Memory consolidation failed',
        detail: getRedactedLogErrorMessage(error),
      })
    } finally {
      dreamRunningRef.current = false
      try {
        exitDreaming()
      } finally {
        releaseBackgroundChatLease(lease)
      }
    }
    } finally {
      dreamStartPendingRef.current = false
    }
  }, [enabled, settingsRef, memoriesRef, dailyMemoriesRef, setMemories, enterDreaming, exitDreaming, busyRef, appendDebugConsoleEvent, readLatestDreamLog, mutateDreamLog])

  /** Call after each chat session to track sessions-since-dream. */
  const incrementSessionCount = useCallback(() => {
    void mutateDreamLog((latest) => incrementDreamSessionCount(latest)).catch(() => undefined)
  }, [mutateDreamLog])

  return {
    dreamLog,
    runDream,
    incrementSessionCount,
  }
}

// ── Trend summarizers (for reflection prompt) ──────────────────────────────

type EmotionSample = ReturnType<typeof loadEmotionHistory>[number]
type RelationshipSample = ReturnType<typeof loadRelationshipHistory>[number]

function summarizeEmotionTrend(samples: EmotionSample[]): string | null {
  if (samples.length < 3) return null
  const first = samples[0]
  const last = samples[samples.length - 1]
  const deltas: string[] = []
  for (const axis of ['energy', 'warmth', 'curiosity', 'concern'] as const) {
    const diff = last[axis] - first[axis]
    if (Math.abs(diff) >= 0.1) {
      deltas.push(`${axis} ${diff > 0 ? 'rising' : 'falling'} (${first[axis].toFixed(2)} → ${last[axis].toFixed(2)})`)
    }
  }
  return deltas.length ? deltas.join(', ') : 'stable across axes'
}

function summarizeRelationshipTrend(samples: RelationshipSample[]): string | null {
  if (samples.length < 2) return null
  const first = samples[0]
  const last = samples[samples.length - 1]
  const scoreDelta = last.score - first.score
  return `score ${first.score} → ${last.score} (${scoreDelta >= 0 ? '+' : ''}${scoreDelta}), streak ${last.streak}d`
}
