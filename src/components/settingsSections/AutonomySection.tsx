import { memo, type Dispatch, type ReactNode, type SetStateAction, useCallback, useEffect, useState } from 'react'
import { parseNumberInput } from '../settingsDrawerSupport'
import { NumberField, SettingsToggle, ToggleField } from '../settingsFields'
import { PetControlIcon } from '../PetControlIcon'
import { clampPresenceIntervalMinutes } from '../../lib/settings'
import { humanizeError } from '../../lib/humanizeError'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { AppSettings, NotificationChannel, UiLanguage } from '../../types'

// ── Channel management types ─────────────────────────────────────────────────

type ChannelManagerProps = {
  channels: NotificationChannel[]
  channelsLoading: boolean
  onAddChannel: (draft: Omit<NotificationChannel, 'id'>) => Promise<void>
  onUpdateChannel: (id: string, patch: Partial<NotificationChannel>) => Promise<void>
  onRemoveChannel: (id: string) => Promise<void>
}

type AutonomySectionProps = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  uiLanguage: UiLanguage
} & Partial<ChannelManagerProps>

type TiFunction = (key: Parameters<typeof pickTranslatedUiText>[1]) => string

// Mirrors the preload bridge shape (vite-env.d.ts is module-scoped).
type NotificationWatcherStatus = {
  status: 'stopped' | 'running' | 'needs-permission' | 'unsupported' | 'error'
  lastError: string | null
  platformSupported: boolean
}

type WebhookInfo = {
  url: string
  requiresAuth: boolean
  tokenFileName: string
  maxBodyBytes: number
}

// ── Helpers to reduce repetition in settings fields ──────────────────────────

type SubsectionHeaderProps = {
  title: string
  hint: string
}

function SubsectionHeader({ title, hint }: SubsectionHeaderProps) {
  return (
    <div className="settings-mini-group__head">
      <h5>{title}</h5>
      <span>{hint}</span>
    </div>
  )
}

function AutonomyControlCard({ children }: { children: ReactNode }) {
  return (
    <div className="settings-control-card settings-autonomy-control">
      {children}
    </div>
  )
}

function AutonomyFieldCard({ children }: { children: ReactNode }) {
  return (
    <div className="settings-control-card settings-autonomy-field">
      {children}
    </div>
  )
}

// ── Notification channels panel ──────────────────────────────────────────────

