/**
 * Settings view of the local voice-model inventory.
 *
 * "Maybe later" on the first-launch dialog is remembered on this computer.
 * This view is the way back: it only describes inventory, progress, disk,
 * and whether a partial file can be continued. Downloads stay on the
 * existing catalog calls.
 */

import { selectMissingVoiceModelIds, speechModelIdForProvider } from '../../../shared/voiceModelDownloads.js'
import type { TranslationKey } from '../../types/i18n.ts'
import {
  getModelProgressPercent,
  isModelProgressActive,
  isModelProgressComplete,
  isModelProgressError,
  type PerModelProgress,
} from './modelSetupState.ts'

export type LocalModelEntry = {
  id: string
  label: string
  sizeLabel: string
  required: boolean
  present: boolean
  resumable?: boolean
}

export type LocalModelDisk = {
  ok: boolean
  resumable?: boolean
}

export type LocalModelInventoryView = {
  models: LocalModelEntry[]
  ready: boolean
  missingRequired: string[]
  disk?: LocalModelDisk
  /** Catalog ids the main process is already fetching. */
  downloading?: string[]
}

export type LocalModelRowStatus = 'installed' | 'pending' | 'downloading' | 'failed'

export type LocalModelRowView = {
  id: string
  label: string
  sizeLabel: string
  required: boolean
  status: LocalModelRowStatus
  percent: number | null
}

export type LocalModelDownloadAction = 'download' | 'resume' | 'retry' | 'none'

export function buildLocalModelRows(
  models: LocalModelEntry[],
  progress: Record<string, PerModelProgress>,
  downloadingIds: readonly string[] = [],
): LocalModelRowView[] {
  const downloading = new Set(downloadingIds)
  return models.map((model) => {
    const current = progress[model.id]
    const percent = getModelProgressPercent(current)
    if (model.present || isModelProgressComplete(current)) {
      return { ...rowBase(model), status: 'installed', percent: null }
    }
    // An in-flight id counts even when this page missed the progress events.
    if (isModelProgressActive(current) || downloading.has(model.id)) {
      return { ...rowBase(model), status: 'downloading', percent }
    }
    if (isModelProgressError(current)) {
      return { ...rowBase(model), status: 'failed', percent }
    }
    return { ...rowBase(model), status: 'pending', percent: null }
  })
}

const OPTIONAL_LABEL_SUFFIX = /(?:\s*[（(]\s*(?:可选|可選|optional)\s*[）)])+\s*$/i

/**
 * Catalog ids with a translated name and description. The catalog itself
 * only carries the fallback text, so every locale can say the same thing
 * in its own words.
 */
const LOCAL_MODEL_NAME_KEYS: Record<string, TranslationKey> = {
  vad: 'model_setup.model.vad.name',
  'kws-en': 'model_setup.model.kws-en.name',
  'kws-zh': 'model_setup.model.kws-zh.name',
  sensevoice: 'model_setup.model.sensevoice.name',
  'paraformer-zh-en': 'model_setup.model.paraformer-zh-en.name',
  'tts-melo-zh-en': 'model_setup.model.tts-melo-zh-en.name',
}

const LOCAL_MODEL_PURPOSE_KEYS: Record<string, TranslationKey> = {
  vad: 'model_setup.model.vad.purpose',
  'kws-en': 'model_setup.model.kws-en.purpose',
  'kws-zh': 'model_setup.model.kws-zh.purpose',
  sensevoice: 'model_setup.model.sensevoice.purpose',
  'paraformer-zh-en': 'model_setup.model.paraformer-zh-en.purpose',
  'tts-melo-zh-en': 'model_setup.model.tts-melo-zh-en.purpose',
}

/**
 * Catalog names sometimes end with "optional". The row status already says
 * that, so the title should not repeat it.
 */
export function localModelDisplayLabel(label: string): string {
  return label.replace(OPTIONAL_LABEL_SUFFIX, '').trim()
}

function localModelNameKey(id: string): TranslationKey | null {
  return LOCAL_MODEL_NAME_KEYS[id] ?? null
}

function localModelPurposeKey(id: string): TranslationKey | null {
  return LOCAL_MODEL_PURPOSE_KEYS[id] ?? null
}

/**
 * A few catalog names are engine labels. The screens use a plain name
 * and description instead, looked up by id so every locale can say it.
 */
export function localModelCopy(
  model: { id: string; label: string; purpose?: string },
  translate: (key: TranslationKey) => string,
): { label: string; purpose: string } {
  const nameKey = localModelNameKey(model.id)
  const purposeKey = localModelPurposeKey(model.id)
  return {
    label: localModelDisplayLabel(nameKey ? translate(nameKey) : model.label),
    purpose: purposeKey ? translate(purposeKey) : (model.purpose ?? ''),
  }
}

/**
 * Required models that are not installed yet. Progress can mark a row
 * installed before the inventory refresh, so the header must follow the
 * rows instead of the last inventory count.
 */
export function countLocalModelsStillNeeded(rows: LocalModelRowView[]): number {
  return rows.filter((row) => row.required && row.status !== 'installed').length
}

/**
 * Models the Voice page still has to fetch for this listener, including
 * the speech model the catalog does not mark required.
 */
export function missingVoiceModelIds(
  models: LocalModelEntry[],
  speechInputProviderId: string,
): string[] {
  return selectMissingVoiceModelIds(models, speechInputProviderId)
}

/**
 * IPC payload for "Download missing models". Omitted for a cloud listener
 * so the main process keeps the required-only set.
 */
export function voiceModelDownloadPayload(
  speechInputProviderId: string,
): { speechInputProviderId: string } | undefined {
  if (!speechModelIdForProvider(speechInputProviderId)) return undefined
  return { speechInputProviderId }
}

/**
 * Status line on the Voice page. A missing count replaces "everything is
 * fine". English uses a separate key so the noun can be singular.
 */
export function voiceSettingsStatusKey(missingCount: number | null): TranslationKey | null {
  if (missingCount === null) return null
  if (missingCount <= 0) return 'settings.voice.status_all_clear'
  return missingCount === 1
    ? 'settings.voice.status_models_missing_one'
    : 'settings.voice.status_models_missing_other'
}

function rowBase(model: LocalModelEntry) {
  return {
    id: model.id,
    label: localModelDisplayLabel(model.label),
    sizeLabel: model.sizeLabel,
    required: model.required,
  }
}

export function localModelDiskBlocksDownload(disk: LocalModelDisk | undefined): boolean {
  return disk?.ok === false
}

export function localModelCanResume(inventory: LocalModelInventoryView): boolean {
  return inventory.disk?.resumable === true || inventory.models.some((model) => model.resumable === true)
}

export function localModelDownloadAction(input: {
  missingCount: number
  resumable: boolean
  hadFailure: boolean
}): LocalModelDownloadAction {
  if (input.resumable) return 'resume'
  if (input.missingCount <= 0) return 'none'
  if (input.hadFailure) return 'retry'
  return 'download'
}
