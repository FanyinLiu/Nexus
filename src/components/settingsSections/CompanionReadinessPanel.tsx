import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  type NotificationWatcherDiagnosticStatus,
  type WebhookDiagnosticInfo,
} from '../../features/context/contextDiagnostics.ts'
import {
  buildCompanionHealthSummary,
  type CompanionHealthItem,
  type CompanionHealthItemId,
  type CompanionHealthStatus,
} from '../../features/onboarding/companionHealth.ts'
import {
  buildM1FirstRunAuditInput,
  buildM1FirstRunEvidenceHandoff,
  buildM1FirstRunEvidenceReport,
  resolveM1FirstRunActionMessageKeys,
  resolveM1FirstRunSettingsNavigationTargets,
} from '../../features/onboarding/firstRunAuditInput.ts'
import type { PetModelDefinition } from '../../features/pet'
import { saveTextFileWithFallback } from '../../lib/textFiles.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'
import type {
  AppSettings,
  ChatMessage,
  FocusState,
  PlatformProfile,
  ServiceConnectionResponse,
  UiLanguage,
  VoicePipelineState,
  VoiceState,
} from '../../types'
import {
  formatVoicePipelineStepLabel,
  formatVoiceStateLabel,
  type SettingsSectionOpenOptions,
  type SettingsSectionId,
} from '../settingsDrawerSupport'

type CompanionReadinessPanelProps = {
  active: boolean
  draft: AppSettings
  focusState?: FocusState
  petModel: PetModelDefinition | undefined
  platformProfile: PlatformProfile
  uiLanguage: UiLanguage
  voicePipeline: VoicePipelineState
  voiceState: VoiceState
  textConnectionResult?: ServiceConnectionResponse | null
  chatMessageSummaries?: Array<Pick<ChatMessage, 'createdAt' | 'role' | 'tone'>>
  onOpenSettingsSection?: (sectionId: SettingsSectionId, options?: SettingsSectionOpenOptions) => void
}

type PanelCopy = {
  title: string
  note: string
  status: Record<CompanionHealthStatus, string>
  labels: Record<CompanionHealthItemId, string>
  summaryReady: string
  summaryWarning: (ready: number, total: number) => string
  summaryBlocked: (blocked: number) => string
  copyM1Report: string
  copyM1ReportCopied: string
  copyM1ReportFailed: string
  saveM1Report: string
  saveM1ReportSaved: string
  saveM1ReportFailed: string
  copyCommand: string
  copyCommandCopied: string
  m1HandoffTitle: string
  m1HandoffNote: string
  m1RepairTitle: string
  m1RepairDone: string
  m1RepairPending: string
  openModelSettings: string
  m1StatusLabel: string
  m1StatusDetail: string
  m1OperatorLabel: (platform: string) => string
  m1OperatorDetail: string
}

const EN_COPY: PanelCopy = {
  title: 'Companion readiness',
  note: 'Standard companion mode checks the first usable path: chat, speech, desktop presence, gentle context, and privacy boundaries.',
  status: {
    ready: 'Ready',
    warning: 'Needs attention',
    blocked: 'Configure',
  },
  labels: {
    standard_companion: 'Standard companion',
    presence_state: 'Current state',
    text_model: 'Text model',
    microphone: 'Microphone',
    tts: 'TTS',
    live2d: 'Live2D presence',
    notification_permission: 'Notification permission',
    local_webhook: 'Local webhook',
    privacy_boundary: 'Privacy boundary',
  },
  summaryReady: 'All ready',
  summaryWarning: (ready, total) => `${ready} / ${total} ready`,
  summaryBlocked: (blocked) => `${blocked} blocked`,
  copyM1Report: 'Copy M1 evidence',
  copyM1ReportCopied: 'Copied',
  copyM1ReportFailed: 'Copy failed',
  saveM1Report: 'Save M1 file',
  saveM1ReportSaved: 'Saved',
  saveM1ReportFailed: 'Save failed',
  copyCommand: 'Copy command',
  copyCommandCopied: 'Copied',
  m1HandoffTitle: 'M1 evidence handoff',
  m1HandoffNote: 'Save the runtime report, record one real first reply on each platform, then run the status rollup.',
  m1RepairTitle: 'First-run repair path',
  m1RepairDone: 'No runtime repair action is pending. Keep the evidence file and platform records current.',
  m1RepairPending: 'Fix these items before treating M1 as ready.',
  openModelSettings: 'Open model settings',
  m1StatusLabel: 'M1 status rollup',
  m1StatusDetail: 'Runs against the saved runtime report and platform operator records.',
  m1OperatorLabel: (platform) => `${platform} operator record`,
  m1OperatorDetail: 'Replace placeholders only after a real first reply is observed on this platform.',
}