function NotificationChannelsPanel({
  channels,
  channelsLoading,
  onAddChannel,
  onUpdateChannel,
  onRemoveChannel,
  ti,
}: ChannelManagerProps & { ti: TiFunction }) {
  const [addMode, setAddMode] = useState(false)
  const [rssUrl, setRssUrl] = useState('')
  const [rssName, setRssName] = useState('')
  const [rssInterval, setRssInterval] = useState(30)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null)

  const resetForm = useCallback(() => {
    setAddMode(false)
    setRssUrl('')
    setRssName('')
    setRssInterval(30)
    setError('')
  }, [])

  const handleSaveRss = useCallback(async () => {
    const url = rssUrl.trim()
    if (!url) { setError(ti('settings.autonomy.notifications.url_empty')); return }
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      setError(ti('settings.autonomy.notifications.url_invalid'))
      return
    }

    setSaving(true)
    setError('')
    try {
      const name = rssName.trim() || new URL(url).hostname
      await onAddChannel({
        kind: 'rss',
        name,
        enabled: true,
        config: { url },
        checkIntervalMinutes: rssInterval,
      })
      resetForm()
    } catch (err) {
      setError(humanizeError(err, 'generic'))
    } finally {
      setSaving(false)
    }
  }, [rssUrl, rssName, rssInterval, onAddChannel, resetForm, ti])

  useEffect(() => {
    let cancelled = false
    const getWebhookInfo = window.desktopPet?.getNotificationWebhookInfo
    if (!getWebhookInfo) return undefined

    getWebhookInfo()
      .then((info) => {
        if (!cancelled) setWebhookInfo(info)
      })
      .catch(() => {
        if (!cancelled) setWebhookInfo(null)
      })

    return () => {
      cancelled = true
    }
  }, [])

  if (channelsLoading) {
    return <p className="settings-drawer__hint">{ti('settings.autonomy.notifications.loading')}</p>
  }

  const rssChannels = channels.filter((c) => c.kind === 'rss')

  return (
    <div className="settings-autonomy-notifications">
      {/* Static webhook info */}
      <div className="settings-autonomy-channel settings-autonomy-channel--webhook">
        <div className="settings-autonomy-channel__head">
          <span className="settings-autonomy-channel__badge settings-autonomy-channel__badge--webhook">
            Webhook
          </span>
          <span className="settings-autonomy-channel__title">{ti('settings.autonomy.notifications.local_webhook')}</span>
        </div>
        <code className="settings-autonomy-channel__code">
          POST {webhookInfo?.url ?? 'http://127.0.0.1:47830/webhook'}
        </code>
        {webhookInfo?.requiresAuth ? (
          <code className="settings-autonomy-channel__code">
            Authorization: Bearer &lt;{webhookInfo.tokenFileName || 'notification-webhook-token.txt'}&gt;
          </code>
        ) : null}
        <p className="settings-drawer__hint settings-autonomy-channel__hint">
          {ti('settings.autonomy.notifications.webhook_hint')}
        </p>
      </div>

      {/* RSS channel rows */}
      {rssChannels.map((ch) => {
        const channelLabel = `RSS ${ch.name}`
        const toggleLabel = `${ti('settings.autonomy.notifications.enable')}: ${channelLabel}`
        const deleteLabel = `${ti('settings.autonomy.notifications.delete')}: ${channelLabel}`

        return (
          <div key={ch.id} className="settings-autonomy-channel settings-autonomy-channel--rss">
            <span className="settings-autonomy-channel__badge settings-autonomy-channel__badge--rss">
              RSS
            </span>
            <div className="settings-autonomy-channel__main">
              <div className="settings-autonomy-channel__title">{ch.name}</div>
              <div className="settings-autonomy-channel__url">
                {ch.config.url}
              </div>
            </div>
            <span className="settings-autonomy-channel__interval">
              {ch.checkIntervalMinutes} {ti('settings.autonomy.notifications.minutes')}
            </span>
            <SettingsToggle
              className="settings-autonomy-channel__toggle"
              label={toggleLabel}
              hideLabel
              checked={ch.enabled}
              onChange={(enabled) => void onUpdateChannel(ch.id, { enabled })}
            />
            <button
              type="button"
              className="settings-autonomy-channel__delete"
              onClick={() => void onRemoveChannel(ch.id)}
              aria-label={deleteLabel}
              title={deleteLabel}
            >
              <PetControlIcon name="close" />
            </button>
          </div>
        )
      })}

      {/* Add RSS form */}
      {addMode ? (
        <div className="settings-autonomy-rss-form">
          <div className="settings-autonomy-rss-form__fields">
            <input
              type="url"
              placeholder={ti('settings.autonomy.notifications.rss_url_placeholder')}
              value={rssUrl}
              aria-label={ti('settings.autonomy.notifications.rss_url_placeholder')}
              onChange={(e) => setRssUrl(e.target.value)}
            />
            <div className="settings-autonomy-rss-form__row">
              <input
                type="text"
                placeholder={ti('settings.autonomy.notifications.rss_name_placeholder')}
                value={rssName}
                aria-label={ti('settings.autonomy.notifications.rss_name_placeholder')}
                onChange={(e) => setRssName(e.target.value)}
              />
              <label className="settings-autonomy-rss-form__interval">
                <input
                  type="number"
                  min={5}
                  max={1440}
                  step={5}
                  value={rssInterval}
                  onChange={(e) => setRssInterval(Number(e.target.value) || 30)}
                />
                <span>{ti('settings.autonomy.notifications.minutes')}</span>
              </label>
            </div>
            {error ? (
              <p className="settings-autonomy-rss-form__error" role="alert" aria-live="assertive" aria-atomic="true">
                {error}
              </p>
            ) : null}
            <div className="settings-autonomy-rss-form__actions">
              <button type="button" onClick={() => void handleSaveRss()} disabled={saving}>
                {saving ? ti('settings.autonomy.notifications.saving') : ti('settings.autonomy.notifications.add')}
              </button>
              <button type="button" onClick={resetForm}>{ti('settings.autonomy.notifications.cancel')}</button>
            </div>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddMode(true)}
          className="settings-autonomy-add-rss"
        >
          {ti('settings.autonomy.notifications.add_rss')}
        </button>
      )}
    </div>
  )
}

