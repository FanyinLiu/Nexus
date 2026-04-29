// Chat provider failover orchestration.
//
// Builds the candidate list and executes a chat request through the shared
// executeWithFailover orchestrator, returning the response along with which
// provider answered and any settings patch the caller should apply (e.g. to
// switch UI to the fallback provider).
//
// Candidate expansion:
//   1. For the primary providerId, AuthProfileStore may hold multiple API
//      keys. Each active key becomes its own FailoverCandidate so the
//      orchestrator automatically rotates through keys on rate-limit errors.
//   2. The settings' own apiKey is appended as the last "default" candidate
//      when no auth profile matches, preserving backward compatibility.
//   3. If chatFailoverEnabled and the primary isn't Ollama, an Ollama
//      fallback is appended at the tail.

import type {
  AppSettings,
  ChatCompletionRequest,
  ChatCompletionResponse,
  ChatMessage,
  MemoryRecallContext,
} from '../../types'
import { apiProviderRequiresApiKey, getApiProviderPreset } from '../../lib/apiProviders'
import { getCoreRuntime } from '../../lib/coreRuntime'
import { t } from '../../i18n/runtime.ts'
import { executeWithFailover, type FailoverCandidate } from '../failover/orchestrator.ts'
import {
  buildChatRequestPayload,
  type AssistantReplyRequestOptions,
} from './systemPromptBuilder'

type ChatCandidatePayload = {
  settings: AppSettings
  settingsPatch?: Partial<AppSettings>
  authProfileId?: string
}

export type AssistantReplyRuntimeResult = {
  response: ChatCompletionResponse
  providerId: string
  usedFallback: boolean
  settingsPatch?: Partial<AppSettings>
  authProfileId?: string
  /** The first successfully dispatched request payload — used for cost accounting. */
  requestPayload?: ChatCompletionRequest
}

function buildChatFailoverCandidates(settings: AppSettings): FailoverCandidate<ChatCandidatePayload>[] {
  const { authStore } = getCoreRuntime()
  const candidates: FailoverCandidate<ChatCandidatePayload>[] = []
  const seenKeys = new Set<string>()

  const primaryAuthProfiles = authStore
    .list(settings.apiProviderId)
    .filter((p) => p.status !== 'failed')

  for (const profile of primaryAuthProfiles) {
    const key = profile.apiKey.trim()
    if (!key || seenKeys.has(key)) continue
    seenKeys.add(key)
    candidates.push({
      id: `${settings.apiProviderId}#${profile.id}`,
      identity: `${settings.apiProviderId}|${settings.apiBaseUrl}|${settings.model}|${profile.id}`,
      payload: {
        settings: { ...settings, apiKey: key },
        authProfileId: profile.id,
      },
    })
  }

  const primaryKey = settings.apiKey.trim()
  if (!primaryKey || !seenKeys.has(primaryKey)) {
    candidates.push({
      id: settings.apiProviderId,
      identity: `${settings.apiProviderId}|${settings.apiBaseUrl}|${settings.model}`,
      payload: { settings },
    })
    if (primaryKey) seenKeys.add(primaryKey)
  }

  if (!settings.chatFailoverEnabled || settings.apiProviderId === 'ollama') {
    return candidates
  }

  const ollamaPreset = getApiProviderPreset('ollama')
  const ollamaSettings: AppSettings = {
    ...settings,
    apiProviderId: ollamaPreset.id,
    apiBaseUrl: ollamaPreset.baseUrl,
    apiKey: '',
    model: ollamaPreset.defaultModel,
  }
  candidates.push({
    id: ollamaPreset.id,
    identity: `${ollamaPreset.id}|${ollamaPreset.baseUrl}|${ollamaPreset.defaultModel}`,
    payload: {
      settings: ollamaSettings,
      settingsPatch: {
        apiProviderId: ollamaPreset.id,
        apiBaseUrl: ollamaPreset.baseUrl,
        apiKey: '',
        model: ollamaPreset.defaultModel,
      },
    },
  })

  return candidates
}

export async function executeChatRequestWithFailover(
  settings: AppSettings,
  history: ChatMessage[],
  memoryContext: MemoryRecallContext,
  options: AssistantReplyRequestOptions,
  execute: (payload: ChatCompletionRequest) => Promise<ChatCompletionResponse>,
) {
  if (!window.desktopPet?.completeChat) {
    throw new Error('Desktop pet client is not wired up in the current environment.')
  }

  if (!settings.apiBaseUrl || !settings.model) {
    throw new Error(t('chat.failover.no_api_base'))
  }

  const hasAnyActiveAuthProfile = getCoreRuntime()
    .authStore.list(settings.apiProviderId)
    .some((p) => p.status === 'active' && p.apiKey.trim().length > 0)

  if (
    apiProviderRequiresApiKey(settings.apiProviderId)
    && !settings.apiKey.trim()
    && !hasAnyActiveAuthProfile
  ) {
    throw new Error(t('chat.failover.no_api_key'))
  }

  const candidates = buildChatFailoverCandidates(settings)
  const { authStore } = getCoreRuntime()

  // Capture the first successfully built payload so callers can use it for
  // cost accounting (system prompt length, tool schemas, message images, etc.)
  // without rebuilding the prompt a second time.
  let capturedPayload: ChatCompletionRequest | undefined

  const result = await executeWithFailover<ChatCandidatePayload, ChatCompletionResponse>({
    domain: 'chat',
    candidates,
    failoverEnabled: settings.chatFailoverEnabled || candidates.length > 1,
    execute: async (candidate) => {
      const payload = await buildChatRequestPayload(candidate.payload.settings, history, memoryContext, options)
      capturedPayload = payload
      return execute(payload)
    },
    onEvent: (event) => {
      if (event.type === 'success') {
        const hit = candidates.find((c) => c.id === event.candidateId)
        const authId = hit?.payload.authProfileId
        if (authId) authStore.recordSuccess(authId)
      } else if (event.type === 'failure' && event.eligible) {
        const hit = candidates.find((c) => c.id === event.candidateId)
        const authId = hit?.payload.authProfileId
        if (authId) {
          const reason: 'rate_limit' | 'auth' | 'other' =
            /rate.?limit|429|quota/i.test(event.error) ? 'rate_limit'
            : /unauthori[sz]ed|invalid.*key|401|403/i.test(event.error) ? 'auth'
            : 'other'
          authStore.recordFailure(authId, reason)
        }
      }
    },
  })

  const matched = candidates.find((c) => c.id === result.candidateId)
  return {
    response: result.result,
    providerId: result.candidateId,
    usedFallback: result.usedFallback,
    settingsPatch: matched?.payload.settingsPatch,
    authProfileId: matched?.payload.authProfileId,
    requestPayload: capturedPayload,
  } satisfies AssistantReplyRuntimeResult
}
