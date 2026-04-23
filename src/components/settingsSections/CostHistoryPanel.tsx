import { memo, useEffect, useMemo, useState } from 'react'
import { type DailyMeterRecord, loadDailyRange } from '../../features/metering/contextMeter'

/**
 * Cost history visualisation:
 *   - Bar chart of last 30 days USD spend
 *   - Today's breakdown by source (chat/dream/tool/...)
 *   - Today's breakdown by model (OpenAI gpt-4o vs Claude Sonnet etc.)
 *
 * Pure render — reads straight from the per-day localStorage keys via
 * loadDailyRange. Polls every 10s so a long chat session ticks the chart
 * forward without manual refresh.
 */
export const CostHistoryPanel = memo(function CostHistoryPanel() {
  const [range, setRange] = useState<DailyMeterRecord[]>(() => loadDailyRange(30))

  useEffect(() => {
    const timer = window.setInterval(() => setRange(loadDailyRange(30)), 10_000)
    return () => window.clearInterval(timer)
  }, [])

  const stats = useMemo(() => {
    const total = range.reduce((acc, r) => acc + r.totalCostUsd, 0)
    const calls = range.reduce((acc, r) => acc + r.callCount, 0)
    const days = range.length
    return { total, calls, days }
  }, [range])

  const today = range[0]

  return (
    <section className="settings-diagnostics-panel">
      <header className="settings-diagnostics-panel__header">
        <h4>Cost history</h4>
        <p>
          Spend across the last 30 days · {stats.days} days with activity · $
          {stats.total.toFixed(4)} total · {stats.calls} calls
        </p>
      </header>
      <CostBarChart records={range} />
      {today ? <TodayBreakdown record={today} /> : (
        <p className="settings-diagnostics-panel__feedback">
          No usage recorded today yet.
        </p>
      )}
    </section>
  )
})

// ── 30-day bar chart ──────────────────────────────────────────────────────

const CHART_WIDTH = 600
const CHART_HEIGHT = 120
const CHART_PAD_X = 32
const CHART_PAD_Y = 12

function CostBarChart({ records }: { records: DailyMeterRecord[] }) {
  // records are most-recent-first; reverse for left-to-right time axis.
  const ordered = records.slice().reverse()
  if (ordered.length === 0) {
    return (
      <div className="settings-timeline-placeholder">
        <strong>30-day spend</strong>
        <p>No usage recorded in the last 30 days.</p>
      </div>
    )
  }

  const maxCost = Math.max(...ordered.map((r) => r.totalCostUsd), 0.01)
  const innerWidth = CHART_WIDTH - 2 * CHART_PAD_X
  const innerHeight = CHART_HEIGHT - 2 * CHART_PAD_Y
  const barWidth = innerWidth / Math.max(ordered.length, 1)

  return (
    <div className="settings-timeline-chart">
      <strong>30-day spend</strong>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="settings-timeline-chart__svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="30-day cost bar chart"
      >
        {ordered.map((rec, i) => {
          const heightRatio = rec.totalCostUsd / maxCost
          const barHeight = Math.max(1, heightRatio * innerHeight)
          const x = CHART_PAD_X + i * barWidth
          const y = CHART_HEIGHT - CHART_PAD_Y - barHeight
          return (
            <rect
              key={rec.date}
              x={x + 1}
              y={y}
              width={Math.max(1, barWidth - 2)}
              height={barHeight}
              fill="#6366f1"
              opacity={0.85}
            >
              <title>{`${rec.date} · $${rec.totalCostUsd.toFixed(4)} · ${rec.callCount} calls`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="settings-timeline-legend">
        <span className="settings-timeline-legend__item">
          Peak: ${maxCost.toFixed(4)}
        </span>
        <span className="settings-timeline-legend__range">
          {ordered[0]?.date} → {ordered[ordered.length - 1]?.date}
        </span>
      </div>
    </div>
  )
}

// ── Today breakdown tables ────────────────────────────────────────────────

function TodayBreakdown({ record }: { record: DailyMeterRecord }) {
  const sourceEntries = Object.entries(record.bySource)
    .filter(([, v]) => v.calls > 0)
    .sort(([, a], [, b]) => b.costUsd - a.costUsd)

  const modelEntries = Object.entries(record.byModel ?? {})
    .filter(([, v]) => v.calls > 0)
    .sort(([, a], [, b]) => b.costUsd - a.costUsd)

  return (
    <div className="settings-cost-breakdowns">
      <div className="settings-cost-breakdown">
        <strong>Today by source</strong>
        {sourceEntries.length === 0 ? (
          <p className="settings-cost-breakdown__empty">No activity yet today.</p>
        ) : (
          <table className="settings-cost-breakdown__table">
            <tbody>
              {sourceEntries.map(([name, agg]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{agg.calls} call{agg.calls === 1 ? '' : 's'}</td>
                  <td>{(agg.input + agg.output).toLocaleString()} tok</td>
                  <td>${agg.costUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="settings-cost-breakdown">
        <strong>Today by model</strong>
        {modelEntries.length === 0 ? (
          <p className="settings-cost-breakdown__empty">
            No model-tagged calls today. Older persisted records do not include
            per-model breakdown.
          </p>
        ) : (
          <table className="settings-cost-breakdown__table">
            <tbody>
              {modelEntries.map(([name, agg]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td>{agg.calls} call{agg.calls === 1 ? '' : 's'}</td>
                  <td>{(agg.input + agg.output).toLocaleString()} tok</td>
                  <td>${agg.costUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
