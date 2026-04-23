/**
 * Sub-dimensional relationship profile.
 *
 * The flat 0–100 relationship score captures "how close are we" but says
 * nothing about "in what way." Four sub-dimensions decompose it:
 *
 *   trust         — willingness to rely on the companion; grows from
 *                   problems shared and help accepted
 *   vulnerability — emotional openness; grows from feelings shared,
 *                   personal stories, expressed sadness
 *   playfulness   — lightheartedness; grows from jokes and teasing
 *   intellectual  — depth of shared thinking; grows from deep questions,
 *                   debate, mutual teaching
 *
 * Each dimension is a continuous value in [0, 1] that grows from per-message
 * signal detection (diminishing-returns deltas) and decays very slowly
 * toward a low baseline. The composite score is a weighted blend that can
 * be compared with the flat daily-interaction score so neither dominates.
 */

import { clamp, classifyByPatterns, driftToward } from '../../lib/common.ts'
import type { RelationshipLevel } from './relationshipTracker.ts'

export interface SubDimensions {
  trust: number
  vulnerability: number
  playfulness: number
  intellectual: number
}

export function createDefaultSubDimensions(): SubDimensions {
  return { trust: 0.1, vulnerability: 0.05, playfulness: 0.1, intellectual: 0.1 }
}

// ── Signal classification ──────────────────────────────────────────────────

export type RelationshipSignal =
  | 'shared_problem'
  | 'accepted_help'
  | 'shared_feeling'
  | 'personal_story'
  | 'expressed_sadness'
  | 'joke'
  | 'teasing'
  | 'asked_deep_question'
  | 'debated'
  | 'taught_something'

