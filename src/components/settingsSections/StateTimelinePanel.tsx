import { memo, useCallback, useEffect, useState } from 'react'
import {
  type EmotionSample,
  type RelationshipSample,
  loadEmotionHistory,
  loadRelationshipHistory,
} from '../../features/autonomy/stateTimeline'
import type { RelationshipLevel } from '../../features/autonomy/relationshipTracker'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { TranslationKey, TranslationParams, UiLanguage } from '../../types'

/**
 * Emotion + relationship time-series panel.
 *
 * Two tiny hand-rolled SVG charts (no chart-library dep):
 *   - Emotion: 4-line chart (energy/warmth/curiosity/concern, 0-1 range)
 *   - Relationship: single-line score chart (0-100)
 *
 * Reads directly from the persisted history stores. No live subscription
 * — the panel only refreshes while the Console section is visible, which
 * matches the "I want to check how my companion's been lately" mental model.
 */
type StateTimelinePanelProps = {
  uiLanguage: UiLanguage
  active?: boolean
}

type TimelineTranslator = (key: TranslationKey, params?: TranslationParams) => string

const RELATIONSHIP_LEVEL_KEYS: Record<RelationshipLevel, TranslationKey> = {
  stranger: 'settings.console.timeline.level.stranger',
  acquaintance: 'settings.console.timeline.level.acquaintance',
  friend: 'settings.console.timeline.level.friend',
  close_friend: 'settings.console.timeline.level.close_friend',
  intimate: 'settings.console.timeline.level.intimate',
}

export const StateTimelinePanel = memo(function StateTimelinePanel({
  uiLanguage,
  active = true,
}: StateTimelinePanelProps) {
  const [emotion, setEmotion] = useState<EmotionSample[]>(() => loadEmotionHistory())
  const [relationship, setRelationship] = useState<RelationshipSample[]>(() =>
    loadRelationshipHistory(),
  )
  const ti: TimelineTranslator = (key, params) => pickTranslatedUiText(uiLanguage, key, params)

  const refresh = useCallback(() => {
    setEmotion(loadEmotionHistory())
    setRelationship(loadRelationshipHistory())
  }, [])

  // The history readers are cached, but hidden settings sections should
  // not keep polling forever in the background.
  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(refresh, 5_000)
    return () => window.clearInterval(timer)
  }, [active, refresh])

  const capturedSampleCount = Math.max(emotion.length, relationship.length)

  return (
    <section className="settings-diagnostics-panel">
      <header className="settings-diagnostics-panel__header">
        <h4>{ti('settings.console.timeline.title')}</h4>
        <p>
          {ti('settings.console.timeline.description', { count: capturedSampleCount })}
        </p>
      </header>
      <EmotionChart samples={emotion} t={ti} />
      <RelationshipChart samples={relationship} t={ti} />
      <div className="settings-diagnostics-panel__actions">
        <button type="button" className="ghost-button" onClick={refresh}>
          {ti('settings.console.timeline.refresh')}
        </button>
      </div>
    </section>
  )
})

// ── Emotion chart ─────────────────────────────────────────────────────────

const EMOTION_CHART_WIDTH = 600
const EMOTION_CHART_HEIGHT = 140
const EMOTION_PAD_X = 32
const EMOTION_PAD_Y = 12

const EMOTION_SERIES: Array<{
  key: keyof Pick<EmotionSample, 'energy' | 'warmth' | 'curiosity' | 'concern'>
  labelKey: TranslationKey
  color: string
}> = [
  { key: 'energy', labelKey: 'settings.console.emotion.energy', color: '#f59e0b' },
  { key: 'warmth', labelKey: 'settings.console.emotion.warmth', color: '#ef4444' },
  { key: 'curiosity', labelKey: 'settings.console.emotion.curiosity', color: '#8b5cf6' },
  { key: 'concern', labelKey: 'settings.console.emotion.concern', color: '#3b82f6' },
]

