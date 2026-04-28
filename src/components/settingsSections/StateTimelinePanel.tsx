import { memo, useEffect, useState } from 'react'
import {
  type EmotionSample,
  type RelationshipSample,
  loadEmotionHistory,
  loadRelationshipHistory,
} from '../../features/autonomy/stateTimeline'

/**
 * Emotion + relationship time-series panel.
 *
 * Two tiny hand-rolled SVG charts (no chart-library dep):
 *   - Emotion: 4-line chart (energy/warmth/curiosity/concern, 0-1 range)
 *   - Relationship: single-line score chart (0-100)
 *
 * Reads directly from the persisted history stores. No live subscription
 * — the panel only refreshes when you open settings, which matches the
 * "I want to check how my companion's been lately" mental model.
 */
export const StateTimelinePanel = memo(function StateTimelinePanel() {
  const [emotion, setEmotion] = useState<EmotionSample[]>(() => loadEmotionHistory())
  const [relationship, setRelationship] = useState<RelationshipSample[]>(() =>
    loadRelationshipHistory(),
  )

  // Periodic refresh while the panel is mounted — cheap (reads from an
  // in-memory cache most of the time). 5s feels responsive enough for a
  // diagnostic view without burning CPU.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setEmotion(loadEmotionHistory())
      setRelationship(loadRelationshipHistory())
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [])

  const handleRefresh = () => {
    setEmotion(loadEmotionHistory())
    setRelationship(loadRelationshipHistory())
  }

  return (
    <section className="settings-diagnostics-panel">
      <header className="settings-diagnostics-panel__header">
        <h4>State timeline</h4>
        <p>
          How your companion's emotion and relationship have trended over
          the last {Math.max(emotion.length, relationship.length)} captured
          samples.
        </p>
      </header>
      <EmotionChart samples={emotion} />
      <RelationshipChart samples={relationship} />
      <div className="settings-diagnostics-panel__actions">
        <button type="button" className="ghost-button" onClick={handleRefresh}>
          Refresh
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
  label: string
  color: string
}> = [
  { key: 'energy', label: 'Energy', color: '#f59e0b' },
  { key: 'warmth', label: 'Warmth', color: '#ef4444' },
  { key: 'curiosity', label: 'Curiosity', color: '#8b5cf6' },
  { key: 'concern', label: 'Concern', color: '#3b82f6' },
]

function EmotionChart({ samples }: { samples: EmotionSample[] }) {
  if (samples.length < 2) {
    return (
      <div className="settings-timeline-placeholder">
        <strong>Emotion</strong>
        <p>Need at least two samples to draw a trend. Keep chatting.</p>
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

  return (
    <div className="settings-timeline-chart">
      <strong>Emotion</strong>
      <svg
        viewBox={`0 0 ${EMOTION_CHART_WIDTH} ${EMOTION_CHART_HEIGHT}`}
        className="settings-timeline-chart__svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Emotion timeline"
      >
        {/* gridlines at 0.25, 0.5, 0.75 */}
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
        {EMOTION_SERIES.map(({ key, label, color }) => (
          <span key={key} className="settings-timeline-legend__item">
            <span
              className="settings-timeline-legend__swatch"
              style={{ background: color }}
            />
            {label}
          </span>
        ))}
        <span className="settings-timeline-legend__range">
          {samples.length} samples · {formatSpan(firstTs, lastTs)}
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

function RelationshipChart({ samples }: { samples: RelationshipSample[] }) {
  if (samples.length < 2) {
    return (
      <div className="settings-timeline-placeholder">
        <strong>Relationship</strong>
        <p>Need at least two samples. Score changes at most once per day.</p>
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

  return (
    <div className="settings-timeline-chart">
      <strong>Relationship</strong>
      <svg
        viewBox={`0 0 ${REL_CHART_WIDTH} ${REL_CHART_HEIGHT}`}
        className="settings-timeline-chart__svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Relationship score timeline"
      >
        {/* level thresholds at 10/30/55/80 */}
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
          Current: {latest.score}/100 · {latest.level.replace('_', ' ')}
        </span>
        <span className="settings-timeline-legend__item">
          Streak: {latest.streak}d · Total: {latest.daysInteracted}d
        </span>
        <span className="settings-timeline-legend__range">
          {samples.length} samples · {formatSpan(firstTs, lastTs)}
        </span>
      </div>
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────

function formatSpan(firstMs: number, lastMs: number): string {
  if (!Number.isFinite(firstMs) || !Number.isFinite(lastMs)) return ''
  const spanMs = lastMs - firstMs
  if (spanMs < 60 * 1000) return 'last minute'
  if (spanMs < 60 * 60 * 1000) return `last ${Math.round(spanMs / 60_000)} min`
  if (spanMs < 24 * 60 * 60 * 1000) return `last ${Math.round(spanMs / 3_600_000)}h`
  return `last ${Math.round(spanMs / (24 * 3_600_000))}d`
}