const ZH_COPY: PanelCopy = {
  title: '陪伴健康检查',
  note: '标准陪伴模式先检查第一条可用路径：能聊天、能说话、能在桌面自然存在，并且上下文和隐私边界清楚。',
  status: {
    ready: '可用',
    warning: '需关注',
    blocked: '需配置',
  },
  labels: {
    standard_companion: '标准陪伴',
    presence_state: '当前状态',
    text_model: '文本模型',
    microphone: '麦克风',
    tts: 'TTS 语音',
    live2d: 'Live2D 存在感',
    notification_permission: '通知权限',
    local_webhook: '本地 Webhook',
    privacy_boundary: '隐私边界',
  },
  summaryReady: '全部可用',
  summaryWarning: (ready, total) => `${ready} / ${total} 就绪`,
  summaryBlocked: (blocked) => `${blocked} 项需配置`,
  copyM1Report: '复制 M1 证据',
  copyM1ReportCopied: '已复制',
  copyM1ReportFailed: '复制失败',
  saveM1Report: '保存 M1 文件',
  saveM1ReportSaved: '已保存',
  saveM1ReportFailed: '保存失败',
  copyCommand: '复制命令',
  copyCommandCopied: '已复制',
  m1HandoffTitle: 'M1 证据交接',
  m1HandoffNote: '先保存运行时报告，再在各平台记录一次真实首轮回复，最后运行状态汇总。',
  m1RepairTitle: '首次启动修复路径',
  m1RepairDone: '当前没有运行时修复动作。保持证据文件和平台记录最新即可。',
  m1RepairPending: '在把 M1 视为 ready 前，先处理这些项目。',
  openModelSettings: '打开模型设置',
  m1StatusLabel: 'M1 状态汇总',
  m1StatusDetail: '读取已保存的运行时报告和平台 operator 记录。',
  m1OperatorLabel: (platform) => `${platform} operator 记录`,
  m1OperatorDetail: '只有在该平台真实观察到第一条回复后，才替换占位符并运行。',
}

function isChineseLocale(uiLanguage: UiLanguage) {
  return String(uiLanguage).startsWith('zh')
}

function getCopy(uiLanguage: UiLanguage) {
  return isChineseLocale(uiLanguage) ? ZH_COPY : EN_COPY
}

function statusClassName(status: CompanionHealthStatus) {
  return status === 'ready' ? 'is-ok' : 'is-warning'
}

function itemClassName(status: CompanionHealthStatus) {
  return status === 'ready' ? 'is-ok' : 'is-warning'
}

function getPresenceStateLabel(item: CompanionHealthItem, uiLanguage: UiLanguage) {
  const state = String(item.evidence.presenceState ?? 'resting')
  const zh = isChineseLocale(uiLanguage)
  const labels = zh
    ? {
        resting: '休息',
        listening: '聆听',
        thinking: '思考',
        speaking: '说话',
        away: '离开',
        quiet: '安静',
      }
    : {
        resting: 'Resting',
        listening: 'Listening',
        thinking: 'Thinking',
        speaking: 'Speaking',
        away: 'Away',
        quiet: 'Quiet',
      }
  return labels[state as keyof typeof labels] ?? labels.resting
}

function formatItemDetail(
  item: CompanionHealthItem,
  uiLanguage: UiLanguage,
  voiceState: VoiceState,
  voicePipeline: VoicePipelineState,
) {
  if (item.id !== 'presence_state') return item.detail

  const stateLabel = getPresenceStateLabel(item, uiLanguage)
  const voiceLabel = formatVoiceStateLabel(voiceState, uiLanguage)
  const stepLabel = formatVoicePipelineStepLabel(voicePipeline.step, uiLanguage)
  const quietReason = typeof item.evidence.quietReason === 'string' && item.evidence.quietReason.trim()
    ? item.evidence.quietReason.trim()
    : ''
  const detail = quietReason || voicePipeline.detail.trim()

  return detail
    ? `${stateLabel} · ${voiceLabel} / ${stepLabel} · ${detail}`
    : `${stateLabel} · ${voiceLabel} / ${stepLabel}`
}

