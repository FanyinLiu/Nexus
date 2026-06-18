import {
  PROACTIVE_CARE_EVENTS_STORAGE_KEY,
  createId,
  onStorageChange,
  readJson,
  writeJson,
} from './core.ts'

export type ProactiveCareSource =
  | 'away_notification'
  | 'daily_bracket'
  | 'open_arc'
  | 'future_capsule'

export type ProactiveCareOutcome = 'fired' | 'skipped' | 'error'

export type ProactiveCareUserAction =
  | 'less_like_this'
  | 'mute_source'
  | 'open_source'
  | 'snooze'

export type ProactiveCareDecisionWindow =
  | 'due_item'
  | 'quiet_hours'
  | 'rate_limited'
  | 'error'

export type ProactiveCareSourceRefKind =
  | 'message'
  | 'bracket'
  | 'errand'
  | 'arc'
  | 'capsule'
  | 'scheduler'

export interface ProactiveCareSourceRef {
  kind: ProactiveCareSourceRefKind
  id: string
  label?: string
}

export type ProactiveCareAutonomyFocus =
  | 'away_notification'
  | 'daily_bracket'
  | 'open_arc'
  | 'future_capsule'
  | 'errand'
  | 'arc'
  | 'capsule'
  | 'unknown'

export type ProactiveCareSourceRefNavigation =
  | {
    section: 'history'
    historySourceRef: string
  }
  | {
    section: 'autonomy'
    focus: ProactiveCareAutonomyFocus
  }

export interface ProactiveCareEvent {
  id: string
  source: ProactiveCareSource
  outcome: ProactiveCareOutcome
  reason: string
  detail: string
  createdAt: string
  occurrences: number
  carePolicyVersion?: 1 | 2
  userVisibleReason?: string
  userAction?: ProactiveCareUserAction
  sourceRef?: ProactiveCareSourceRef
}

export interface ProactiveCareEventDraft {
  source: ProactiveCareSource
  outcome: ProactiveCareOutcome
  reason: string
  detail?: string
  createdAt?: string
  carePolicyVersion?: 1 | 2
  userVisibleReason?: string
  userAction?: ProactiveCareUserAction
  sourceRef?: ProactiveCareSourceRef
}

export interface ProactiveCareSourceEvidence {
  events: number
  occurrences: number
  fired: number
  skipped: number
  error: number
  withSourceRef: number
  withOpenableSourceRef: number
  firstEventAt: string | null
  lastEventAt: string | null
  coverageWindowMs: number
  coverageWindowHours: number
  sourceRefCoverage: number
  openableSourceRefCoverage: number
  decisionWindowCounts: Record<ProactiveCareDecisionWindow, number>
}

export interface ProactiveCareEvidenceCheck {
  id:
    | 'has-events'
    | 'has-fired'
    | 'has-skipped'
    | 'has-quiet-hours-skip'
    | 'has-rate-limit-skip'
    | 'has-key-decision-window-coverage'
    | 'has-source-refs'
    | 'has-openable-source-refs'
    | 'has-openable-source-ref-coverage'
    | 'has-source-ref-coverage'
    | 'has-all-sources-observed'
    | 'has-multi-hour-coverage'
    | 'has-v2-policy-events'
    | 'has-user-visible-reasons'
    | 'has-user-feedback-actions'
  pass: boolean
  detail: string
}

export type ProactiveCareQualityIssueSeverity = 'info' | 'warning'

export interface ProactiveCareQualityIssue {
  id: string
  severity: ProactiveCareQualityIssueSeverity
  source?: ProactiveCareSource
  detail: string
}

export interface ProactiveCareEvidenceReport {
  schemaVersion: 1
  gate: 'proactive-care-observability'
  generatedAt: string
  totalEvents: number
  totalOccurrences: number
  firstEventAt: string | null
  lastEventAt: string | null
  coverageWindowMs: number
  coverageWindowHours: number
  outcomeCounts: Record<ProactiveCareOutcome, number>
  sourceCounts: Record<ProactiveCareSource, ProactiveCareSourceEvidence>
  reasonCounts: Record<string, number>
  decisionWindowCounts: Record<ProactiveCareDecisionWindow, number>
  keyDecisionWindowCount: number
  sourceRefCount: number
  missingSourceRefCount: number
  openableSourceRefCount: number
  sourceRefCoverage: number
  openableSourceRefCoverage: number
  quietHoursSkipCount: number
  rateLimitSkipCount: number
  qualityIssueCount: number
  qualityIssues: ProactiveCareQualityIssue[]
  v2EventCount: number
  userVisibleReasonCount: number
  userActionCounts: Record<ProactiveCareUserAction, number>
  checks: ProactiveCareEvidenceCheck[]
  nextActions: string[]
  latestEvents: ProactiveCareEvent[]
}

