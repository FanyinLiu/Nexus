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
  type ReflectionCandidate,
} from '../features/memory/reflectionGenerator'
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
  /** Shared busy ref — when true, another LLM call (e.g. chat) is in progress. */
  busyRef?: React.RefObject<boolean>
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
    if (busyRef?.current) return
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
      title: 'Starting memory consolidation (Dream)',
      detail: `diary entries: ${dailyEntries.length}, existing memories: ${memoriesRef.current.length}`,
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
          const skillResponse = await window.desktopPet?.completeChat?.({
            providerId: settings.apiProviderId,
            baseUrl: settings.apiBaseUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            messages: [
              { role: 'system', content: skillPrompt.system },
              { role: 'user', content: skillPrompt.user },
            ],
            temperature: 0.3,
            maxTokens: 1000,
          })

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
          detail: skillError instanceof Error ? skillError.message : String(skillError),
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
          const reflectionResponse = await window.desktopPet?.completeChat?.({
            providerId: settings.apiProviderId,
            baseUrl: settings.apiBaseUrl,
            apiKey: settings.apiKey,
            model: settings.model,
            messages: [
              { role: 'system', content: reflectionPrompt.system },
              { role: 'user', content: reflectionPrompt.user },
            ],
            temperature: 0.4,
            maxTokens: 600,
          })

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
          detail: reflectionError instanceof Error ? reflectionError.message : String(reflectionError),
        })
      }

      // ── Apply all memory mutations in a single setMemories to avoid stale refs ──
      let archivedCount = 0
      let clusterCount = 0
      let finalMemories: MemoryItem[] = []

      setMemories((prevMemories) => {
        let updated = [...prevMemories]

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

        // 6. Semantic clustering + cold archiving
        const clusters = clusterMemories(updated)
        clusterCount = clusters.length

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

        const candidates = identifyArchiveCandidates(updated)
        if (candidates.length > 0) {
          const { active } = archiveMemories(updated, candidates, clusterIdMap)
          archivedCount = candidates.length
          updated = active
        }

        finalMemories = updated
        return updated
      })

      // ── Rebuild narrative threads from the actual updated memories ──
      const narrativeSnapshot = rebuildNarrative(finalMemories)

      const result: MemoryDreamResult = {
        mergedTopics: ops.updates.length,
        prunedEntries: ops.pruneIds.length,
        newEntries: ops.newMemories.length + distilledSkillCount,
        startedAt,
        completedAt: new Date().toISOString(),
      }

      setDreamLog((prev) => recordDreamResult(prev, result))

      appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Memory consolidation completed',
        detail: `added ${ops.newMemories.length}, updated ${result.mergedTopics}, pruned ${result.prunedEntries}${distilledSkillCount ? `, skills +${distilledSkillCount}` : ''}${clusterCount ? `, clusters ${clusterCount}` : ''}${archivedCount ? `, archived ${archivedCount}` : ''}${narrativeSnapshot.threads.length ? `, narrative threads ${narrativeSnapshot.threads.length}` : ''}`,
      })
    } catch (error) {
      appendDebugConsoleEvent({
        source: 'autonomy',
        title: 'Memory consolidation failed',
        detail: error instanceof Error ? error.message : String(error),
      })
    } finally {
      dreamRunningRef.current = false
      exitDreaming()
    }
  }, [settingsRef, memoriesRef, dailyMemoriesRef, setMemories, enterDreaming, exitDreaming, busyRef, appendDebugConsoleEvent])

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
