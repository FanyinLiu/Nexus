import {
  AUTONOMY_EMOTION_HISTORY_STORAGE_KEY,
  AUTONOMY_EMOTION_STORAGE_KEY,
  AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY,
  AUTONOMY_RELATIONSHIP_STORAGE_KEY,
  AUTONOMY_RHYTHM_STORAGE_KEY,
  AGENT_TRACE_STORAGE_KEY,
  BACKGROUND_TASKS_STORAGE_KEY,
  COMPANION_LOCAL_DATA_AUTHORITY_CONSENT_KEY,
  ERRAND_STORE_STORAGE_KEY,
  OPEN_GOALS_STORAGE_KEY,
  PLAN_STORE_STORAGE_KEY,
  REMINDER_TASKS_STORAGE_KEY,
  USER_AFFECT_HISTORY_STORAGE_KEY,
} from './core.ts'
import type { CompanionLocalDataStorageKey } from './core.ts'

export const COMPANION_LOCAL_DATA_AUTHORITY_CHANGED_EVENT = 'nexus:companion-local-data-authority-changed'
const COMPANION_MIGRATION_PACKAGE_SCHEMA_VERSION = 1 as const

const RELATIONSHIP_DATASETS = [
  ['relationship-state', AUTONOMY_RELATIONSHIP_STORAGE_KEY],
  ['relationship-history', AUTONOMY_RELATIONSHIP_HISTORY_STORAGE_KEY],
  ['emotion-state', AUTONOMY_EMOTION_STORAGE_KEY],
  ['emotion-history', AUTONOMY_EMOTION_HISTORY_STORAGE_KEY],
  ['rhythm-state', AUTONOMY_RHYTHM_STORAGE_KEY],
  ['user-affect-history', USER_AFFECT_HISTORY_STORAGE_KEY],
] as const

const TASK_DATASETS = [
  ['plans', PLAN_STORE_STORAGE_KEY],
  ['open-goals', OPEN_GOALS_STORAGE_KEY],
  ['agent-traces', AGENT_TRACE_STORAGE_KEY],
  ['background-tasks', BACKGROUND_TASKS_STORAGE_KEY],
  ['errands', ERRAND_STORE_STORAGE_KEY],
  ['reminder-tasks', REMINDER_TASKS_STORAGE_KEY],
] as const

type CompanionDataset = {
  id: string
  storageKey: CompanionLocalDataStorageKey
  value: unknown
}

export type CompanionLocalDataMigrationPackage = {
  schemaVersion: typeof COMPANION_MIGRATION_PACKAGE_SCHEMA_VERSION
  createdAt: string
  source: {
    relationshipKeysPresent: string[]
    taskKeysPresent: string[]
    invalidKeys: string[]
  }
  relationship: CompanionDataset[]
  tasks: CompanionDataset[]
}

function getStorage(): Storage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

function parseStoredValue(storage: Storage, storageKey: string, invalidKeys: string[]): unknown {
  const raw = storage.getItem(storageKey)
  if (!raw) return null
  try {
    return JSON.parse(raw) as unknown
  } catch {
    invalidKeys.push(storageKey)
    return null
  }
}

function datasetFromStorage(
  storage: Storage,
  [id, storageKey]: readonly [string, CompanionLocalDataStorageKey],
  invalidKeys: string[],
): CompanionDataset {
  return { id, storageKey, value: parseStoredValue(storage, storageKey, invalidKeys) }
}

export function isCompanionLocalDataMigrationFeatureEnabled(): boolean {
  return import.meta.env?.VITE_NEXUS_ENABLE_LOCAL_DATA_COMPANION_MIGRATION === '1'
}

export function isCompanionLocalDataMigrationUiEnabled(): boolean {
  return import.meta.env?.VITE_NEXUS_ENABLE_LOCAL_DATA_COMPANION_MIGRATION_UI === '1'
}

export function getCompanionLocalDataAuthorityConsent(): boolean {
  return getStorage()?.getItem(COMPANION_LOCAL_DATA_AUTHORITY_CONSENT_KEY) === '1'
}

export function isCompanionLocalDataAuthorityActive(): boolean {
  return isCompanionLocalDataMigrationFeatureEnabled() && getCompanionLocalDataAuthorityConsent()
}