export interface PublicProactiveCareSourceRefEvidence {
  kind: ProactiveCareSourceRefKind
  openable: boolean
  route: 'history' | 'autonomy' | 'unknown'
  focus?: ProactiveCareAutonomyFocus
}

export interface PublicProactiveCareEventEvidence {
  source: ProactiveCareSource
  outcome: ProactiveCareOutcome
  reason: string
  createdAt: string
  occurrences: number
  carePolicyVersion?: 1 | 2
  hasUserVisibleReason: boolean
  userAction?: ProactiveCareUserAction
  sourceRef?: PublicProactiveCareSourceRefEvidence
}

export type PublicProactiveCareEvidenceReport = Omit<
  ProactiveCareEvidenceReport,
  'latestEvents' | 'reasonCounts'
> & {
  ok: boolean
  privacy: {
    privateFieldsOmitted: string[]
  }
  reasonCounts: Record<string, number>
  latestEvents: PublicProactiveCareEventEvidence[]
}

export interface ProactiveCareEventsExport {
  schemaVersion: 1
  kind: 'nexus.proactive-care-events-export'
  generatedAt: string
  containsPrivateEventRows: true
  usage: {
    command: string
  }
  events: ProactiveCareEvent[]
}

const MAX_EVENTS = 80
const MAX_REPORT_EVENTS = 20
const DEDUPE_WINDOW_MS = 30 * 60_000
const MULTI_HOUR_COVERAGE_MS = 2 * 60 * 60_000
const PUBLIC_REASON_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/i
const VALID_SOURCES = new Set<ProactiveCareSource>([
  'away_notification',
  'daily_bracket',
  'open_arc',
  'future_capsule',
])
const VALID_OUTCOMES = new Set<ProactiveCareOutcome>(['fired', 'skipped', 'error'])
const VALID_USER_ACTIONS = new Set<ProactiveCareUserAction>([
  'less_like_this',
  'mute_source',
  'open_source',
  'snooze',
])
const VALID_SOURCE_REF_KINDS = new Set<ProactiveCareSourceRefKind>([
  'message',
  'bracket',
  'errand',
  'arc',
  'capsule',
  'scheduler',
])
const QUIET_HOURS_REASONS = new Set(['quiet_hours', 'quiet-hours'])
const RATE_LIMIT_REASONS = new Set([
  'in_cooldown',
  'morning_already_fired_today',
  'evening_already_fired_today',
  'too_close_to_other_bracket',
])

const PROACTIVE_CARE_NEXT_ACTIONS: Record<ProactiveCareEvidenceCheck['id'], string> = {
  'has-events': 'Run Nexus with proactive care enabled until Settings -> Console -> Proactive care shows runtime decisions, then regenerate the report.',
  'has-fired': 'Keep the panel closed and let at least one due proactive item fire through the native notification path.',
  'has-skipped': 'Let one scheduler evaluate when it should not fire, such as below threshold, no due item, quiet hours, or cooldown.',
  'has-quiet-hours-skip': 'Keep quiet hours configured and run through a quiet-hours window so a skipped care decision is recorded.',
  'has-rate-limit-skip': 'Run through a second eligible bracket or cooldown window so a rate-limit skip is recorded.',
  'has-key-decision-window-coverage': 'Collect all three key decision windows: one due-item fire, one quiet-hours skip, and one rate-limit skip.',
  'has-source-refs': 'Record care decisions with source references so each event can route back to History or Autonomy.',
  'has-openable-source-refs': 'Use message, bracket, arc, capsule, errand, or known scheduler references so the diagnostics panel can open the source.',
  'has-openable-source-ref-coverage': 'Increase event coverage from openable source references; scheduler-only unknown refs are not enough.',
  'has-source-ref-coverage': 'Increase the share of care events that include source references before using this as release evidence.',
  'has-all-sources-observed': 'Enable and run away notifications, daily brackets, open arcs, and future capsules long enough for each source to record a decision.',
  'has-multi-hour-coverage': 'Keep Nexus running for at least two hours of real proactive-care decisions before regenerating the report.',
  'has-v2-policy-events': 'Record new proactive-care decisions with carePolicyVersion=2 so release evidence covers the visible-reason policy.',
  'has-user-visible-reasons': 'Record care decisions with a userVisibleReason so the Console can explain why Nexus appeared now.',
  'has-user-feedback-actions': 'Exercise one user feedback action such as snooze, less-like-this, mute-source, or open-source from the proactive-care panel.',
}