function getQuietReason(voicePipeline: VoicePipelineState) {
  if (voicePipeline.step === 'blocked_busy' || voicePipeline.step === 'blocked_wake_word') {
    return voicePipeline.detail || voicePipeline.step
  }
  return null
}

export const CompanionReadinessPanel = memo(function CompanionReadinessPanel({
  active,
  draft,
  focusState,
  petModel,
  platformProfile,
  uiLanguage,
  voicePipeline,
  voiceState,
  textConnectionResult = null,
  chatMessageSummaries = [],
  onOpenSettingsSection,
}: CompanionReadinessPanelProps) {
  const [watcherStatus, setWatcherStatus] = useState<NotificationWatcherDiagnosticStatus | null>(null)
  const [webhookInfo, setWebhookInfo] = useState<WebhookDiagnosticInfo | null>(null)
  const [m1CopyState, setM1CopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [m1SaveState, setM1SaveState] = useState<'idle' | 'saved' | 'failed'>('idle')
  const [copiedCommand, setCopiedCommand] = useState('')

  useEffect(() => {
    if (!active || typeof window === 'undefined') return undefined

    let cancelled = false
    const bridge = window.desktopPet
    const loadDiagnostics = async () => {
      const settled = await Promise.allSettled([
        bridge?.notificationWatcherStatus?.() ?? Promise.resolve(null),
        bridge?.getNotificationWebhookInfo?.() ?? Promise.resolve(null),
      ])
      if (cancelled) return

      const [watcher, webhook] = settled
      setWatcherStatus(watcher.status === 'fulfilled' ? watcher.value : null)
      setWebhookInfo(webhook.status === 'fulfilled' ? webhook.value : null)
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
    draft.autonomyNotificationsEnabled,
    draft.macosMessageWatcherEnabled,
    voicePipeline.updatedAt,
  ])

  const companionHealthInput = useMemo(() => ({
    focusState,
    platformProfile,
    petModel,
    quietReason: getQuietReason(voicePipeline),
    settings: draft,
    voicePipeline,
    voiceState,
    watcherStatus,
    webhookInfo,
  }), [
    draft,
    focusState,
    petModel,
    platformProfile,
    voicePipeline,
    voiceState,
    watcherStatus,
    webhookInfo,
  ])
  const summary = useMemo(
    () => buildCompanionHealthSummary(companionHealthInput),
    [companionHealthInput],
  )
  const m1Report = useMemo(() => buildM1FirstRunEvidenceReport(
    buildM1FirstRunAuditInput({
      companionHealth: companionHealthInput,
      textConnectionResult,
      chatMessages: chatMessageSummaries,
    }),
    new Date().toISOString(),
    'runtime-console-summary',
  ), [
    chatMessageSummaries,
    companionHealthInput,
    textConnectionResult,
  ])
  const m1Handoff = useMemo(() => buildM1FirstRunEvidenceHandoff(m1Report), [m1Report])
  const m1ActionMessageKeys = useMemo(
    () => resolveM1FirstRunActionMessageKeys(m1Report, 5),
    [m1Report],
  )
  const m1NavigationTargets = useMemo(
    () => resolveM1FirstRunSettingsNavigationTargets(m1Report),
    [m1Report],
  )
  const canOpenModelSettings = Boolean(onOpenSettingsSection && m1NavigationTargets.includes('model'))
  const copy = getCopy(uiLanguage)
  const ti = useCallback(
    (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key),
    [uiLanguage],
  )
  const badgeLabel = summary.status === 'blocked'
    ? copy.summaryBlocked(summary.blockedCount)
    : summary.status === 'warning'
      ? copy.summaryWarning(summary.readyCount, summary.totalCount)
      : copy.summaryReady
  const m1CopyLabel = m1CopyState === 'copied'
    ? copy.copyM1ReportCopied
    : m1CopyState === 'failed'
      ? copy.copyM1ReportFailed
      : copy.copyM1Report
  const m1SaveLabel = m1SaveState === 'saved'
    ? copy.saveM1ReportSaved
    : m1SaveState === 'failed'
      ? copy.saveM1ReportFailed
      : copy.saveM1Report

  const handleCopyM1Report = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      setM1CopyState('failed')
      return
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(m1Report, null, 2))
      setM1CopyState('copied')
    } catch {
      setM1CopyState('failed')
    }

    window.setTimeout(() => {
      setM1CopyState('idle')
    }, 1800)
  }, [m1Report])

  const handleSaveM1Report = useCallback(async () => {
    try {
      const result = await saveTextFileWithFallback({
        title: copy.saveM1Report,
        defaultFileName: 'm1-first-run-audit.json',
        content: `${JSON.stringify(m1Report, null, 2)}\n`,
        filters: [{ name: 'JSON', extensions: ['json'] }],
      })
      setM1SaveState(result.canceled ? 'failed' : 'saved')
    } catch {
      setM1SaveState('failed')
    }

    window.setTimeout(() => {
      setM1SaveState('idle')
    }, 1800)
  }, [copy.saveM1Report, m1Report])

  const copyCommand = useCallback(async (command: string) => {
    if (!navigator.clipboard?.writeText) return
    await navigator.clipboard.writeText(command)
    setCopiedCommand(command)
    window.setTimeout(() => {
      setCopiedCommand((current) => (current === command ? '' : current))
    }, 1800)
  }, [])

  return (
    <section className="settings-startup-status settings-companion-readiness">
      <header className="settings-startup-status__header">
        <div>
          <h4>{copy.title}</h4>
          <p>{copy.note}</p>
        </div>
        <div className="settings-context-diagnostics__actions">
          <span className={`settings-startup-status__badge ${statusClassName(summary.status)}`}>
            {badgeLabel}
          </span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void handleCopyM1Report()}
          >
            {m1CopyLabel}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void handleSaveM1Report()}
          >
            {m1SaveLabel}
          </button>
        </div>
      </header>
      <div className="settings-startup-status__items">
        {summary.items.map((item) => (
          <article
            key={item.id}
            className={`settings-startup-status__item ${itemClassName(item.status)}`}
          >
            <div className="settings-startup-status__item-head">
              <span className="settings-startup-status__dot" aria-hidden="true" />
              <strong>{copy.labels[item.id]}</strong>
              <span className="settings-startup-status__item-badge">
                {copy.status[item.status]}
              </span>
            </div>
            <p>{formatItemDetail(item, uiLanguage, voiceState, voicePipeline)}</p>
          </article>
        ))}
        <article className={`settings-startup-status__item ${m1ActionMessageKeys.length ? 'is-warning' : 'is-ok'}`}>
          <div className="settings-startup-status__item-head">
            <span className="settings-startup-status__dot" aria-hidden="true" />
            <strong>{copy.m1RepairTitle}</strong>
            <span className="settings-startup-status__item-badge">
              {m1ActionMessageKeys.length ? copy.status.warning : copy.status.ready}
            </span>
          </div>
          <p>{m1ActionMessageKeys.length ? copy.m1RepairPending : copy.m1RepairDone}</p>
          {m1ActionMessageKeys.length ? (
            <>
              <ul className="onboarding-first-run__repair-list">
                {m1ActionMessageKeys.map((key) => (
                  <li key={key} className="onboarding-first-run__repair-item">
                    {ti(key)}
                  </li>
                ))}
              </ul>
              {canOpenModelSettings ? (
                <div className="settings-companion-readiness__repair-actions">
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => onOpenSettingsSection?.('model', { entryReason: 'm1-first-run-repair' })}
                  >
                    {copy.openModelSettings}
                  </button>
                </div>
              ) : null}
            </>
          ) : null}
        </article>
      </div>
      <div className="settings-context-diagnostics__commands settings-companion-readiness__handoff">
        <div className="settings-context-diagnostics__command">
          <div className="settings-context-diagnostics__command-head">
            <strong>{copy.m1HandoffTitle}</strong>
            <span>{copy.m1HandoffNote}</span>
          </div>
          <code>{m1Handoff.reportFile}</code>
        </div>
        {m1Handoff.commands.map((command) => (
          <div key={command.id} className="settings-context-diagnostics__command">
            <div className="settings-context-diagnostics__command-head">
              <strong>
                {command.platform
                  ? copy.m1OperatorLabel(command.platform)
                  : copy.m1StatusLabel}
              </strong>
              <span>{command.platform ? copy.m1OperatorDetail : copy.m1StatusDetail}</span>
            </div>
            <code>{command.command}</code>
            <button
              type="button"
              className="ghost-button"
              onClick={() => void copyCommand(command.command)}
            >
              {copiedCommand === command.command
                ? copy.copyCommandCopied
                : copy.copyCommand}
            </button>
          </div>
        ))}
      </div>
    </section>
  )
})
