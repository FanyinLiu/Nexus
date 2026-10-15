/**
 * Voice auto-detect public surface: language tags, tier mapping, the
 * per-language plan, and the explicit apply step.
 */

export {
  applyVoiceSuggestion,
  shouldAlignStockVoiceLanguage,
  voiceSuggestionChangesSettings,
} from './applyVoiceSuggestion.ts'
export { mapVoiceTier } from './hardwareTier.ts'
export { profileFromProbe, selectVoiceProfile } from './selectVoiceProfile.ts'
export {
  configuredVoiceLanguages,
  defaultEdgeVoiceForLanguage,
  migrateVoiceLanguageValue,
  resolveStoredVoiceLanguage,
} from './voiceLanguages.ts'