const EMPTY_OUTCOME_COUNTS: Record<ProactiveCareOutcome, number> = {
  error: 0,
  fired: 0,
  skipped: 0,
}

function createEmptyDecisionWindowCounts(): Record<ProactiveCareDecisionWindow, number> {
  return {
    due_item: 0,
    error: 0,
    quiet_hours: 0,
    rate_limited: 0,
  }
}

function createEmptyUserActionCounts(): Record<ProactiveCareUserAction, number> {
  return {
    less_like_this: 0,
    mute_source: 0,
    open_source: 0,
    snooze: 0,
  }
}

function createEmptySourceEvidence(): ProactiveCareSourceEvidence {
  return {
    error: 0,
    coverageWindowHours: 0,
    coverageWindowMs: 0,
    decisionWindowCounts: createEmptyDecisionWindowCounts(),
    events: 0,
    fired: 0,
    firstEventAt: null,
    lastEventAt: null,
    openableSourceRefCoverage: 0,
    occurrences: 0,
    sourceRefCoverage: 0,
    skipped: 0,
    withOpenableSourceRef: 0,
    withSourceRef: 0,
  }
}

function createEmptySourceCounts(): Record<ProactiveCareSource, ProactiveCareSourceEvidence> {
  return {
    away_notification: createEmptySourceEvidence(),
    daily_bracket: createEmptySourceEvidence(),
    future_capsule: createEmptySourceEvidence(),
    open_arc: createEmptySourceEvidence(),
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  return value.replace(/\s+/g, ' ').trim() || fallback
}

function toPublicReason(value: unknown): string {
  const reason = normalizeText(value, 'unknown')
  return PUBLIC_REASON_PATTERN.test(reason) ? reason : 'custom_reason'
}

function normalizeIso(value: unknown, fallbackIso = new Date().toISOString()): string {
  if (typeof value !== 'string' && typeof value !== 'number') return fallbackIso
  const parsed = typeof value === 'number' ? value : Date.parse(value)
  if (!Number.isFinite(parsed)) return fallbackIso
  return new Date(parsed).toISOString()
}

function normalizeOccurrenceCount(value: unknown): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 1
  return Math.max(1, Math.min(999, Math.floor(numeric)))
}

function normalizeCarePolicyVersion(value: unknown): 1 | 2 | undefined {
  return value === 1 || value === 2 ? value : undefined
}

function normalizeUserAction(value: unknown): ProactiveCareUserAction | undefined {
  return typeof value === 'string' && VALID_USER_ACTIONS.has(value as ProactiveCareUserAction)
    ? value as ProactiveCareUserAction
    : undefined
}

function defaultUserVisibleReason(draft: Pick<ProactiveCareEventDraft, 'detail' | 'reason' | 'source'>): string {
  const detail = normalizeText(draft.detail)
  if (detail) return detail
  return `${draft.source}: ${draft.reason}`
}

function roundRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 1000
}

function updateSourceWindow(source: ProactiveCareSourceEvidence, createdAt: string): void {
  const createdMs = Date.parse(createdAt)
  if (!Number.isFinite(createdMs)) return

  const firstMs = source.firstEventAt ? Date.parse(source.firstEventAt) : NaN
  const lastMs = source.lastEventAt ? Date.parse(source.lastEventAt) : NaN
  if (!Number.isFinite(firstMs) || createdMs < firstMs) source.firstEventAt = createdAt
  if (!Number.isFinite(lastMs) || createdMs > lastMs) source.lastEventAt = createdAt
}

function finalizeSourceWindow(source: ProactiveCareSourceEvidence): void {
  const firstMs = source.firstEventAt ? Date.parse(source.firstEventAt) : NaN
  const lastMs = source.lastEventAt ? Date.parse(source.lastEventAt) : NaN
  source.coverageWindowMs = Number.isFinite(firstMs) && Number.isFinite(lastMs)
    ? Math.max(0, lastMs - firstMs)
    : 0
  source.coverageWindowHours = Math.round((source.coverageWindowMs / 3_600_000) * 100) / 100
}

function classifyDecisionWindow(event: ProactiveCareEvent): ProactiveCareDecisionWindow | null {
  if (event.outcome === 'fired') return 'due_item'
  if (event.outcome === 'error') return 'error'
  if (event.outcome !== 'skipped') return null
  if (QUIET_HOURS_REASONS.has(event.reason)) return 'quiet_hours'
  if (RATE_LIMIT_REASONS.has(event.reason)) return 'rate_limited'
  return null
}