export function setCompanionLocalDataAuthorityConsent(enabled: boolean): void {
  const storage = getStorage()
  if (!storage) return
  if (enabled) storage.setItem(COMPANION_LOCAL_DATA_AUTHORITY_CONSENT_KEY, '1')
  else storage.removeItem(COMPANION_LOCAL_DATA_AUTHORITY_CONSENT_KEY)
  try {
    window.dispatchEvent(new Event(COMPANION_LOCAL_DATA_AUTHORITY_CHANGED_EVENT))
  } catch {
    // Event delivery is best-effort in non-DOM test environments.
  }
}

export function buildCompanionLocalDataMigrationPackage(now = new Date()): CompanionLocalDataMigrationPackage {
  const storage = getStorage()
  const invalidKeys: string[] = []
  const relationship = storage
    ? RELATIONSHIP_DATASETS.map((dataset) => datasetFromStorage(storage, dataset, invalidKeys))
      .filter((dataset) => dataset.value != null)
    : []
  const tasks = storage
    ? TASK_DATASETS.map((dataset) => datasetFromStorage(storage, dataset, invalidKeys))
      .filter((dataset) => dataset.value != null)
    : []
  const relationshipKeysPresent = relationship.filter((dataset) => dataset.value != null).map((dataset) => dataset.storageKey)
  const taskKeysPresent = tasks.filter((dataset) => dataset.value != null).map((dataset) => dataset.storageKey)
  return {
    schemaVersion: COMPANION_MIGRATION_PACKAGE_SCHEMA_VERSION,
    createdAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
    source: { relationshipKeysPresent, taskKeysPresent, invalidKeys },
    relationship,
    tasks,
  }
}

export function buildCompanionLocalDataComparisonSource(now = new Date()) {
  const migrationPackage = buildCompanionLocalDataMigrationPackage(now)
  const toComparisonDataset = (dataset: CompanionDataset) => {
    const json = JSON.stringify(dataset.value)
    return {
      id: dataset.id,
      storageKey: dataset.storageKey,
      recordCount: Array.isArray(dataset.value) ? dataset.value.length : 1,
      payloadBytes: new TextEncoder().encode(json).byteLength,
    }
  }
  return {
    schemaVersion: migrationPackage.schemaVersion,
    generatedAt: migrationPackage.createdAt,
    relationship: migrationPackage.relationship.map(toComparisonDataset),
    tasks: migrationPackage.tasks.map(toComparisonDataset),
  }
}

export type CompanionLocalDataReadResult = {
  attempted: boolean
  relationship: CompanionDataset[] | null
  tasks: CompanionDataset[] | null
  reason: string | null
}

export async function readCompanionFromLocalData(): Promise<CompanionLocalDataReadResult> {
  if (!isCompanionLocalDataAuthorityActive()) {
    return { attempted: false, relationship: null, tasks: null, reason: 'companion-authority-disabled' }
  }
  const read = window.desktopPet?.localDataReadCompanion
  if (typeof read !== 'function') {
    return { attempted: false, relationship: null, tasks: null, reason: 'companion-authority-bridge-unavailable' }
  }
  try {
    const result = await read()
    if (!result.ok) return { attempted: true, relationship: null, tasks: null, reason: result.errorKind || 'companion-authority-read-failed' }
    return { attempted: true, relationship: result.relationship, tasks: result.tasks, reason: null }
  } catch {
    return { attempted: true, relationship: null, tasks: null, reason: 'companion-authority-read-failed' }
  }
}

export async function hydrateCompanionLocalDataCache(): Promise<boolean> {
  const result = await readCompanionFromLocalData()
  const storage = getStorage()
  if (!storage || !result.relationship || !result.tasks) return false
  for (const dataset of [...result.relationship, ...result.tasks]) {
    try {
      storage.setItem(dataset.storageKey, JSON.stringify(dataset.value))
    } catch {
      return false
    }
  }
  return result.reason === null
}

export type CompanionLocalDataStatus = Awaited<ReturnType<NonNullable<Window['desktopPet']>['localDataCompanionMigrationStatus']>>
