import { memo, useCallback, useMemo, useState } from 'react'
import type { ConfirmFn } from '../../components/useConfirm'
import { getRedactedLogErrorMessage } from '../../lib/logRedaction'
import {
  buildCompanionLocalDataComparisonSource,
  buildCompanionLocalDataMigrationPackage,
  getCompanionLocalDataAuthorityConsent,
  isCompanionLocalDataMigrationFeatureEnabled,
  isCompanionLocalDataMigrationUiEnabled,
  setCompanionLocalDataAuthorityConsent,
} from '../../lib/storage/companionLocalDataMigration'
import {
  buildMemoryLocalDataMigrationPackage,
  getMemoryLocalDataAuthorityConsent,
  isMemoryLocalDataMigrationFeatureEnabled,
  isMemoryLocalDataMigrationUiEnabled,
  loadMemoryStorageMigrationDryRun,
  setMemoryLocalDataAuthorityConsent,
} from '../../lib/storage'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'
import {
  SettingsV3Notice,
  SettingsV3Row,
  SettingsV3Section,
  SettingsV3Switch,
  SettingsV3Toolbar,
} from './SettingsV3Primitives'

type StatusMessage = { ok: boolean; message: string } | null
type MemoryStatus = Awaited<ReturnType<NonNullable<Window['desktopPet']>['localDataMemoryMigrationStatus']>>
type CompanionStatus = Awaited<ReturnType<NonNullable<Window['desktopPet']>['localDataCompanionMigrationStatus']>>
type CompanionComparison = Awaited<ReturnType<NonNullable<Window['desktopPet']>['localDataCompareCompanion']>>

function errorText(error: unknown) {
  return getRedactedLogErrorMessage(error).trim() || 'unknown'
}

