import type { TranslationKey, TranslationParams } from '../../types/i18n.ts'
import { FIRST_CONVERSATION_TARGET_MINUTES } from './companionReadiness.ts'
import type { FirstConversationTelemetryStatus } from './firstConversationTelemetry.ts'
import type { StartupStatusItem, StartupStatusSummary } from './startupStatusView.ts'

export type FirstRunQaReportTranslator = (
  key: TranslationKey,
  params?: TranslationParams,
) => string

export type FirstRunQaReportItem = {
  id: StartupStatusItem['id']
  status: StartupStatusItem['status']
  labelKey: TranslationKey
  label?: string
  detailKey: TranslationKey
  detail?: string
  detailParams?: TranslationParams
}

export type FirstRunQaReport = {
  schemaVersion: 1
  generatedAt: string
  targetMinutes: number
  firstConversation: FirstConversationTelemetryStatus
  startupStatus: {
    warningCount: number
    items: FirstRunQaReportItem[]
  }
  privacy: {
    includesApiKeys: false
    includesMessageContent: false
    includesModelOutput: false
    includesProviderSecrets: false
  }
}

type BuildFirstRunQaReportInput = {
  summary: StartupStatusSummary
  firstConversationStatus?: FirstConversationTelemetryStatus
  generatedAt?: Date | string
  translate?: FirstRunQaReportTranslator
}

function normalizeGeneratedAt(value: Date | string | undefined) {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value.toISOString()
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString()
  }
  return new Date().toISOString()
}

function normalizeFirstConversationStatus(
  status: FirstConversationTelemetryStatus | undefined,
): FirstConversationTelemetryStatus {
  return status ?? {
    status: 'not_recorded',
    targetMinutes: FIRST_CONVERSATION_TARGET_MINUTES,
  }
}

export function buildFirstRunQaReport({
  summary,
  firstConversationStatus,
  generatedAt,
  translate,
}: BuildFirstRunQaReportInput): FirstRunQaReport {
  const firstConversation = normalizeFirstConversationStatus(firstConversationStatus)

  return {
    schemaVersion: 1,
    generatedAt: normalizeGeneratedAt(generatedAt),
    targetMinutes: firstConversation.targetMinutes,
    firstConversation,
    startupStatus: {
      warningCount: summary.warningCount,
      items: summary.items.map((item) => ({
        id: item.id,
        status: item.status,
        labelKey: item.labelKey,
        ...(translate ? { label: translate(item.labelKey) } : {}),
        detailKey: item.detailKey,
        ...(translate ? { detail: translate(item.detailKey, item.detailParams) } : {}),
        ...(item.detailParams ? { detailParams: item.detailParams } : {}),
      })),
    },
    privacy: {
      includesApiKeys: false,
      includesMessageContent: false,
      includesModelOutput: false,
      includesProviderSecrets: false,
    },
  }
}
