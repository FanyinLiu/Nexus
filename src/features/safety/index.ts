// Public surface for the safety / crisis-response feature.
//
// Modules in this folder satisfy the SB 243 / NY companion-safeguards /
// EU AI Act requirements documented in docs/ROADMAP.md → Tier 1.1.
//
// Other code in the app should depend on this barrel rather than
// reaching into specific files, so the internal layout can move.

export { detectCrisisSignal } from './crisisDetect.ts'
export { HOTLINES, primaryHotline } from './hotlines.ts'
export type { CrisisSeverity, CrisisSignal, Hotline } from './types.ts'
