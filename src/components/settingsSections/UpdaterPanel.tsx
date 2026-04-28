import { memo } from 'react'
import { useUpdater } from '../../features/updater/useUpdater'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { TranslationParams } from '../../i18n'
import type { UiLanguage } from '../../types'

type UpdaterPanelProps = {
  uiLanguage: UiLanguage
}

function formatBytes(bytes: number): string {
  if (!bytes || !Number.isFinite(bytes)) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(value >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatSpeed(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`
}

export const UpdaterPanel = memo(function UpdaterPanel({ uiLanguage }: UpdaterPanelProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1], params?: TranslationParams) =>
    pickTranslatedUiText(uiLanguage, key, params)
  const updater = useUpdater()
  const { event, busy, currentVersion, isPackaged } = updater

  let statusText: string
  let statusTone: 'idle' | 'info' | 'success' | 'warning' | 'error' = 'idle'

  switch (event.type) {
    case 'idle':
      statusText = isPackaged
        ? ti('settings.updater.idle')
        : ti('settings.updater.dev_mode')
      statusTone = 'idle'
      break
    case 'checking':
      statusText = ti('settings.updater.checking_status')
      statusTone = 'info'
      break
    case 'available':
      statusText = ti('settings.updater.available', { version: event.version ?? '?' })
      statusTone = 'info'
      break
    case 'not-available':
      statusText = ti('settings.updater.up_to_date', { version: event.version ?? '?' })
      statusTone = 'success'
      break
    case 'progress': {
      const pct = Math.max(0, Math.min(100, Math.round(event.percent)))
      statusText = `${ti('settings.updater.downloading')} ${pct}% · ${formatBytes(event.transferred)} / ${formatBytes(event.total)} · ${formatSpeed(event.bytesPerSecond)}`
      statusTone = 'info'
      break
    }
    case 'downloaded':
      statusText = ti('settings.updater.downloaded', { version: event.version ?? '?' })
      statusTone = 'success'
      break
    case 'error':
      statusText = `${ti('settings.updater.error_prefix')}${event.message}`
      statusTone = 'error'
      break
    default:
      // Defensive fallback if a new event.type is added without a switch
      // arm — better than ReferenceError on the unset `statusText` below.
      statusText = ti('settings.updater.idle')
      statusTone = 'idle'
      break
  }

  const showInstallButton = event.type === 'downloaded'
  const progressPercent = event.type === 'progress'
    ? Math.max(0, Math.min(100, event.percent))
    : null

  return (
    <section className="settings-updater-panel">
      <div className="settings-updater-panel__header">
        <div>
          <h5 className="settings-updater-panel__title">{ti('settings.updater.title')}</h5>
          <p className="settings-updater-panel__version">
            {ti('settings.updater.version')} v{currentVersion ?? '—'}
          </p>
        </div>
        <div className="settings-updater-panel__actions">
          {showInstallButton ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => void updater.installAndRestart()}
            >
              {ti('settings.updater.install')}
            </button>
          ) : (
            <button
              type="button"
              className="ghost-button"
              onClick={() => void updater.checkForUpdates()}
              disabled={busy || !isPackaged}
              title={!isPackaged ? ti('settings.updater.only_packaged') : undefined}
            >
              {busy ? ti('settings.updater.checking') : ti('settings.updater.check')}
            </button>
          )}
        </div>
      </div>

      <p className={`settings-updater-panel__status settings-updater-panel__status--${statusTone}`}>
        {statusText}
      </p>

      {progressPercent !== null ? (
        <div className="settings-updater-panel__progress" aria-hidden="true">
          <div
            className="settings-updater-panel__progress-bar"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      ) : null}
    </section>
  )
})