function buildProactiveCareQualityIssues(
  sourceCounts: Record<ProactiveCareSource, ProactiveCareSourceEvidence>,
  totalEvents: number,
  sourceRefCoverage: number,
  openableSourceRefCoverage: number,
  coverageWindowMs: number,
  decisionWindowCounts: Record<ProactiveCareDecisionWindow, number>,
): ProactiveCareQualityIssue[] {
  const issues: ProactiveCareQualityIssue[] = []

  for (const source of VALID_SOURCES) {
    const evidence = sourceCounts[source]
    if (evidence.events === 0) {
      issues.push({
        id: `${source}:unobserved`,
        severity: 'warning',
        source,
        detail: `${source} has no recorded proactive-care decisions yet.`,
      })
      continue
    }

    if (evidence.withSourceRef === 0) {
      issues.push({
        id: `${source}:missing-source-refs`,
        severity: 'warning',
        source,
        detail: `${source} has ${evidence.events} event(s) but no source references.`,
      })
    }

    if (evidence.withSourceRef > 0 && evidence.withOpenableSourceRef === 0) {
      issues.push({
        id: `${source}:missing-openable-source-refs`,
        severity: 'warning',
        source,
        detail: `${source} has source references, but none route to History or Autonomy.`,
      })
    }

    if (evidence.fired === 0) {
      issues.push({
        id: `${source}:no-fired-coverage`,
        severity: 'info',
        source,
        detail: `${source} has no fired occurrence in the current evidence window.`,
      })
    }

    if (evidence.skipped === 0) {
      issues.push({
        id: `${source}:no-skip-coverage`,
        severity: 'info',
        source,
        detail: `${source} has no skipped occurrence in the current evidence window.`,
      })
    }
  }

  if (totalEvents > 0 && sourceRefCoverage < 0.5) {
    issues.push({
      id: 'low-source-ref-coverage',
      severity: 'warning',
      detail: `Only ${Math.round(sourceRefCoverage * 100)}% of proactive-care events have source references.`,
    })
  }

  if (totalEvents > 0 && openableSourceRefCoverage < 0.5) {
    issues.push({
      id: 'low-openable-source-ref-coverage',
      severity: 'warning',
      detail: `Only ${Math.round(openableSourceRefCoverage * 100)}% of proactive-care events have source references that route to History or Autonomy.`,
    })
  }

  if (totalEvents > 0 && coverageWindowMs < MULTI_HOUR_COVERAGE_MS) {
    issues.push({
      id: 'short-coverage-window',
      severity: 'info',
      detail: 'Evidence covers less than two hours of proactive-care behavior.',
    })
  }

  const missingDecisionWindows = [
    decisionWindowCounts.due_item > 0 ? null : 'due-item',
    decisionWindowCounts.quiet_hours > 0 ? null : 'quiet-hours',
    decisionWindowCounts.rate_limited > 0 ? null : 'rate-limit',
  ].filter((window): window is string => Boolean(window))
  if (totalEvents > 0 && missingDecisionWindows.length > 0) {
    issues.push({
      id: 'missing-key-decision-window-coverage',
      severity: 'info',
      detail: `Missing proactive-care decision-window evidence: ${missingDecisionWindows.join(', ')}.`,
    })
  }

  return issues
}

function buildProactiveCareNextActions(
  checks: readonly ProactiveCareEvidenceCheck[],
): string[] {
  const actions: string[] = []
  for (const check of checks) {
    if (check.pass) continue
    const action = PROACTIVE_CARE_NEXT_ACTIONS[check.id]
    if (action && !actions.includes(action)) actions.push(action)
  }
  return actions.slice(0, 5)
}

function normalizeEvent(raw: unknown): ProactiveCareEvent | null {
  if (!isObject(raw)) return null
  const id = normalizeText(raw.id)
  const source = raw.source
  const outcome = raw.outcome
  const reason = normalizeText(raw.reason)
  if (!id || !VALID_SOURCES.has(source as ProactiveCareSource)) return null
  if (!VALID_OUTCOMES.has(outcome as ProactiveCareOutcome) || !reason) return null

  const sourceRef = normalizeSourceRef(raw.sourceRef)
  const carePolicyVersion = normalizeCarePolicyVersion(raw.carePolicyVersion)
  const userVisibleReason = normalizeText(raw.userVisibleReason, '')
  const userAction = normalizeUserAction(raw.userAction)
  return {
    id,
    source: source as ProactiveCareSource,
    outcome: outcome as ProactiveCareOutcome,
    reason,
    detail: normalizeText(raw.detail, reason),
    createdAt: normalizeIso(raw.createdAt),
    occurrences: normalizeOccurrenceCount(raw.occurrences),
    ...(carePolicyVersion ? { carePolicyVersion } : {}),
    ...(userVisibleReason ? { userVisibleReason } : {}),
    ...(userAction ? { userAction } : {}),
    ...(sourceRef ? { sourceRef } : {}),
  }
}

