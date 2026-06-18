import type { AppLocale } from '../../types/i18n.ts'
import { buildCrisisGuidance } from '../safety/crisisGuidance.ts'
import { detectCrisisSignal } from '../safety/crisisDetect.ts'
import { HOTLINES } from '../safety/hotlines.ts'
import type { CrisisSignal } from '../safety/types.ts'

export type PrivacySafetyEvidenceCheckId =
  | 'ai-companion-disclosure'
  | 'crisis-response-support'
  | 'age-and-market-boundaries'

export interface PrivacySafetyBoundaryPolicy {
  aiDisclosureRequired: true
  adultOrNsfwMarketplaceAllowed: false
  dependencyReinforcementMechanicsAllowed: false
  humanRelationshipSubstituteClaimAllowed: false
  minorDirectedExperienceAllowed: false
  relationshipScoreMechanicsAllowed: false
}

export interface PrivacySafetyEvidenceCheck {
  id: PrivacySafetyEvidenceCheckId
  pass: boolean
  detail: string
  evidence: Record<string, unknown>
}

export interface PrivacySafetyEvidenceReport {
  schemaVersion: 1
  gate: 'v0.4-privacy-safety-boundaries'
  generatedAt: string
  ok: boolean
  policy: PrivacySafetyBoundaryPolicy
  checks: PrivacySafetyEvidenceCheck[]
  failedCheckIds: PrivacySafetyEvidenceCheckId[]
  privacy: {
    privateFieldsOmitted: string[]
  }
}

const SUPPORTED_LOCALES: AppLocale[] = ['en-US', 'zh-CN', 'zh-TW', 'ja', 'ko']

const CRISIS_SMOKE_PHRASES: Record<AppLocale, string> = {
  'en-US': 'I want to die',
  'zh-CN': '我不想活了',
  'zh-TW': '我不想活了',
  ja: '死にたい',
  ko: '죽고 싶어',
}

const DEFAULT_POLICY: PrivacySafetyBoundaryPolicy = {
  adultOrNsfwMarketplaceAllowed: false,
  aiDisclosureRequired: true,
  dependencyReinforcementMechanicsAllowed: false,
  humanRelationshipSubstituteClaimAllowed: false,
  minorDirectedExperienceAllowed: false,
  relationshipScoreMechanicsAllowed: false,
}

function normalizeIso(value: string | undefined): string {
  const parsed = value ? Date.parse(value) : NaN
  if (!Number.isFinite(parsed)) return new Date().toISOString()
  return new Date(parsed).toISOString()
}

function hasText(value: string | null | undefined): boolean {
  return Boolean(value?.trim())
}

function getCrisisSmokeSignals(): CrisisSignal[] {
  return SUPPORTED_LOCALES
    .map((locale) => detectCrisisSignal(CRISIS_SMOKE_PHRASES[locale], locale))
    .filter((signal): signal is CrisisSignal => Boolean(signal))
}

function buildChecks(policy: PrivacySafetyBoundaryPolicy): PrivacySafetyEvidenceCheck[] {
  const crisisSignals = getCrisisSmokeSignals()
  const crisisGuidance = buildCrisisGuidance({
    signal: {
      locale: 'en-US',
      matchedPhrase: 'I want to die',
      severity: 'medium',
      source: 'pattern',
    },
    uiLanguage: 'en-US',
  })
  const guidanceBlocksMethods = crisisGuidance.includes('Do NOT discuss methods')
  const guidanceBlocksMedicalAdvice = crisisGuidance.includes('Do NOT give medical advice')
  const guidancePointsToHumanSupport = crisisGuidance.includes('people trained to help')
  const hotlineLocalesWithSource = SUPPORTED_LOCALES.filter((locale) => {
    const entries = HOTLINES[locale] ?? []
    return entries.length > 0 && entries.every((entry) => hasText(entry.sourceUrl))
  })

  return [
    {
      id: 'ai-companion-disclosure',
      pass: policy.aiDisclosureRequired && !policy.humanRelationshipSubstituteClaimAllowed,
      detail: policy.aiDisclosureRequired && !policy.humanRelationshipSubstituteClaimAllowed
        ? 'AI disclosure is required and human-relationship replacement claims are blocked.'
        : 'AI disclosure or human-relationship boundary policy is incomplete.',
      evidence: {
        aiDisclosureRequired: policy.aiDisclosureRequired,
        humanRelationshipSubstituteClaimAllowed: policy.humanRelationshipSubstituteClaimAllowed,
        reminderPosture: 'initial-disclosure-plus-periodic-reminders',
      },
    },
    {
      id: 'crisis-response-support',
      pass: crisisSignals.length === SUPPORTED_LOCALES.length
        && guidanceBlocksMethods
        && guidanceBlocksMedicalAdvice
        && guidancePointsToHumanSupport
        && hotlineLocalesWithSource.length === SUPPORTED_LOCALES.length,
      detail: `${crisisSignals.length}/${SUPPORTED_LOCALES.length} locale smoke signal(s); ${hotlineLocalesWithSource.length}/${SUPPORTED_LOCALES.length} hotline locale(s) have source URLs.`,
      evidence: {
        detectedLocales: crisisSignals.map((signal) => signal.locale),
        guidanceBlocksMethods,
        guidanceBlocksMedicalAdvice,
        guidancePointsToHumanSupport,
        hotlineLocalesWithSource,
      },
    },
    {
      id: 'age-and-market-boundaries',
      pass: !policy.adultOrNsfwMarketplaceAllowed
        && !policy.minorDirectedExperienceAllowed
        && !policy.dependencyReinforcementMechanicsAllowed
        && !policy.relationshipScoreMechanicsAllowed,
      detail: 'Adult marketplace, minor-directed positioning, dependency mechanics, and relationship scores are disabled for v0.4.',
      evidence: {
        adultOrNsfwMarketplaceAllowed: policy.adultOrNsfwMarketplaceAllowed,
        dependencyReinforcementMechanicsAllowed: policy.dependencyReinforcementMechanicsAllowed,
        minorDirectedExperienceAllowed: policy.minorDirectedExperienceAllowed,
        relationshipScoreMechanicsAllowed: policy.relationshipScoreMechanicsAllowed,
      },
    },
  ]
}

export function buildPrivacySafetyEvidenceReport(
  options: {
    generatedAt?: string
    policy?: PrivacySafetyBoundaryPolicy
  } = {},
): PrivacySafetyEvidenceReport {
  const policy = options.policy ?? DEFAULT_POLICY
  const checks = buildChecks(policy)
  const failedCheckIds = checks
    .filter((check) => !check.pass)
    .map((check) => check.id)

  return {
    schemaVersion: 1,
    gate: 'v0.4-privacy-safety-boundaries',
    generatedAt: normalizeIso(options.generatedAt),
    ok: failedCheckIds.length === 0,
    policy,
    checks,
    failedCheckIds,
    privacy: {
      privateFieldsOmitted: [
        'user messages',
        'crisis matched text beyond built-in smoke phrases',
        'hotline panel interaction history',
        'message sender/body/source ids',
      ],
    },
  }
}