function EmotionChart({ samples, t }: { samples: EmotionSample[]; t: TimelineTranslator }) {
  if (samples.length < 2) {
    return (
      <div className="settings-timeline-placeholder">
        <strong>{t('settings.console.timeline.emotion')}</strong>
        <p>{t('settings.console.timeline.emotion_empty')}</p>
      </div>
    )
  }

  const firstTsRaw = Date.parse(samples[0].ts)
  const lastTsRaw = Date.parse(samples[samples.length - 1].ts)
  // Defensive: a malformed sample timestamp would propagate NaN through
  // every projectX call and emit `NaN,NaN` SVG paths. Falls back to a
  // unit-span placeholder so the chart degrades to overlapping points
  // instead of disappearing.
  const firstTs = Number.isFinite(firstTsRaw) ? firstTsRaw : 0
  const lastTs = Number.isFinite(lastTsRaw) ? lastTsRaw : firstTs + 1
  const span = Math.max(lastTs - firstTs, 1)
  const innerWidth = EMOTION_CHART_WIDTH - 2 * EMOTION_PAD_X
  const innerHeight = EMOTION_CHART_HEIGHT - 2 * EMOTION_PAD_Y

  function projectX(sample: EmotionSample): number {
    const parsed = Date.parse(sample.ts)
    const ratio = Number.isFinite(parsed) ? (parsed - firstTs) / span : 0
    return EMOTION_PAD_X + ratio * innerWidth
  }

  function projectY(value: number): number {
    return EMOTION_PAD_Y + (1 - value) * innerHeight
  }

  function pathFor(key: 'energy' | 'warmth' | 'curiosity' | 'concern'): string {
    return samples
      .map((s, i) => `${i === 0 ? 'M' : 'L'}${projectX(s).toFixed(1)},${projectY(s[key]).toFixed(1)}`)
      .join(' ')
  }

  const chartTitleId = 'state-emotion-chart-title'
  const chartDescriptionId = 'state-emotion-chart-description'
  const latest = samples[samples.length - 1]
  const spanLabel = formatSpan(firstTs, lastTs, t)
  const chartDescription = t('settings.console.timeline.chart.emotion_desc', {
    count: samples.length,
    span: spanLabel,
    energy: latest.energy.toFixed(2),
    warmth: latest.warmth.toFixed(2),
    curiosity: latest.curiosity.toFixed(2),
    concern: latest.concern.toFixed(2),
  })

  return (
    <div className="settings-timeline-chart">
      <strong>{t('settings.console.timeline.emotion')}</strong>
      <svg
        viewBox={`0 0 ${EMOTION_CHART_WIDTH} ${EMOTION_CHART_HEIGHT}`}
        className="settings-timeline-chart__svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-labelledby={`${chartTitleId} ${chartDescriptionId}`}
      >
        <title id={chartTitleId}>{t('settings.console.timeline.chart.emotion_title')}</title>
        <desc id={chartDescriptionId}>{chartDescription}</desc>
        {[0.25, 0.5, 0.75].map((v) => (
          <line
            key={v}
            x1={EMOTION_PAD_X}
            x2={EMOTION_CHART_WIDTH - EMOTION_PAD_X}
            y1={projectY(v)}
            y2={projectY(v)}
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="2 3"
          />
        ))}
        {EMOTION_SERIES.map(({ key, color }) => (
          <path
            key={key}
            d={pathFor(key)}
            stroke={color}
            strokeWidth={1.4}
            fill="none"
            opacity={0.9}
          />
        ))}
      </svg>
      <div className="settings-timeline-legend">
        {EMOTION_SERIES.map(({ key, labelKey }) => (
          <span key={key} className="settings-timeline-legend__item">
            <span className={`settings-timeline-legend__swatch settings-timeline-legend__swatch--${key}`} />
            {t(labelKey)}
          </span>
        ))}
        <span className="settings-timeline-legend__range">
          {samples.length} {t('settings.console.timeline.samples')} · {spanLabel}
        </span>
      </div>
    </div>
  )
}

// ── Relationship chart ────────────────────────────────────────────────────

const REL_CHART_WIDTH = 600
const REL_CHART_HEIGHT = 100
const REL_PAD_X = 32
const REL_PAD_Y = 12