function normalizeSourceRef(raw: unknown): ProactiveCareSourceRef | undefined {
  if (!isObject(raw)) return undefined
  const kind = normalizeText(raw.kind)
  const id = normalizeText(raw.id)
  if (!VALID_SOURCE_REF_KINDS.has(kind as ProactiveCareSourceRefKind) || !id) return undefined
  const label = normalizeText(raw.label)
  return {
    kind: kind as ProactiveCareSourceRefKind,
    id,
    ...(label ? { label } : {}),
  }
}

function hasChanged(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) !== JSON.stringify(right)
}

export function resolveProactiveCareSourceRefNavigation(
  sourceRef: ProactiveCareSourceRef,
): ProactiveCareSourceRefNavigation {
  if (sourceRef.kind === 'message') {
    return {
      section: 'history',
      historySourceRef: `chat:${sourceRef.id}`,
    }
  }

  return {
    section: 'autonomy',
    focus: resolveProactiveCareAutonomyFocus(sourceRef),
  }
}

function isOpenableProactiveCareSourceRef(sourceRef: ProactiveCareSourceRef): boolean {
  const navigation = resolveProactiveCareSourceRefNavigation(sourceRef)
  if (navigation.section === 'history') return Boolean(navigation.historySourceRef.trim())
  return navigation.focus !== 'unknown'
}

export function resolveProactiveCareAutonomyFocus(
  sourceRef: ProactiveCareSourceRef,
): ProactiveCareAutonomyFocus {
  if (sourceRef.kind === 'scheduler') {
    if (VALID_SOURCES.has(sourceRef.id as ProactiveCareSource)) {
      return sourceRef.id as ProactiveCareSource
    }
    return 'unknown'
  }
  if (sourceRef.kind === 'bracket') return 'daily_bracket'
  if (sourceRef.kind === 'errand') return 'errand'
  if (sourceRef.kind === 'arc') return 'arc'
  if (sourceRef.kind === 'capsule') return 'capsule'
  return 'unknown'
}

export function normalizeProactiveCareEvents(raw: unknown): ProactiveCareEvent[] {
  if (!Array.isArray(raw)) return []
  return raw
    .map(normalizeEvent)
    .filter((event): event is ProactiveCareEvent => Boolean(event))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, MAX_EVENTS)
}

export function buildProactiveCareEventsExport(
  inputEvents: readonly ProactiveCareEvent[],
  generatedAt = new Date().toISOString(),
): ProactiveCareEventsExport {
  return {
    schemaVersion: 1,
    kind: 'nexus.proactive-care-events-export',
    generatedAt: normalizeIso(generatedAt),
    containsPrivateEventRows: true,
    usage: {
      command: 'npm run proactive:care:evidence -- --events-file artifacts/proactive-care-events.json --output artifacts/v0.3.4/proactive-care-evidence.json --require-ready',
    },
    events: normalizeProactiveCareEvents([...inputEvents]),
  }
}

export function loadProactiveCareEvents(): ProactiveCareEvent[] {
  const raw = readJson<unknown>(PROACTIVE_CARE_EVENTS_STORAGE_KEY, [])
  const normalized = normalizeProactiveCareEvents(raw)
  if (hasChanged(normalized, raw)) {
    writeJson(PROACTIVE_CARE_EVENTS_STORAGE_KEY, normalized)
  }
  return normalized
}

export function saveProactiveCareEvents(events: ProactiveCareEvent[]): void {
  writeJson(PROACTIVE_CARE_EVENTS_STORAGE_KEY, normalizeProactiveCareEvents(events))
}

function shouldMergeEvent(
  prev: ProactiveCareEvent | undefined,
  draft: ProactiveCareEvent,
): prev is ProactiveCareEvent {
  if (!prev) return false
  if (prev.source !== draft.source) return false
  if (prev.outcome !== draft.outcome) return false
  if (prev.reason !== draft.reason) return false
  if (prev.detail !== draft.detail) return false
  if (prev.carePolicyVersion !== draft.carePolicyVersion) return false
  if (prev.userVisibleReason !== draft.userVisibleReason) return false
  if (prev.userAction !== draft.userAction) return false
  if (JSON.stringify(prev.sourceRef ?? null) !== JSON.stringify(draft.sourceRef ?? null)) return false
  const prevMs = Date.parse(prev.createdAt)
  const nextMs = Date.parse(draft.createdAt)
  if (!Number.isFinite(prevMs) || !Number.isFinite(nextMs)) return false
  return Math.abs(nextMs - prevMs) <= DEDUPE_WINDOW_MS
}

