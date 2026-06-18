import { memo, useEffect, useMemo, useState } from 'react'
import {
  getContextDiagnosticStatusLabelKey,
  resolveContextDiagnosticsSummary,
  type MessagingGatewayDiagnosticStatus,
  type NotificationWatcherDiagnosticStatus,
  type WebhookDiagnosticInfo,
} from '../../features/context/contextDiagnostics.ts'
import { saveTextFileWithFallback } from '../../lib/textFiles.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { AppSettings, PlatformProfile, UiLanguage } from '../../types'
import { formatConsoleTimestamp } from '../settingsDrawerSupport'

type ContextDiagnosticsPanelProps = {
  active: boolean
  draft: AppSettings
  platformProfile: PlatformProfile
  uiLanguage: UiLanguage
}

function statusClassName(status: ReturnType<typeof resolveContextDiagnosticsSummary>['items'][number]['status']) {
  return status === 'ready' ? 'is-ok' : 'is-warning'
}

function formatTraceValue(
  trace: NonNullable<ReturnType<typeof resolveContextDiagnosticsSummary>['items'][number]['traces']>[number],
  uiLanguage: UiLanguage,
) {
  if (trace.format === 'timestamp') {
    return formatConsoleTimestamp(trace.value, uiLanguage)
  }
  return trace.value
}

