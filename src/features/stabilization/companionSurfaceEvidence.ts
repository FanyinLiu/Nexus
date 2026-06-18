import type { AppSettings, CharacterProfile } from '../../types/app.ts'
import {
  buildPetActionMapReport,
  type PetActionMapReport,
} from '../pet/actionMap.ts'
import type { PetModelDefinition } from '../pet/models.ts'

export type CompanionSurfaceEvidenceCheckId =
  | 'has-pet-model'
  | 'has-action-map-coverage'
  | 'has-action-map-editor-targets'
  | 'has-character-profiles'
  | 'has-active-profile-preset'
  | 'has-keyless-voice-preset'

export interface CompanionSurfaceEvidenceCheck {
  id: CompanionSurfaceEvidenceCheckId
  pass: boolean
  detail: string
}

export type CompanionSurfaceQualityIssueSeverity = 'info' | 'warning'

export interface CompanionSurfaceQualityIssue {
  id: string
  severity: CompanionSurfaceQualityIssueSeverity
  detail: string
}

export interface CompanionSurfaceEvidenceReport {
  schemaVersion: 1
  gate: 'companion-surface-observability'
  generatedAt: string
  petModel: {
    present: boolean
    kind: 'live2d' | 'sprite' | 'missing'
    hasActionMapReport: boolean
  }
  actionMap: {
    expressionSlots: number
    mappedExpressions: number
    publicGestures: number
    mappedGestures: number
    lifecycleMotions: number
    mappedLifecycleMotions: number
    presenceStates: number
    mappedPresenceStates: number
    idleFidgets: number
    missing: number
    coverage: number
    overrideCount: number
    activeModelHasOverride: boolean
  }
  characterProfiles: {
    total: number
    hasActiveProfile: boolean
    profilesWithPetPreset: number
    profilesWithVoicePreset: number
    profilesWithInstructions: number
    profilePersonaInChatEnabled: boolean
  }
  voicePreset: {
    activeHasProvider: boolean
    activeHasVoice: boolean
    activeHasModel: boolean
    activeHasInstructions: boolean
    activeUsesKeylessOrLocalProvider: boolean
  }
  checks: CompanionSurfaceEvidenceCheck[]
  qualityIssueCount: number
  qualityIssues: CompanionSurfaceQualityIssue[]
}

export type CompanionSurfaceEvidenceSettings = Pick<
  AppSettings,
  | 'activeCharacterProfileId'
  | 'characterProfiles'
  | 'petActionMapOverrides'
  | 'petModelId'
  | 'profilePersonaInChatEnabled'
  | 'speechOutputInstructions'
  | 'speechOutputModel'
  | 'speechOutputProviderId'
  | 'speechOutputVoice'
>

const KEYLESS_OR_LOCAL_TTS_PROVIDERS = new Set([
  'edge-tts',
  'local-tts',
])

function normalizeIso(value: string | undefined): string {
  const parsed = value ? Date.parse(value) : NaN
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

function hasText(value: unknown): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

function roundRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 1000) / 1000
}

function countProfileWhere(
  profiles: readonly CharacterProfile[],
  predicate: (profile: CharacterProfile) => boolean,
): number {
  return profiles.filter(predicate).length
}

function summarizeActionMap(
  report: PetActionMapReport | null,
  settings: CompanionSurfaceEvidenceSettings,
) {
  const totalSlots = report
    ? report.summary.expressionSlots
      + report.summary.publicGestures
      + report.summary.lifecycleMotions
      + report.summary.presenceStates
      + report.summary.idleFidgets
    : 0
  const mappedSlots = report ? totalSlots - report.summary.missing : 0
  const overrideIds = Object.keys(settings.petActionMapOverrides ?? {})
  const activeModelHasOverride = Boolean(settings.petModelId && settings.petActionMapOverrides?.[settings.petModelId])

  return {
    expressionSlots: report?.summary.expressionSlots ?? 0,
    mappedExpressions: report?.summary.mappedExpressions ?? 0,
    publicGestures: report?.summary.publicGestures ?? 0,
    mappedGestures: report?.summary.mappedGestures ?? 0,
    lifecycleMotions: report?.summary.lifecycleMotions ?? 0,
    mappedLifecycleMotions: report?.summary.mappedLifecycleMotions ?? 0,
    presenceStates: report?.summary.presenceStates ?? 0,
    mappedPresenceStates: report?.summary.mappedPresenceStates ?? 0,
    idleFidgets: report?.summary.idleFidgets ?? 0,
    missing: report?.summary.missing ?? 0,
    coverage: roundRatio(mappedSlots, totalSlots),
    overrideCount: overrideIds.length,
    activeModelHasOverride,
  }
}

function buildCompanionSurfaceQualityIssues(report: {
  actionMap: CompanionSurfaceEvidenceReport['actionMap']
  characterProfiles: CompanionSurfaceEvidenceReport['characterProfiles']
  petModel: CompanionSurfaceEvidenceReport['petModel']
  voicePreset: CompanionSurfaceEvidenceReport['voicePreset']
}): CompanionSurfaceQualityIssue[] {
  const issues: CompanionSurfaceQualityIssue[] = []

  if (!report.petModel.present) {
    issues.push({
      id: 'missing-pet-model',
      severity: 'warning',
      detail: 'No active pet model is available for companion surface evidence.',
    })
  } else if (report.petModel.kind === 'live2d' && report.actionMap.missing > 0) {
    issues.push({
      id: 'incomplete-live2d-action-map',
      severity: 'warning',
      detail: `${report.actionMap.missing} Live2D action target(s) are missing.`,
    })
  }

  if (report.petModel.kind === 'live2d' && !report.actionMap.activeModelHasOverride) {
    issues.push({
      id: 'no-active-action-map-override',
      severity: 'info',
      detail: 'The active Live2D model has no saved action-map override yet.',
    })
  }

  if (report.characterProfiles.total === 0) {
    issues.push({
      id: 'no-character-profiles',
      severity: 'warning',
      detail: 'No character profiles are available for role/package evidence.',
    })
  } else if (!report.characterProfiles.hasActiveProfile) {
    issues.push({
      id: 'no-active-character-profile',
      severity: 'warning',
      detail: 'Character profiles exist, but no active profile is selected.',
    })
  }

  if (report.characterProfiles.total > 0 && report.characterProfiles.profilesWithVoicePreset === 0) {
    issues.push({
      id: 'no-profile-voice-presets',
      severity: 'info',
      detail: 'No character profile carries a voice preset.',
    })
  }

  if (!report.voicePreset.activeUsesKeylessOrLocalProvider) {
    issues.push({
      id: 'active-voice-not-keyless-or-local',
      severity: 'info',
      detail: 'The active profile/settings voice path is not a keyless or local provider.',
    })
  }

  return issues
}

