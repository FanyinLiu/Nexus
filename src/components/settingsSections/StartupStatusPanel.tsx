import { memo, useCallback, useState } from 'react'
import type { PetModelDefinition } from '../../features/pet'
import {
  resolveStartupStatusSummary,
} from '../../features/onboarding/startupStatusView.ts'
import { loadFirstConversationTelemetryStatus } from '../../features/onboarding/firstConversationTelemetry.ts'
import { buildFirstRunQaReport } from '../../features/onboarding/firstRunQaReport.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { AppSettings, UiLanguage } from '../../types'

type StartupStatusPanelProps = {
  draft: AppSettings
  petModel: PetModelDefinition | undefined
  uiLanguage: UiLanguage
}

function getCurrentOrigin() {
  if (typeof window === 'undefined') return ''

  return window.location.origin || ''
}

function hasElectronBridge() {
  return typeof window !== 'undefined' && Boolean(window.desktopPet?.completeChat)
}

export const StartupStatusPanel = memo(function StartupStatusPanel({
  draft,
  petModel,
  uiLanguage,
}: StartupStatusPanelProps) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const ti = useCallback((
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params), [uiLanguage])

  const origin = getCurrentOrigin()
  const firstConversationStatus = loadFirstConversationTelemetryStatus()
  const summary = resolveStartupStatusSummary({
    bridgeReady: hasElectronBridge(),
    firstConversationStatus,
    origin,
    petModel,
    settings: draft,
  })

  const showFeedback = useCallback((text: string) => {
    setFeedback(text)
    window.setTimeout(() => setFeedback(null), 3_000)
  }, [])

  const handleDownloadReport = useCallback(() => {
    const report = buildFirstRunQaReport({
      firstConversationStatus,
      generatedAt: new Date(),
      summary,
      translate: ti,
    })
    const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const stamp = report.generatedAt.replace(/[:.]/g, '-')
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `nexus-first-run-qa-${stamp}.json`
    document.body.appendChild(anchor)
    anchor.click()
    document.body.removeChild(anchor)
    URL.revokeObjectURL(url)
    showFeedback(ti('settings.startup_status.report_exported'))
  }, [firstConversationStatus, showFeedback, summary, ti])

  return (
    <section className="settings-startup-status">
      <header className="settings-startup-status__header">
        <div>
          <h4>{ti('settings.startup_status.title')}</h4>
          <p>{ti('settings.startup_status.note')}</p>
        </div>
        <div className="settings-startup-status__header-actions">
          <span className={`settings-startup-status__badge${summary.warningCount ? ' is-warning' : ' is-ok'}`}>
            {summary.warningCount
              ? ti('settings.startup_status.warning_badge', { count: summary.warningCount })
              : ti('settings.startup_status.ready_badge')}
          </span>
          <button type="button" className="ghost-button" onClick={handleDownloadReport}>
            {ti('settings.startup_status.download_report')}
          </button>
        </div>
      </header>
      {feedback ? (
        <p className="settings-startup-status__feedback">{feedback}</p>
      ) : null}
      <div className="settings-startup-status__items">
        {summary.items.map((item) => (
          <article
            key={item.id}
            className={`settings-startup-status__item is-${item.status}`}
          >
            <div className="settings-startup-status__item-head">
              <span className="settings-startup-status__dot" aria-hidden="true" />
              <strong>{ti(item.labelKey)}</strong>
              <span className="settings-startup-status__item-badge">
                {item.status === 'ok'
                  ? ti('settings.startup_status.item_ok')
                  : ti('settings.startup_status.item_warning')}
              </span>
            </div>
            <p>{ti(item.detailKey, item.detailParams)}</p>
          </article>
        ))}
      </div>
    </section>
  )
})
