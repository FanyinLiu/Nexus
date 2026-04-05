/**
 * Settings schema migration registry.
 *
 * Each migration transforms a raw settings object from one schema version to
 * the next. Migrations run sequentially (oldest-first) during loadSettings()
 * whenever the stored version is behind CURRENT_SETTINGS_SCHEMA_VERSION.
 *
 * To add a new migration:
 *   1. Bump CURRENT_SETTINGS_SCHEMA_VERSION
 *   2. Append a SettingsMigration entry to `migrations`
 */

export const CURRENT_SETTINGS_SCHEMA_VERSION = 1

export interface SettingsMigration {
  toVersion: number
  description: string
  migrate: (raw: Record<string, unknown>) => Record<string, unknown>
}

const migrations: SettingsMigration[] = [
  // Version 1: initial schema — no transformation needed, just stamps the version.
]

export function migrateSettings(
  raw: Record<string, unknown>,
  fromVersion: number,
): Record<string, unknown> {
  let current = { ...raw }

  for (const migration of migrations) {
    if (migration.toVersion > fromVersion) {
      current = migration.migrate(current)
    }
  }

  current.settingsSchemaVersion = CURRENT_SETTINGS_SCHEMA_VERSION
  return current
}
