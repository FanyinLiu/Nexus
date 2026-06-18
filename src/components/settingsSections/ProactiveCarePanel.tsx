import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  buildProactiveCareEvidenceReport,
  buildProactiveCareEventsExport,
  buildPublicProactiveCareEvidenceReport,
  clearProactiveCareEvents,
  loadProactiveCareEvents,
  recordProactiveCareUserAction,
  subscribeProactiveCareEvents,
  type ProactiveCareEvent,
  type ProactiveCareOutcome,
  type ProactiveCareSource,
  type ProactiveCareSourceRef,
  type ProactiveCareSourceRefKind,
  type ProactiveCareUserAction,
} from '../../lib/storage/proactiveCare.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'
import { formatConsoleTimestamp } from '../settingsDrawerSupport'

type TranslationKey = Parameters<typeof pickTranslatedUiText>[1]

interface ProactiveCarePanelProps {
  active: boolean
  uiLanguage: UiLanguage
  onOpenSourceRef?: (sourceRef: ProactiveCareSourceRef) => void
}

const SOURCE_LABEL_KEY: Record<ProactiveCareSource, TranslationKey> = {
  away_notification: 'settings.console.proactive_care.source.away_notification',
  daily_bracket: 'settings.console.proactive_care.source.daily_bracket',
  open_arc: 'settings.console.proactive_care.source.open_arc',
  future_capsule: 'settings.console.proactive_care.source.future_capsule',
}

const OUTCOME_LABEL_KEY: Record<ProactiveCareOutcome, TranslationKey> = {
  fired: 'settings.console.proactive_care.outcome.fired',
  skipped: 'settings.console.proactive_care.outcome.skipped',
  error: 'settings.console.proactive_care.outcome.error',
}

const SOURCE_REF_LABEL_KEY: Record<ProactiveCareSourceRefKind, TranslationKey> = {
  message: 'settings.console.proactive_care.source_ref.message',
  bracket: 'settings.console.proactive_care.source_ref.bracket',
  errand: 'settings.console.proactive_care.source_ref.errand',
  arc: 'settings.console.proactive_care.source_ref.arc',
  capsule: 'settings.console.proactive_care.source_ref.capsule',
  scheduler: 'settings.console.proactive_care.source_ref.scheduler',
}

const USER_ACTION_LABEL_KEY: Record<ProactiveCareUserAction, TranslationKey> = {
  less_like_this: 'settings.console.proactive_care.action.less_like_this',
  mute_source: 'settings.console.proactive_care.action.mute_source',
  open_source: 'settings.console.proactive_care.action.open_source',
  snooze: 'settings.console.proactive_care.action.snooze',
}

function formatSourceLabel(source: ProactiveCareSource, uiLanguage: UiLanguage): string {
  return pickTranslatedUiText(uiLanguage, SOURCE_LABEL_KEY[source])
}

function formatOutcomeLabel(outcome: ProactiveCareOutcome, uiLanguage: UiLanguage): string {
  return pickTranslatedUiText(uiLanguage, OUTCOME_LABEL_KEY[outcome])
}

function formatUserActionLabel(action: ProactiveCareUserAction, uiLanguage: UiLanguage): string {
  return pickTranslatedUiText(uiLanguage, USER_ACTION_LABEL_KEY[action])
}

function formatSourceRef(event: ProactiveCareEvent, uiLanguage: UiLanguage): string | null {
  if (!event.sourceRef) return null
  const kind = pickTranslatedUiText(uiLanguage, SOURCE_REF_LABEL_KEY[event.sourceRef.kind])
  return `${kind}: ${event.sourceRef.label || event.sourceRef.id}`
}

function eventToneClass(event: ProactiveCareEvent): string {
  if (event.outcome === 'fired') return ' is-success'
  if (event.outcome === 'error') return ' is-error'
  return ''
}

function SourceRefLine({
  event,
  uiLanguage,
}: {
  event: ProactiveCareEvent
  uiLanguage: UiLanguage
}) {
  const sourceRef = formatSourceRef(event, uiLanguage)
  if (!sourceRef) return null
  return (
    <p className="settings-console-list__secondary">
      {sourceRef}
    </p>
  )
}

