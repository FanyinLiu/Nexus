import { memo } from 'react'
import type { PetModelDefinition } from '../../features/pet'
import {
  resolveStartupStatusSummary,
} from '../../features/onboarding/startupStatusView.ts'
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
  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params)

  const origin = getCurrentOrigin()
  const summary = resolveStartupStatusSummary({
    bridgeReady: hasElectronBridge(),
    origin,
    petModel,
    settings: draft,
  })

  return (
    <section className="settings-startup-status">
      <header className="settings-startup-status__header">
        <div>
          <h4>{ti('settings.startup_status.title')}</h4>
          <p>{ti('settings.startup_status.note')}</p>
        </div>
        <span className={`settings-startup-status__badge${summary.warningCount ? ' is-warning' : ' is-ok'}`}>
          {summary.warningCount
            ? ti('settings.startup_status.warning_badge', { count: summary.warningCount })
            : ti('settings.startup_status.ready_badge')}
        </span>
      </header>
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
