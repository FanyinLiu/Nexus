/**
 * About page: language, update check, and the first-time guide.
 */

import { useUpdater } from '../../features/updater/useUpdater.ts'
import { UI_LANGUAGE_OPTIONS } from '../../lib/uiLanguage.ts'
import { SettingsV3Field } from '../../features/settingsV3/SettingsV3Primitives.tsx'
import type { AppSettings } from '../../types/index.ts'
import { simpleTranslate } from './settingsSimpleCopy.ts'
import { SimpleRow } from './settingsSimpleShared.tsx'

type AboutSimplePageProps = {
  draft: AppSettings
  onSelectLanguage: (language: AppSettings['uiLanguage']) => void
  onOpenOnboarding: () => void
}

export function AboutSimplePage({ draft, onSelectLanguage, onOpenOnboarding }: AboutSimplePageProps) {
  const ti = simpleTranslate(draft.uiLanguage)
  const updater = useUpdater()
  const newer = updater.event.type === 'available'
    || updater.event.type === 'downloaded'
    || updater.event.type === 'manual-update'
  const checking = updater.busy || updater.event.type === 'checking'
  const status = checking
    ? ti('settings.simple.about_checking')
    : newer
      ? ti('settings.simple.about_available')
      : ti('settings.simple.about_current')

  return (
    <>
      <section className="settings-v3-section__body">
        <SettingsV3Field label={ti('settings.simple.about_language')}>
          <select
            aria-label={ti('settings.simple.about_language')}
            value={draft.uiLanguage}
            onChange={(event) => onSelectLanguage(event.target.value as AppSettings['uiLanguage'])}
          >
            {UI_LANGUAGE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.nativeLabel}</option>
            ))}
          </select>
        </SettingsV3Field>
        <SimpleRow icon="refresh" tone="success" title={status}>
          <button
            type="button"
            className="settings-v3-action"
            disabled={checking}
            onClick={() => void updater.checkForUpdates()}
          >
            {ti('settings.simple.about_check')}
          </button>
        </SimpleRow>
        {updater.event.type === 'downloaded' ? (
          <div className="settings-v3-row">
            <button type="button" className="settings-v3-action" onClick={() => void updater.installAndRestart()}>
              {ti('settings.updater.install')}
            </button>
          </div>
        ) : null}
      </section>
      <section className="settings-v3-section__body">
        <SimpleRow icon="onboarding" title={ti('settings.simple.about_guide')} hint={ti('settings.simple.about_guide_hint')}>
          <button
            type="button"
            className="settings-v3-action"
            aria-label={ti('settings.simple.about_guide')}
            data-settings-guide=""
            onClick={onOpenOnboarding}
          >
            {ti('settings.simple.about_guide_open')}
          </button>
        </SimpleRow>
      </section>
    </>
  )
}
