import type {
  ChatMigrationDryRunIssue,
  ChatMigrationDryRunReport,
  ChatMigrationDryRunStatus,
  ChatStorageMigrationPackage,
} from './chatMigrationDryRun.ts'
import { loadChatStorageMigrationPackage } from './chatMigrationDryRun.ts'

type EnvLike = Record<string, string | boolean | undefined>

export type ChatMigrationPreviewTone = 'idle' | 'success' | 'warning' | 'error'

export interface ChatMigrationPreviewSummary {
  enabled: boolean
  status: ChatMigrationDryRunStatus
  tone: ChatMigrationPreviewTone
  canApply: boolean
  canExportBackup: boolean
  sessionCount: number
  messageCount: number
  userMessageCount: number
  assistantMessageCount: number
  systemMessageCount: number
  toolResultMessageCount: number
  reasoningMessageCount: number
  estimatedContentBytes: number
  sourceBytes: number
  sessionsKeyPresent: boolean
  legacyFlatChatKeyPresent: boolean
  legacyFlatChatUsed: boolean
  legacyFlatChatIgnoredBecauseSessionsExist: boolean
  firstMessageAt: string | null
  lastMessageAt: string | null
  issueCounts: {
    info: number
    warning: number
    error: number
  }
  issues: ChatMigrationDryRunIssue[]
  safety: {
    requiresUserConfirmation: true
    dryRunWritesRecords: false
    includesMessageContent: false
    rendererLocalStorageAuthority: true
  }
}

export interface ChatMigrationBackupEnvelope {
  format: 'nexus-chat-migration-backup'
  schemaVersion: 1
  exportedAt: string
  includesMessageContent: true
  warning: 'This backup contains full chat message content.'
  source: ChatStorageMigrationPackage['source']
  totals: {
    sessionCount: number
    messageCount: number
    dryRunStatus: ChatMigrationDryRunStatus
    payloadBytes: number
  }
  migrationPackage: ChatStorageMigrationPackage
}

export interface ChatMigrationComparisonSourceSession {
  id: string
  startedAt: number
  lastActiveAt: number
  messageCount: number
  payloadBytes: number
}

export interface ChatMigrationComparisonSource {
  schemaVersion: 1
  generatedAt: string
  source: ChatStorageMigrationPackage['source']
  sessions: ChatMigrationComparisonSourceSession[]
}

export type ChatMigrationComparisonSourceResult =
  | {
      ok: true
      report: ChatMigrationDryRunReport
      source: ChatMigrationComparisonSource
    }
  | {
      ok: false
      reason: 'dry-run-blocked'
      report: ChatMigrationDryRunReport
    }

function getImportMetaEnv(): EnvLike | undefined {
  return (import.meta as ImportMeta & { env?: EnvLike }).env
}

export function isChatMigrationPreviewEnabled(env: EnvLike | undefined = getImportMetaEnv()): boolean {
  return env?.VITE_NEXUS_ENABLE_LOCAL_DATA_CHAT_MIGRATION_UI === '1'
}

