import { memo, useEffect, useMemo, useState } from 'react'
import {
  loadUserAffectWindow,
  type UserAffectSample,
} from '../../features/autonomy/userAffectTimeline'
import {
  computeAffectSnapshot,
  type AffectSnapshot,
} from '../../features/autonomy/affectDynamics'
import {
  binSamplesByDay,
  type DailyAffectBin,
} from '../../features/autonomy/moodMapBinning'
import type { UiLanguage } from '../../types'

/**
 * Monthly mood map.
 *
 * Reads user-side affect samples (collected by `userAffectTimeline.ts`)
 * over the last 30 days, bins them by local day, and renders two stacked
 * lines: valence (-1..+1) and arousal (0..1). Below the chart we surface
 * the Kuppens-style snapshot — baseline valence, variability, inertia —
 * so the user can see the descriptive numbers their letters/yearbook are
 * grounded in.
 *
 * Read-only artifact: the panel doesn't write or mutate samples. Refresh
 * pulls fresh data from the timeline cache.
 */

type MoodMapPanelProps = {
  uiLanguage: UiLanguage
}

const COPY = {
  title: {
    'en-US': 'Mood map',
    'zh-CN': '心情地图',
    'zh-TW': '心情地圖',
    'ja': 'ムードマップ',
    'ko': '무드 맵',
  },
  description: {
    'en-US': 'How your affect has trended over the last 30 days. One point per day, averaged.',
    'zh-CN': '最近 30 天的情绪走势。每天一个点，按当天均值。',
    'zh-TW': '最近 30 天的情緒走勢。每天一個點，按當天均值。',
    'ja': '過去 30 日間の感情の推移。1日 1点、その日の平均です。',
    'ko': '최근 30일간의 감정 추이. 하루 한 점, 그날의 평균값.',
  },
  empty: {
    'en-US': 'No affect samples yet. Talk to her — voice or text — and the map fills in.',
    'zh-CN': '还没有情绪样本。和她说说话——语音或文字——地图就会慢慢长出来。',
    'zh-TW': '還沒有情緒樣本。和她說說話——語音或文字——地圖就會慢慢長出來。',
    'ja': 'まだ感情サンプルがありません。話しかけてみてください — 音声でも文字でも — マップが描かれていきます。',
    'ko': '아직 감정 샘플이 없습니다. 음성이든 문자든 그녀에게 말을 걸어보세요. 지도가 채워집니다.',
  },
  needMore: {
    'en-US': 'Need at least two days of samples to draw a trend. Keep going.',
    'zh-CN': '至少需要两天的样本才能画出趋势线。再多一些日子。',
    'zh-TW': '至少需要兩天的樣本才能畫出趨勢線。再多一些日子。',
    'ja': '推移を描くには最低2日分のサンプルが必要です。あと少し。',
    'ko': '추이를 그리려면 최소 2일분의 샘플이 필요합니다. 조금만 더.',
  },
  baselineValence: {
    'en-US': 'Baseline valence',
    'zh-CN': '基线效价',
    'zh-TW': '基線效價',
    'ja': 'ベースライン感情価',
    'ko': '기준 정서가',
  },
  variability: {
    'en-US': 'Variability',
    'zh-CN': '波动度',
    'zh-TW': '波動度',
    'ja': '変動性',
    'ko': '변동성',
  },
  inertia: {
    'en-US': 'Inertia',
    'zh-CN': '惯性',
    'zh-TW': '慣性',
    'ja': '慣性',
    'ko': '관성',
  },
  samples: {
    'en-US': 'samples',
    'zh-CN': '个样本',
    'zh-TW': '個樣本',
    'ja': 'サンプル',
    'ko': '샘플',
  },
  refresh: {
    'en-US': 'Refresh',
    'zh-CN': '刷新',
    'zh-TW': '重新整理',
    'ja': '更新',
    'ko': '새로고침',
  },
  valence: {
    'en-US': 'Valence',
    'zh-CN': '效价',
    'zh-TW': '效價',
    'ja': '感情価',
    'ko': '정서가',
  },
  arousal: {
    'en-US': 'Arousal',
    'zh-CN': '唤醒度',
    'zh-TW': '喚醒度',
    'ja': '覚醒度',
    'ko': '각성도',
  },
}

function pick(field: { [key: string]: string }, uiLanguage: UiLanguage): string {
  return field[uiLanguage] ?? field['en-US'] ?? ''
}

const WINDOW_DAYS = 30

