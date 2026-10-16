/**
 * Settings view of the local voice-model inventory.
 *
 * The first-launch dialog can be dismissed for the rest of the session.
 * This view is the way back: it only describes inventory, progress, disk,
 * and whether a partial file can be continued. Downloads stay on the
 * existing catalog calls.
 */

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
): LocalModelRowView[] {
  return models.map((model) => {
    const current = progress[model.id]
    const percent = getModelProgressPercent(current)
    if (model.present || isModelProgressComplete(current)) {
      return { ...rowBase(model), status: 'installed', percent: null }
    }
    if (isModelProgressError(current)) {
      return { ...rowBase(model), status: 'failed', percent }
    }
    if (isModelProgressActive(current)) {
      return { ...rowBase(model), status: 'downloading', percent }
    }
    return { ...rowBase(model), status: 'pending', percent: null }
  })
}

function rowBase(model: LocalModelEntry) {
  return {
    id: model.id,
    label: model.label,
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
