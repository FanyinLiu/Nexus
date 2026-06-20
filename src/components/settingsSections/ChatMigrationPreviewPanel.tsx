import { memo, useCallback, useMemo, useState } from 'react'
import {
  buildChatMigrationBackupEnvelope,
  buildChatMigrationBackupFileName,
  loadChatMigrationComparisonSource,
  buildChatMigrationPreviewSummary,
  getChatLocalDataRuntimeMirrorConsent,
  isChatLocalDataRuntimeMirrorFeatureEnabled,
  loadChatStorageMigrationDryRun,
  loadChatStorageMigrationPackage,
  setChatLocalDataRuntimeMirrorConsent,
} from '../../lib/storage'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'
import type { ConfirmFn } from '../useConfirm'

type ChatMigrationPreviewPanelProps = {
  uiLanguage: UiLanguage
  confirm: ConfirmFn
}

type StatusMessage = {
  ok: boolean
  message: string
} | null

type MigrationStatusResult = Awaited<ReturnType<NonNullable<Window['desktopPet']>['localDataChatMigrationStatus']>>
type MigrationComparisonResult = Awaited<ReturnType<NonNullable<Window['desktopPet']>['localDataCompareChatSessions']>>

type MigrationStatusState = {
  loading: boolean
  result: MigrationStatusResult | null
}

type MigrationComparisonState = {
  loading: boolean
  result: MigrationComparisonResult | null
}

function createMigrationStatusError(errorMessage: string): MigrationStatusResult {
  return {
    ok: false,
    targetDomainId: 'chat-sessions',
    schemaVersion: 0,
    recordCount: 0,
    messageCount: 0,
    recordPayloadsIncluded: false,
    lastAuditRecordId: null,
    lastAuditAction: null,
    lastAuditAt: null,
    errorKind: 'local-data-chat-migration-status-unavailable',
    errorMessage,
  }
}

function createMigrationComparisonError(errorMessage: string): MigrationComparisonResult {
  return {
    ok: false,
    targetDomainId: 'chat-sessions',
    schemaVersion: 0,
    compared: false,
    recordPayloadsIncluded: false,
    status: 'blocked',
    sourceSessionCount: 0,
    sqliteSessionCount: 0,
    matchedRecordCount: 0,
    metadataAlignedRecordCount: 0,
    metadataMismatchCount: 0,
    missingSqliteRecordCount: 0,
    extraSqliteRecordCount: 0,
    malformedSqliteRecordCount: 0,
    sourceMessageCount: 0,
    sqliteMessageCount: 0,
    messageCountDelta: 0,
    sourcePayloadBytes: 0,
    sqlitePayloadBytes: 0,
    issueCodes: [],
    auditRecordId: null,
    errorKind: 'local-data-chat-comparison-unavailable',
    errorMessage,
  }
}

function formatCount(value: number, uiLanguage: UiLanguage): string {
  return value.toLocaleString(uiLanguage)
}

