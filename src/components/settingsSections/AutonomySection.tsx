import { memo, type Dispatch, type SetStateAction, useCallback, useEffect, useState } from 'react'
import { parseNumberInput } from '../settingsDrawerSupport'
import { NumberField, ToggleField } from '../settingsFields'
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

type WebhookInfo = {
  url: string
  authHeader: string
  maxBodyBytes: number
}

// ── Helpers to reduce repetition in settings fields ──────────────────────────

type SubsectionHeaderProps = {
  title: string
  hint: string
}

function SubsectionHeader({ title, hint }: SubsectionHeaderProps) {
  return (
    <div className="settings-section__title-row" style={{ marginTop: 20 }}>
      <div>
        <h4>{title}</h4>
        <p className="settings-drawer__hint">{hint}</p>
      </div>
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
    <div style={{ marginTop: 8 }}>
      {/* Static webhook info */}
      <div style={{ padding: '8px 0', borderBottom: '1px solid var(--border-color, #333)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            fontSize: 11,
            padding: '1px 6px',
            borderRadius: 3,
            background: 'var(--accent-color, #4a6)',
            color: '#fff',
          }}>
            Webhook
          </span>
          <span style={{ fontWeight: 500 }}>{ti('settings.autonomy.notifications.local_webhook')}</span>
        </div>
        <code style={{
          display: 'block',
          fontSize: 12,
          marginTop: 4,
          padding: '4px 8px',
          borderRadius: 4,
          background: 'var(--input-bg, #1a1a1a)',
          userSelect: 'all',
        }}>
          POST {webhookInfo?.url ?? 'http://127.0.0.1:47830/webhook'}
        </code>
        {webhookInfo?.authHeader ? (
          <code style={{
            display: 'block',
            fontSize: 12,
            marginTop: 4,
            padding: '4px 8px',
            borderRadius: 4,
            background: 'var(--input-bg, #1a1a1a)',
            userSelect: 'all',
          }}>
            Authorization: {webhookInfo.authHeader}
          </code>
        ) : null}
        <p className="settings-drawer__hint" style={{ marginTop: 2 }}>
          {ti('settings.autonomy.notifications.webhook_hint')}
        </p>
      </div>

      {/* RSS channel rows */}
      {rssChannels.map((ch) => (
        <div key={ch.id} style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 0',
          borderBottom: '1px solid var(--border-color, #333)',
        }}>
          <span style={{
            fontSize: 11,
            padding: '1px 6px',
            borderRadius: 3,
            background: 'var(--warning-color, #c80)',
            color: '#fff',
            flexShrink: 0,
          }}>
            RSS
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontWeight: 500 }}>{ch.name}</div>
            <div style={{ fontSize: 12, opacity: 0.6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {ch.config.url}
            </div>
          </div>
          <span style={{ fontSize: 12, opacity: 0.5, flexShrink: 0 }}>
            {ch.checkIntervalMinutes}min
          </span>
          <label className="settings-toggle" style={{ margin: 0 }}>
            <input
              type="checkbox"
              checked={ch.enabled}
              onChange={() => void onUpdateChannel(ch.id, { enabled: !ch.enabled })}
            />
          </label>
          <button
            type="button"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--error-color, #e55)',
              cursor: 'pointer',
              fontSize: 16,
              padding: '0 4px',
            }}
            onClick={() => void onRemoveChannel(ch.id)}
            title={ti('settings.autonomy.notifications.delete')}
          >
            x
          </button>
        </div>
      ))}

      {/* Add RSS form */}
      {addMode ? (
        <div style={{ padding: '10px 0' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <input
              type="url"
              placeholder={ti('settings.autonomy.notifications.rss_url_placeholder')}
              value={rssUrl}
              onChange={(e) => setRssUrl(e.target.value)}
              style={{ width: '100%' }}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                type="text"
                placeholder={ti('settings.autonomy.notifications.rss_name_placeholder')}
                value={rssName}
                onChange={(e) => setRssName(e.target.value)}
                style={{ flex: 1 }}
              />
              <label style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  step={5}
                  value={rssInterval}
                  onChange={(e) => setRssInterval(Number(e.target.value) || 30)}
                  style={{ width: 60 }}
                />
                <span style={{ fontSize: 12 }}>{ti('settings.autonomy.notifications.minutes')}</span>
              </label>
            </div>
            {error && <p style={{ color: 'var(--error-color, #e55)', fontSize: 12, margin: 0 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8 }}>
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
          style={{
            marginTop: 8,
            background: 'none',
            border: '1px dashed var(--border-color, #555)',
            borderRadius: 4,
            padding: '6px 12px',
            cursor: 'pointer',
            color: 'inherit',
            width: '100%',
          }}
        >
          {ti('settings.autonomy.notifications.add_rss')}
        </button>
      )}
    </div>
  )
}

// ── Main section ─────────────────────────────────────────────────────────────

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
    <section className={`settings-section ${active ? 'is-active' : 'is-hidden'}`}>

      {/* ── Master switch ────────────────────────────────────────────────── */}
      <div className="settings-section__title-row">
        <div>
          <h4>{ti('settings.autonomy.title')}</h4>
          <p className="settings-drawer__hint">
            {ti('settings.autonomy.hint')}
          </p>
        </div>
      </div>

      <ToggleField label={ti('settings.autonomy.enable')} field="autonomyEnabled" {...fieldProps} />

      {/* ── Proactive Presence (basic fallback) ──────────────────────────── */}
      <SubsectionHeader
        title={ti('settings.autonomy.presence.title')}
        hint={ti('settings.autonomy.presence.hint')}
      />

      <ToggleField label={ti('settings.autonomy.presence.enable')} field="proactivePresenceEnabled" {...fieldProps} />

      {draft.proactivePresenceEnabled && (
        <label>
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
      <ToggleField
        label={ti('settings.autonomy.away_notification.enable')}
        field="proactiveAwayNotificationsEnabled"
        {...fieldProps}
      />
      <p className="settings-drawer__hint">
        {ti('settings.autonomy.away_notification.hint')}
      </p>

      {draft.proactiveAwayNotificationsEnabled && (
        <label>
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

      {/* ── Tick Loop & Sleep ─────────────────────────────────────────────── */}
      {draft.autonomyEnabled && (
        <>
          <SubsectionHeader
            title={ti('settings.autonomy.tick.title')}
            hint={ti('settings.autonomy.tick.hint')}
          />

          <div className="settings-grid">
            <NumberField label={ti('settings.autonomy.tick.interval')} field="autonomyTickIntervalSeconds" min={10} max={300} step={5} {...fieldProps} />
            <NumberField label={ti('settings.autonomy.tick.sleep_idle')} field="autonomySleepAfterIdleMinutes" min={5} max={120} step={5} {...fieldProps} />
            <NumberField label={ti('settings.autonomy.tick.daily_limit')} field="autonomyCostLimitDailyTicks" min={10} max={1000} step={10} {...fieldProps} />
          </div>

          <ToggleField label={ti('settings.autonomy.tick.wake_on_input')} field="autonomyWakeOnInput" {...fieldProps} />

          <div className="settings-grid">
            <NumberField label={ti('settings.autonomy.tick.quiet_start')} field="autonomyQuietHoursStart" min={0} max={23} step={1} {...fieldProps} />
            <NumberField label={ti('settings.autonomy.tick.quiet_end')} field="autonomyQuietHoursEnd" min={0} max={23} step={1} {...fieldProps} />
          </div>

          <p className="settings-drawer__hint">
            {ti('settings.autonomy.tick.quiet_note')}
            {` (${draft.autonomyQuietHoursStart}:00 ~ ${draft.autonomyQuietHoursEnd}:00)`}
          </p>

          {/* ── Focus Awareness ─────────────────────────────────────────────── */}
          <SubsectionHeader
            title={ti('settings.autonomy.focus.title')}
            hint={ti('settings.autonomy.focus.hint')}
          />

          <ToggleField label={ti('settings.autonomy.focus.enable')} field="autonomyFocusAwarenessEnabled" {...fieldProps} />

          <div className="settings-grid">
            <NumberField label={ti('settings.autonomy.focus.idle_threshold')} field="autonomyIdleThresholdSeconds" min={60} max={1800} step={30} {...fieldProps} />
          </div>

          {/* ── Memory Dream ───────────────────────────────────────────────── */}
          <SubsectionHeader
            title={ti('settings.autonomy.dream.title')}
            hint={ti('settings.autonomy.dream.hint')}
          />

          <ToggleField label={ti('settings.autonomy.dream.enable')} field="autonomyDreamEnabled" {...fieldProps} />

          {draft.autonomyDreamEnabled && (
            <div className="settings-grid">
              <NumberField label={ti('settings.autonomy.dream.interval')} field="autonomyDreamIntervalHours" min={1} max={168} step={1} {...fieldProps} />
              <NumberField label={ti('settings.autonomy.dream.min_sessions')} field="autonomyDreamMinSessions" min={1} max={50} step={1} {...fieldProps} />
            </div>
          )}

          {/* ── Context Triggers ────────────────────────────────────────────── */}
          <SubsectionHeader
            title={ti('settings.autonomy.triggers.title')}
            hint={ti('settings.autonomy.triggers.hint')}
          />

          <ToggleField label={ti('settings.autonomy.triggers.enable')} field="autonomyContextTriggersEnabled" {...fieldProps} />

          {/* ── Notification Bridge ─────────────────────────────────────────── */}
          <SubsectionHeader
            title={ti('settings.autonomy.notifications.title')}
            hint={ti('settings.autonomy.notifications.hint')}
          />

          <ToggleField label={ti('settings.autonomy.notifications.enable')} field="autonomyNotificationsEnabled" {...fieldProps} />

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
        </>
      )}
    </section>
  )
})
