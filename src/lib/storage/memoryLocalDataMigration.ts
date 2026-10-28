import {
  DAILY_MEMORY_STORAGE_KEY,
  LEGACY_MEMORY_STORAGE_KEY,
  MEMORY_LOCAL_DATA_AUTHORITY_CONSENT_KEY,
} from './core.ts'
import {
  normalizeDailyMemoryStore,
  normalizeMemoryItemsForStorage,
  readLongTermMemoryMigrationSource,
} from './memory.ts'
import type { DailyMemoryEntry, MemoryItem } from '../../types/memory.ts'
import type { MemoryMigrationDryRunReport } from './memoryMigrationDryRun.ts'
import { nowIso } from '../localDate.ts'

type EnvLike = Record<string, string | boolean | undefined>

const MEMORY_MIGRATION_PACKAGE_SCHEMA_VERSION = 1 as const
export const MEMORY_LOCAL_DATA_AUTHORITY_CHANGED_EVENT = 'nexus:memory-local-data-authority-changed'

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

function parseRaw(raw: string | null, fallback: unknown): unknown {
  if (!raw) return fallback
  try {
    return JSON.parse(raw) as unknown
  } catch {
    throw new Error('memory migration source JSON is invalid')
  }
}

function flattenDailyMemories(store: Record<string, DailyMemoryEntry[]>): DailyMemoryEntry[] {
  return Object.values(store)
    .flat()
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
}

function getImportMetaEnv(): EnvLike | undefined {
  return (import.meta as ImportMeta & { env?: EnvLike }).env
}

export function isMemoryLocalDataMigrationFeatureEnabled(): boolean {
  // Default-on since v0.4.6: the build-time opt-in flag is retired. A
  // build may still force the feature off with
  // VITE_NEXUS_ENABLE_LOCAL_DATA_MEMORY_MIGRATION=0 as an emergency
  // circuit breaker. The runtime consent layer
  // (getMemoryLocalDataAuthorityConsent) remains the user-facing
  // control — nothing migrates until the user authorises it.
  return import.meta.env?.VITE_NEXUS_ENABLE_LOCAL_DATA_MEMORY_MIGRATION !== '0'
}

export function isMemoryLocalDataMigrationUiEnabled(env: EnvLike | undefined = getImportMetaEnv()): boolean {
  // Default-on since v0.4.6, mirroring the feature flag: the migration
  // panel is a normal settings entry now. Set ..._UI=0 to hide it.
  return env?.VITE_NEXUS_ENABLE_LOCAL_DATA_MEMORY_MIGRATION_UI !== '0'
}

export function getMemoryLocalDataAuthorityConsent(): boolean {
  return getStorage()?.getItem(MEMORY_LOCAL_DATA_AUTHORITY_CONSENT_KEY) === '1'
}

export function setMemoryLocalDataAuthorityConsent(enabled: boolean): void {
  const storage = getStorage()
  if (!storage) return
  if (enabled) storage.setItem(MEMORY_LOCAL_DATA_AUTHORITY_CONSENT_KEY, '1')
  else storage.removeItem(MEMORY_LOCAL_DATA_AUTHORITY_CONSENT_KEY)
  try {
    window.dispatchEvent(new Event(MEMORY_LOCAL_DATA_AUTHORITY_CHANGED_EVENT))
  } catch {
    // Browser event dispatch is best-effort for non-DOM test environments.
  }
}

export function isMemoryLocalDataAuthorityActive(): boolean {
  return isMemoryLocalDataMigrationFeatureEnabled() && getMemoryLocalDataAuthorityConsent()
}

export type MemoryLocalDataMigrationPackage = {
  schemaVersion: typeof MEMORY_MIGRATION_PACKAGE_SCHEMA_VERSION
  createdAt: string
  source: {
    longTermKeyPresent: boolean
    legacyLongTermKeyPresent: boolean
    dailyKeyPresent: boolean
    legacyLongTermUsed: boolean
  }
  longTerm: Array<MemoryItem & { enabled: boolean }>
  daily: DailyMemoryEntry[]
}

export function buildMemoryLocalDataMigrationPackage(
  now = new Date(),
): MemoryLocalDataMigrationPackage {
  const storage = getStorage()
  const legacyRaw = storage?.getItem(LEGACY_MEMORY_STORAGE_KEY) ?? null
  const dailyRaw = storage?.getItem(DAILY_MEMORY_STORAGE_KEY) ?? null
  // Long-term memory lives in the main-process file store after hydration;
  // loadMemories() still falls back to localStorage in browser preview. The
  // legacy key is read directly because it is only a migration source.
  const longTermSource = readLongTermMemoryMigrationSource()
  const longTermKeyPresent = longTermSource.canonicalPresent
  const current = longTermSource.memories
  const legacy = normalizeMemoryItemsForStorage(parseRaw(legacyRaw, []))
  const daily = normalizeDailyMemoryStore(parseRaw(dailyRaw, {}))
  return buildMemoryLocalDataMigrationPackageFromState(
    longTermKeyPresent ? current : legacy,
    daily,
    now,
    {
      longTermKeyPresent,
      legacyLongTermKeyPresent: Boolean(legacyRaw),
      dailyKeyPresent: Boolean(dailyRaw),
      legacyLongTermUsed: !longTermKeyPresent && legacy.length > 0,
    },
  )
}