export const MemoryMigrationAdapterV3 = memo(function MemoryMigrationAdapterV3({
  confirm,
  uiLanguage,
}: { confirm: ConfirmFn; uiLanguage: UiLanguage }) {
  const ti = useCallback((key: Parameters<typeof pickTranslatedUiText>[1], params?: Parameters<typeof pickTranslatedUiText>[2]) => pickTranslatedUiText(uiLanguage, key, params), [uiLanguage])
  const uiEnabled = isMemoryLocalDataMigrationUiEnabled()
  const enabled = isMemoryLocalDataMigrationFeatureEnabled()
  const [report, setReport] = useState(() => loadMemoryStorageMigrationDryRun())
  const [remote, setRemote] = useState<MemoryStatus | null>(null)
  const [authority, setAuthority] = useState(() => getMemoryLocalDataAuthorityConsent())
  const [confirmed, setConfirmed] = useState(false)
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false)
  const [busy, setBusy] = useState<'status' | 'apply' | 'rollback' | null>(null)
  const [status, setStatus] = useState<StatusMessage>(null)
  const hasData = report.totals.longTermMemoryCount > 0 || report.totals.dailyEntryCount > 0
  const previewLabel = useMemo(() => ti(`settings.memory.migration.status.${report.status}` as Parameters<typeof pickTranslatedUiText>[1]), [report.status, ti])

  const refreshStatus = useCallback(async () => {
    const read = window.desktopPet?.localDataMemoryMigrationStatus
    if (!read) {
      setStatus({ ok: false, message: ti('settings.memory.migration.bridge_unavailable') })
      return null
    }
    setBusy('status')
    try {
      const result = await read()
      setRemote(result)
      return result
    } catch (error) {
      setStatus({ ok: false, message: ti('settings.memory.migration.status_error', { error: errorText(error) }) })
      return null
    } finally {
      setBusy(null)
    }
  }, [ti])

  const apply = useCallback(async () => {
    if (!enabled || !hasData || !confirmed || busy) return
    if (!(await confirm({ message: ti('settings.memory.migration.apply_confirm'), tone: 'danger' }))) return
    const run = window.desktopPet?.localDataApplyMemoryMigration
    if (!run) return setStatus({ ok: false, message: ti('settings.memory.migration.bridge_unavailable') })
    setBusy('apply')
    try {
      const result = await run({ confirmed: true, migrationPackage: buildMemoryLocalDataMigrationPackage() })
      setStatus(result.ok
        ? { ok: true, message: ti('settings.memory.migration.apply_success', { longTerm: result.longTermRecordCount ?? report.totals.longTermMemoryCount, daily: result.dailyEntryCount ?? report.totals.dailyEntryCount }) }
        : { ok: false, message: ti('settings.memory.migration.apply_error', { error: errorText(result.errorMessage || result.errorKind) }) })
      if (result.ok) {
        setConfirmed(false)
        await refreshStatus()
      }
    } catch (error) {
      setStatus({ ok: false, message: ti('settings.memory.migration.apply_error', { error: errorText(error) }) })
    } finally {
      setBusy(null)
    }
  }, [busy, confirm, confirmed, enabled, hasData, refreshStatus, report.totals.dailyEntryCount, report.totals.longTermMemoryCount, ti])

  const toggleAuthority = useCallback(async () => {
    const next = !authority
    if (!(await confirm({ message: ti(next ? 'settings.memory.migration.authority_enable_confirm' : 'settings.memory.migration.authority_disable_confirm'), tone: next ? 'default' : 'danger' }))) return
    const current = remote ?? await refreshStatus()
    if (next && (!current?.ok || current.longTermRecordCount + current.dailyEntryCount === 0)) {
      return setStatus({ ok: false, message: ti('settings.memory.migration.authority_requires_migration') })
    }
    setMemoryLocalDataAuthorityConsent(next)
    setAuthority(next)
    setStatus({ ok: true, message: ti(next ? 'settings.memory.migration.authority_enabled' : 'settings.memory.migration.authority_disabled') })
  }, [authority, confirm, refreshStatus, remote, ti])

  const rollback = useCallback(async () => {
    if (!rollbackConfirmed || busy) return
    if (!(await confirm({ message: ti('settings.memory.migration.rollback_confirm'), tone: 'danger' }))) return
    const run = window.desktopPet?.localDataRollbackMemoryMigration
    if (!run) return setStatus({ ok: false, message: ti('settings.memory.migration.bridge_unavailable') })
    setBusy('rollback')
    try {
      const result = await run({ confirmed: true })
      setStatus(result.ok
        ? { ok: true, message: ti('settings.memory.migration.rollback_success', { records: result.recordsDeleted }) }
        : { ok: false, message: ti('settings.memory.migration.rollback_error', { error: errorText(result.errorMessage || result.errorKind) }) })
      if (result.ok) {
        setMemoryLocalDataAuthorityConsent(false)
        setAuthority(false)
        setRollbackConfirmed(false)
        await refreshStatus()
      }
    } catch (error) {
      setStatus({ ok: false, message: ti('settings.memory.migration.rollback_error', { error: errorText(error) }) })
    } finally {
      setBusy(null)
    }
  }, [busy, confirm, refreshStatus, rollbackConfirmed, ti])

  if (!uiEnabled) return null
  return (
    <SettingsV3Section title={ti('settings.memory.migration.title')} description={ti('settings.memory.migration.note')}>
      {!enabled ? <SettingsV3Notice tone="warning" title={ti('settings.memory.migration.feature_disabled')} /> : null}
      <SettingsV3Row label={ti('settings.memory.migration.long_term_records')} meta={report.totals.longTermMemoryCount.toLocaleString(uiLanguage)} />
      <SettingsV3Row label={ti('settings.memory.migration.daily_entries')} meta={report.totals.dailyEntryCount.toLocaleString(uiLanguage)} />
      <SettingsV3Row label={ti('settings.memory.migration.preview_status')} hint={ti('settings.memory.migration.safety_note')} meta={previewLabel} />
      {report.issues.map((issue) => <SettingsV3Notice key={issue.code} tone="warning" title={issue.code}>{issue.count ? String(issue.count) : undefined}</SettingsV3Notice>)}
      {remote ? <SettingsV3Row label={ti('settings.memory.migration.status_refresh')} hint={remote.lastAuditAction || ti('settings.memory.migration.status_none')} meta={`${remote.longTermRecordCount} / ${remote.dailyEntryCount}`} /> : null}
      <SettingsV3Row label={ti('settings.memory.migration.confirm_label')}><SettingsV3Switch checked={confirmed} disabled={!enabled || !hasData} label={ti('settings.memory.migration.confirm_label')} onChange={setConfirmed} /></SettingsV3Row>
      <SettingsV3Row label={authority ? ti('settings.memory.migration.authority_disable') : ti('settings.memory.migration.authority_enable')}><SettingsV3Switch checked={authority} disabled={!enabled} label={ti('settings.memory.migration.authority_enable')} onChange={() => void toggleAuthority()} /></SettingsV3Row>
      <SettingsV3Toolbar>
        <button type="button" onClick={() => { setReport(loadMemoryStorageMigrationDryRun()); setStatus(null) }}>{ti('settings.memory.migration.refresh')}</button>
        <button type="button" disabled={!enabled || busy === 'status'} onClick={() => void refreshStatus()}>{busy === 'status' ? ti('settings.memory.migration.status_refreshing') : ti('settings.memory.migration.status_refresh')}</button>
        <button type="button" disabled={!enabled || !hasData || !confirmed || Boolean(busy)} onClick={() => void apply()}>{busy === 'apply' ? ti('settings.memory.migration.applying') : ti('settings.memory.migration.apply')}</button>
      </SettingsV3Toolbar>
      <SettingsV3Row label={ti('settings.memory.migration.rollback_confirm_label')}><SettingsV3Switch checked={rollbackConfirmed} disabled={!enabled} label={ti('settings.memory.migration.rollback_confirm_label')} onChange={setRollbackConfirmed} /></SettingsV3Row>
      <SettingsV3Toolbar><button type="button" className="is-danger" disabled={!enabled || !rollbackConfirmed || Boolean(busy)} onClick={() => void rollback()}>{busy === 'rollback' ? ti('settings.memory.migration.rolling_back') : ti('settings.memory.migration.rollback')}</button></SettingsV3Toolbar>
      {status ? <SettingsV3Notice tone={status.ok ? 'success' : 'error'} title={status.message} announce /> : null}
    </SettingsV3Section>
  )
})

