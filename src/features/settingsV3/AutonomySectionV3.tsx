import {
  memo,
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useState,
} from 'react'
import { clampPresenceIntervalMinutes } from '../../lib/settings'
import { humanizeError } from '../../lib/humanizeError'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { AppSettings, NotificationChannel, UiLanguage } from '../../types'
import { PetControlIcon } from '../../components/PetControlIcon'
import type { ConfirmFn } from '../../components/useConfirm'
import {
  SettingsV3Disclosure,
  SettingsV3Field,
  SettingsV3Notice,
  SettingsV3Page,
  SettingsV3Row,
  SettingsV3Section,
  SettingsV3Switch,
  SettingsV3Toolbar,
} from './SettingsV3Primitives'

type ChannelManagerProps = {
  channels: NotificationChannel[]
  channelsLoading: boolean
  onAddChannel: (draft: Omit<NotificationChannel, 'id'>) => Promise<void>
  onUpdateChannel: (id: string, patch: Partial<NotificationChannel>) => Promise<void>
  onRemoveChannel: (id: string) => Promise<void>
}

export type AutonomySectionV3Props = {
  active: boolean
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  uiLanguage: UiLanguage
  confirm: ConfirmFn
} & Partial<ChannelManagerProps>

type Ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => string

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

const numberValue = (value: string, fallback: number, min: number, max: number) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback
}

function NumberSetting({
  draft,
  field,
  label,
  max,
  min,
  setDraft,
  step = 1,
}: {
  draft: AppSettings
  field: keyof AppSettings
  label: string
  max: number
  min: number
  setDraft: Dispatch<SetStateAction<AppSettings>>
  step?: number
}) {
  const value = draft[field]
  if (typeof value !== 'number') return null
  return (
    <SettingsV3Field label={label}>
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => {
          const next = numberValue(event.target.value, value, min, max)
          setDraft((current) => ({ ...current, [field]: next }))
        }}
      />
    </SettingsV3Field>
  )
}

function MessageWatcher({ draft, setDraft, ti }: {
  draft: AppSettings
  setDraft: Dispatch<SetStateAction<AppSettings>>
  ti: Ti
}) {
  const [watcherStatus, setWatcherStatus] = useState<NotificationWatcherStatus | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.desktopPet?.notificationWatcherStatus?.()
      .then((status) => { if (!cancelled) setWatcherStatus(status) })
      .catch(() => {})
    const unsubscribe = window.desktopPet?.subscribeNotificationWatcherStatus?.(setWatcherStatus)
    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  const status = watcherStatus?.status ?? 'stopped'
  const supported = watcherStatus?.platformSupported !== false
  const statusLabel = ti(
    status === 'running' ? 'settings.autonomy.watcher.status.running'
      : status === 'needs-permission' ? 'settings.autonomy.watcher.status.needs_permission'
        : status === 'error' ? 'settings.autonomy.watcher.status.error'
          : status === 'unsupported' ? 'settings.autonomy.watcher.status.unsupported'
            : 'settings.autonomy.watcher.status.stopped',
  )

  return (
    <>
      <SettingsV3Row
        icon="chat"
        label={ti('settings.autonomy.watcher.enable')}
        hint={ti('settings.autonomy.watcher.hint')}
        meta={statusLabel}
        disabled={!supported}
      >
        <SettingsV3Switch
          label={ti('settings.autonomy.watcher.enable')}
          checked={draft.macosMessageWatcherEnabled}
          disabled={!supported}
          onChange={(enabled) => setDraft((current) => ({
            ...current,
            macosMessageWatcherEnabled: enabled,
            autonomyNotificationsEnabled: enabled ? true : current.autonomyNotificationsEnabled,
          }))}
        />
      </SettingsV3Row>
      {draft.macosMessageWatcherEnabled && status === 'needs-permission' ? (
        <div className="settings-v3-editor">
          <SettingsV3Notice tone="warning" title={ti('settings.autonomy.watcher.permission_note')}>
            {ti('settings.autonomy.watcher.permission_note')}
          </SettingsV3Notice>
          <SettingsV3Toolbar>
            <button
              type="button"
              onClick={() => void window.desktopPet?.openExternalLink?.({
                url: 'x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles',
              })}
            >
              {ti('settings.autonomy.watcher.open_permission')}
            </button>
          </SettingsV3Toolbar>
        </div>
      ) : null}
      {draft.macosMessageWatcherEnabled ? (
        <div className="settings-v3-editor">
          <SettingsV3Field label={ti('settings.autonomy.watcher.apps_label')}>
            <input
              value={draft.macosMessageWatcherApps}
              onChange={(event) => setDraft((current) => ({ ...current, macosMessageWatcherApps: event.target.value }))}
            />
          </SettingsV3Field>
          <SettingsV3Row
            label={ti('settings.autonomy.watcher.to_chat')}
            hint={ti('settings.autonomy.watcher.hint')}
          >
            <SettingsV3Switch
              label={ti('settings.autonomy.watcher.to_chat')}
              checked={draft.autonomyNotificationMessagesToChatEnabled}
              onChange={(value) => setDraft((current) => ({ ...current, autonomyNotificationMessagesToChatEnabled: value }))}
            />
          </SettingsV3Row>
        </div>
      ) : null}
    </>
  )
}