export const MoodMapPanel = memo(function MoodMapPanel({ uiLanguage }: MoodMapPanelProps) {
  const [samples, setSamples] = useState<UserAffectSample[]>(() =>
    loadUserAffectWindow(WINDOW_DAYS),
  )

  useEffect(() => {
    const timer = window.setInterval(() => {
      setSamples(loadUserAffectWindow(WINDOW_DAYS))
    }, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const handleRefresh = () => setSamples(loadUserAffectWindow(WINDOW_DAYS))

  const bins = useMemo(() => binSamplesByDay(samples), [samples])
  const snapshot = useMemo(() => computeAffectSnapshot(samples), [samples])

  return (
    <section className="settings-diagnostics-panel">
      <header className="settings-diagnostics-panel__header">
        <h4>{pick(COPY.title, uiLanguage)}</h4>
        <p>{pick(COPY.description, uiLanguage)}</p>
      </header>

      {samples.length === 0 ? (
        <div className="settings-timeline-placeholder">
          <p>{pick(COPY.empty, uiLanguage)}</p>
        </div>
      ) : bins.length < 2 ? (
        <div className="settings-timeline-placeholder">
          <p>{pick(COPY.needMore, uiLanguage)}</p>
        </div>
      ) : (
        <MoodChart bins={bins} uiLanguage={uiLanguage} />
      )}

      <SnapshotLine snapshot={snapshot} uiLanguage={uiLanguage} />

      <div className="settings-diagnostics-panel__actions">
        <button type="button" className="ghost-button" onClick={handleRefresh}>
          {pick(COPY.refresh, uiLanguage)}
        </button>
      </div>
    </section>
  )
})

// ── Chart ──────────────────────────────────────────────────────────────────

const CHART_WIDTH = 600
const CHART_HEIGHT = 160
const PAD_X = 32
const PAD_Y = 14

const VALENCE_COLOR = '#10b981'  // green: pleasant axis
const AROUSAL_COLOR = '#f59e0b'  // amber: activation axis

function MoodChart({ bins, uiLanguage }: { bins: DailyAffectBin[]; uiLanguage: UiLanguage }) {
  const firstDay = bins[0].day
  const lastDay = bins[bins.length - 1].day
  const firstMs = Date.parse(firstDay)
  const lastMs = Date.parse(lastDay)
  const span = Math.max(lastMs - firstMs, 1)
  const innerWidth = CHART_WIDTH - 2 * PAD_X
  const innerHeight = CHART_HEIGHT - 2 * PAD_Y

  function projectX(day: string): number {
    const t = Date.parse(day)
    const ratio = Number.isFinite(t) ? (t - firstMs) / span : 0
    return PAD_X + ratio * innerWidth
  }

  // Both series rendered on a normalized [0,1] vertical axis. Valence is
  // [-1,+1], so we shift it to [0,1] (0.5 = neutral). Arousal is already
  // [0,1].
  function projectYValence(v: number): number {
    const norm = (v + 1) / 2
    return PAD_Y + (1 - norm) * innerHeight
  }
  function projectYArousal(a: number): number {
    return PAD_Y + (1 - a) * innerHeight
  }

  const valencePath = bins
    .map((b, i) => `${i === 0 ? 'M' : 'L'}${projectX(b.day).toFixed(1)},${projectYValence(b.valence).toFixed(1)}`)
    .join(' ')
  const arousalPath = bins
    .map((b, i) => `${i === 0 ? 'M' : 'L'}${projectX(b.day).toFixed(1)},${projectYArousal(b.arousal).toFixed(1)}`)
    .join(' ')

  // Reference line at neutral valence (0.5 normalized).
  const neutralY = PAD_Y + 0.5 * innerHeight

  return (
    <div className="settings-timeline-chart">
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="settings-timeline-chart__svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Mood map"
      >
        {/* gridlines at 0.25, 0.75 normalized */}
        {[0.25, 0.75].map((v) => (
          <line
            key={v}
            x1={PAD_X}
            x2={CHART_WIDTH - PAD_X}
            y1={PAD_Y + (1 - v) * innerHeight}
            y2={PAD_Y + (1 - v) * innerHeight}
            stroke="rgba(255,255,255,0.05)"
            strokeDasharray="2 3"
          />
        ))}
        {/* neutral valence reference */}
        <line
          x1={PAD_X}
          x2={CHART_WIDTH - PAD_X}
          y1={neutralY}
          y2={neutralY}
          stroke="rgba(255,255,255,0.12)"
          strokeDasharray="3 3"
        />
        <path d={valencePath} stroke={VALENCE_COLOR} strokeWidth={1.6} fill="none" />
        <path d={arousalPath} stroke={AROUSAL_COLOR} strokeWidth={1.4} fill="none" opacity={0.85} />
        {/* dot markers so single-day spikes aren't invisible */}
        {bins.map((b) => (
          <g key={b.day}>
            <circle cx={projectX(b.day)} cy={projectYValence(b.valence)} r={2} fill={VALENCE_COLOR} />
            <circle cx={projectX(b.day)} cy={projectYArousal(b.arousal)} r={2} fill={AROUSAL_COLOR} />
          </g>
        ))}
      </svg>
      <div className="settings-timeline-legend">
        <span className="settings-timeline-legend__item">
          <span className="settings-timeline-legend__swatch" style={{ background: VALENCE_COLOR }} />
          {pick(COPY.valence, uiLanguage)}
        </span>
        <span className="settings-timeline-legend__item">
          <span className="settings-timeline-legend__swatch" style={{ background: AROUSAL_COLOR }} />
          {pick(COPY.arousal, uiLanguage)}
        </span>
        <span className="settings-timeline-legend__range">
          {bins.length} {uiLanguage === 'en-US' ? 'days' : ''} · {firstDay} → {lastDay}
        </span>
      </div>
    </div>
  )
}

// ── Snapshot summary line ──────────────────────────────────────────────────

function formatSigned(x: number): string {
  if (x === 0) return '0.00'
  const sign = x > 0 ? '+' : ''
  return `${sign}${x.toFixed(2)}`
}

function SnapshotLine({
  snapshot,
  uiLanguage,
}: {
  snapshot: AffectSnapshot
  uiLanguage: UiLanguage
}) {
  if (snapshot.n === 0) return null
  const parts: string[] = []
  if (snapshot.baselineValence != null) {
    parts.push(`${pick(COPY.baselineValence, uiLanguage)}: ${formatSigned(snapshot.baselineValence)}`)
  }
  if (snapshot.variability != null) {
    parts.push(`${pick(COPY.variability, uiLanguage)}: ${snapshot.variability.toFixed(2)}`)
  }
  if (snapshot.inertia != null) {
    parts.push(`${pick(COPY.inertia, uiLanguage)}: ${snapshot.inertia.toFixed(2)}`)
  }
  parts.push(`${snapshot.n} ${pick(COPY.samples, uiLanguage)}`)
  return (
    <p className="settings-drawer__hint" style={{ marginTop: 8 }}>
      {parts.join(' · ')}
    </p>
  )
}
