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
    processMessage,
    getRelationshipPrompt,
    updateSessionContext,
  }
}