// ── Main section ─────────────────────────────────────────────────────────────

function MacMessageWatcherCard({ draft, setDraft, ti }: {
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  ti: TiFunction
}) {
  const [watcherStatus, setWatcherStatus] = useState<NotificationWatcherStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.desktopPet?.notificationWatcherStatus?.().then((status) => {
      if (!cancelled) setWatcherStatus(status)
    }).catch(() => {})
    const unsubscribe = window.desktopPet?.subscribeNotificationWatcherStatus?.((status) => {
      setWatcherStatus(status)
    })
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const platformSupported = watcherStatus?.platformSupported !== false
  const statusKey = watcherStatus?.status ?? 'stopped'
  const statusLabel = ti(
    statusKey === 'running' ? 'settings.autonomy.watcher.status.running'
      : statusKey === 'needs-permission' ? 'settings.autonomy.watcher.status.needs_permission'
        : statusKey === 'error' ? 'settings.autonomy.watcher.status.error'
          : statusKey === 'unsupported' ? 'settings.autonomy.watcher.status.unsupported'
            : 'settings.autonomy.watcher.status.stopped',
  )

  return (
    <div className="settings-drawer__card">
      <div className="settings-section__title-row">
        <div>
          <h5>{ti('settings.autonomy.watcher.title')}</h5>
          <p className="settings-drawer__hint">{ti('settings.autonomy.watcher.hint')}</p>
        </div>
        <div className="settings-page__meta">
          <span>{statusLabel}</span>
        </div>
      </div>

      {/* The one toggle. Turning it on auto-raises the notification master
          switch so message awareness is a single flip + the macOS Full Disk
          Access grant — nothing else to configure. Turning it off leaves the
          master alone (webhook/RSS may still want it). */}
      <SettingsToggle
        label={ti('settings.autonomy.watcher.enable')}
        checked={draft.macosMessageWatcherEnabled}
        disabled={!platformSupported}
        onChange={(enabled) => {
          setDraft((prev) => ({
            ...prev,
            macosMessageWatcherEnabled: enabled,
            autonomyNotificationsEnabled: enabled ? true : prev.autonomyNotificationsEnabled,
          }))
        }}
      />

      {draft.macosMessageWatcherEnabled && statusKey === 'needs-permission' ? (
        <div className="settings-stack">
          <p className="settings-inline-note">{ti('settings.autonomy.watcher.permission_note')}</p>
          <div className="settings-action-row">
            <button
              type="button"
              onClick={() => {
                void window.desktopPet?.openExternalLink?.({
                  url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
                })
              }}
            >
              {ti('settings.autonomy.watcher.open_permission')}
            </button>
          </div>
        </div>
      ) : null}

      {/* Optional knobs stay hidden until the feature is on, so an off card
          is just the single toggle + its hint. */}
      {draft.macosMessageWatcherEnabled ? (
        <>
          <label>
            <span>{ti('settings.autonomy.watcher.apps_label')}</span>
            <input
              type="text"
              value={draft.macosMessageWatcherApps}
              placeholder={'微信|WeChat|QQ|钉钉|飞书|Telegram|Slack'}
              onChange={(event) => {
                const value = event.target.value
                setDraft((prev) => ({ ...prev, macosMessageWatcherApps: value }))
              }}
            />
          </label>

          <ToggleField
            label={ti('settings.autonomy.watcher.to_chat')}
            field="autonomyNotificationMessagesToChatEnabled"
            draft={draft}
            setDraft={setDraft}
          />
        </>
      ) : null}
    </div>
  )
}