export const ProactiveCarePanel = memo(function ProactiveCarePanel({
  active,
  onOpenSourceRef,
  uiLanguage,
}: ProactiveCarePanelProps) {
  const [events, setEvents] = useState<ProactiveCareEvent[]>(() => loadProactiveCareEvents())
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const [eventExportCopyState, setEventExportCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const ti = (key: TranslationKey, params?: Record<string, string | number>) => (
    pickTranslatedUiText(uiLanguage, key, params)
  )

  useEffect(() => {
    if (!active) return undefined

    const loadEvents = async () => {
      setEvents(loadProactiveCareEvents())
    }

    void loadEvents()
    return subscribeProactiveCareEvents(setEvents)
  }, [active])

  const visibleEvents = events.slice(0, 10)
  const evidenceReport = useMemo(() => buildProactiveCareEvidenceReport(events), [events])
  const publicEvidenceReport = useMemo(() => buildPublicProactiveCareEvidenceReport(events), [events])
  const handleRefresh = () => {
    setEvents(loadProactiveCareEvents())
  }
  const handleClear = () => {
    clearProactiveCareEvents()
    setEvents([])
  }
  const handleRecordUserAction = useCallback((eventId: string, action: ProactiveCareUserAction) => {
    const updated = recordProactiveCareUserAction(eventId, action)
    if (!updated) return
    setEvents(loadProactiveCareEvents())
  }, [])
  const handleCopyEvidence = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      setCopyState('failed')
      return
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(publicEvidenceReport, null, 2))
      setCopyState('copied')
    } catch {
      setCopyState('failed')
    }

    window.setTimeout(() => {
      setCopyState('idle')
    }, 1800)
  }, [publicEvidenceReport])
  const handleCopyEventsExport = useCallback(async () => {
    if (!navigator.clipboard?.writeText) {
      setEventExportCopyState('failed')
      return
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(buildProactiveCareEventsExport(events), null, 2))
      setEventExportCopyState('copied')
    } catch {
      setEventExportCopyState('failed')
    }

    window.setTimeout(() => {
      setEventExportCopyState('idle')
    }, 1800)
  }, [events])

  return (
    <section className="settings-console-subpanel">
      <div className="settings-console-subpanel__header">
        <div>
          <h6>{ti('settings.console.proactive_care.title')}</h6>
          <p className="settings-section__note">{ti('settings.console.proactive_care.description')}</p>
        </div>
        <span className="settings-console-section__meta">
          {events.length} {ti('settings.console.items')}
        </span>
      </div>
      <div className="settings-console-section__actions">
        <button type="button" className="ghost-button" onClick={() => void handleCopyEvidence()}>
          {copyState === 'copied'
            ? ti('settings.console.proactive_care.copy_evidence_copied')
            : copyState === 'failed'
              ? ti('settings.console.proactive_care.copy_evidence_failed')
              : ti('settings.console.proactive_care.copy_evidence')}
        </button>
        <button type="button" className="ghost-button" onClick={() => void handleCopyEventsExport()}>
          {eventExportCopyState === 'copied'
            ? ti('settings.console.proactive_care.copy_events_export_copied')
            : eventExportCopyState === 'failed'
              ? ti('settings.console.proactive_care.copy_events_export_failed')
              : ti('settings.console.proactive_care.copy_events_export')}
        </button>
        <button type="button" className="ghost-button" onClick={handleRefresh}>
          {ti('settings.console.proactive_care.refresh')}
        </button>
        {events.length > 0 ? (
          <button type="button" className="ghost-button" onClick={handleClear}>
            {ti('settings.console.proactive_care.clear')}
          </button>
        ) : null}
      </div>
      <p className="settings-section__note">
        {ti('settings.console.proactive_care.evidence_summary', {
          error: evidenceReport.outcomeCounts.error,
          fired: evidenceReport.outcomeCounts.fired,
          quiet: evidenceReport.quietHoursSkipCount,
          rate: evidenceReport.rateLimitSkipCount,
          skipped: evidenceReport.outcomeCounts.skipped,
          sourceRefs: evidenceReport.sourceRefCount,
          openableSourceRefs: evidenceReport.openableSourceRefCount,
          coverage: evidenceReport.coverageWindowHours,
          windows: evidenceReport.keyDecisionWindowCount,
          issues: evidenceReport.qualityIssueCount,
        })}
      </p>
      <div className="settings-console-list">
        {visibleEvents.length ? visibleEvents.map((event) => (
          <article
            key={event.id}
            className={`settings-console-list__item${eventToneClass(event)}`}
          >
            <div className="settings-console-list__header">
              <span className="settings-console-list__badge">
                {formatSourceLabel(event.source, uiLanguage)}
              </span>
              <span className="settings-console-list__meta">
                {formatConsoleTimestamp(event.createdAt, uiLanguage)}
              </span>
            </div>
            <strong>{formatOutcomeLabel(event.outcome, uiLanguage)} · {event.reason}</strong>
            <p>{event.userVisibleReason || event.detail}</p>
            {event.userVisibleReason && event.detail && event.userVisibleReason !== event.detail ? (
              <p className="settings-console-list__secondary">{event.detail}</p>
            ) : null}
            <SourceRefLine
              event={event}
              uiLanguage={uiLanguage}
            />
            {event.occurrences > 1 ? (
              <p className="settings-console-list__secondary">
                {ti('settings.console.proactive_care.occurrences', { count: event.occurrences })}
              </p>
            ) : null}
            <div className="settings-console-section__actions">
              <button
                type="button"
                className="ghost-button"
                onClick={() => handleRecordUserAction(event.id, 'snooze')}
              >
                {formatUserActionLabel('snooze', uiLanguage)}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => handleRecordUserAction(event.id, 'less_like_this')}
              >
                {formatUserActionLabel('less_like_this', uiLanguage)}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => handleRecordUserAction(event.id, 'mute_source')}
              >
                {formatUserActionLabel('mute_source', uiLanguage)}
              </button>
              {event.sourceRef && onOpenSourceRef ? (
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => {
                    handleRecordUserAction(event.id, 'open_source')
                    onOpenSourceRef(event.sourceRef!)
                  }}
                  aria-label={ti('settings.console.proactive_care.open_source', {
                    ref: formatSourceRef(event, uiLanguage) ?? event.sourceRef.id,
                  })}
                  title={ti('settings.console.proactive_care.open_source', {
                    ref: formatSourceRef(event, uiLanguage) ?? event.sourceRef.id,
                  })}
                >
                  {formatUserActionLabel('open_source', uiLanguage)}
                </button>
              ) : null}
              {event.userAction ? (
                <span className="settings-console-list__secondary">
                  {ti('settings.console.proactive_care.action.recorded', {
                    action: formatUserActionLabel(event.userAction, uiLanguage),
                  })}
                </span>
              ) : null}
            </div>
          </article>
        )) : (
          <p className="settings-console-list__empty">{ti('settings.console.proactive_care.empty')}</p>
        )}
      </div>
    </section>
  )
})
