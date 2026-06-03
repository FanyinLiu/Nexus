import { memo, useEffect, useMemo, useState } from 'react'
import { type DailyMeterRecord, loadDailyRange } from '../../features/metering/contextMeter'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { TranslationParams, UiLanguage } from '../../types'

type CostHistoryPanelProps = {
  uiLanguage: UiLanguage
}

type ConsoleTextKey = Parameters<typeof pickTranslatedUiText>[1]
type ConsoleTranslator = (key: ConsoleTextKey, params?: TranslationParams) => string

/**
 * Cost history visualisation:
 *   - Bar chart of last 30 days USD spend
 *   - Today's breakdown by source (chat/dream/tool/...)
 *   - Today's breakdown by model (for example OpenAI gpt-5.4 vs local models)
 *
 * Pure render — reads straight from the per-day localStorage keys via
 * loadDailyRange. Polls every 10s so a long chat session ticks the chart
 * forward without manual refresh.
 */
export const CostHistoryPanel = memo(function CostHistoryPanel({ uiLanguage }: CostHistoryPanelProps) {
  const [range, setRange] = useState<DailyMeterRecord[]>(() => loadDailyRange(30))
  const ti = (key: ConsoleTextKey, params?: TranslationParams) => pickTranslatedUiText(uiLanguage, key, params)

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
        <h4>{ti('settings.console.cost.title')}</h4>
        <p>
          {ti('settings.console.cost.summary', {
            days: stats.days,
            total: `$${stats.total.toFixed(4)}`,
            calls: stats.calls,
          })}
        </p>
      </header>
      <CostBarChart records={range} ti={ti} />
      {today ? <TodayBreakdown record={today} ti={ti} uiLanguage={uiLanguage} /> : (
        <p className="settings-diagnostics-panel__feedback">
          {ti('settings.console.cost.empty_today')}
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

function CostBarChart({
  records,
  ti,
}: {
  records: DailyMeterRecord[]
  ti: ConsoleTranslator
}) {
  // records are most-recent-first; reverse for left-to-right time axis.
  const ordered = records.slice().reverse()
  if (ordered.length === 0) {
    return (
      <div className="settings-timeline-placeholder">
        <strong>{ti('settings.console.cost.chart.title')}</strong>
        <p>{ti('settings.console.cost.chart.empty')}</p>
      </div>
    )
  }

  const maxCost = Math.max(...ordered.map((r) => r.totalCostUsd), 0.01)
  const innerWidth = CHART_WIDTH - 2 * CHART_PAD_X
  const innerHeight = CHART_HEIGHT - 2 * CHART_PAD_Y
  const barWidth = innerWidth / Math.max(ordered.length, 1)
  const chartTitleId = 'cost-history-chart-title'
  const chartDescriptionId = 'cost-history-chart-description'
  const totalCost = ordered.reduce((sum, rec) => sum + rec.totalCostUsd, 0)
  const totalCalls = ordered.reduce((sum, rec) => sum + rec.callCount, 0)
  const chartDescription = ti('settings.console.cost.chart.description', {
    days: ordered.length,
    startDate: ordered[0]?.date,
    endDate: ordered[ordered.length - 1]?.date,
    total: `$${totalCost.toFixed(4)}`,
    calls: totalCalls,
    peak: `$${maxCost.toFixed(4)}`,
  })

  return (
    <div className="settings-timeline-chart">
      <strong>{ti('settings.console.cost.chart.title')}</strong>
      <svg
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        className="settings-timeline-chart__svg"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-labelledby={`${chartTitleId} ${chartDescriptionId}`}
      >
        <title id={chartTitleId}>{ti('settings.console.cost.chart.aria_title')}</title>
        <desc id={chartDescriptionId}>{chartDescription}</desc>
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
              <title>
                {ti('settings.console.cost.chart.tooltip', {
                  date: rec.date,
                  cost: `$${rec.totalCostUsd.toFixed(4)}`,
                  calls: formatCalls(rec.callCount, ti),
                })}
              </title>
            </rect>
          )
        })}
      </svg>
      <div className="settings-timeline-legend">
        <span className="settings-timeline-legend__item">
          {ti('settings.console.cost.chart.peak', { peak: `$${maxCost.toFixed(4)}` })}
        </span>
        <span className="settings-timeline-legend__range">
          {ordered[0]?.date} - {ordered[ordered.length - 1]?.date}
        </span>
      </div>
    </div>
  )
}

// ── Today breakdown tables ────────────────────────────────────────────────

function TodayBreakdown({ record, ti, uiLanguage }: { record: DailyMeterRecord; ti: ConsoleTranslator; uiLanguage: UiLanguage }) {
  const sourceEntries = Object.entries(record.bySource)
    .filter(([, v]) => v.calls > 0)
    .sort(([, a], [, b]) => b.costUsd - a.costUsd)

  const modelEntries = Object.entries(record.byModel ?? {})
    .filter(([, v]) => v.calls > 0)
    .sort(([, a], [, b]) => b.costUsd - a.costUsd)

  return (
    <div className="settings-cost-breakdowns">
      <div className="settings-cost-breakdown">
        <strong>{ti('settings.console.cost.today_by_source')}</strong>
        {sourceEntries.length === 0 ? (
          <p className="settings-cost-breakdown__empty">{ti('settings.console.cost.no_activity_today')}</p>
        ) : (
          <table className="settings-cost-breakdown__table">
            <caption className="settings-cost-breakdown__caption">{ti('settings.console.cost.today_by_source')}</caption>
            <thead>
              <tr>
                <th scope="col">{ti('settings.console.cost.table.source')}</th>
                <th scope="col">{ti('settings.console.cost.table.calls')}</th>
                <th scope="col">{ti('settings.console.cost.table.tokens')}</th>
                <th scope="col">{ti('settings.console.cost.table.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {sourceEntries.map(([name, agg]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{formatCalls(agg.calls, ti)}</td>
                  <td>{ti('settings.console.cost.tokens_count', { count: (agg.input + agg.output).toLocaleString(uiLanguage) })}</td>
                  <td>${agg.costUsd.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      <div className="settings-cost-breakdown">
        <strong>{ti('settings.console.cost.today_by_model')}</strong>
        {modelEntries.length === 0 ? (
          <p className="settings-cost-breakdown__empty">
            {ti('settings.console.cost.no_model_activity_today')}
          </p>
        ) : (
          <table className="settings-cost-breakdown__table">
            <caption className="settings-cost-breakdown__caption">{ti('settings.console.cost.today_by_model')}</caption>
            <thead>
              <tr>
                <th scope="col">{ti('settings.console.cost.table.model')}</th>
                <th scope="col">{ti('settings.console.cost.table.calls')}</th>
                <th scope="col">{ti('settings.console.cost.table.tokens')}</th>
                <th scope="col">{ti('settings.console.cost.table.cost')}</th>
              </tr>
            </thead>
            <tbody>
              {modelEntries.map(([name, agg]) => (
                <tr key={name}>
                  <th scope="row">{name}</th>
                  <td>{formatCalls(agg.calls, ti)}</td>
                  <td>{ti('settings.console.cost.tokens_count', { count: (agg.input + agg.output).toLocaleString(uiLanguage) })}</td>
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

function formatCalls(count: number, ti: ConsoleTranslator) {
  return ti(count === 1 ? 'settings.console.cost.calls_one' : 'settings.console.cost.calls_many', { count })
}