export const ContextDiagnosticsPanel = memo(function ContextDiagnosticsPanel({
  active,
  draft,
  platformProfile,
  uiLanguage,
}: ContextDiagnosticsPanelProps) {
  const [refreshNonce, setRefreshNonce] = useState(0)
  const [loading, setLoading] = useState(false)
  const [copiedCommand, setCopiedCommand] = useState('')
  const [savedCommand, setSavedCommand] = useState('')
  const [saveFailedCommand, setSaveFailedCommand] = useState('')
  const [watcherStatus, setWatcherStatus] = useState<NotificationWatcherDiagnosticStatus | null>(null)
  const [webhookInfo, setWebhookInfo] = useState<WebhookDiagnosticInfo | null>(null)
  const [telegramStatus, setTelegramStatus] = useState<MessagingGatewayDiagnosticStatus | null>(null)
  const [discordStatus, setDiscordStatus] = useState<MessagingGatewayDiagnosticStatus | null>(null)

  const ti = (
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params)

  useEffect(() => {
    if (!active) return undefined

    let cancelled = false
    const bridge = window.desktopPet
    const loadDiagnostics = async () => {
      setLoading(true)
      const watcherPromise = bridge?.notificationWatcherStatus?.() ?? Promise.resolve(null)
      const webhookPromise = bridge?.getNotificationWebhookInfo?.() ?? Promise.resolve(null)
      const telegramPromise = bridge?.telegramStatus?.() ?? Promise.resolve(null)
      const discordPromise = bridge?.discordStatus?.() ?? Promise.resolve(null)

      try {
        const settled = await Promise.allSettled([
          watcherPromise,
          webhookPromise,
          telegramPromise,
          discordPromise,
        ])

        if (cancelled) return
        const [watcher, webhook, telegram, discord] = settled
        setWatcherStatus(watcher.status === 'fulfilled' ? watcher.value : null)
        setWebhookInfo(webhook.status === 'fulfilled' ? webhook.value : null)
        setTelegramStatus(telegram.status === 'fulfilled' ? telegram.value : null)
        setDiscordStatus(discord.status === 'fulfilled' ? discord.value : null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadDiagnostics()

    const unsubscribeWatcher = bridge?.subscribeNotificationWatcherStatus?.((status) => {
      setWatcherStatus(status)
    })

    return () => {
      cancelled = true
      unsubscribeWatcher?.()
    }
  }, [
    active,
    refreshNonce,
    draft.autonomyNotificationsEnabled,
    draft.discordBotToken,
    draft.discordIntegrationEnabled,
    draft.macosMessageWatcherEnabled,
    draft.telegramBotToken,
    draft.telegramIntegrationEnabled,
  ])

  const summary = useMemo(() => resolveContextDiagnosticsSummary({
    settings: draft,
    platformProfile,
    watcherStatus,
    webhookInfo,
    telegramStatus,
    discordStatus,
  }), [draft, platformProfile, watcherStatus, webhookInfo, telegramStatus, discordStatus])

  const copyCommand = async (command: string) => {
    if (!navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(command)
    setCopiedCommand(command)
    window.setTimeout(() => {
      setCopiedCommand((current) => (current === command ? '' : current))
    }, 1800)
  }

  const saveBridgeTrace = async (command: string) => {
    setSaveFailedCommand('')
    const result = await saveTextFileWithFallback({
      title: ti('settings.console.context_diagnostics.action.v04_bridge_trace_json'),
      defaultFileName: 'message-awareness-bridge-trace.json',
      content: command.endsWith('\n') ? command : `${command}\n`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    }).catch(() => null)

    if (!result || result.canceled) {
      setSaveFailedCommand(command)
    } else {
      setSavedCommand(command)
    }

    window.setTimeout(() => {
      setSavedCommand((current) => (current === command ? '' : current))
      setSaveFailedCommand((current) => (current === command ? '' : current))
    }, 1800)
  }

  return (
    <section className="settings-startup-status settings-context-diagnostics">
      <header className="settings-startup-status__header">
        <div>
          <h4>{ti('settings.console.context_diagnostics.title')}</h4>
          <p>{ti('settings.console.context_diagnostics.description')}</p>
        </div>
        <div className="settings-context-diagnostics__actions">
          <span
            className={`settings-startup-status__badge${summary.actionCount ? ' is-warning' : ' is-ok'}`}
            aria-live="polite"
          >
            {ti('settings.console.context_diagnostics.summary', {
              ready: String(summary.readyCount),
              total: String(summary.items.length),
            })}
          </span>
          <button
            type="button"
            className="ghost-button"
            disabled={loading}
            onClick={() => setRefreshNonce((value) => value + 1)}
          >
            {loading
              ? ti('settings.console.context_diagnostics.refreshing')
              : ti('settings.console.context_diagnostics.refresh')}
          </button>
        </div>
      </header>

      <div className="settings-startup-status__items">
        {summary.items.map((item) => (
          <article
            key={item.id}
            className={`settings-startup-status__item ${statusClassName(item.status)}`}
          >
            <div className="settings-startup-status__item-head">
              <span className="settings-startup-status__dot" aria-hidden="true" />
              <strong>{ti(item.labelKey)}</strong>
              <span className="settings-startup-status__item-badge">
                {ti(getContextDiagnosticStatusLabelKey(item.status))}
              </span>
            </div>
            <p>{ti(item.detailKey, item.detailParams)}</p>
            {item.traces?.length ? (
              <dl className="settings-context-diagnostics__traces">
                {item.traces.map((trace) => (
                  <div key={`${trace.labelKey}:${trace.value}`} className="settings-context-diagnostics__trace">
                    <dt>{ti(trace.labelKey)}</dt>
                    <dd>{formatTraceValue(trace, uiLanguage)}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
            {item.actions?.length ? (
              <div className="settings-context-diagnostics__commands">
                {item.actions.map((action) => (
                  <div key={action.command} className="settings-context-diagnostics__command">
                    <div className="settings-context-diagnostics__command-head">
                      <strong>{ti(action.labelKey)}</strong>
                      {action.detailKey ? <span>{ti(action.detailKey)}</span> : null}
                    </div>
                    <code>{action.command}</code>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => void copyCommand(action.command)}
                    >
                      {copiedCommand === action.command
                        ? ti('settings.console.context_diagnostics.action.copied')
                        : ti('settings.console.context_diagnostics.action.copy')}
                    </button>
                    {action.labelKey === 'settings.console.context_diagnostics.action.v04_bridge_trace_json' ? (
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => void saveBridgeTrace(action.command)}
                      >
                        {savedCommand === action.command
                          ? ti('settings.console.context_diagnostics.action.saved_file')
                          : saveFailedCommand === action.command
                            ? ti('settings.console.context_diagnostics.action.save_failed')
                            : ti('settings.console.context_diagnostics.action.save_file')}
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  )
})