export function recordProactiveCareEvent(draft: ProactiveCareEventDraft): ProactiveCareEvent | null {
  if (!VALID_SOURCES.has(draft.source) || !VALID_OUTCOMES.has(draft.outcome)) return null
  const reason = normalizeText(draft.reason)
  if (!reason) return null

  const sourceRef = normalizeSourceRef(draft.sourceRef)
  const userAction = normalizeUserAction(draft.userAction)
  const event: ProactiveCareEvent = {
    id: createId('proactive-care'),
    source: draft.source,
    outcome: draft.outcome,
    reason,
    detail: normalizeText(draft.detail, reason),
    createdAt: normalizeIso(draft.createdAt),
    occurrences: 1,
    carePolicyVersion: draft.carePolicyVersion ?? 2,
    userVisibleReason: normalizeText(
      draft.userVisibleReason,
      defaultUserVisibleReason({ ...draft, reason }),
    ),
    ...(userAction ? { userAction } : {}),
    ...(sourceRef ? { sourceRef } : {}),
  }

  const current = loadProactiveCareEvents()
  const [head, ...rest] = current
  const next = shouldMergeEvent(head, event)
    ? [{ ...head, createdAt: event.createdAt, occurrences: Math.min(999, head.occurrences + 1) }, ...rest]
    : [event, ...current]
  saveProactiveCareEvents(next.slice(0, MAX_EVENTS))
  return next[0] ?? null
}

export function recordProactiveCareUserAction(
  eventId: string,
  userAction: ProactiveCareUserAction,
): ProactiveCareEvent | null {
  const normalizedEventId = normalizeText(eventId)
  const normalizedAction = normalizeUserAction(userAction)
  if (!normalizedEventId || !normalizedAction) return null

  const events = loadProactiveCareEvents()
  let updatedEvent: ProactiveCareEvent | null = null
  const nextEvents = events.map((event) => {
    if (event.id !== normalizedEventId) return event
    updatedEvent = {
      ...event,
      carePolicyVersion: event.carePolicyVersion ?? 2,
      userVisibleReason: event.userVisibleReason || event.detail || event.reason,
      userAction: normalizedAction,
    }
    return updatedEvent
  })
  if (!updatedEvent) return null
  saveProactiveCareEvents(nextEvents)
  return updatedEvent
}

export function clearProactiveCareEvents(): void {
  writeJson(PROACTIVE_CARE_EVENTS_STORAGE_KEY, [])
}