function nowIso(now: Date | string | number = new Date()): string {
  return now instanceof Date ? now.toISOString() : new Date(now).toISOString()
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function toneForStatus(status: ChatMigrationDryRunStatus): ChatMigrationPreviewTone {
  switch (status) {
    case 'ready':
      return 'success'
    case 'needs_review':
      return 'warning'
    case 'blocked':
      return 'error'
    case 'empty':
    default:
      return 'idle'
  }
}

export function buildChatMigrationPreviewSummary(
  report: ChatMigrationDryRunReport,
  env?: EnvLike,
): ChatMigrationPreviewSummary {
  const enabled = isChatMigrationPreviewEnabled(env)
  const issueCounts = report.issues.reduce<ChatMigrationPreviewSummary['issueCounts']>((counts, issue) => {
    counts[issue.severity] += 1
    return counts
  }, {
    info: 0,
    warning: 0,
    error: 0,
  })
  const sourceBytes = report.source.sessions.bytes + report.source.legacyFlatChat.bytes
  const hasMigrationData = report.migrationPlan.wouldCreateSessionRecords > 0
    && report.migrationPlan.wouldCreateMessageRecords > 0
  const canApply = enabled
    && report.status !== 'blocked'
    && report.status !== 'empty'
    && hasMigrationData

  return {
    enabled,
    status: report.status,
    tone: toneForStatus(report.status),
    canApply,
    canExportBackup: enabled && report.status !== 'blocked' && hasMigrationData,
    sessionCount: report.totals.sessionCount,
    messageCount: report.totals.messageCount,
    userMessageCount: report.totals.userMessageCount,
    assistantMessageCount: report.totals.assistantMessageCount,
    systemMessageCount: report.totals.systemMessageCount,
    toolResultMessageCount: report.totals.toolResultMessageCount,
    reasoningMessageCount: report.totals.reasoningMessageCount,
    estimatedContentBytes: report.totals.estimatedContentBytes,
    sourceBytes,
    sessionsKeyPresent: report.source.sessions.present,
    legacyFlatChatKeyPresent: report.source.legacyFlatChat.present,
    legacyFlatChatUsed: report.migrationPlan.legacyFlatChatWouldCreateSession,
    legacyFlatChatIgnoredBecauseSessionsExist: report.migrationPlan.legacyFlatChatIgnoredBecauseSessionsExist,
    firstMessageAt: report.totals.firstMessageAt,
    lastMessageAt: report.totals.lastMessageAt,
    issueCounts,
    issues: report.issues.map((issue) => ({ ...issue })),
    safety: {
      requiresUserConfirmation: report.migrationPlan.requiresUserConfirmation,
      dryRunWritesRecords: report.migrationPlan.writeRecords,
      includesMessageContent: report.migrationPlan.includesMessageContent,
      rendererLocalStorageAuthority: report.migrationPlan.rendererLocalStorageAuthority,
    },
  }
}

export function buildChatMigrationBackupEnvelope(
  migrationPackage: ChatStorageMigrationPackage,
  options: { now?: Date | string | number } = {},
): ChatMigrationBackupEnvelope {
  const messageCount = migrationPackage.sessions.reduce(
    (count, session) => count + session.messages.length,
    0,
  )
  const payloadBytes = byteLength(JSON.stringify(migrationPackage))

  return {
    format: 'nexus-chat-migration-backup',
    schemaVersion: 1,
    exportedAt: nowIso(options.now),
    includesMessageContent: true,
    warning: 'This backup contains full chat message content.',
    source: { ...migrationPackage.source },
    totals: {
      sessionCount: migrationPackage.sessions.length,
      messageCount,
      dryRunStatus: migrationPackage.dryRunReport.status,
      payloadBytes,
    },
    migrationPackage,
  }
}

export function buildChatMigrationBackupFileName(exportedAt: string): string {
  const stamp = exportedAt
    .replace(/[:.]/g, '-')
    .replace(/[^0-9A-Za-zTZ-]/g, '-')
  return `nexus-chat-migration-backup-${stamp}.json`
}

export function buildChatMigrationComparisonSource(
  migrationPackage: ChatStorageMigrationPackage,
): ChatMigrationComparisonSource {
  return {
    schemaVersion: 1,
    generatedAt: migrationPackage.createdAt,
    source: { ...migrationPackage.source },
    sessions: migrationPackage.sessions.map((session) => ({
      id: session.id,
      startedAt: Math.max(0, Math.round(session.startedAt)),
      lastActiveAt: Math.max(0, Math.round(session.lastActiveAt)),
      messageCount: session.messages.length,
      payloadBytes: byteLength(JSON.stringify(session)),
    })),
  }
}

export function loadChatMigrationComparisonSource(): ChatMigrationComparisonSourceResult {
  const packageResult = loadChatStorageMigrationPackage()
  if (!packageResult.ok) {
    return {
      ok: false,
      reason: packageResult.reason,
      report: packageResult.report,
    }
  }

  return {
    ok: true,
    report: packageResult.report,
    source: buildChatMigrationComparisonSource(packageResult.migrationPackage),
  }
}
