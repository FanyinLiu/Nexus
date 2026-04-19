// Barrel re-export so external code can `import { ... } from '../lib/storage'`
// regardless of which submodule actually owns the symbol.
//
// Layout:
//   core.ts          — STORAGE_KEY constants, readJson/writeJson(/Debounced), createId
//   chat.ts          — chat message persistence
//   memory.ts        — long-term + daily memory persistence
//   voice.ts         — voice pipeline state + trace
//   reminders.ts     — reminder task persistence
//   debugConsole.ts  — debug console event log
//   onboarding.ts    — onboarding completion flag
//   presence.ts      — ambient presence + activity timestamps + history
//   pet.ts           — pet window prefs + runtime state
//   settings.ts      — AppSettings load/save (the heavy migration + normalization piece)

export * from './core.ts'
export * from './chat.ts'
export * from './chatSessions.ts'
export * from './lorebooks.ts'
export * from './memory.ts'
export * from './subagents.ts'
export * from './voice.ts'
export * from './reminders.ts'
export * from './debugConsole.ts'
export * from './onboarding.ts'
export * from './presence.ts'
export * from './pet.ts'
export * from './settings.ts'
export * from './authProfiles.ts'
export * from './costEntries.ts'