export function buildProactiveCareEvidenceReport(
  inputEvents: readonly ProactiveCareEvent[],
  generatedAt = new Date().toISOString(),
): ProactiveCareEvidenceReport {
  const events = normalizeProactiveCareEvents([...inputEvents])
  const outcomeCounts = { ...EMPTY_OUTCOME_COUNTS }
  const sourceCounts = createEmptySourceCounts()
  const reasonCounts: Record<string, number> = {}
  const decisionWindowCounts = createEmptyDecisionWindowCounts()
  let sourceRefCount = 0
  let openableSourceRefCount = 0
  let totalOccurrences = 0
  let quietHoursSkipCount = 0
  let rateLimitSkipCount = 0
  let v2EventCount = 0
  let userVisibleReasonCount = 0
  const userActionCounts = createEmptyUserActionCounts()

  for (const event of events) {
    totalOccurrences += event.occurrences
    outcomeCounts[event.outcome] += event.occurrences
    const source = sourceCounts[event.source]
    source.events += 1
    source.occurrences += event.occurrences
    source[event.outcome] += event.occurrences
    updateSourceWindow(source, event.createdAt)
    reasonCounts[event.reason] = (reasonCounts[event.reason] ?? 0) + event.occurrences
    const decisionWindow = classifyDecisionWindow(event)
    if (decisionWindow) {
      decisionWindowCounts[decisionWindow] += event.occurrences
      source.decisionWindowCounts[decisionWindow] += event.occurrences
    }
    if (event.sourceRef) {
      sourceRefCount += 1
      source.withSourceRef += 1
      if (isOpenableProactiveCareSourceRef(event.sourceRef)) {
        openableSourceRefCount += 1
        source.withOpenableSourceRef += 1
      }
    }
    if (event.outcome === 'skipped' && QUIET_HOURS_REASONS.has(event.reason)) {
      quietHoursSkipCount += event.occurrences
    }
    if (event.outcome === 'skipped' && RATE_LIMIT_REASONS.has(event.reason)) {
      rateLimitSkipCount += event.occurrences
    }
    if (event.carePolicyVersion === 2) {
      v2EventCount += 1
    }
    if (event.userVisibleReason) {
      userVisibleReasonCount += 1
    }
    if (event.userAction) {
      userActionCounts[event.userAction] += event.occurrences
    }
  }

  const missingSourceRefCount = Math.max(0, events.length - sourceRefCount)
  for (const source of Object.values(sourceCounts)) {
    source.sourceRefCoverage = roundRatio(source.withSourceRef, source.events)
    source.openableSourceRefCoverage = roundRatio(source.withOpenableSourceRef, source.events)
    finalizeSourceWindow(source)
  }
  const oldest = events.length ? events[events.length - 1] : null
  const newest = events[0] ?? null
  const oldestMs = oldest ? Date.parse(oldest.createdAt) : NaN
  const newestMs = newest ? Date.parse(newest.createdAt) : NaN
  const coverageWindowMs = Number.isFinite(oldestMs) && Number.isFinite(newestMs)
    ? Math.max(0, newestMs - oldestMs)
    : 0
  const coverageWindowHours = Math.round((coverageWindowMs / 3_600_000) * 100) / 100
  const sourceRefCoverage = roundRatio(sourceRefCount, events.length)
  const openableSourceRefCoverage = roundRatio(openableSourceRefCount, events.length)
  const observedSourceCount = Object.values(sourceCounts).filter((source) => source.events > 0).length
  const keyDecisionWindowCount = [
    decisionWindowCounts.due_item,
    decisionWindowCounts.quiet_hours,
    decisionWindowCounts.rate_limited,
  ].filter((count) => count > 0).length
  const qualityIssues = buildProactiveCareQualityIssues(
    sourceCounts,
    events.length,
    sourceRefCoverage,
    openableSourceRefCoverage,
    coverageWindowMs,
    decisionWindowCounts,
  )
  const checks: ProactiveCareEvidenceCheck[] = [
    {
      id: 'has-events',
      pass: events.length > 0,
      detail: `${events.length} event(s), ${totalOccurrences} occurrence(s)`,
    },
    {
      id: 'has-fired',
      pass: outcomeCounts.fired > 0,
      detail: `${outcomeCounts.fired} fired occurrence(s)`,
    },
    {
      id: 'has-skipped',
      pass: outcomeCounts.skipped > 0,
      detail: `${outcomeCounts.skipped} skipped occurrence(s)`,
    },
    {
      id: 'has-quiet-hours-skip',
      pass: quietHoursSkipCount > 0,
      detail: `${quietHoursSkipCount} quiet-hours skipped occurrence(s)`,
    },
    {
      id: 'has-rate-limit-skip',
      pass: rateLimitSkipCount > 0,
      detail: `${rateLimitSkipCount} rate-limit skipped occurrence(s)`,
    },
    {
      id: 'has-key-decision-window-coverage',
      pass: keyDecisionWindowCount === 3,
      detail: `${keyDecisionWindowCount}/3 key decision window(s) observed`,
    },
    {
      id: 'has-source-refs',
      pass: sourceRefCount > 0,
      detail: `${sourceRefCount} event(s) with sourceRef; ${missingSourceRefCount} without`,
    },
    {
      id: 'has-openable-source-refs',
      pass: openableSourceRefCount > 0,
      detail: `${openableSourceRefCount} event source reference(s) route to History or Autonomy`,
    },
    {
      id: 'has-source-ref-coverage',
      pass: events.length > 0 && sourceRefCoverage >= 0.5,
      detail: `${Math.round(sourceRefCoverage * 100)}% of events include a sourceRef`,
    },
    {
      id: 'has-openable-source-ref-coverage',
      pass: events.length > 0 && openableSourceRefCoverage >= 0.5,
      detail: `${Math.round(openableSourceRefCoverage * 100)}% of events include an openable sourceRef`,
    },
    {
      id: 'has-all-sources-observed',
      pass: observedSourceCount === VALID_SOURCES.size,
      detail: `${observedSourceCount}/${VALID_SOURCES.size} proactive sources observed`,
    },
    {
      id: 'has-multi-hour-coverage',
      pass: coverageWindowMs >= MULTI_HOUR_COVERAGE_MS,
      detail: `${coverageWindowHours}h covered between first and latest event`,
    },
    {
      id: 'has-v2-policy-events',
      pass: v2EventCount > 0,
      detail: `${v2EventCount} event(s) recorded with carePolicyVersion=2`,
    },
    {
      id: 'has-user-visible-reasons',
      pass: userVisibleReasonCount > 0,
      detail: `${userVisibleReasonCount} event(s) include userVisibleReason`,
    },
    {
      id: 'has-user-feedback-actions',
      pass: Object.values(userActionCounts).some((count) => count > 0),
      detail: Object.entries(userActionCounts)
        .map(([action, count]) => `${action}=${count}`)
        .join(', '),
    },
  ]
  const nextActions = buildProactiveCareNextActions(checks)

  return {
    schemaVersion: 1,
    gate: 'proactive-care-observability',
    generatedAt: normalizeIso(generatedAt),
    totalEvents: events.length,
    totalOccurrences,
    firstEventAt: oldest?.createdAt ?? null,
    lastEventAt: newest?.createdAt ?? null,
    coverageWindowMs,
    coverageWindowHours,
    outcomeCounts,
    sourceCounts,
    reasonCounts,
    decisionWindowCounts,
    keyDecisionWindowCount,
    sourceRefCount,
    missingSourceRefCount,
    openableSourceRefCount,
    sourceRefCoverage,
    openableSourceRefCoverage,
    quietHoursSkipCount,
    rateLimitSkipCount,
    qualityIssueCount: qualityIssues.length,
    qualityIssues,
    v2EventCount,
    userVisibleReasonCount,
    userActionCounts,
    checks,
    nextActions,
    latestEvents: events.slice(0, MAX_REPORT_EVENTS),
  }
}