function NotificationChannels({
  channels,
  channelsLoading,
  onAddChannel,
  onUpdateChannel,
  onRemoveChannel,
  confirm,
  ti,
}: ChannelManagerProps & { ti: Ti; confirm: ConfirmFn }) {
  const [adding, setAdding] = useState(false)
  const [rssUrl, setRssUrl] = useState('')
  const [rssName, setRssName] = useState('')
  const [rssInterval, setRssInterval] = useState(30)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [webhookInfo, setWebhookInfo] = useState<WebhookInfo | null>(null)

  useEffect(() => {
    let cancelled = false
    void window.desktopPet?.getNotificationWebhookInfo?.()
      .then((info) => { if (!cancelled) setWebhookInfo(info) })
      .catch(() => { if (!cancelled) setWebhookInfo(null) })
    return () => { cancelled = true }
  }, [])

  const reset = useCallback(() => {
    setAdding(false)
    setRssUrl('')
    setRssName('')
    setRssInterval(30)
    setError('')
  }, [])

  const addRss = useCallback(async () => {
    const url = rssUrl.trim()
    if (!url) { setError(ti('settings.autonomy.notifications.url_empty')); return }
    if (!/^https?:\/\//i.test(url)) { setError(ti('settings.autonomy.notifications.url_invalid')); return }
    setSaving(true)
    setError('')
    try {
      await onAddChannel({
        kind: 'rss',
        name: rssName.trim() || new URL(url).hostname,
        enabled: true,
        config: { url },
        checkIntervalMinutes: rssInterval,
      })
      reset()
    } catch (cause) {
      setError(humanizeError(cause, 'generic'))
    } finally {
      setSaving(false)
    }
  }, [onAddChannel, reset, rssInterval, rssName, rssUrl, ti])

  const rssChannels = channels.filter((channel) => channel.kind === 'rss')

  return (
    <div className="settings-v3-editor">
      <SettingsV3Notice title={ti('settings.autonomy.notifications.local_webhook')}>
        {`POST ${webhookInfo?.url ?? 'http://127.0.0.1:47830/webhook'}${webhookInfo?.requiresAuth ? ` · ${webhookInfo.tokenFileName || 'notification-webhook-token.txt'}` : ''}`}
      </SettingsV3Notice>
      {channelsLoading ? <SettingsV3Notice title={ti('settings.autonomy.notifications.loading')} announce /> : null}
      {!channelsLoading && rssChannels.length ? (
        <SettingsV3Section title="RSS" hideHeader>
          {rssChannels.map((channel) => (
            <SettingsV3Row
              key={channel.id}
              label={channel.name}
              hint={channel.config.url}
              meta={`${channel.checkIntervalMinutes} ${ti('settings.autonomy.notifications.minutes')}`}
            >
              <SettingsV3Switch
                label={`${ti('settings.autonomy.notifications.enable')}: RSS ${channel.name}`}
                checked={channel.enabled}
                onChange={(enabled) => void onUpdateChannel(channel.id, { enabled })}
              />
              <button
                type="button"
                className="settings-v3-action is-danger"
                aria-label={`${ti('settings.autonomy.notifications.delete')}: RSS ${channel.name}`}
                title={`${ti('settings.autonomy.notifications.delete')}: RSS ${channel.name}`}
                onClick={() => void confirm({
                  title: ti('settings.autonomy.notifications.delete'),
                  message: `${ti('settings.autonomy.notifications.delete')}: RSS ${channel.name}`,
                  confirmLabel: ti('settings.autonomy.notifications.delete'),
                  tone: 'danger',
                }).then((accepted) => { if (accepted) void onRemoveChannel(channel.id) })}
              >
                <PetControlIcon name="trash" aria-hidden="true" />
                <span className="settings-v3-sr-only">{ti('settings.autonomy.notifications.delete')}</span>
              </button>
            </SettingsV3Row>
          ))}
        </SettingsV3Section>
      ) : null}
      {adding ? (
        <div className="settings-v3-editor">
          <SettingsV3Field label={ti('settings.autonomy.notifications.rss_url_placeholder')}>
            <input type="url" value={rssUrl} onChange={(event) => setRssUrl(event.target.value)} />
          </SettingsV3Field>
          <SettingsV3Field label={ti('settings.autonomy.notifications.rss_name_placeholder')}>
            <input value={rssName} onChange={(event) => setRssName(event.target.value)} />
          </SettingsV3Field>
          <SettingsV3Field label={ti('settings.autonomy.notifications.minutes')}>
            <input
              type="number"
              min={5}
              max={1440}
              step={5}
              value={rssInterval}
              onChange={(event) => setRssInterval(numberValue(event.target.value, 30, 5, 1440))}
            />
          </SettingsV3Field>
          {error ? <SettingsV3Notice tone="error" title={error} announce /> : null}
          <SettingsV3Toolbar>
            <button type="button" disabled={saving} onClick={() => void addRss()}>
              {saving ? ti('settings.autonomy.notifications.saving') : ti('settings.autonomy.notifications.add')}
            </button>
            <button type="button" onClick={reset}>{ti('settings.autonomy.notifications.cancel')}</button>
          </SettingsV3Toolbar>
        </div>
      ) : (
        <SettingsV3Toolbar>
          <button type="button" onClick={() => setAdding(true)}>{ti('settings.autonomy.notifications.add_rss')}</button>
        </SettingsV3Toolbar>
      )}
    </div>
  )
}

export const AutonomySectionV3 = memo(function AutonomySectionV3({
  active,
  draft,
  setDraft,
  uiLanguage,
  channels,
  channelsLoading,
  onAddChannel,
  onUpdateChannel,
  onRemoveChannel,
  confirm,
}: AutonomySectionV3Props) {
  const ti: Ti = (key) => pickTranslatedUiText(uiLanguage, key)
  const setSetting = <TKey extends keyof AppSettings>(key: TKey, value: AppSettings[TKey]) => {
    setDraft((current) => ({ ...current, [key]: value }))
  }
  const hasChannels = channels !== undefined && onAddChannel && onUpdateChannel && onRemoveChannel
  const quietHours = `${String(draft.autonomyQuietHoursStart).padStart(2, '0')}:00 – ${String(draft.autonomyQuietHoursEnd).padStart(2, '0')}:00`

  return (
    <SettingsV3Page className={active ? 'settings-v3-autonomy' : 'is-hidden settings-v3-autonomy'}>
      <SettingsV3Section title={ti('settings.autonomy.enable')} hideHeader>
        <SettingsV3Row
          icon="sparkles"
          label={ti('settings.autonomy.enable')}
          hint={ti('settings.autonomy.presence.hint')}
          meta={draft.autonomyEnabled ? ti('settings.autonomy.watcher.status.running') : ti('settings.autonomy.watcher.status.stopped')}
        >
          <SettingsV3Switch
            label={ti('settings.autonomy.enable')}
            checked={draft.autonomyEnabled}
            onChange={(value) => setSetting('autonomyEnabled', value)}
          />
        </SettingsV3Row>
      </SettingsV3Section>

      <SettingsV3Section title={ti('settings.autonomy.tick.title')} description={ti('settings.autonomy.tick.quiet_note')}>
        <div className="settings-v3-editor">
          <SettingsV3Notice title={quietHours}>{ti('settings.autonomy.tick.quiet_note')}</SettingsV3Notice>
          <div className="settings-v3-editor">
            <NumberSetting draft={draft} field="autonomyQuietHoursStart" label={ti('settings.autonomy.tick.quiet_start')} min={0} max={23} setDraft={setDraft} />
            <NumberSetting draft={draft} field="autonomyQuietHoursEnd" label={ti('settings.autonomy.tick.quiet_end')} min={0} max={23} setDraft={setDraft} />
          </div>
        </div>
      </SettingsV3Section>

      <SettingsV3Section title={ti('settings.autonomy.presence.title')} description={ti('settings.autonomy.presence.hint')}>
        <SettingsV3Row label={ti('settings.autonomy.presence.enable')} hint={ti('settings.autonomy.presence.hint')}>
          <SettingsV3Switch
            label={ti('settings.autonomy.presence.enable')}
            checked={draft.proactivePresenceEnabled}
            onChange={(value) => setSetting('proactivePresenceEnabled', value)}
          />
        </SettingsV3Row>
        {draft.proactivePresenceEnabled ? (
          <div className="settings-v3-editor">
            <SettingsV3Field label={ti('settings.autonomy.presence.interval')} hint={ti('settings.autonomy.presence.hint')}>
              <input
                type="number"
                min={5}
                max={120}
                value={draft.proactivePresenceIntervalMinutes}
                onChange={(event) => setSetting(
                  'proactivePresenceIntervalMinutes',
                  clampPresenceIntervalMinutes(numberValue(event.target.value, draft.proactivePresenceIntervalMinutes, 5, 120)),
                )}
              />
            </SettingsV3Field>
          </div>
        ) : null}
        <SettingsV3Row label={ti('settings.autonomy.away_notification.enable')} hint={ti('settings.autonomy.away_notification.hint')}>
          <SettingsV3Switch
            label={ti('settings.autonomy.away_notification.enable')}
            checked={draft.proactiveAwayNotificationsEnabled}
            onChange={(value) => setSetting('proactiveAwayNotificationsEnabled', value)}
          />
        </SettingsV3Row>
        {draft.proactiveAwayNotificationsEnabled ? (
          <div className="settings-v3-editor">
            <NumberSetting
              draft={draft}
              field="proactiveAwayNotificationThresholdMinutes"
              label={ti('settings.autonomy.away_notification.threshold')}
              min={60}
              max={1440}
              step={30}
              setDraft={setDraft}
            />
            <SettingsV3Notice title={ti('settings.autonomy.tick.quiet_note')}>{ti('settings.autonomy.away_notification.hint')}</SettingsV3Notice>
          </div>
        ) : null}
      </SettingsV3Section>

      {draft.autonomyEnabled ? (
        <SettingsV3Disclosure title={ti('settings.autonomy.tick.title')} description={ti('settings.autonomy.tick.hint')}>
          <SettingsV3Row label={ti('settings.autonomy.tick.wake_on_input')} hint={ti('settings.autonomy.tick.hint')}>
            <SettingsV3Switch
              label={ti('settings.autonomy.tick.wake_on_input')}
              checked={draft.autonomyWakeOnInput}
              onChange={(value) => setSetting('autonomyWakeOnInput', value)}
            />
          </SettingsV3Row>
          <div className="settings-v3-editor">
            <NumberSetting draft={draft} field="autonomyTickIntervalSeconds" label={ti('settings.autonomy.tick.interval')} min={10} max={300} step={5} setDraft={setDraft} />
            <NumberSetting draft={draft} field="autonomySleepAfterIdleMinutes" label={ti('settings.autonomy.tick.sleep_idle')} min={5} max={120} step={5} setDraft={setDraft} />
            <NumberSetting draft={draft} field="autonomyCostLimitDailyTicks" label={ti('settings.autonomy.tick.daily_limit')} min={10} max={1000} step={10} setDraft={setDraft} />
          </div>
          <SettingsV3Row label={ti('settings.autonomy.focus.enable')} hint={ti('settings.autonomy.focus.hint')}>
            <SettingsV3Switch label={ti('settings.autonomy.focus.enable')} checked={draft.autonomyFocusAwarenessEnabled} onChange={(value) => setSetting('autonomyFocusAwarenessEnabled', value)} />
          </SettingsV3Row>
          {draft.autonomyFocusAwarenessEnabled ? (
            <div className="settings-v3-editor">
              <NumberSetting draft={draft} field="autonomyIdleThresholdSeconds" label={ti('settings.autonomy.focus.idle_threshold')} min={60} max={1800} step={30} setDraft={setDraft} />
            </div>
          ) : null}
          <SettingsV3Row label={ti('settings.autonomy.dream.enable')} hint={ti('settings.autonomy.dream.hint')}>
            <SettingsV3Switch label={ti('settings.autonomy.dream.enable')} checked={draft.autonomyDreamEnabled} onChange={(value) => setSetting('autonomyDreamEnabled', value)} />
          </SettingsV3Row>
          {draft.autonomyDreamEnabled ? (
            <div className="settings-v3-editor">
              <NumberSetting draft={draft} field="autonomyDreamIntervalHours" label={ti('settings.autonomy.dream.interval')} min={1} max={168} setDraft={setDraft} />
              <NumberSetting draft={draft} field="autonomyDreamMinSessions" label={ti('settings.autonomy.dream.min_sessions')} min={1} max={50} setDraft={setDraft} />
            </div>
          ) : null}
          <SettingsV3Row label={ti('settings.autonomy.triggers.enable')} hint={ti('settings.autonomy.triggers.hint')}>
            <SettingsV3Switch label={ti('settings.autonomy.triggers.enable')} checked={draft.autonomyContextTriggersEnabled} onChange={(value) => setSetting('autonomyContextTriggersEnabled', value)} />
          </SettingsV3Row>
        </SettingsV3Disclosure>
      ) : null}

      <SettingsV3Disclosure title={ti('settings.autonomy.notifications.title')} description={ti('settings.autonomy.notifications.hint')}>
        <MessageWatcher draft={draft} setDraft={setDraft} ti={ti} />
        <SettingsV3Row label={ti('settings.autonomy.notifications.enable')} hint={ti('settings.autonomy.notifications.hint')}>
          <SettingsV3Switch label={ti('settings.autonomy.notifications.enable')} checked={draft.autonomyNotificationsEnabled} onChange={(value) => setSetting('autonomyNotificationsEnabled', value)} />
        </SettingsV3Row>
        {draft.autonomyNotificationsEnabled ? (
          <>
            <SettingsV3Row label={ti('settings.autonomy.notifications.message_announce')}>
              <SettingsV3Switch label={ti('settings.autonomy.notifications.message_announce')} checked={draft.autonomyNotificationMessageAnnouncementsEnabled} onChange={(value) => setSetting('autonomyNotificationMessageAnnouncementsEnabled', value)} />
            </SettingsV3Row>
            <SettingsV3Row label={ti('settings.autonomy.notifications.message_preview')} disabled={!draft.autonomyNotificationMessageAnnouncementsEnabled}>
              <SettingsV3Switch label={ti('settings.autonomy.notifications.message_preview')} checked={draft.autonomyNotificationMessagePreviewEnabled} disabled={!draft.autonomyNotificationMessageAnnouncementsEnabled} onChange={(value) => setSetting('autonomyNotificationMessagePreviewEnabled', value)} />
            </SettingsV3Row>
            {hasChannels ? (
              <NotificationChannels
                channels={channels}
                channelsLoading={channelsLoading ?? true}
                onAddChannel={onAddChannel}
                onUpdateChannel={onUpdateChannel}
                onRemoveChannel={onRemoveChannel}
                confirm={confirm}
                ti={ti}
              />
            ) : null}
          </>
        ) : null}
      </SettingsV3Disclosure>
    </SettingsV3Page>
  )
})