export const CompanionMigrationAdapterV3 = memo(function CompanionMigrationAdapterV3({
  confirm,
  uiLanguage,
}: { confirm: ConfirmFn; uiLanguage: UiLanguage }) {
  const ti = useCallback((key: Parameters<typeof pickTranslatedUiText>[1], params?: Parameters<typeof pickTranslatedUiText>[2]) => pickTranslatedUiText(uiLanguage, key, params), [uiLanguage])
  const uiEnabled = isCompanionLocalDataMigrationUiEnabled()
  const enabled = isCompanionLocalDataMigrationFeatureEnabled()
  const [migrationPackage, setMigrationPackage] = useState(() => buildCompanionLocalDataMigrationPackage())
  const [remote, setRemote] = useState<CompanionStatus | null>(null)
  const [comparison, setComparison] = useState<CompanionComparison | null>(null)
  const [authority, setAuthority] = useState(() => getCompanionLocalDataAuthorityConsent())
  const [confirmed, setConfirmed] = useState(false)
  const [rollbackConfirmed, setRollbackConfirmed] = useState(false)
  const [busy, setBusy] = useState<'status' | 'compare' | 'apply' | 'rollback' | null>(null)
  const [status, setStatus] = useState<StatusMessage>(null)
  const hasData = migrationPackage.relationship.length > 0 || migrationPackage.tasks.length > 0

  const refreshStatus = useCallback(async () => {
    const read = window.desktopPet?.localDataCompanionMigrationStatus
    if (!read) return setStatus({ ok: false, message: ti('settings.memory.companionMigration.bridge_unavailable') }), null
    setBusy('status')
    try {
      const result = await read()
      setRemote(result)
      return result
    } catch (error) {
      setStatus({ ok: false, message: ti('settings.memory.companionMigration.status_error', { error: errorText(error) }) })
      return null
    } finally { setBusy(null) }
  }, [ti])

  const compare = useCallback(async () => {
    if (!confirmed || !hasData || busy) return
    if (!(await confirm({ message: ti('settings.memory.companionMigration.compare_confirm') }))) return
    const run = window.desktopPet?.localDataCompareCompanion
    if (!run) return setStatus({ ok: false, message: ti('settings.memory.companionMigration.bridge_unavailable') })
    setBusy('compare')
    try {
      const result = await run({ confirmed: true, source: buildCompanionLocalDataComparisonSource() })
      setComparison(result)
      setStatus({ ok: result.ok, message: result.ok ? ti('settings.memory.companionMigration.compare_result', { status: result.status, matched: result.matchedDatasetCount }) : ti('settings.memory.companionMigration.status_error', { error: result.errorMessage || result.errorKind || 'unknown' }) })
    } catch (error) { setStatus({ ok: false, message: ti('settings.memory.companionMigration.status_error', { error: errorText(error) }) }) }
    finally { setBusy(null) }
  }, [busy, confirm, confirmed, hasData, ti])

  const apply = useCallback(async () => {
    if (!confirmed || !hasData || busy) return
    if (!(await confirm({ message: ti('settings.memory.companionMigration.apply_confirm'), tone: 'danger' }))) return
    const run = window.desktopPet?.localDataApplyCompanionMigration
    if (!run) return setStatus({ ok: false, message: ti('settings.memory.companionMigration.bridge_unavailable') })
    setBusy('apply')
    try {
      const result = await run({ confirmed: true, migrationPackage: buildCompanionLocalDataMigrationPackage() })
      setStatus({ ok: result.ok, message: result.ok ? ti('settings.memory.companionMigration.apply_success', { records: result.recordsWritten }) : ti('settings.memory.companionMigration.apply_error', { error: result.errorMessage || result.errorKind || 'unknown' }) })
      if (result.ok) { setConfirmed(false); await refreshStatus() }
    } catch (error) { setStatus({ ok: false, message: ti('settings.memory.companionMigration.apply_error', { error: errorText(error) }) }) }
    finally { setBusy(null) }
  }, [busy, confirm, confirmed, hasData, refreshStatus, ti])

  const toggleAuthority = useCallback(async () => {
    const next = !authority
    if (!(await confirm({ message: ti(next ? 'settings.memory.companionMigration.authority_enable_confirm' : 'settings.memory.companionMigration.authority_disable_confirm'), tone: next ? 'default' : 'danger' }))) return
    if (next && (!remote?.ok || remote.totalRecordCount === 0 || comparison?.status !== 'aligned')) return setStatus({ ok: false, message: ti('settings.memory.companionMigration.authority_requires_migration') })
    setCompanionLocalDataAuthorityConsent(next)
    setAuthority(next)
    setStatus({ ok: true, message: ti(next ? 'settings.memory.companionMigration.authority_enabled' : 'settings.memory.companionMigration.authority_disabled') })
  }, [authority, comparison?.status, confirm, remote, ti])

  const rollback = useCallback(async () => {
    if (!rollbackConfirmed || busy) return
    if (!(await confirm({ message: ti('settings.memory.companionMigration.rollback_confirm'), tone: 'danger' }))) return
    const run = window.desktopPet?.localDataRollbackCompanionMigration
    if (!run) return setStatus({ ok: false, message: ti('settings.memory.companionMigration.bridge_unavailable') })
    setBusy('rollback')
    try {
      const result = await run({ confirmed: true })
      setStatus({ ok: result.ok, message: result.ok ? ti('settings.memory.companionMigration.rollback_success', { records: result.recordsDeleted }) : ti('settings.memory.companionMigration.rollback_error', { error: result.errorMessage || result.errorKind || 'unknown' }) })
      if (result.ok) { setCompanionLocalDataAuthorityConsent(false); setAuthority(false); setRollbackConfirmed(false); await refreshStatus() }
    } catch (error) { setStatus({ ok: false, message: ti('settings.memory.companionMigration.rollback_error', { error: errorText(error) }) }) }
    finally { setBusy(null) }
  }, [busy, confirm, refreshStatus, rollbackConfirmed, ti])

  if (!uiEnabled) return null
  return (
    <SettingsV3Section title={ti('settings.memory.companionMigration.title')} description={ti('settings.memory.companionMigration.note')}>
      {!enabled ? <SettingsV3Notice tone="warning" title={ti('settings.memory.companionMigration.feature_disabled')} /> : null}
      <SettingsV3Row label={ti('settings.memory.companionMigration.relationship_datasets')} meta={migrationPackage.relationship.length.toLocaleString(uiLanguage)} />
      <SettingsV3Row label={ti('settings.memory.companionMigration.task_datasets')} meta={migrationPackage.tasks.length.toLocaleString(uiLanguage)} />
      <SettingsV3Row label={ti('settings.memory.companionMigration.preview_status')} hint={ti('settings.memory.companionMigration.safety_note')} meta={comparison?.status || ti('settings.memory.companionMigration.status_none')} />
      {remote ? <SettingsV3Row label={ti('settings.memory.companionMigration.status_refresh')} hint={remote.lastAuditAction || ti('settings.memory.companionMigration.status_none')} meta={`${remote.relationshipDatasetCount} / ${remote.taskDatasetCount}`} /> : null}
      <SettingsV3Row label={ti('settings.memory.companionMigration.confirm_label')}><SettingsV3Switch checked={confirmed} disabled={!enabled || !hasData} label={ti('settings.memory.companionMigration.confirm_label')} onChange={setConfirmed} /></SettingsV3Row>
      <SettingsV3Row label={authority ? ti('settings.memory.companionMigration.authority_disable') : ti('settings.memory.companionMigration.authority_enable')}><SettingsV3Switch checked={authority} disabled={!enabled} label={ti('settings.memory.companionMigration.authority_enable')} onChange={() => void toggleAuthority()} /></SettingsV3Row>
      <SettingsV3Toolbar>
        <button type="button" onClick={() => { setMigrationPackage(buildCompanionLocalDataMigrationPackage()); setRemote(null); setComparison(null); setStatus(null) }}>{ti('settings.memory.companionMigration.refresh')}</button>
        <button type="button" disabled={!enabled || Boolean(busy)} onClick={() => void refreshStatus()}>{busy === 'status' ? ti('settings.memory.companionMigration.status_refreshing') : ti('settings.memory.companionMigration.status_refresh')}</button>
        <button type="button" disabled={!enabled || !confirmed || !hasData || Boolean(busy)} onClick={() => void compare()}>{ti('settings.memory.companionMigration.compare')}</button>
        <button type="button" disabled={!enabled || !confirmed || !hasData || Boolean(busy)} onClick={() => void apply()}>{busy === 'apply' ? ti('settings.memory.companionMigration.applying') : ti('settings.memory.companionMigration.apply')}</button>
      </SettingsV3Toolbar>
      <SettingsV3Row label={ti('settings.memory.companionMigration.rollback_confirm_label')}><SettingsV3Switch checked={rollbackConfirmed} disabled={!enabled} label={ti('settings.memory.companionMigration.rollback_confirm_label')} onChange={setRollbackConfirmed} /></SettingsV3Row>
      <SettingsV3Toolbar><button type="button" className="is-danger" disabled={!enabled || !rollbackConfirmed || Boolean(busy)} onClick={() => void rollback()}>{busy === 'rollback' ? ti('settings.memory.companionMigration.rolling_back') : ti('settings.memory.companionMigration.rollback')}</button></SettingsV3Toolbar>
      {status ? <SettingsV3Notice tone={status.ok ? 'success' : 'error'} title={status.message} announce /> : null}
    </SettingsV3Section>
  )
})