function toPublicSourceRefEvidence(
  sourceRef: ProactiveCareSourceRef | undefined,
): PublicProactiveCareSourceRefEvidence | undefined {
  if (!sourceRef) return undefined
  const navigation = resolveProactiveCareSourceRefNavigation(sourceRef)
  const openable = isOpenableProactiveCareSourceRef(sourceRef)
  if (navigation.section === 'history') {
    return {
      kind: sourceRef.kind,
      openable,
      route: 'history',
    }
  }

  return {
    kind: sourceRef.kind,
    openable,
    route: navigation.focus === 'unknown' ? 'unknown' : 'autonomy',
    ...(navigation.focus === 'unknown' ? {} : { focus: navigation.focus }),
  }
}

function buildPublicReasonCounts(reasonCounts: Record<string, number>): Record<string, number> {
  const publicCounts: Record<string, number> = {}
  for (const [reason, count] of Object.entries(reasonCounts)) {
    const publicReason = toPublicReason(reason)
    publicCounts[publicReason] = (publicCounts[publicReason] ?? 0) + count
  }
  return publicCounts
}

export function redactProactiveCareEvidenceReport(
  report: ProactiveCareEvidenceReport,
): PublicProactiveCareEvidenceReport {
  return {
    ...report,
    ok: report.checks.every((check) => check.pass),
    privacy: {
      privateFieldsOmitted: [
        'latestEvents.id',
        'latestEvents.detail',
        'latestEvents.userVisibleReason',
        'latestEvents.sourceRef.id',
        'latestEvents.sourceRef.label',
        'nonCodeReasonStrings',
      ],
    },
    reasonCounts: buildPublicReasonCounts(report.reasonCounts),
    latestEvents: report.latestEvents.map((event) => {
      const sourceRef = toPublicSourceRefEvidence(event.sourceRef)
      return {
        source: event.source,
        outcome: event.outcome,
        reason: toPublicReason(event.reason),
        createdAt: event.createdAt,
        occurrences: event.occurrences,
        ...(event.carePolicyVersion ? { carePolicyVersion: event.carePolicyVersion } : {}),
        hasUserVisibleReason: Boolean(event.userVisibleReason),
        ...(event.userAction ? { userAction: event.userAction } : {}),
        ...(sourceRef ? { sourceRef } : {}),
      }
    }),
  }
}

export function buildPublicProactiveCareEvidenceReport(
  inputEvents: readonly ProactiveCareEvent[],
  generatedAt = new Date().toISOString(),
): PublicProactiveCareEvidenceReport {
  return redactProactiveCareEvidenceReport(
    buildProactiveCareEvidenceReport(inputEvents, generatedAt),
  )
}

export function subscribeProactiveCareEvents(
  callback: (events: ProactiveCareEvent[]) => void,
): () => void {
  return onStorageChange(PROACTIVE_CARE_EVENTS_STORAGE_KEY, (value) => {
    callback(normalizeProactiveCareEvents(value))
  })
}