const SIGNAL_PATTERNS: Array<{ signal: RelationshipSignal; pattern: RegExp }> = [
  // Trust: bringing a real problem, or accepting that help worked.
  { signal: 'shared_problem', pattern: /(帮我|能不能帮|请帮|有个问题想问你|我想问|我遇到|我碰到|我不知道怎么|help me|could you help|i need help|i have a problem|i don['’]t know how)/i },
  { signal: 'accepted_help', pattern: /(谢谢.{0,5}帮|感谢.{0,5}(解决|帮忙)|你说得对|好的.{0,4}试试|果然|原来如此|thanks.{0,10}helped|that worked|you['’]re right|got it, thanks)/i },

  // Vulnerability: emotional opening, personal history, low mood.
  // All patterns require a first-person marker so "my friend is sad" does not
  // trigger vulnerability growth on behalf of the user.
  { signal: 'shared_feeling', pattern: /(我.{0,4}感觉|我觉得.{0,5}(难过|孤独|害怕|焦虑|压力|累|委屈|失落|不开心|开心|高兴|幸福)|我心情|i feel|i['’]m feeling|feeling (sad|lonely|scared|anxious|stressed|tired|down|happy))/i },
  { signal: 'personal_story', pattern: /(我小时候|以前.{0,5}我|我记得.{0,3}(那年|年|时候)|我爸|我妈|我家|我爷爷|我奶奶|我朋友|growing up|when i was (a kid|little|young)|my (family|parents|dad|mom|grandma|grandpa))/i },
  // Subject has to be the user themselves — exclude "我朋友/我妈/我他" etc.
  { signal: 'expressed_sadness', pattern: /(我(?!.{0,8}(朋友|妈|爸|家人|他|她|爷|奶|别人|他们))(.{0,8})(难过|伤心|孤独|想哭|泪目|心碎)|i['’]?m?\s+(so\s+)?(sad|lonely|heartbroken|crying|tearing up))/i },

  // Playfulness: laughter, teasing, banter.
  { signal: 'joke', pattern: /(哈哈|嘻嘻|笑死|233|草w?$|wwwww|lol|lmao|rofl|haha|😂|🤣|that['’]s hilarious|so funny)/i },
  { signal: 'teasing', pattern: /(你这个|逗你|开玩笑|别闹|臭美|呆瓜|笨蛋(?!\s*(不是|并不))|just kidding|i['’]m teasing|you silly|dork)/i },

  // Intellectual: open-ended questions, debate, knowledge exchange.
  { signal: 'asked_deep_question', pattern: /(为什么.{0,10}会|怎么理解|你觉得.{0,10}是不是|本质上|从根本|what do you think|why does|how would you explain|what['’]s your take)/i },
  { signal: 'debated', pattern: /(我觉得不对|我不同意|不一定吧|另一种看法|其实|我反而|actually i think|i disagree|not sure i agree|on the other hand|counterpoint)/i },
  { signal: 'taught_something', pattern: /(你知道吗|告诉你.{0,4}件事|我发现|我学到|did you know|let me tell you|i learned|here['’]s a fact)/i },
]

export function classifyRelationshipSignals(text: string): RelationshipSignal[] {
  return classifyByPatterns(text, SIGNAL_PATTERNS)
}

// ── Signal application ────────────────────────────────────────────────────

interface SignalEffect {
  dim: keyof SubDimensions
  delta: number
}

const SIGNAL_EFFECTS: Record<RelationshipSignal, SignalEffect> = {
  shared_problem:      { dim: 'trust',         delta: 0.02 },
  accepted_help:       { dim: 'trust',         delta: 0.015 },
  shared_feeling:      { dim: 'vulnerability', delta: 0.025 },
  personal_story:      { dim: 'vulnerability', delta: 0.02 },
  expressed_sadness:   { dim: 'vulnerability', delta: 0.03 },
  joke:                { dim: 'playfulness',   delta: 0.02 },
  teasing:             { dim: 'playfulness',   delta: 0.015 },
  asked_deep_question: { dim: 'intellectual',  delta: 0.02 },
  debated:             { dim: 'intellectual',  delta: 0.025 },
  taught_something:    { dim: 'intellectual',  delta: 0.015 },
}

/**
 * Apply detected signals to sub-dimensions. Each signal's raw delta is
 * scaled by `(1 - current * 0.5)` so growth slows as a dimension saturates
 * — prevents runaway, mirrors diminishing returns in real closeness.
 */
export function applyRelationshipSignals(
  dims: SubDimensions,
  signals: RelationshipSignal[],
): SubDimensions {
  if (signals.length === 0) return dims
  const next: SubDimensions = { ...dims }
  for (const signal of signals) {
    const { dim, delta } = SIGNAL_EFFECTS[signal]
    const current = next[dim]
    const effective = delta * (1 - current * 0.5)
    next[dim] = clamp(current + effective, 0, 1)
  }
  return next
}

// ── Composite score ───────────────────────────────────────────────────────

const DIMENSION_WEIGHTS: Record<keyof SubDimensions, number> = {
  trust: 0.3,
  vulnerability: 0.25,
  playfulness: 0.2,
  intellectual: 0.25,
}

/** Weighted blend of sub-dimensions to an integer score in [0, 100]. */
export function computeCompositeScore(dims: SubDimensions): number {
  let weighted = 0
  for (const key of Object.keys(DIMENSION_WEIGHTS) as Array<keyof SubDimensions>) {
    weighted += dims[key] * DIMENSION_WEIGHTS[key]
  }
  return Math.round(weighted * 100)
}

// ── Decay ─────────────────────────────────────────────────────────────────

const DECAY_RATE = 0.005
const DECAY_BASELINE = createDefaultSubDimensions()

/**
 * Drift sub-dimensions toward baseline. Intended to be called at most
 * once per day; rate is small on purpose — relationship depth should be
 * stable across dry spells, only slowly eroding with prolonged absence.
 */
export function decaySubDimensions(dims: SubDimensions): SubDimensions {
  return driftToward(dims, DECAY_BASELINE, DECAY_RATE)
}

// ── Prompt context ────────────────────────────────────────────────────────

/**
 * Produce additive guidance lines that layer on top of the flat-level
 * prompt from relationshipTracker. Only speaks when a dimension is
 * notably high or low — mid-range dimensions stay silent to avoid prompt
 * bloat.
 */
export function formatSubDimensionsForPrompt(
  dims: SubDimensions,
  level: RelationshipLevel,
): string {
  const parts: string[] = []
  const nonStranger = level !== 'stranger'

  if (dims.trust > 0.7) {
    parts.push('They trust you deeply — they come to you with real problems. Honor that.')
  } else if (dims.trust < 0.2 && nonStranger) {
    parts.push('They haven\'t opened up about their problems yet. Don\'t push — let trust build naturally.')
  }

  if (dims.vulnerability > 0.6) {
    parts.push('They\'ve shown you vulnerable sides of themselves. Be gentle with that knowledge.')
  }

  if (dims.playfulness > 0.7) {
    parts.push('You share a playful dynamic — banter and teasing come naturally.')
  } else if (dims.playfulness < 0.15 && nonStranger) {
    parts.push('The dynamic has been more serious so far. Light humor is fine, but don\'t force playfulness.')
  }

  if (dims.intellectual > 0.7) {
    parts.push('You share rich intellectual exchanges. They enjoy exploring ideas with you.')
  }

  return parts.join('\n')
}