function RelationshipChart({ samples, t }: { samples: RelationshipSample[]; t: TimelineTranslator }) {
  if (samples.length < 2) {
    return (
      <div className="settings-timeline-placeholder">
        <strong>{t('settings.console.timeline.relationship')}</strong>
        <p>{t('settings.console.timeline.relationship_empty')}</p>
      </div>
    )
  }

  const firstTsRaw = Date.parse(samples[0].ts)
  const lastTsRaw = Date.parse(samples[samples.length - 1].ts)
  const firstTs = Number.isFinite(firstTsRaw) ? firstTsRaw : 0
  const lastTs = Number.isFinite(lastTsRaw) ? lastTsRaw : firstTs + 1
  const span = Math.max(lastTs - firstTs, 1)
  const innerWidth = REL_CHART_WIDTH - 2 * REL_PAD_X
  const innerHeight = REL_CHART_HEIGHT - 2 * REL_PAD_Y

  function projectX(sample: RelationshipSample): number {
    const parsed = Date.parse(sample.ts)
    const ratio = Number.isFinite(parsed) ? (parsed - firstTs) / span : 0
    return REL_PAD_X + ratio * innerWidth
  }

  function projectY(score: number): number {
    return REL_PAD_Y + (1 - Math.max(0, Math.min(100, score)) / 100) * innerHeight
  }

  const path = samples
    .map((s, i) => `${i === 0 ? 'M' : 'L'}${projectX(s).toFixed(1)},${projectY(s.score).toFixed(1)}`)
    .join(' ')

  const latest = samples[samples.length - 1]
  const chartTitleId = 'state-relationship-chart-title'
  const chartDescriptionId = 'state-relationship-chart-description'
  const spanLabel = formatSpan(firstTs, lastTs, t)
  const relationshipLevelLabel = t(RELATIONSHIP_LEVEL_KEYS[latest.level])
  const daySuffix = t('settings.console.timeline.day_suffix')
  const chartDescription = t('settings.console.timeline.chart.relationship_desc', {
    count: samples.length,
    span: spanLabel,
    score: latest.score,
    level: relationshipLevelLabel,
    streak: latest.streak,
  })

  return (
    <div className="settings-timeline-chart">
      <strong>{t('settings.console.timeline.relationship')}</strong>
      <svg
        viewBox={`0 0 ${REL_CHART_WIDTH} ${REL_CHART_HEIGHT}`}
        className="settings-timeline-chart__svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-labelledby={`${chartTitleId} ${chartDescriptionId}`}
      >
        <title id={chartTitleId}>{t('settings.console.timeline.chart.relationship_title')}</title>
        <desc id={chartDescriptionId}>{chartDescription}</desc>
        {[10, 30, 55, 80].map((v) => (
          <line
            key={v}
            x1={REL_PAD_X}
            x2={REL_CHART_WIDTH - REL_PAD_X}
            y1={projectY(v)}
            y2={projectY(v)}
            stroke="rgba(255,255,255,0.08)"
            strokeDasharray="3 3"
          />
        ))}
        <path d={path} stroke="#10b981" strokeWidth={1.8} fill="none" />
      </svg>
      <div className="settings-timeline-legend">
        <span className="settings-timeline-legend__item">
          {t('settings.console.timeline.current')}: {latest.score}/100 · {relationshipLevelLabel}
        </span>
        <span className="settings-timeline-legend__item">
          {t('settings.console.timeline.streak')}: {latest.streak}{daySuffix} · {t('settings.console.timeline.total')}: {latest.daysInteracted}{daySuffix}
        </span>
        <span className="settings-timeline-legend__range">
          {samples.length} {t('settings.console.timeline.samples')} · {spanLabel}
        </span>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatSpan(firstMs: number, lastMs: number, t: TimelineTranslator): string {
  if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) return ''
  const spanMs = lastMs - firstMs
  if (spanMs < 60 * 1000) return t('settings.console.timeline.span.last_minute')
  if (spanMs < 60 * 60 * 1000) {
    return t('settings.console.timeline.span.last_minutes', { count: Math.round(spanMs / 60_000) })
  }
  if (spanMs < 24 * 60 * 60 * 1000) {
    return t('settings.console.timeline.span.last_hours', { count: Math.round(spanMs / 3_600_000) })
  }
  return t('settings.console.timeline.span.last_days', { count: Math.round(spanMs / (24 * 3_600_000)) })
}
