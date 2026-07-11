import { memo, useCallback, useState } from 'react'
import {
  buildCompanionLocalDataComparisonSource,
  buildCompanionLocalDataMigrationPackage,
  getCompanionLocalDataAuthorityConsent,
  isCompanionLocalDataMigrationFeatureEnabled,
  isCompanionLocalDataMigrationUiEnabled,
  setCompanionLocalDataAuthorityConsent,
} from '../../lib/storage/companionLocalDataMigration.ts'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'
import type { ConfirmFn } from '../useConfirm.ts'

type StatusMessage = { ok: boolean; message: string } | null
type CompanionStatusResult = Awaited<ReturnType<NonNullable<Window['desktopPet']>['localDataCompanionMigrationStatus']>>
type CompanionComparisonResult = Awaited<ReturnType<NonNullable<Window['desktopPet']>['localDataCompareCompanion']>>

function formatError(error: unknown): string {
  return getRedactedLogErrorMessage(error).trim() || 'unknown'
}

export const CompanionMigrationPreviewPanel = memo(function CompanionMigrationPreviewPanel({
  uiLanguage,
  confirm,
}: {
  uiLanguage: UiLanguage
  confirm: ConfirmFn
}) {
  const ti = useCallback((key: Parameters<typeof pickTranslatedUiText>[1], params?: Parameters<typeof pickTranslatedUiText>[2]) => (
    pickTranslatedUiText(uiLanguage, key, params)
  ), [uiLanguage])
  const uiEnabled = isCompanionLocalDataMigrationUiEnabled()
  const migrationEnabled = isCompanionLocalDataMigrationFeatureEnabled()
  const [migrationPackage, setMigrationPackage] = useState(() => buildCompanionLocalDataMigrationPackage())
  const [statusResult, setStatusResult] = useState<CompanionStatusResult | null>(null)
  const [comparisonResult, setComparisonResult] = useState<CompanionComparisonResult | null>(null)
  const [authorityEnabled, setAuthorityEnabled] = useState(() => getCompanionLocalDataAuthorityConsent())
  const [confirmed, setConfirmed] = useState(false)
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  const [rollingBack, setRollingBack] = useState(false)
  const [status, setStatus] = useState<StatusMessage>(null)
  const hasData = migrationPackage.relationship.length > 0 || migrationPackage.tasks.length > 0

  const refresh = useCallback(() => {
    setMigrationPackage(buildCompanionLocalDataMigrationPackage())
    setStatusResult(null)
    setComparisonResult(null)
    setConfirmed(false)
    setRollbackConfirmed(false)
    setStatus(null)
  }, [])

  const readStatus = useCallback(async () => {
    const read = window.desktopPet?.localDataCompanionMigrationStatus
    if (typeof read !== 'function') {
      setStatus({ ok: false, message: ti('settings.memory.companionMigration.bridge_unavailable') })
      return null
    }
    setLoading(true)
    try {
      const result = await read()
      setStatusResult(result)
      return result
    } catch (error) {
      setStatus({ ok: false, message: ti('settings.memory.companionMigration.status_error', { error: formatError(error) }) })
      return null
    } finally {
      setLoading(false)
    }
  }, [ti])

  const compare = useCallback(async () => {
    if (!migrationEnabled || !confirmed || !hasData) return
    if (!(await confirm({ message: ti('settings.memory.companionMigration.compare_confirm'), tone: 'default' }))) return
    const compareInMain = window.desktopPet?.localDataCompareCompanion
    if (typeof compareInMain !== 'function') {
      setStatus({ ok: false, message: ti('settings.memory.companionMigration.bridge_unavailable') })
      return
    }
    setLoading(true)
    try {
      const result = await compareInMain({ confirmed: true, source: buildCompanionLocalDataComparisonSource() })
      setComparisonResult(result)
      setStatus({
        ok: result.ok,
        message: result.ok
          ? ti('settings.memory.companionMigration.compare_result', { status: result.status, matched: result.matchedDatasetCount })
          : ti('settings.memory.companionMigration.status_error', { error: result.errorMessage || result.errorKind || 'unknown' }),
      })
    } catch (error) {
      setStatus({ ok: false, message: ti('settings.memory.companionMigration.status_error', { error: formatError(error) }) })
    } finally {
      setLoading(false)
    }
  }, [confirmed, confirm, hasData, migrationEnabled, ti])

  const apply = useCallback(async () => {
    if (!migrationEnabled || !hasData || !confirmed || applying) return
    if (!(await confirm({ message: ti('settings.memory.companionMigration.apply_confirm'), tone: 'danger' }))) return
    const applyInMain = window.desktopPet?.localDataApplyCompanionMigration
    if (typeof applyInMain !== 'function') {
      setStatus({ ok: false, message: ti('settings.memory.companionMigration.bridge_unavailable') })
      return
    }
    setApplying(true)
    try {
      const result = await applyInMain({ confirmed: true, migrationPackage: buildCompanionLocalDataMigrationPackage() })
      setStatus({
        ok: result.ok,
        message: result.ok
          ? ti('settings.memory.companionMigration.apply_success', { records: result.recordsWritten })
          : ti('settings.memory.companionMigration.apply_error', { error: result.errorMessage || result.errorKind || 'unknown' }),
      })
      if (result.ok) {
        setConfirmed(false)
        await readStatus()
      }
    } catch (error) {
      setStatus({ ok: false, message: ti('settings.memory.companionMigration.apply_error', { error: formatError(error) }) })
    } finally {
      setApplying(false)
    }
  }, [applying, confirmed, confirm, hasData, migrationEnabled, readStatus, ti])

  const toggleAuthority = useCallback(async () => {
    if (!migrationEnabled) return
    const next = !authorityEnabled
    if (!(await confirm({
      message: ti(next ? 'settings.memory.companionMigration.authority_enable_confirm' : 'settings.memory.companionMigration.authority_disable_confirm'),
      tone: next ? 'default' : 'danger',
    }))) return
    if (next && (!statusResult?.ok || statusResult.totalRecordCount === 0 || comparisonResult?.status !== 'aligned')) {
      setStatus({ ok: false, message: ti('settings.memory.companionMigration.authority_requires_migration') })
      return
    }
    setCompanionLocalDataAuthorityConsent(next)
    setAuthorityEnabled(next)
    setStatus({ ok: true, message: ti(next ? 'settings.memory.companionMigration.authority_enabled' : 'settings.memory.companionMigration.authority_disabled') })
  }, [authorityEnabled, comparisonResult?.status, confirm, migrationEnabled, statusResult, ti])

  const rollback = useCallback(async () => {
    if (!migrationEnabled || !rollbackConfirmed || rollingBack) return
    if (!(await confirm({ message: ti('settings.memory.companionMigration.rollback_confirm'), tone: 'danger' }))) return
    const rollbackInMain = window.desktopPet?.localDataRollbackCompanionMigration
    if (typeof rollbackInMain !== 'function') {
      setStatus({ ok: false, message: ti('settings.memory.companionMigration.bridge_unavailable') })
      return
    }
    setRollingBack(true)
    try {
      const result = await rollbackInMain({ confirmed: true })
      if (result.ok) {
        setCompanionLocalDataAuthorityConsent(false)
        setAuthorityEnabled(false)
        setRollbackConfirmed(false)
      }
      setStatus({
        ok: result.ok,
        message: result.ok
          ? ti('settings.memory.companionMigration.rollback_success', { records: result.recordsDeleted })
          : ti('settings.memory.companionMigration.rollback_error', { error: result.errorMessage || result.errorKind || 'unknown' }),
      })
      if (result.ok) await readStatus()
    } catch (error) {
      setStatus({ ok: false, message: ti('settings.memory.companionMigration.rollback_error', { error: formatError(error) }) })
    } finally {
      setRollingBack(false)
    }
  }, [confirm, migrationEnabled, readStatus, rollbackConfirmed, rollingBack, ti])

  if (!uiEnabled) return null

  return (
    <div className="settings-mini-group settings-memory-group settings-memory-migration-panel settings-companion-migration-panel">
      <div className="settings-mini-group__head">
        <h5>{ti('settings.memory.companionMigration.title')}</h5>
        <span>{ti('settings.memory.companionMigration.note')}</span>
      </div>

      {!migrationEnabled ? <p className="settings-mini-group__note settings-memory-note">{ti('settings.memory.companionMigration.feature_disabled')}</p> : null}

      <div className="settings-control-grid settings-memory-migration-metrics">
        <div className="settings-metric-card"><span>{ti('settings.memory.companionMigration.relationship_datasets')}</span><strong>{migrationPackage.relationship.length}</strong></div>
        <div className="settings-metric-card"><span>{ti('settings.memory.companionMigration.task_datasets')}</span><strong>{migrationPackage.tasks.length}</strong></div>
        <div className="settings-metric-card"><span>{ti('settings.memory.companionMigration.preview_status')}</span><strong>{comparisonResult?.status || ti('settings.memory.companionMigration.status_none')}</strong></div>
      </div>

      <p className="settings-mini-group__note settings-memory-note">{ti('settings.memory.companionMigration.safety_note')}</p>

      <div className="settings-action-row settings-memory-archive-actions">
        <button type="button" className="ghost-button" onClick={refresh}>{ti('settings.memory.companionMigration.refresh')}</button>
        <button type="button" className="ghost-button" onClick={() => void readStatus()} disabled={loading || !migrationEnabled}>{loading ? ti('settings.memory.companionMigration.status_refreshing') : ti('settings.memory.companionMigration.status_refresh')}</button>
        <button type="button" className="ghost-button" onClick={() => void compare()} disabled={!migrationEnabled || !hasData || !confirmed || loading}>{ti('settings.memory.companionMigration.compare')}</button>
        <button type="button" className="ghost-button" onClick={() => void apply()} disabled={!migrationEnabled || !hasData || !confirmed || applying}>{applying ? ti('settings.memory.companionMigration.applying') : ti('settings.memory.companionMigration.apply')}</button>
      </div>

      <label className="settings-checkbox-row">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={!migrationEnabled || !hasData || applying} />
        <span>{ti('settings.memory.companionMigration.confirm_label')}</span>
      </label>

      {statusResult ? <p className="settings-mini-group__note settings-memory-note">{ti('settings.memory.companionMigration.status_records', { relationship: statusResult.relationshipDatasetCount, tasks: statusResult.taskDatasetCount, action: statusResult.lastAuditAction || ti('settings.memory.companionMigration.status_none') })}</p> : null}

      <div className="settings-action-row settings-memory-archive-actions">
        <button type="button" className="ghost-button" onClick={() => void toggleAuthority()} disabled={!migrationEnabled || !statusResult?.ok}>{authorityEnabled ? ti('settings.memory.companionMigration.authority_disable') : ti('settings.memory.companionMigration.authority_enable')}</button>
        <button type="button" className="settings-danger-button" onClick={() => void rollback()} disabled={!migrationEnabled || !rollbackConfirmed || rollingBack}>{rollingBack ? ti('settings.memory.companionMigration.rolling_back') : ti('settings.memory.companionMigration.rollback')}</button>
      </div>

      <label className="settings-checkbox-row">
        <input type="checkbox" checked={rollbackConfirmed} onChange={(event) => setRollbackConfirmed(event.target.checked)} disabled={!migrationEnabled || rollingBack} />
        <span>{ti('settings.memory.companionMigration.rollback_confirm_label')}</span>
      </label>

      {status ? <div className={status.ok ? 'settings-test-result is-success' : 'settings-test-result is-error'} role={status.ok ? 'status' : 'alert'}>{status.message}</div> : null}
    </div>
  )
})
