// Barrel re-export so external code can `import { ... } from '../lib/storage'`
// regardless of which submodule actually owns the symbol.
//
// Layout:
//   core.ts          — STORAGE_KEY constants, readJson/writeJson(/Debounced), createId
//   chat.ts          — chat message persistence
//   chatMigrationDryRun.ts — content-free chat localStorage migration audit
//   chatMigrationPreview.ts — content-free settings preview for the chat migration audit
//   chatLocalDataRuntimeMirror.ts — hidden chat SQLite runtime mirror consent
//   memory.ts        — long-term + daily memory persistence
//   memoryMigrationDryRun.ts — content-free memory localStorage migration audit
//   voice.ts         — voice pipeline state + trace
//   reminders.ts     — reminder task persistence
//   debugConsole.ts  — debug console event log
//   onboarding.ts    — onboarding completion flag
//   presence.ts      — ambient presence + activity timestamps + history
//   pet.ts           — pet window prefs + runtime state
//   autonomy.ts      — goals + proactive scheduler persisted state
//   settings.ts      — AppSettings load/save (the heavy migration + normalization piece)

export * from './core.ts'
export * from './chat.ts'
export * from './chatSessions.ts'
export * from './chatMigrationDryRun.ts'
export * from './chatMigrationPreview.ts'
export * from './chatLocalDataRuntimeMirror.ts'
export * from './lorebooks.ts'
export * from './pendingGreeting.ts'
export * from './memory.ts'
export * from './memoryMigrationDryRun.ts'
export * from './voice.ts'
export * from './reminders.ts'
export * from './debugConsole.ts'
export * from './onboarding.ts'
export * from './presence.ts'
export * from './pet.ts'
export * from './autonomy.ts'
export * from './settings.ts'
export * from './authProfiles.ts'
export * from './costEntries.ts'