export function buildCompanionSurfaceEvidenceReport(
  settings: CompanionSurfaceEvidenceSettings,
  petModel: PetModelDefinition | undefined,
  options: { generatedAt?: string } = {},
): CompanionSurfaceEvidenceReport {
  const actionMapReport = petModel ? buildPetActionMapReport(petModel) : null
  const activeProfile = settings.characterProfiles.find((profile) => profile.id === settings.activeCharacterProfileId)
  const activeVoiceProvider = activeProfile?.speechOutputProviderId || settings.speechOutputProviderId
  const activeVoice = activeProfile?.speechOutputVoice || settings.speechOutputVoice
  const activeVoiceModel = activeProfile?.speechOutputModel || settings.speechOutputModel
  const activeVoiceInstructions = activeProfile?.speechOutputInstructions || settings.speechOutputInstructions
  const actionMap = summarizeActionMap(actionMapReport, settings)
  const characterProfiles = {
    total: settings.characterProfiles.length,
    hasActiveProfile: Boolean(activeProfile),
    profilesWithPetPreset: countProfileWhere(settings.characterProfiles, (profile) => hasText(profile.petModelId)),
    profilesWithVoicePreset: countProfileWhere(settings.characterProfiles, (profile) => (
      hasText(profile.speechOutputProviderId)
      || hasText(profile.speechOutputVoice)
      || hasText(profile.speechOutputModel)
      || hasText(profile.speechOutputInstructions)
    )),
    profilesWithInstructions: countProfileWhere(settings.characterProfiles, (profile) => hasText(profile.speechOutputInstructions)),
    profilePersonaInChatEnabled: settings.profilePersonaInChatEnabled,
  }
  const voicePreset = {
    activeHasProvider: hasText(activeVoiceProvider),
    activeHasVoice: hasText(activeVoice),
    activeHasModel: hasText(activeVoiceModel),
    activeHasInstructions: hasText(activeVoiceInstructions),
    activeUsesKeylessOrLocalProvider: KEYLESS_OR_LOCAL_TTS_PROVIDERS.has(activeVoiceProvider),
  }
  const petModelSummary = {
    present: Boolean(petModel),
    kind: actionMapReport?.model.kind ?? 'missing',
    hasActionMapReport: Boolean(actionMapReport),
  } satisfies CompanionSurfaceEvidenceReport['petModel']
  const qualityIssues = buildCompanionSurfaceQualityIssues({
    actionMap,
    characterProfiles,
    petModel: petModelSummary,
    voicePreset,
  })
  const checks: CompanionSurfaceEvidenceCheck[] = [
    {
      id: 'has-pet-model',
      pass: petModelSummary.present,
      detail: petModelSummary.present ? `${petModelSummary.kind} pet model available` : 'no active pet model',
    },
    {
      id: 'has-action-map-coverage',
      pass: petModelSummary.kind === 'sprite' || (petModelSummary.present && actionMap.missing === 0),
      detail: `${Math.round(actionMap.coverage * 100)}% action coverage; ${actionMap.missing} missing target(s)`,
    },
    {
      id: 'has-action-map-editor-targets',
      pass: petModelSummary.hasActionMapReport && (
        actionMap.expressionSlots > 0
        || actionMap.publicGestures > 0
        || actionMap.lifecycleMotions > 0
        || actionMap.presenceStates > 0
      ),
      detail: `${actionMap.expressionSlots} expression slot(s), ${actionMap.publicGestures} gesture(s), ${actionMap.lifecycleMotions} lifecycle motion(s), ${actionMap.presenceStates} presence state(s)`,
    },
    {
      id: 'has-character-profiles',
      pass: characterProfiles.total > 0,
      detail: `${characterProfiles.total} character profile(s)`,
    },
    {
      id: 'has-active-profile-preset',
      pass: characterProfiles.hasActiveProfile && characterProfiles.profilesWithPetPreset > 0,
      detail: `${characterProfiles.profilesWithPetPreset} profile(s) carry pet presets; active=${characterProfiles.hasActiveProfile}`,
    },
    {
      id: 'has-keyless-voice-preset',
      pass: voicePreset.activeUsesKeylessOrLocalProvider && voicePreset.activeHasVoice,
      detail: `keyless/local=${voicePreset.activeUsesKeylessOrLocalProvider}; voice=${voicePreset.activeHasVoice}`,
    },
  ]

  return {
    schemaVersion: 1,
    gate: 'companion-surface-observability',
    generatedAt: normalizeIso(options.generatedAt),
    petModel: petModelSummary,
    actionMap,
    characterProfiles,
    voicePreset,
    checks,
    qualityIssueCount: qualityIssues.length,
    qualityIssues,
  }
}