export function buildMemoryLocalDataMigrationPackageFromState(
  memories: MemoryItem[],
  dailyMemories: Record<string, DailyMemoryEntry[]>,
  now = new Date(),
  source: MemoryLocalDataMigrationPackage['source'] = {
    longTermKeyPresent: false,
    legacyLongTermKeyPresent: false,
    dailyKeyPresent: false,
    legacyLongTermUsed: false,
  },
): MemoryLocalDataMigrationPackage {
  const longTerm = normalizeMemoryItemsForStorage(memories).map((memory) => ({
    ...memory,
    enabled: memory.enabled !== false,
  }))
  const daily = normalizeDailyMemoryStore(dailyMemories)
  return {
    schemaVersion: MEMORY_MIGRATION_PACKAGE_SCHEMA_VERSION,
    createdAt: nowIso(now),
    source,
    longTerm,
    daily: flattenDailyMemories(daily),
  }
}

export interface MemoryMigrationBackupEnvelope {
  format: 'nexus-memory-migration-backup'
  schemaVersion: 1
  exportedAt: string
  includesMessageContent: true
  warning: 'This backup contains full memory content.'
  source: MemoryLocalDataMigrationPackage['source']
  totals: {
    longTermMemoryCount: number
    dailyEntryCount: number
    payloadBytes: number
  }
  migrationPackage: MemoryLocalDataMigrationPackage
}

export function canExportMemoryMigrationBackup(
  report: MemoryMigrationDryRunReport,
  uiEnabled: boolean = isMemoryLocalDataMigrationUiEnabled(),
): boolean {
  return uiEnabled
    && report.status !== 'blocked'
    && (report.migrationPlan.wouldCreateLongTermRecords > 0
      || report.migrationPlan.wouldCreateDailyEntryRecords > 0)
}

export function buildMemoryMigrationBackupEnvelope(
  migrationPackage: MemoryLocalDataMigrationPackage,
  options: { now?: Date | string | number } = {},
): MemoryMigrationBackupEnvelope {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(migrationPackage)).length

  return {
    format: 'nexus-memory-migration-backup',
    schemaVersion: 1,
    exportedAt: nowIso(options.now),
    includesMessageContent: true,
    warning: 'This backup contains full memory content.',
    source: { ...migrationPackage.source },
    totals: {
      longTermMemoryCount: migrationPackage.longTerm.length,
      dailyEntryCount: migrationPackage.daily.length,
      payloadBytes,
    },
    migrationPackage,
  }
}

export function buildMemoryMigrationBackupFileName(exportedAt: string): string {
  const stamp = exportedAt
    .replace(/[:.]/g, '-')
    .replace(/[^0-9A-Za-zTZ-]/g, '-')
  return `nexus-memory-migration-backup-${stamp}.json`
}

export type MemoryLocalDataReadResult = {
  attempted: boolean
  memories: MemoryItem[] | null
  daily: DailyMemoryEntry[] | null
  reason: string | null
}

export async function readMemoryFromLocalData(): Promise<MemoryLocalDataReadResult> {
  if (!isMemoryLocalDataAuthorityActive()) {
    return { attempted: false, memories: null, daily: null, reason: 'memory-authority-disabled' }
  }
  const readMemory = window.desktopPet?.localDataReadMemory
  if (typeof readMemory !== 'function') {
    return { attempted: false, memories: null, daily: null, reason: 'memory-authority-bridge-unavailable' }
  }
  try {
    const result = await readMemory()
    if (!result.ok) {
      return { attempted: true, memories: null, daily: null, reason: result.errorKind || 'memory-authority-read-failed' }
    }
    return {
      attempted: true,
      memories: result.memories as unknown as MemoryItem[],
      daily: result.daily as unknown as DailyMemoryEntry[],
      reason: null,
    }
  } catch {
    return { attempted: true, memories: null, daily: null, reason: 'memory-authority-read-failed' }
  }
}

export async function syncMemoryToLocalData(
  memories: MemoryItem[],
  dailyMemories: Record<string, DailyMemoryEntry[]>,
): Promise<boolean> {
  if (!isMemoryLocalDataAuthorityActive()) return false
  const applyMemoryMigration = window.desktopPet?.localDataApplyMemoryMigration
  if (typeof applyMemoryMigration !== 'function') return false
  try {
    const packageForBridge = buildMemoryLocalDataMigrationPackageFromState(memories, dailyMemories) as unknown as Parameters<typeof applyMemoryMigration>[0]['migrationPackage']
    const result = await applyMemoryMigration({
      confirmed: true,
      migrationPackage: packageForBridge,
    })
    return result.ok === true && result.applied === true
  } catch {
    return false
  }
}
