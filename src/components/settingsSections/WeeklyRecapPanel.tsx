import { memo, useMemo } from 'react'
import {
  type EmotionSample,
  type RelationshipSample,
  loadEmotionHistory,
  loadRelationshipHistory,
} from '../../features/autonomy/stateTimeline'
import { loadChatMessages } from '../../lib/storage/chat'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { ChatMessage, UiLanguage } from '../../types'

type WeeklyRecapPanelProps = {
  uiLanguage: UiLanguage
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000

interface RecapData {
  weekStart: number
  weekEnd: number
  totalMessages: number
  userMessages: number
  companionMessages: number
  daysActive: number
  /** Average of each emotion dimension across the week (0–1). */
  avgEnergy: number
  avgWarmth: number
  avgCuriosity: number
  avgConcern: number
  /** Relationship score at start vs end of week. */
  relationshipScoreStart: number | null
  relationshipScoreEnd: number | null
  /** Sparkline points (one per day) for avg energy + warmth. */
  energySpark: number[]
  warmthSpark: number[]
}

function computeRecap(
  messages: ChatMessage[],
  emotionHistory: EmotionSample[],
  relationshipHistory: RelationshipSample[],
): RecapData {
  const now = Date.now()
  const weekStart = now - WEEK_MS
  const weekEnd = now

  const recentMessages = messages.filter((m) => {
    const t = Date.parse(m.createdAt)
    return Number.isFinite(t) && t >= weekStart && t <= weekEnd
  })

  const userMessages = recentMessages.filter((m) => m.role === 'user').length
  const companionMessages = recentMessages.filter((m) => m.role === 'assistant').length

  // Days active: count unique YYYY-MM-DD where at least one user message landed.
  const dayKeys = new Set<string>()
  for (const m of recentMessages) {
    if (m.role !== 'user') continue
    const t = Date.parse(m.createdAt)
    if (!Number.isFinite(t)) continue
    dayKeys.add(new Date(t).toISOString().slice(0, 10))
  }

  const recentEmotion = emotionHistory.filter((s) => {
    const t = Date.parse(s.ts)
    return Number.isFinite(t) && t >= weekStart && t <= weekEnd
  })
  const avg = (key: keyof Omit<EmotionSample, 'ts'>) =>
    recentEmotion.length === 0 ? 0 : recentEmotion.reduce((sum, s) => sum + s[key], 0) / recentEmotion.length

  const recentRelationship = relationshipHistory.filter((s) => {
    const t = Date.parse(s.ts)
    return Number.isFinite(t) && t >= weekStart && t <= weekEnd
  })
  const relationshipScoreStart = recentRelationship[0]?.score ?? null
  const relationshipScoreEnd = recentRelationship.at(-1)?.score ?? null

  // 7 daily buckets for sparklines
  const energyByDay: number[] = new Array(7).fill(0)
  const warmthByDay: number[] = new Array(7).fill(0)
  const countByDay: number[] = new Array(7).fill(0)
  for (const s of recentEmotion) {
    const t = Date.parse(s.ts)
    const dayIndex = Math.min(6, Math.max(0, Math.floor((t - weekStart) / (24 * 60 * 60 * 1000))))
    energyByDay[dayIndex] += s.energy
    warmthByDay[dayIndex] += s.warmth
    countByDay[dayIndex] += 1
  }
  const energySpark = energyByDay.map((v, i) => (countByDay[i] === 0 ? 0 : v / countByDay[i]))
  const warmthSpark = warmthByDay.map((v, i) => (countByDay[i] === 0 ? 0 : v / countByDay[i]))

  return {
    weekStart,
    weekEnd,
    totalMessages: recentMessages.length,
    userMessages,
    companionMessages,
    daysActive: dayKeys.size,
    avgEnergy: avg('energy'),
    avgWarmth: avg('warmth'),
    avgCuriosity: avg('curiosity'),
    avgConcern: avg('concern'),
    relationshipScoreStart,
    relationshipScoreEnd,
    energySpark,
    warmthSpark,
  }
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  if (values.every((v) => v === 0)) {
    return <span className="settings-weekly-recap__sparkline settings-weekly-recap__sparkline--empty">·</span>
  }
  const w = 80
  const h = 24
  const max = 1
  const path = values
    .map((v, i) => {
      const x = (i / (values.length - 1)) * w
      const y = h - (v / max) * h
      return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg className="settings-weekly-recap__sparkline" viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path d={path} stroke={color} strokeWidth="1.5" fill="none" />
    </svg>
  )
}

/**
 * Weekly recap panel — local-only summary of the past 7 days for users
 * who want to see their own pattern. Pulls from existing data sources
 * (chat history, state timeline) — nothing new to track, no extra
 * persistence. Read-only and refreshes on mount.
 *
 * Ships in the Console settings section so it sits next to the other
 * "look at your own state" panels (state timeline, cost history).
 */
export const WeeklyRecapPanel = memo(function WeeklyRecapPanel({ uiLanguage }: WeeklyRecapPanelProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1], params?: Record<string, string>) =>
    pickTranslatedUiText(uiLanguage, key, params)
  // Compute eagerly during render — pulling from localStorage is sync
  // and cheap (we already do this in StateTimelinePanel / CostHistoryPanel).
  // Avoids the lint rule about setState-in-useEffect for what is actually
  // just a one-shot read of in-memory data.
  const recap = useMemo(
    () => computeRecap(loadChatMessages(), loadEmotionHistory(), loadRelationshipHistory()),
    [],
  )

  const moodSummary = useMemo(() => {
    if (!recap) return null
    if (recap.avgEnergy === 0 && recap.avgWarmth === 0 && recap.avgCuriosity === 0 && recap.avgConcern === 0) {
      return null
    }
    // Pick the dominant dimension as a one-word vibe tag.
    const dims: Array<{ key: 'energy' | 'warmth' | 'curiosity' | 'concern'; value: number }> = [
      { key: 'energy', value: recap.avgEnergy },
      { key: 'warmth', value: recap.avgWarmth },
      { key: 'curiosity', value: recap.avgCuriosity },
      { key: 'concern', value: recap.avgConcern },
    ]
    dims.sort((a, b) => b.value - a.value)
    return dims[0].key
  }, [recap])

  if (!recap) {
    return (
      <section className="settings-weekly-recap">
        <h4 className="settings-weekly-recap__title">{ti('weekly_recap.title')}</h4>
        <p className="settings-weekly-recap__loading">{ti('weekly_recap.loading')}</p>
      </section>
    )
  }

  if (recap.totalMessages === 0) {
    return (
      <section className="settings-weekly-recap">
        <h4 className="settings-weekly-recap__title">{ti('weekly_recap.title')}</h4>
        <p className="settings-weekly-recap__empty">{ti('weekly_recap.empty')}</p>
      </section>
    )
  }

  const scoreDelta = (recap.relationshipScoreStart != null && recap.relationshipScoreEnd != null)
    ? recap.relationshipScoreEnd - recap.relationshipScoreStart
    : null

  return (
    <section className="settings-weekly-recap">
      <header className="settings-weekly-recap__header">
        <h4 className="settings-weekly-recap__title">{ti('weekly_recap.title')}</h4>
        <p className="settings-weekly-recap__subtitle">{ti('weekly_recap.subtitle')}</p>
      </header>

      <div className="settings-weekly-recap__metrics">
        <div className="settings-weekly-recap__metric">
          <div className="settings-weekly-recap__metric-value">{recap.userMessages}</div>
          <div className="settings-weekly-recap__metric-label">{ti('weekly_recap.metric.user_messages')}</div>
        </div>
        <div className="settings-weekly-recap__metric">
          <div className="settings-weekly-recap__metric-value">{recap.daysActive}<span className="settings-weekly-recap__metric-unit">/7</span></div>
          <div className="settings-weekly-recap__metric-label">{ti('weekly_recap.metric.days_active')}</div>
        </div>
        {scoreDelta != null && (
          <div className="settings-weekly-recap__metric">
            <div className="settings-weekly-recap__metric-value">
              {scoreDelta >= 0 ? '+' : ''}{scoreDelta.toFixed(1)}
            </div>
            <div className="settings-weekly-recap__metric-label">{ti('weekly_recap.metric.score_delta')}</div>
          </div>
        )}
      </div>

      <div className="settings-weekly-recap__sparklines">
        <div className="settings-weekly-recap__spark-row">
          <span className="settings-weekly-recap__spark-label">{ti('weekly_recap.spark.energy')}</span>
          <Sparkline values={recap.energySpark} color="#f5a05f" />
        </div>
        <div className="settings-weekly-recap__spark-row">
          <span className="settings-weekly-recap__spark-label">{ti('weekly_recap.spark.warmth')}</span>
          <Sparkline values={recap.warmthSpark} color="#f06b8c" />
        </div>
      </div>

      {moodSummary && (
        <p className="settings-weekly-recap__vibe">
          {ti(`weekly_recap.vibe.${moodSummary}` as Parameters<typeof pickTranslatedUiText>[1])}
        </p>
      )}
    </section>
  )
})
