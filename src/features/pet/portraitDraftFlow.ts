/**
 * Portrait setup state and commands, independent of React and the desktop host.
 * Consent authorizes only an explicit model download; image selection stays in
 * the native picker. One controller survives settings remounts so an operation
 * cannot be duplicated by closing and reopening its disclosure.
 */
import { describePortraitModel, selectPortraitModels } from '../../../shared/portraitModels.js'
import type { PortraitModelAttribution } from '../../../shared/portraitModels.js'
import { isPortraitImageGateReason, PORTRAIT_IMAGE_GATE_MESSAGE_KEYS } from '../../../shared/portraitImageGate.js'
import { isPortraitCutoutGateReason, PORTRAIT_CUTOUT_GATE_MESSAGE_KEYS } from '../../../shared/portraitCutoutGate.js'
import { isPortraitLandmarkGateReason, PORTRAIT_LANDMARK_GATE_MESSAGE_KEYS } from '../../../shared/portraitLandmarkGate.js'
import { normalizePortraitPreview } from '../../../shared/portraitPreview.js'
import type { PortraitPreview } from '../../../shared/portraitPreview.js'
import { extractPortraitDraftExportErrorCode, isPortraitDraftId, normalizePortraitDraftExportPayload, PORTRAIT_DRAFT_EXPORT_ERROR_CODES } from '../../../shared/portraitDraftExport.js'
import type { PortraitDraftExportPayload, PortraitDraftExportResult } from '../../../shared/portraitDraftExport.js'
import type { TranslationKey, TranslationParams } from '../../types/i18n.ts'

export type PortraitModelStatus = {
  releasePublished: boolean
  models: Array<PortraitModelAttribution & { installed: 'present' | 'missing' | 'invalid' }>
}
export type PortraitModelProgress = {
  phase: 'start' | 'downloading' | 'verifying' | 'retrying' | 'installed' | 'error' | 'done'
  modelId?: string
  receivedBytes?: number
  totalBytes?: number
}
export type PortraitDraftResult = null | { accepted: true; preview?: PortraitPreview; draftId?: string } | {
  accepted: false
  reasonCode: string
  messageParams: Record<string, string | number>
}
export type PortraitDraftBridge = {
  getPortraitModelStatus: () => Promise<PortraitModelStatus>
  downloadPortraitModels: () => Promise<{ ok: true } | { ok: false; code: string }>
  subscribePortraitModelProgress: (listener: (event: PortraitModelProgress) => void) => () => void
  generatePortraitDraft: () => Promise<PortraitDraftResult>
  exportPortraitDraft: (payload: PortraitDraftExportPayload) => Promise<PortraitDraftExportResult | null>
}
type Notice = { key: TranslationKey; params?: TranslationParams; error?: boolean }
export type PortraitDraftFlowState = {
  status: PortraitModelStatus | null
  checking: boolean
  consent: boolean
  downloading: boolean
  generating: boolean
  progress: PortraitModelProgress | null
  modelNotice: Notice | null
  draftNotice: Notice | null
  preview: PortraitPreview | null
  previewRevision: number
  draftId: string | null
  exporting: boolean
  exportName: string
  exportAttribution: string
  exportNotice: Notice | null
}

const DOWNLOAD_ERRORS: Record<string, TranslationKey> = {
  release_unpublished: 'settings.chat.portrait_flow.release_unavailable',
  hash_mismatch: 'settings.chat.portrait_flow.integrity_error',
  size_mismatch: 'settings.chat.portrait_flow.integrity_error',
  unsafe_url: 'settings.chat.portrait_flow.integrity_error',
  disk: 'settings.chat.portrait_flow.disk_error',
}
const EXPORT_ERRORS: Record<string, TranslationKey> = {
  [PORTRAIT_DRAFT_EXPORT_ERROR_CODES.INVALID]: 'settings.chat.portrait_flow.export_invalid',
  [PORTRAIT_DRAFT_EXPORT_ERROR_CODES.UNAVAILABLE]: 'settings.chat.portrait_flow.export_unavailable',
  [PORTRAIT_DRAFT_EXPORT_ERROR_CODES.EXISTS]: 'settings.chat.portrait_flow.export_exists',
  [PORTRAIT_DRAFT_EXPORT_ERROR_CODES.WRITE_FAILED]: 'settings.chat.portrait_flow.export_error',
}

export function portraitModelSummary(status: PortraitModelStatus | null) {
  const models = selectPortraitModels().map((entry) => ({
    ...describePortraitModel(entry),
    installed: status?.models.find((model) => model.id === entry.id)?.installed ?? 'missing',
  }))
  return {
    models,
    ready: status !== null && models.every((model) => model.installed === 'present'),
    downloadMegabytes: Math.ceil(models.reduce((sum, model) => sum + (model.installed === 'present' ? 0 : model.sizeBytes), 0) / 1_000_000),
  }
}

export function portraitProgressKey(phase: PortraitModelProgress['phase']): TranslationKey {
  const keys = {
    start: 'settings.chat.portrait_flow.downloading',
    downloading: 'settings.chat.portrait_flow.downloading',
    verifying: 'settings.chat.portrait_flow.verifying',
    retrying: 'settings.chat.portrait_flow.retrying',
    installed: 'settings.chat.portrait_flow.verifying',
    error: 'settings.chat.portrait_flow.download_error',
    done: 'settings.chat.portrait_flow.ready',
  } as const
  return keys[phase]
}

export function portraitDownloadError(code: string): TranslationKey {
  return DOWNLOAD_ERRORS[code] ?? 'settings.chat.portrait_flow.download_error'
}