export const AutonomySection = memo(function AutonomySection({
  active,
  draft,
  setDraft,
  uiLanguage,
  channels,
  channelsLoading,
  onAddChannel,
  onUpdateChannel,
  onRemoveChannel,
}: AutonomySectionProps) {
  const ti: TiFunction = (key) => pickTranslatedUiText(uiLanguage, key)
  const fieldProps = { draft, setDraft }

  const hasChannelProps = channels !== undefined
    && onAddChannel !== undefined
    && onUpdateChannel !== undefined
    && onRemoveChannel !== undefined

  return (
    <section className={`settings-section settings-autonomy-section ${active ? 'is-active' : 'is-hidden'}`}>

      {/* ── Master switch ────────────────────────────────────────────────── */}
      <AutonomyControlCard>
        <ToggleField label={ti('settings.autonomy.enable')} field="autonomyEnabled" {...fieldProps} />
      </AutonomyControlCard>

      {/* ── Proactive Presence (basic fallback) ──────────────────────────── */}
      <div className="settings-mini-group settings-autonomy-group">
        <SubsectionHeader
          title={ti('settings.autonomy.presence.title')}
          hint={ti('settings.autonomy.presence.hint')}
        />

        <AutonomyControlCard>
          <ToggleField label={ti('settings.autonomy.presence.enable')} field="proactivePresenceEnabled" {...fieldProps} />
        </AutonomyControlCard>

        {draft.proactivePresenceEnabled && (
          <label className="settings-control-card settings-autonomy-field">
            <span>{ti('settings.autonomy.presence.interval')}</span>
            <input
              type="number"
              min="5"
              max="120"
              step="1"
              value={draft.proactivePresenceIntervalMinutes}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  proactivePresenceIntervalMinutes: clampPresenceIntervalMinutes(
                    parseNumberInput(event.target.value, prev.proactivePresenceIntervalMinutes),
                  ),
                }))
              }
            />
          </label>
        )}

        {/* ── Away "Thinking of you" notification ──────────────────────────── */}
        <AutonomyControlCard>
          <ToggleField
            label={ti('settings.autonomy.away_notification.enable')}
            field="proactiveAwayNotificationsEnabled"
            {...fieldProps}
          />
        </AutonomyControlCard>
        <p className="settings-mini-group__note settings-autonomy-note">
          {ti('settings.autonomy.away_notification.hint')}
        </p>

        {draft.proactiveAwayNotificationsEnabled && (
          <label className="settings-control-card settings-autonomy-field">
            <span>{ti('settings.autonomy.away_notification.threshold')}</span>
            <input
              type="number"
              min="60"
              max="1440"
              step="30"
              value={draft.proactiveAwayNotificationThresholdMinutes}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  proactiveAwayNotificationThresholdMinutes: Math.max(
                    60,
                    Math.min(1440, parseNumberInput(event.target.value, prev.proactiveAwayNotificationThresholdMinutes)),
                  ),
                }))
              }
            />
          </label>
        )}
      </div>

      {/* ── Tick Loop & Sleep ─────────────────────────────────────────────── */}
      {draft.autonomyEnabled && (
        <>
          <div className="settings-mini-group settings-autonomy-group">
            <SubsectionHeader
              title={ti('settings.autonomy.tick.title')}
              hint={ti('settings.autonomy.tick.hint')}
            />

            <div className="settings-grid settings-grid--two settings-autonomy-field-grid">
              <AutonomyFieldCard>
                <NumberField label={ti('settings.autonomy.tick.interval')} field="autonomyTickIntervalSeconds" min={10} max={300} step={5} {...fieldProps} />
              </AutonomyFieldCard>
              <AutonomyFieldCard>
                <NumberField label={ti('settings.autonomy.tick.sleep_idle')} field="autonomySleepAfterIdleMinutes" min={5} max={120} step={5} {...fieldProps} />
              </AutonomyFieldCard>
              <AutonomyFieldCard>
                <NumberField label={ti('settings.autonomy.tick.daily_limit')} field="autonomyCostLimitDailyTicks" min={10} max={1000} step={10} {...fieldProps} />
              </AutonomyFieldCard>
            </div>

            <AutonomyControlCard>
              <ToggleField label={ti('settings.autonomy.tick.wake_on_input')} field="autonomyWakeOnInput" {...fieldProps} />
            </AutonomyControlCard>

            <div className="settings-grid settings-grid--two settings-autonomy-field-grid">
              <AutonomyFieldCard>
                <NumberField label={ti('settings.autonomy.tick.quiet_start')} field="autonomyQuietHoursStart" min={0} max={23} step={1} {...fieldProps} />
              </AutonomyFieldCard>
              <AutonomyFieldCard>
                <NumberField label={ti('settings.autonomy.tick.quiet_end')} field="autonomyQuietHoursEnd" min={0} max={23} step={1} {...fieldProps} />
              </AutonomyFieldCard>
            </div>

            <p className="settings-mini-group__note settings-autonomy-note">
              {ti('settings.autonomy.tick.quiet_note')}
              {` (${draft.autonomyQuietHoursStart}:00 ~ ${draft.autonomyQuietHoursEnd}:00)`}
            </p>
          </div>

          {/* ── Focus Awareness ─────────────────────────────────────────────── */}
          <div className="settings-mini-group settings-autonomy-group">
            <SubsectionHeader
              title={ti('settings.autonomy.focus.title')}
              hint={ti('settings.autonomy.focus.hint')}
            />

            <AutonomyControlCard>
              <ToggleField label={ti('settings.autonomy.focus.enable')} field="autonomyFocusAwarenessEnabled" {...fieldProps} />
            </AutonomyControlCard>

            <div className="settings-grid settings-autonomy-field-grid">
              <AutonomyFieldCard>
                <NumberField label={ti('settings.autonomy.focus.idle_threshold')} field="autonomyIdleThresholdSeconds" min={60} max={1800} step={30} {...fieldProps} />
              </AutonomyFieldCard>
            </div>
          </div>

          {/* ── Memory Dream ───────────────────────────────────────────────── */}
          <div className="settings-mini-group settings-autonomy-group">
            <SubsectionHeader
              title={ti('settings.autonomy.dream.title')}
              hint={ti('settings.autonomy.dream.hint')}
            />

            <AutonomyControlCard>
              <ToggleField label={ti('settings.autonomy.dream.enable')} field="autonomyDreamEnabled" {...fieldProps} />
            </AutonomyControlCard>

            {draft.autonomyDreamEnabled && (
              <div className="settings-grid settings-grid--two settings-autonomy-field-grid">
                <AutonomyFieldCard>
                  <NumberField label={ti('settings.autonomy.dream.interval')} field="autonomyDreamIntervalHours" min={1} max={168} step={1} {...fieldProps} />
                </AutonomyFieldCard>
                <AutonomyFieldCard>
                  <NumberField label={ti('settings.autonomy.dream.min_sessions')} field="autonomyDreamMinSessions" min={1} max={50} step={1} {...fieldProps} />
                </AutonomyFieldCard>
              </div>
            )}
          </div>

          {/* ── Context Triggers ────────────────────────────────────────────── */}
          <div className="settings-mini-group settings-autonomy-group">
            <SubsectionHeader
              title={ti('settings.autonomy.triggers.title')}
              hint={ti('settings.autonomy.triggers.hint')}
            />

            <AutonomyControlCard>
              <ToggleField label={ti('settings.autonomy.triggers.enable')} field="autonomyContextTriggersEnabled" {...fieldProps} />
            </AutonomyControlCard>
          </div>

        </>
      )}

      {/* ── Notification Bridge ─────────────────────────────────────────── */}
      <div className="settings-mini-group settings-autonomy-group">
        <SubsectionHeader
          title={ti('settings.autonomy.notifications.title')}
          hint={ti('settings.autonomy.notifications.hint')}
        />

        {/* Message awareness — the one toggle most users want. Always
            visible; flipping it on raises the master switch below. */}
        <MacMessageWatcherCard draft={draft} setDraft={setDraft} ti={ti} />

        <AutonomyControlCard>
          <ToggleField label={ti('settings.autonomy.notifications.enable')} field="autonomyNotificationsEnabled" {...fieldProps} />
        </AutonomyControlCard>

        {draft.autonomyNotificationsEnabled && (
          <div className="settings-grid settings-grid--two settings-autonomy-field-grid">
            <AutonomyFieldCard>
              <ToggleField
                label={ti('settings.autonomy.notifications.message_announce')}
                field="autonomyNotificationMessageAnnouncementsEnabled"
                {...fieldProps}
              />
            </AutonomyFieldCard>
            <AutonomyFieldCard>
              <ToggleField
                label={ti('settings.autonomy.notifications.message_preview')}
                field="autonomyNotificationMessagePreviewEnabled"
                disabled={!draft.autonomyNotificationMessageAnnouncementsEnabled}
                {...fieldProps}
              />
            </AutonomyFieldCard>
          </div>
        )}

        {draft.autonomyNotificationsEnabled && hasChannelProps && (
          <NotificationChannelsPanel
            channels={channels}
            channelsLoading={channelsLoading ?? true}
            onAddChannel={onAddChannel}
            onUpdateChannel={onUpdateChannel}
            onRemoveChannel={onRemoveChannel}
            ti={ti}
          />
        )}
      </div>
    </section>
  )
})