function formatSignedCount(value: number, uiLanguage: UiLanguage): string {
  if (value === 0) return '0'
  const prefix = value > 0 ? '+' : '-'
  return `${prefix}${formatCount(Math.abs(value), uiLanguage)}`
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

function formatDate(value: string | null, uiLanguage: UiLanguage): string {
  if (!value) return 'N/A'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return 'N/A'
  return new Intl.DateTimeFormat(uiLanguage, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}

function downloadJsonFile(fileName: string, value: unknown): void {
  const blob = new Blob([`${JSON.stringify(value, null, 2)}\n`], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export const ChatMigrationPreviewPanel = memo(function ChatMigrationPreviewPanel({
  uiLanguage,
  confirm,
}: ChatMigrationPreviewPanelProps) {
  const ti = useCallback((
    key: Parameters<typeof pickTranslatedUiText>[1],
    params?: Parameters<typeof pickTranslatedUiText>[2],
  ) => pickTranslatedUiText(uiLanguage, key, params), [uiLanguage])
  const [report, setReport] = useState(() => loadChatStorageMigrationDryRun())
  const [confirmed, setConfirmed] = useState(false)
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false)
  const [exportingBackup, setExportingBackup] = useState(false)
  const [applying, setApplying] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [runtimeMirrorEnabled, setRuntimeMirrorEnabled] = useState(() => getChatLocalDataRuntimeMirrorConsent())
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatusState>({
    loading: false,
    result: null,
  })
  const [comparison, setComparison] = useState<MigrationComparisonState>({
    loading: false,
    result: null,
  })
  const [status, setStatus] = useState<StatusMessage>(null)
  const summary = useMemo(() => buildChatMigrationPreviewSummary(report), [report])
  const runtimeMirrorFeatureEnabled = isChatLocalDataRuntimeMirrorFeatureEnabled()
  const runtimeMirrorActive = runtimeMirrorFeatureEnabled && runtimeMirrorEnabled

  const refresh = useCallback(() => {
    setReport(loadChatStorageMigrationDryRun())
    setStatus(null)
    setMigrationStatus({ loading: false, result: null })
    setComparison({ loading: false, result: null })
    setConfirmed(false)
    setRollbackConfirmed(false)
  }, [])

  const loadMigrationStatus = useCallback(async () => {
    const readMigrationStatus = window.desktopPet?.localDataChatMigrationStatus
    if (typeof readMigrationStatus !== 'function') {
      setMigrationStatus({
        loading: false,
        result: createMigrationStatusError(ti('settings.history.migration.bridge_unavailable')),
      })
      return
    }

    setMigrationStatus({ loading: true, result: null })
    try {
      const result = await readMigrationStatus()
      setMigrationStatus({ loading: false, result })
    } catch (error) {
      setMigrationStatus({
        loading: false,
        result: createMigrationStatusError(error instanceof Error ? error.message : String(error)),
      })
    }
  }, [ti])

  const formatLocalStatusAction = useCallback((action: MigrationStatusResult['lastAuditAction']): string => {
    switch (action) {
      case 'chat-sessions-migration-applied':
        return ti('settings.history.migration.local_status_action_applied')
      case 'chat-sessions-migration-rolled-back':
        return ti('settings.history.migration.local_status_action_rolled_back')
      default:
        return ti('settings.history.migration.local_status_action_none')
    }
  }, [ti])

  const formatComparisonStatus = useCallback((status: MigrationComparisonResult['status']): string => {
    switch (status) {
      case 'aligned':
        return ti('settings.history.migration.compare_status_aligned')
      case 'differences':
        return ti('settings.history.migration.compare_status_differences')
      case 'empty':
        return ti('settings.history.migration.compare_status_empty')
      case 'blocked':
      default:
        return ti('settings.history.migration.compare_status_blocked')
    }
  }, [ti])

  const handleCompare = useCallback(async () => {
    if (comparison.loading) return
    const accepted = await confirm({
      message: ti('settings.history.migration.compare_confirm'),
      tone: 'danger',
    })
    if (!accepted) return

    const sourceResult = loadChatMigrationComparisonSource()
    if (!sourceResult.ok) {
      setStatus({
        ok: false,
        message: ti('settings.history.migration.compare_blocked'),
      })
      setReport(sourceResult.report)
      return
    }

    const compareChatSessions = window.desktopPet?.localDataCompareChatSessions
    if (typeof compareChatSessions !== 'function') {
      setComparison({
        loading: false,
        result: createMigrationComparisonError(ti('settings.history.migration.bridge_unavailable')),
      })
      return
    }

    setComparison({ loading: true, result: null })
    setStatus(null)
    try {
      const result = await compareChatSessions({
        confirmed: true,
        source: sourceResult.source,
      })
      setComparison({ loading: false, result })
      if (result.ok) {
        setStatus({
          ok: true,
          message: ti('settings.history.migration.compare_success', {
            status: formatComparisonStatus(result.status),
            auditId: result.auditRecordId ?? 'N/A',
          }),
        })
      } else {
        setStatus({
          ok: false,
          message: ti('settings.history.migration.compare_error', {
            error: result.errorMessage || result.errorKind || 'unknown',
          }),
        })
      }
    } catch (error) {
      setComparison({
        loading: false,
        result: createMigrationComparisonError(error instanceof Error ? error.message : String(error)),
      })
      setStatus({
        ok: false,
        message: ti('settings.history.migration.compare_error', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    }
  }, [comparison.loading, confirm, formatComparisonStatus, ti])

  const handleExportBackup = useCallback(async () => {
    if (!summary.canExportBackup || exportingBackup) return
    const accepted = await confirm({
      message: ti('settings.history.migration.backup_confirm'),
      tone: 'danger',
    })
    if (!accepted) return

    const packageResult = loadChatStorageMigrationPackage()
    if (!packageResult.ok) {
      setStatus({
        ok: false,
        message: ti('settings.history.migration.backup_blocked'),
      })
      setReport(packageResult.report)
      return
    }

    setExportingBackup(true)
    setStatus(null)
    try {
      const envelope = buildChatMigrationBackupEnvelope(packageResult.migrationPackage)
      downloadJsonFile(buildChatMigrationBackupFileName(envelope.exportedAt), envelope)
      setStatus({
        ok: true,
        message: ti('settings.history.migration.backup_success', {
          sessions: formatCount(envelope.totals.sessionCount, uiLanguage),
          messages: formatCount(envelope.totals.messageCount, uiLanguage),
        }),
      })
    } catch (error) {
      setStatus({
        ok: false,
        message: ti('settings.history.migration.apply_error', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setExportingBackup(false)
    }
  }, [confirm, exportingBackup, summary.canExportBackup, ti, uiLanguage])

  const handleApply = useCallback(async () => {
    if (!summary.canApply || applying) return
    const accepted = await confirm({
      message: ti('settings.history.migration.apply_confirm'),
      tone: 'danger',
    })
    if (!accepted) return

    const packageResult = loadChatStorageMigrationPackage()
    if (!packageResult.ok) {
      setStatus({
        ok: false,
        message: ti('settings.history.migration.package_blocked'),
      })
      setReport(packageResult.report)
      setConfirmed(false)
      return
    }

    const applyMigration = window.desktopPet?.localDataApplyChatMigration
    if (typeof applyMigration !== 'function') {
      setStatus({
        ok: false,
        message: ti('settings.history.migration.bridge_unavailable'),
      })
      return
    }

    setApplying(true)
    setStatus(null)
    try {
      const result = await applyMigration({
        confirmed: true,
        migrationPackage: packageResult.migrationPackage,
      })
      if (result.ok) {
        setStatus({
          ok: true,
          message: ti('settings.history.migration.apply_success', {
            sessions: formatCount(result.sessionCount ?? summary.sessionCount, uiLanguage),
            messages: formatCount(result.messageCount ?? summary.messageCount, uiLanguage),
            auditId: result.auditRecordId ?? 'N/A',
          }),
        })
        void loadMigrationStatus()
      } else {
        setStatus({
          ok: false,
          message: ti('settings.history.migration.apply_error', {
            error: result.errorMessage || result.errorKind || 'unknown',
          }),
        })
      }
    } catch (error) {
      setStatus({
        ok: false,
        message: ti('settings.history.migration.apply_error', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setApplying(false)
      setConfirmed(false)
      setReport(loadChatStorageMigrationDryRun())
    }
  }, [applying, confirm, loadMigrationStatus, summary, ti, uiLanguage])

  const handleRollback = useCallback(async () => {
    if (!rollbackConfirmed || rollingBack) return
    const accepted = await confirm({
      message: ti('settings.history.migration.rollback_confirm'),
      tone: 'danger',
    })
    if (!accepted) return

    const rollbackMigration = window.desktopPet?.localDataRollbackChatMigration
    if (typeof rollbackMigration !== 'function') {
      setStatus({
        ok: false,
        message: ti('settings.history.migration.bridge_unavailable'),
      })
      return
    }

    setRollingBack(true)
    setStatus(null)
    try {
      const result = await rollbackMigration({ confirmed: true })
      if (result.ok) {
        setStatus({
          ok: true,
          message: ti('settings.history.migration.rollback_success', {
            records: formatCount(result.recordsDeleted, uiLanguage),
            auditId: result.auditRecordId ?? 'N/A',
          }),
        })
        void loadMigrationStatus()
      } else {
        setStatus({
          ok: false,
          message: ti('settings.history.migration.rollback_error', {
            error: result.errorMessage || result.errorKind || 'unknown',
          }),
        })
      }
    } catch (error) {
      setStatus({
        ok: false,
        message: ti('settings.history.migration.rollback_error', {
          error: error instanceof Error ? error.message : String(error),
        }),
      })
    } finally {
      setRollingBack(false)
      setRollbackConfirmed(false)
      setReport(loadChatStorageMigrationDryRun())
    }
  }, [confirm, loadMigrationStatus, rollbackConfirmed, rollingBack, ti, uiLanguage])

  const handleRuntimeMirrorToggle = useCallback(async (enabled: boolean) => {
    if (!enabled) {
      setChatLocalDataRuntimeMirrorConsent(false)
      setRuntimeMirrorEnabled(false)
      setStatus({
        ok: true,
        message: ti('settings.history.migration.runtime_mirror_disabled_success'),
      })
      return
    }

    const accepted = await confirm({
      message: ti('settings.history.migration.runtime_mirror_enable_confirm'),
      tone: 'danger',
    })
    if (!accepted) return
    setChatLocalDataRuntimeMirrorConsent(true)
    setRuntimeMirrorEnabled(true)
    setStatus({
      ok: true,
      message: ti('settings.history.migration.runtime_mirror_enabled_success'),
    })
  }, [confirm, ti])

  if (!summary.enabled) return null

  const applyDisabled = applying || rollingBack || exportingBackup || !summary.canApply || !confirmed
  const backupDisabled = applying || rollingBack || exportingBackup || !summary.canExportBackup
  const rollbackDisabled = applying || rollingBack || exportingBackup || !rollbackConfirmed
  const localStatusResult = migrationStatus.result
  const comparisonResult = comparison.result
  const compareDisabled = applying || rollingBack || exportingBackup || comparison.loading

  return (
    <div className="settings-mini-group settings-chat-migration-preview">
      <div className="settings-chat-migration-preview__header">
        <div>
          <h5>{ti('settings.history.migration.title')}</h5>
          <p>{ti('settings.history.migration.note')}</p>
        </div>
        <span className={`settings-chat-migration-preview__badge is-${summary.tone}`}>
          {ti(`settings.history.migration.status.${summary.status}`)}
        </span>
      </div>

      <div className="settings-chat-migration-preview__metrics" aria-label={ti('settings.history.migration.metrics_label')}>
        <div className="settings-chat-migration-preview__metric">
          <span>{ti('settings.history.migration.sessions')}</span>
          <strong>{formatCount(summary.sessionCount, uiLanguage)}</strong>
        </div>
        <div className="settings-chat-migration-preview__metric">
          <span>{ti('settings.history.migration.messages')}</span>
          <strong>{formatCount(summary.messageCount, uiLanguage)}</strong>
        </div>
        <div className="settings-chat-migration-preview__metric">
          <span>{ti('settings.history.migration.source_bytes')}</span>
          <strong>{formatBytes(summary.sourceBytes)}</strong>
        </div>
      </div>

      <dl className="settings-chat-migration-preview__detail-grid">
        <div>
          <dt>{ti('settings.history.migration.role_counts')}</dt>
          <dd>
            {ti('settings.history.migration.role_counts_value', {
              users: formatCount(summary.userMessageCount, uiLanguage),
              assistants: formatCount(summary.assistantMessageCount, uiLanguage),
              systems: formatCount(summary.systemMessageCount, uiLanguage),
            })}
          </dd>
        </div>
        <div>
          <dt>{ti('settings.history.migration.extra_counts')}</dt>
          <dd>
            {ti('settings.history.migration.extra_counts_value', {
              toolResults: formatCount(summary.toolResultMessageCount, uiLanguage),
              reasoning: formatCount(summary.reasoningMessageCount, uiLanguage),
            })}
          </dd>
        </div>
        <div>
          <dt>{ti('settings.history.migration.date_range')}</dt>
          <dd>
            {summary.firstMessageAt || summary.lastMessageAt
              ? `${formatDate(summary.firstMessageAt, uiLanguage)} - ${formatDate(summary.lastMessageAt, uiLanguage)}`
              : ti('settings.history.migration.date_range_empty')}
          </dd>
        </div>
        <div>
          <dt>{ti('settings.history.migration.source')}</dt>
          <dd>
            {summary.sessionsKeyPresent
              ? ti('settings.history.migration.source_sessions_present')
              : ti('settings.history.migration.source_sessions_missing')}
            {' · '}
            {summary.legacyFlatChatKeyPresent
              ? ti('settings.history.migration.source_legacy_present')
              : ti('settings.history.migration.source_legacy_missing')}
          </dd>
        </div>
      </dl>

      <p className="settings-mini-group__note">
        {summary.legacyFlatChatUsed
          ? ti('settings.history.migration.legacy_used')
          : summary.legacyFlatChatIgnoredBecauseSessionsExist
            ? ti('settings.history.migration.legacy_ignored')
            : ti('settings.history.migration.legacy_not_used')}
      </p>

      <div className="settings-chat-migration-preview__issues">
        <strong>{ti('settings.history.migration.issues_title')}</strong>
        {summary.issues.length === 0 ? (
          <span>{ti('settings.history.migration.issues_empty')}</span>
        ) : (
          <ul>
            {summary.issues.map((issue) => (
              <li key={`${issue.code}-${issue.severity}`}>
                <code>{issue.code}</code>
                <span>{issue.severity}{issue.count != null ? ` / ${formatCount(issue.count, uiLanguage)}` : ''}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="settings-mini-group__note">
        {ti('settings.history.migration.safety_note')}
      </p>

      <div className="settings-chat-migration-preview__backup">
        <strong>{ti('settings.history.migration.backup_title')}</strong>
        <p>{ti('settings.history.migration.backup_note')}</p>
        <button
          type="button"
          className="ghost-button"
          onClick={() => void handleExportBackup()}
          disabled={backupDisabled}
        >
          {exportingBackup ? ti('settings.history.migration.exporting_backup') : ti('settings.history.migration.export_backup')}
        </button>
      </div>

      <label className="settings-chat-migration-preview__confirm">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(event) => setConfirmed(event.currentTarget.checked)}
          disabled={!summary.canApply || applying}
        />
        <span>{ti('settings.history.migration.confirm_label')}</span>
      </label>

      <div className="settings-action-row settings-chat-migration-preview__actions">
        <button type="button" className="ghost-button" onClick={refresh} disabled={applying}>
          {ti('settings.history.migration.refresh')}
        </button>
        <button
          type="button"
          className="settings-danger-button"
          onClick={() => void handleApply()}
          disabled={applyDisabled}
        >
          {applying ? ti('settings.history.migration.applying') : ti('settings.history.migration.apply')}
        </button>
      </div>

      <div className="settings-chat-migration-preview__local-status">
        <div className="settings-chat-migration-preview__local-status-header">
          <div>
            <strong>{ti('settings.history.migration.local_status_title')}</strong>
            <p>{ti('settings.history.migration.local_status_note')}</p>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void loadMigrationStatus()}
            disabled={applying || rollingBack || exportingBackup || migrationStatus.loading}
          >
            {migrationStatus.loading
              ? ti('settings.history.migration.refreshing_local_status')
              : ti('settings.history.migration.refresh_local_status')}
          </button>
        </div>

        {localStatusResult ? (
          localStatusResult.ok ? (
            <dl className="settings-chat-migration-preview__local-status-grid">
              <div>
                <dt>{ti('settings.history.migration.local_status_records')}</dt>
                <dd>{formatCount(localStatusResult.recordCount, uiLanguage)}</dd>
              </div>
              <div>
                <dt>{ti('settings.history.migration.local_status_messages')}</dt>
                <dd>{formatCount(localStatusResult.messageCount, uiLanguage)}</dd>
              </div>
              <div>
                <dt>{ti('settings.history.migration.local_status_last_action')}</dt>
                <dd>{formatLocalStatusAction(localStatusResult.lastAuditAction)}</dd>
              </div>
              <div>
                <dt>{ti('settings.history.migration.local_status_last_at')}</dt>
                <dd>{formatDate(localStatusResult.lastAuditAt, uiLanguage)}</dd>
              </div>
              <div>
                <dt>{ti('settings.history.migration.local_status_last_audit')}</dt>
                <dd><code>{localStatusResult.lastAuditRecordId ?? 'N/A'}</code></dd>
              </div>
              <div>
                <dt>{ti('settings.history.migration.local_status_payloads')}</dt>
                <dd>{ti('settings.history.migration.local_status_payloads_no')}</dd>
              </div>
            </dl>
          ) : (
            <div className="settings-test-result is-error" role="alert" aria-live="assertive" aria-atomic="true">
              {ti('settings.history.migration.local_status_error', {
                error: localStatusResult.errorMessage || localStatusResult.errorKind || 'unknown',
              })}
            </div>
          )
        ) : (
          <p className="settings-mini-group__note">
            {ti('settings.history.migration.local_status_empty')}
          </p>
        )}
      </div>

      <div className="settings-chat-migration-preview__comparison">
        <div className="settings-chat-migration-preview__local-status-header">
          <div>
            <strong>{ti('settings.history.migration.compare_title')}</strong>
            <p>{ti('settings.history.migration.compare_note')}</p>
          </div>
          <button
            type="button"
            className="ghost-button"
            onClick={() => void handleCompare()}
            disabled={compareDisabled}
          >
            {comparison.loading
              ? ti('settings.history.migration.compare_running')
              : ti('settings.history.migration.compare')}
          </button>
        </div>

        {comparisonResult ? (
          comparisonResult.ok ? (
            <dl className="settings-chat-migration-preview__local-status-grid">
              <div>
                <dt>{ti('settings.history.migration.compare_status')}</dt>
                <dd>{formatComparisonStatus(comparisonResult.status)}</dd>
              </div>
              <div>
                <dt>{ti('settings.history.migration.compare_source_sessions')}</dt>
                <dd>{formatCount(comparisonResult.sourceSessionCount, uiLanguage)}</dd>
              </div>
              <div>
                <dt>{ti('settings.history.migration.compare_sqlite_sessions')}</dt>
                <dd>{formatCount(comparisonResult.sqliteSessionCount, uiLanguage)}</dd>
              </div>
              <div>
                <dt>{ti('settings.history.migration.compare_matched')}</dt>
                <dd>{formatCount(comparisonResult.matchedRecordCount, uiLanguage)}</dd>
              </div>
              <div>
                <dt>{ti('settings.history.migration.compare_differences')}</dt>
                <dd>
                  {formatCount(
                    comparisonResult.missingSqliteRecordCount
                      + comparisonResult.extraSqliteRecordCount
                      + comparisonResult.metadataMismatchCount
                      + comparisonResult.malformedSqliteRecordCount,
                    uiLanguage,
                  )}
                </dd>
              </div>
              <div>
                <dt>{ti('settings.history.migration.compare_message_delta')}</dt>
                <dd>{formatSignedCount(comparisonResult.messageCountDelta, uiLanguage)}</dd>
              </div>
              <div>
                <dt>{ti('settings.history.migration.compare_payload_bytes')}</dt>
                <dd>
                  {formatBytes(comparisonResult.sourcePayloadBytes)}
                  {' / '}
                  {formatBytes(comparisonResult.sqlitePayloadBytes)}
                </dd>
              </div>
              <div>
                <dt>{ti('settings.history.migration.local_status_payloads')}</dt>
                <dd>{ti('settings.history.migration.local_status_payloads_no')}</dd>
              </div>
              <div>
                <dt>{ti('settings.history.migration.local_status_last_audit')}</dt>
                <dd><code>{comparisonResult.auditRecordId ?? 'N/A'}</code></dd>
              </div>
            </dl>
          ) : (
            <div className="settings-test-result is-error" role="alert" aria-live="assertive" aria-atomic="true">
              {ti('settings.history.migration.compare_error', {
                error: comparisonResult.errorMessage || comparisonResult.errorKind || 'unknown',
              })}
            </div>
          )
        ) : (
          <p className="settings-mini-group__note">
            {ti('settings.history.migration.compare_empty')}
          </p>
        )}
      </div>

      <div className="settings-chat-migration-preview__runtime-mirror">
        <div>
          <strong>{ti('settings.history.migration.runtime_mirror_title')}</strong>
          <p>
            {runtimeMirrorFeatureEnabled
              ? ti('settings.history.migration.runtime_mirror_note')
              : ti('settings.history.migration.runtime_mirror_unavailable')}
          </p>
        </div>
        <label className="settings-chat-migration-preview__confirm">
          <input
            type="checkbox"
            checked={runtimeMirrorActive}
            onChange={(event) => void handleRuntimeMirrorToggle(event.currentTarget.checked)}
            disabled={!runtimeMirrorFeatureEnabled || applying || rollingBack || exportingBackup}
          />
          <span>
            {runtimeMirrorActive
              ? ti('settings.history.migration.runtime_mirror_enabled_label')
              : ti('settings.history.migration.runtime_mirror_disabled_label')}
          </span>
        </label>
      </div>

      <div className="settings-chat-migration-preview__rollback">
        <div>
          <strong>{ti('settings.history.migration.rollback_title')}</strong>
          <p>{ti('settings.history.migration.rollback_note')}</p>
        </div>
        <label className="settings-chat-migration-preview__confirm">
          <input
            type="checkbox"
            checked={rollbackConfirmed}
            onChange={(event) => setRollbackConfirmed(event.currentTarget.checked)}
            disabled={applying || rollingBack || exportingBackup}
          />
          <span>{ti('settings.history.migration.rollback_confirm_label')}</span>
        </label>
        <button
          type="button"
          className="settings-danger-button"
          onClick={() => void handleRollback()}
          disabled={rollbackDisabled}
        >
          {rollingBack ? ti('settings.history.migration.rolling_back') : ti('settings.history.migration.rollback')}
        </button>
      </div>

      {!summary.canApply ? (
        <p className="settings-mini-group__note">
          {ti('settings.history.migration.no_action')}
        </p>
      ) : null}

      {status ? (
        <div
          className={status.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'}
          role={status.ok ? 'status' : 'alert'}
          aria-live={status.ok ? 'polite' : 'assertive'}
          aria-atomic="true"
        >
          {status.message}
        </div>
      ) : null}
    </div>
  )
})