function draftNotice(result: PortraitDraftResult): Notice {
  if (result === null) return { key: 'settings.chat.portrait_flow.cancelled' }
  if (result.accepted) return { key: 'settings.chat.portrait_flow.saved' }
  const reason = result.reasonCode
  const key = isPortraitImageGateReason(reason) ? PORTRAIT_IMAGE_GATE_MESSAGE_KEYS[reason]
    : isPortraitLandmarkGateReason(reason) ? PORTRAIT_LANDMARK_GATE_MESSAGE_KEYS[reason]
      : isPortraitCutoutGateReason(reason) ? PORTRAIT_CUTOUT_GATE_MESSAGE_KEYS[reason]
        : 'settings.chat.portrait_flow.generate_error'
  return { key, params: result.messageParams, error: true }
}

export function createPortraitDraftFlow({ getBridge }: { getBridge: () => PortraitDraftBridge | undefined }) {
  let state: PortraitDraftFlowState = {
    status: null, checking: false, consent: false, downloading: false, generating: false,
    progress: null, modelNotice: null, draftNotice: null, preview: null, previewRevision: 0,
    draftId: null, exporting: false, exportName: '', exportAttribution: '', exportNotice: null,
  }
  const listeners = new Set<() => void>()
  let active = false
  let refreshToken = 0
  let previewSession = 0
  function update(patch: Partial<PortraitDraftFlowState>) {
    state = { ...state, ...patch }
    listeners.forEach((listener) => listener())
  }
  async function refresh() {
    const token = ++refreshToken
    const bridge = getBridge()
    update({ checking: true, modelNotice: null })
    try {
      if (!bridge) throw new Error('unavailable')
      const status = await bridge.getPortraitModelStatus()
      if (active && token === refreshToken) update({ status, checking: false })
    } catch {
      if (active && token === refreshToken) update({ status: null, checking: false, modelNotice: { key: 'settings.chat.portrait_flow.status_error', error: true } })
    }
  }
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    open() {
      active = true
      update({ consent: false })
      const unsubscribe = getBridge()?.subscribePortraitModelProgress((progress) => {
        if (active && state.downloading) update({ progress })
      })
      void refresh()
      return () => {
        active = false
        refreshToken += 1
        previewSession += 1
        unsubscribe?.()
        update({ consent: false, checking: false, preview: null, draftId: null, exportName: '', exportAttribution: '', exportNotice: null })
      }
    },
    refresh,
    setConsent(consent: boolean) { update({ consent }) },
    setExportName(exportName: string) {
      if (active && state.draftId && !state.exporting) update({ exportName, exportNotice: null })
    },
    setExportAttribution(exportAttribution: string) {
      if (active && state.draftId && !state.exporting) update({ exportAttribution, exportNotice: null })
    },
    async download() {
      const bridge = getBridge()
      if (!active || !bridge || !state.consent || state.downloading || state.generating || state.exporting || state.checking
        || !state.status?.releasePublished || portraitModelSummary(state.status).ready) return
      update({ downloading: true, progress: { phase: 'start' }, modelNotice: null })
      try {
        const result = await bridge.downloadPortraitModels()
        if (!result.ok) update({ modelNotice: { key: portraitDownloadError(result.code), error: true } })
        else if (active) await refresh()
      } catch {
        update({ modelNotice: { key: 'settings.chat.portrait_flow.download_error', error: true } })
      } finally {
        update({ downloading: false, progress: null })
      }
    },
    async generate() {
      const bridge = getBridge()
      if (!active || !bridge || state.downloading || state.generating || state.exporting || state.checking || !portraitModelSummary(state.status).ready) return
      const session = previewSession
      // A new selection must not show an older picture under its result notice.
      update({ generating: true, draftNotice: null, preview: null, previewRevision: state.previewRevision + 1, draftId: null, exportName: '', exportAttribution: '', exportNotice: null })
      try {
        const result = await bridge.generatePortraitDraft()
        const preview = active && session === previewSession && result?.accepted ? normalizePortraitPreview(result.preview) : null
        update({
          draftNotice: draftNotice(result),
          // Closing the disclosure revokes this view's access to returned pixels.
          preview,
          draftId: preview && result?.accepted && isPortraitDraftId(result.draftId) ? result.draftId : null,
        })
      } catch {
        update({ draftNotice: { key: 'settings.chat.portrait_flow.generate_error', error: true } })
      } finally {
        update({ generating: false })
      }
    },
    async exportDraft(defaultName = '') {
      const bridge = getBridge()
      if (!active || !bridge || !state.preview || !state.draftId || state.downloading || state.generating || state.exporting || state.checking) return
      const payload = normalizePortraitDraftExportPayload({ draftId: state.draftId, displayName: state.exportName.trim() || defaultName, attributionText: state.exportAttribution })
      if (!payload) {
        update({ exportNotice: { key: 'settings.chat.portrait_flow.export_invalid', error: true } })
        return
      }
      const session = previewSession
      update({ exporting: true, exportNotice: null })
      try {
        const result = await bridge.exportPortraitDraft(payload)
        if (!active || session !== previewSession) return
        if (result === null) update({ exportNotice: { key: 'settings.chat.portrait_flow.export_cancelled' } })
        else if (result.exported && result.static && result.formatVersion === 2) update({ exportNotice: { key: 'settings.chat.portrait_flow.export_saved' } })
        else update({ exportNotice: { key: 'settings.chat.portrait_flow.export_error', error: true } })
      } catch (error) {
        if (active && session === previewSession) update({ exportNotice: { key: EXPORT_ERRORS[extractPortraitDraftExportErrorCode(error) ?? ''] ?? 'settings.chat.portrait_flow.export_error', error: true } })
      } finally {
        update({ exporting: false })
      }
    },
  }
}
