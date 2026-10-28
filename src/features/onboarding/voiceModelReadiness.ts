/**
 * Which tip the onboarding voice step shows.
 *
 * The step used to claim "voice is ready" no matter what was on disk.
 * The ready line now needs the required models plus the models the
 * chosen local providers run on. Without an inventory — a browser, or a
 * failed IPC call — the step says nothing rather than guessing.
 */

import type { TranslationKey } from '../../types/i18n.ts'

export type VoiceModelReadinessStatus = 'ready' | 'models_missing' | 'unknown'

export type VoiceModelInventoryEntry = {
  id: string
  present: boolean
}

export type VoiceModelInventory = {
  ready: boolean
  models: VoiceModelInventoryEntry[]
}

export type VoiceModelReadinessInput = {
  inventory: VoiceModelInventory | null
  speechInputProviderId: string
  speechOutputProviderId: string
}

export type VoiceModelReadiness = {
  status: VoiceModelReadinessStatus
  messageKey: TranslationKey | null
}

/** Catalog model each local speech provider needs on disk. */
const SPEECH_INPUT_MODEL_BY_PROVIDER: Record<string, string> = {
  'local-sensevoice': 'sensevoice',
  'local-paraformer': 'paraformer-zh-en',
}

const SPEECH_OUTPUT_MODEL_BY_PROVIDER: Record<string, string> = {
  'local-tts': 'tts-melo-zh-en',
}

function isModelPresent(inventory: VoiceModelInventory, modelId: string): boolean {
  return inventory.models.some((model) => model.id === modelId && model.present)
}

export function buildVoiceModelReadiness(input: VoiceModelReadinessInput): VoiceModelReadiness {
  const { inventory } = input
  if (!inventory) {
    return { status: 'unknown', messageKey: null }
  }

  const inputModelId = SPEECH_INPUT_MODEL_BY_PROVIDER[input.speechInputProviderId]
  const outputModelId = SPEECH_OUTPUT_MODEL_BY_PROVIDER[input.speechOutputProviderId]
  const providerModelsInstalled = (
    (!inputModelId || isModelPresent(inventory, inputModelId))
    && (!outputModelId || isModelPresent(inventory, outputModelId))
  )

  if (inventory.ready && providerModelsInstalled) {
    return { status: 'ready', messageKey: 'onboarding.voice.ready' }
  }

  return { status: 'models_missing', messageKey: 'onboarding.voice.models_missing' }
}
