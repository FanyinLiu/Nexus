import { useCallback, useRef } from 'react'
import {
  type RelationshipMilestone,
  type RelationshipState,
  applyAbsenceDecay,
  createDefaultRelationshipState,
  detectLevelTransition,
  formatAbsenceContext,
  formatMilestoneForPrompt,
  formatRelationshipForPrompt,
  markDailyInteraction,
  recordLevelMilestone,
} from '../../features/autonomy/relationshipTracker'
import {
  applyRelationshipSignals,
  classifyRelationshipSignals,
  createDefaultSubDimensions,
  decaySubDimensions,
} from '../../features/autonomy/relationshipDimensions.ts'
import {
  detectAnniversaryMilestones,
  markMilestoneFired,
} from '../../features/autonomy/milestones.ts'
import { findOnThisDayCandidate } from '../../features/memory/onThisDay.ts'
import {
  loadOnThisDayLedger,
  recordOnThisDayFired,
} from '../../features/memory/onThisDayLedger.ts'
import { formatOnThisDayPromptHint } from '../../features/memory/onThisDayPrompt.ts'
import type { MemoryItem } from '../../types'
import { captureRelationshipSample } from '../../features/autonomy/stateTimeline.ts'
import {
  AUTONOMY_RELATIONSHIP_STORAGE_KEY,
  readJson,
  writeJson,
  writeJsonDebounced,
} from '../../lib/storage'

export function useRelationshipState() {
  const relationshipRef = useRef<RelationshipState>(
    readJson<RelationshipState>(AUTONOMY_RELATIONSHIP_STORAGE_KEY, createDefaultRelationshipState()),
  )
  const lastAbsenceCheckDateRef = useRef<string>('')
  const pendingMilestoneRef = useRef<RelationshipMilestone | null>(null)

  const decayOnTick = useCallback(() => {
    const today = new Date().toISOString().slice(0, 10)
    if (today === lastAbsenceCheckDateRef.current) return
    lastAbsenceCheckDateRef.current = today
    const decayed = applyAbsenceDecay(relationshipRef.current)
    relationshipRef.current = decayed.subDimensions
      ? { ...decayed, subDimensions: decaySubDimensions(decayed.subDimensions) }
      : decayed
    writeJson(AUTONOMY_RELATIONSHIP_STORAGE_KEY, relationshipRef.current)
  }, [])

  /**
   * Classify the user message for relationship signals and apply them to
   * sub-dimensions. Lazily initializes subDimensions on first use so
   * pre-v0.3 stored state migrates transparently. Writes are debounced
   * because active chat can fire several signals a minute.
   */
  const processMessage = useCallback((text: string) => {
    if (!text) return
    const signals = classifyRelationshipSignals(text)
    if (signals.length === 0) return
    const prev = relationshipRef.current
    const baseDims = prev.subDimensions ?? createDefaultSubDimensions()
    const nextDims = applyRelationshipSignals(baseDims, signals)
    relationshipRef.current = { ...prev, subDimensions: nextDims }
    writeJsonDebounced(AUTONOMY_RELATIONSHIP_STORAGE_KEY, relationshipRef.current)
  }, [])

  const markInteraction = useCallback(() => {
    const prev = relationshipRef.current
    let next = markDailyInteraction(prev)
    if (next !== prev) {
      next = recordLevelMilestone(next)
      const milestone = detectLevelTransition(prev, next)
      if (milestone) pendingMilestoneRef.current = milestone
      relationshipRef.current = next
      writeJson(AUTONOMY_RELATIONSHIP_STORAGE_KEY, next)
      captureRelationshipSample(next)
    }
  }, [])

  /**
   * Return and clear the pending milestone instruction, if any.
   *
   * Called by the chat runtime at the start of each turn — the milestone
   * is a one-shot prompt that fires only on the turn the level transition
   * happened, then is consumed and gone.
   */
  const consumePendingMilestoneText = useCallback(() => {
    const milestone = pendingMilestoneRef.current
    if (!milestone) return ''
    pendingMilestoneRef.current = null
    return formatMilestoneForPrompt(milestone)
  }, [])

  /**
   * Anniversary milestone (days-30/100/365) — checked at chat-turn time
   * rather than buffered in a ref because the threshold is a state-derived
   * predicate (totalDaysInteracted ≥ N) that any caller can recompute
   * deterministically. When fired we persist the key on the state so it
   * doesn't fire again next turn.
   */
  const consumeAnniversaryPromptText = useCallback((uiLanguage: string) => {
    const trigger = detectAnniversaryMilestones(relationshipRef.current, uiLanguage)
    if (!trigger) return ''
    const next = markMilestoneFired(relationshipRef.current, trigger.key)
    if (next !== relationshipRef.current) {
      relationshipRef.current = next
      writeJson(AUTONOMY_RELATIONSHIP_STORAGE_KEY, next)
    }
    return trigger.promptHint
  }, [])

  /**
   * "On this day" — distinct from days-30/100/365 above. This one matches
   * a single past memory's createdAt against today's date (year /
   * half-year / month / week anniversaries) and asks the LLM to weave it
   * in if the moment fits. Lifetime ledger keeps each memory id from
   * firing on consecutive days through the +/- tolerance window.
   */
  const consumeOnThisDayPromptText = useCallback((uiLanguage: string, memories: MemoryItem[]) => {
    if (!memories.length) return ''
    const nowMs = Date.now()
    const ledger = loadOnThisDayLedger(nowMs)
    const excludeIds = new Set(Object.keys(ledger))
    const candidate = findOnThisDayCandidate(memories, nowMs, excludeIds)
    if (!candidate) return ''
    recordOnThisDayFired(candidate.memoryId, new Date(nowMs).toISOString())
    return formatOnThisDayPromptHint(candidate, uiLanguage)
  }, [])

  const getRelationshipPrompt = useCallback(() => {
    const state = relationshipRef.current
    const base = formatRelationshipForPrompt(state)
    const absence = formatAbsenceContext(state)
    return absence ? `${base}\n${absence}` : base
  }, [])

  const updateSessionContext = useCallback((emotion: { energy: number; warmth: number; curiosity: number; concern: number }, topic: string) => {
    const prev = relationshipRef.current
    const trimmedTopic = topic.replace(/\s+/g, ' ').trim().slice(0, 80)
    relationshipRef.current = { ...prev, lastSessionEmotion: emotion, lastSessionTopic: trimmedTopic || prev.lastSessionTopic }
    writeJson(AUTONOMY_RELATIONSHIP_STORAGE_KEY, relationshipRef.current)
  }, [])

  return {
    relationshipRef,
    decayOnTick,
    markInteraction,
    consumePendingMilestoneText,
    consumeAnniversaryPromptText,
    consumeOnThisDayPromptText,
    processMessage,
    getRelationshipPrompt,
    updateSessionContext,
  }
}
