import { memo, useCallback, useMemo, useState } from 'react'
import {
  buildMemoryLocalDataMigrationPackage,
  getMemoryLocalDataAuthorityConsent,
  isMemoryLocalDataMigrationFeatureEnabled,
  isMemoryLocalDataMigrationUiEnabled,
  loadMemoryStorageMigrationDryRun,
  setMemoryLocalDataAuthorityConsent,
} from '../../lib/storage'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'
import type { ConfirmFn } from '../useConfirm.ts'

type StatusMessage = { ok: boolean; message: string } | null
type MigrationStatusResult = Awaited<ReturnType<NonNullable<Window['desktopPet']>['localDataMemoryMigrationStatus']>>

function formatError(error: unknown): string {
  return getRedactedLogErrorMessage(error).trim() || 'unknown'
}

function formatCount(value: number, language: UiLanguage): string {
  return value.toLocaleString(language)
}

export const MemoryMigrationPreviewPanel = memo(function MemoryMigrationPreviewPanel({
  uiLanguage,
  confirm,
}: {
  uiLanguage: UiLanguage
  confirm: ConfirmFn
}) {
  const ti = useCallback((key: Parameters<typeof pickTranslatedUiText>[1], params?: Parameters<typeof pickTranslatedUiText>[2]) => (
    pickTranslatedUiText(uiLanguage, key, params)
  ), [uiLanguage])
  const uiEnabled = isMemoryLocalDataMigrationUiEnabled()
  const migrationEnabled = isMemoryLocalDataMigrationFeatureEnabled()
  const [report, setReport] = useState(() => loadMemoryStorageMigrationDryRun())
  const [statusResult, setStatusResult] = useState<MigrationStatusResult | null>(null)
  const [authorityEnabled, setAuthorityEnabled] = useState(() => getMemoryLocalDataAuthorityConsent())
  const [confirmed, setConfirmed] = useState(false)
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false)
  const [loadingStatus, setLoadingStatus] = useState(false)
  const [applying, setApplying] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [status, setStatus] = useState<StatusMessage>(null)
  const hasData = report.totals.longTermMemoryCount > 0 || report.totals.dailyEntryCount > 0
  const statusLabel = useMemo(() => ti(`settings.memory.migration.status.${report.status}` as Parameters<typeof pickTranslatedUiText>[1]), [report.status, ti])

  const refresh = useCallback(() => {
    setReport(loadMemoryStorageMigrationDryRun())
    setStatusResult(null)
    setStatus(null)
    setConfirmed(false)
    setRollbackConfirmed(false)
  }, [])

  const readStatus = useCallback(async () => {
    const read = window.desktopPet?.localDataMemoryMigrationStatus
    if (typeof read !== 'function') {
      setStatus({ ok: false, message: ti('settings.memory.migration.bridge_unavailable') })
      return null
    }
    setLoadingStatus(true)
    try {
      const result = await read()
      setStatusResult(result)
      return result
    } catch (error) {
      setStatus({ ok: false, message: ti('settings.memory.migration.status_error', { error: formatError(error) }) })
      return null
    } finally {
      setLoadingStatus(false)
    }
  }, [ti])

  const applyMigration = useCallback(async () => {
    if (!migrationEnabled || !hasData || !confirmed || applying) return
    if (!(await confirm({ message: ti('settings.memory.migration.apply_confirm'), tone: 'danger' }))) return
    const apply = window.desktopPet?.localDataApplyMemoryMigration
    if (typeof apply !== 'function') {
      setStatus({ ok: false, message: ti('settings.memory.migration.bridge_unavailable') })
      return
    }
    setApplying(true)
    setStatus(null)
    try {
      const result = await apply({ confirmed: true, migrationPackage: buildMemoryLocalDataMigrationPackage() })
      if (!result.ok) {
        setStatus({ ok: false, message: ti('settings.memory.migration.apply_error', { error: formatError(result.errorMessage || result.errorKind) }) })
        return
      }
      setStatus({
        ok: true,
        message: ti('settings.memory.migration.apply_success', {
          longTerm: formatCount(result.longTermRecordCount ?? report.totals.longTermMemoryCount, uiLanguage),
          daily: formatCount(result.dailyEntryCount ?? report.totals.dailyEntryCount, uiLanguage),
        }),
      })
      setConfirmed(false)
      await readStatus()
    } catch (error) {
      setStatus({ ok: false, message: ti('settings.memory.migration.apply_error', { error: formatError(error) }) })
    } finally {
      setApplying(false)
    }
  }, [applying, confirmed, confirm, hasData, migrationEnabled, readStatus, report.totals.dailyEntryCount, report.totals.longTermMemoryCount, ti, uiLanguage])

  const toggleAuthority = useCallback(async () => {
    if (!migrationEnabled) return
    const next = !authorityEnabled
    if (!(await confirm({
      message: ti(next ? 'settings.memory.migration.authority_enable_confirm' : 'settings.memory.migration.authority_disable_confirm'),
      tone: next ? 'default' : 'danger',
    }))) return
    if (next) {
      const result = statusResult ?? await readStatus()
      if (!result?.ok || result.longTermRecordCount + result.dailyEntryCount === 0) {
        setStatus({ ok: false, message: ti('settings.memory.migration.authority_requires_migration') })
        return
      }
    }
    setMemoryLocalDataAuthorityConsent(next)
    setAuthorityEnabled(next)
    setStatus({ ok: true, message: ti(next ? 'settings.memory.migration.authority_enabled' : 'settings.memory.migration.authority_disabled') })
  }, [authorityEnabled, confirm, migrationEnabled, readStatus, statusResult, ti])

  const rollback = useCallback(async () => {
    if (!migrationEnabled || !rollbackConfirmed || rollingBack) return
    if (!(await confirm({ message: ti('settings.memory.migration.rollback_confirm'), tone: 'danger' }))) return
    const rollbackMemory = window.desktopPet?.localDataRollbackMemoryMigration
    if (typeof rollbackMemory !== 'function') {
      setStatus({ ok: false, message: ti('settings.memory.migration.bridge_unavailable') })
      return
    }
    setRollingBack(true)
    try {
      const result = await rollbackMemory({ confirmed: true })
      if (!result.ok) {
        setStatus({ ok: false, message: ti('settings.memory.migration.rollback_error', { error: formatError(result.errorMessage || result.errorKind) }) })
        return
      }
      setMemoryLocalDataAuthorityConsent(false)
      setAuthorityEnabled(false)
      setRollbackConfirmed(false)
      setStatus({ ok: true, message: ti('settings.memory.migration.rollback_success', { records: formatCount(result.recordsDeleted, uiLanguage) }) })
      await readStatus()
    } catch (error) {
      setStatus({ ok: false, message: ti('settings.memory.migration.rollback_error', { error: formatError(error) }) })
    } finally {
      setRollingBack(false)
    }
  }, [confirm, migrationEnabled, readStatus, rollbackConfirmed, rollingBack, ti, uiLanguage])

  if (!uiEnabled) return null

  return (
    <div className="settings-mini-group settings-memory-group settings-memory-migration-panel">
      <div className="settings-mini-group__head">
        <h5>{ti('settings.memory.migration.title')}</h5>
        <span>{ti('settings.memory.migration.note')}</span>
      </div>

      {!migrationEnabled ? (
        <p className="settings-mini-group__note settings-memory-note">
          {ti('settings.memory.migration.feature_disabled')}
        </p>
      ) : null}

      <div className="settings-control-grid settings-memory-migration-metrics">
        <div className="settings-metric-card">
          <span>{ti('settings.memory.migration.long_term_records')}</span>
          <strong>{report.totals.longTermMemoryCount}</strong>
        </div>
        <div className="settings-metric-card">
          <span>{ti('settings.memory.migration.daily_entries')}</span>
          <strong>{report.totals.dailyEntryCount}</strong>
        </div>
        <div className="settings-metric-card">
          <span>{ti('settings.memory.migration.preview_status')}</span>
          <strong>{statusLabel}</strong>
        </div>
      </div>

      <p className="settings-mini-group__note settings-memory-note">
        {ti('settings.memory.migration.safety_note')}
      </p>

      {report.issues.length ? (
        <ul className="settings-memory-migration-issues">
          {report.issues.map((issue) => <li key={issue.code}>{issue.code}{issue.count ? ` (${issue.count})` : ''}</li>)}
        </ul>
      ) : null}

      <div className="settings-action-row settings-memory-archive-actions">
        <button type="button" className="ghost-button" onClick={refresh}>
          {ti('settings.memory.migration.refresh')}
        </button>
        <button type="button" className="ghost-button" onClick={() => void readStatus()} disabled={loadingStatus || !migrationEnabled}>
          {loadingStatus ? ti('settings.memory.migration.status_refreshing') : ti('settings.memory.migration.status_refresh')}
        </button>
        <button type="button" className="ghost-button" onClick={() => void applyMigration()} disabled={!migrationEnabled || !hasData || !confirmed || applying}>
          {applying ? ti('settings.memory.migration.applying') : ti('settings.memory.migration.apply')}
        </button>
      </div>

      <label className="settings-checkbox-row">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!migrationEnabled || !hasData || applying} />
        <span>{ti('settings.memory.migration.confirm_label')}</span>
      </label>

      {statusResult ? (
        <p className="settings-mini-group__note settings-memory-note">
          {ti('settings.memory.migration.status_records', {
            longTerm: statusResult.longTermRecordCount,
            daily: statusResult.dailyEntryCount,
            action: statusResult.lastAuditAction || ti('settings.memory.migration.status_none'),
          })}
        </p>
      ) : null}

      <div className="settings-action-row settings-memory-archive-actions">
        <button type="button" className="ghost-button" onClick={() => void toggleAuthority()} disabled={!migrationEnabled || !statusResult?.ok}>
          {authorityEnabled ? ti('settings.memory.migration.authority_disable') : ti('settings.memory.migration.authority_enable')}
        </button>
        <button type="button" className="settings-danger-button" onClick={() => void rollback()} disabled={!migrationEnabled || !rollbackConfirmed || rollingBack}>
          {rollingBack ? ti('settings.memory.migration.rolling_back') : ti('settings.memory.migration.rollback')}
        </button>
      </div>

      <label className="settings-checkbox-row">
        <input type="checkbox" checked={rollbackConfirmed} onChange={(event) => setRollbackConfirmed(event.target.checked)} disabled={!migrationEnabled || rollingBack} />
        <span>{ti('settings.memory.migration.rollback_confirm_label')}</span>
      </label>

      {status ? (
        <div className={status.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'} role={status.ok ? 'status' : 'alert'}>
          {status.message}
        </div>
      ) : null}
    </div>
  )
})
