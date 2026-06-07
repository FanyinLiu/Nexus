// Public surface for the safety / crisis-response feature.
//
// Modules in this folder satisfy the SB 243 / NY companion-safeguards /
// EU AI Act requirements documented in docs/ROADMAP.md → Tier 1.1.
//
// Other code in the app should depend on this barrel rather than
// reaching into specific files, so the internal layout can move.

export { detectCrisisSignal } from './crisisDetect.ts'
export {
  buildCrisisSecondPassPrompt,
  classifyCrisisSecondPass,
  clearResolvedCrisisSignalCache,
  getRememberedCrisisSignal,
  mergeCrisisSecondPassDecision,
  parseCrisisSecondPassResponse,
} from './crisisSecondPass.ts'
export { buildCrisisGuidance } from './crisisGuidance.ts'
export { HOTLINES, primaryHotline } from './hotlines.ts'
export {
  presentCrisis,
  dismissCrisis,
  shouldPresentCrisisPanel,
  useCrisisPanelState,
} from './crisisPanelState.ts'
export { CrisisHotlinePanel } from './CrisisHotlinePanel.tsx'
export type { CrisisSecondPassDecision, CrisisSecondPassRunner } from './crisisSecondPass.ts'
export type { CrisisSeverity, CrisisSignal, Hotline } from './types.ts'
