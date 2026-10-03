import { isPortraitImageGateReason } from '../../shared/portraitImageGate.js'
import { isPortraitLandmarkGateReason } from '../../shared/portraitLandmarkGate.js'
import { isPortraitCutoutGateReason } from '../../shared/portraitCutoutGate.js'

function textLength(value) {
  return typeof value === 'string' ? value.length : 0
}

function hasText(value) {
  return textLength(value) > 0
}

function pathSummary(value) {
  return {
    present: hasText(value),
    length: textLength(value),
  }
}

// Only the verdict and a known reason code are logged; image metrics stay
// out of the audit trail with the path and pixels.
function portraitImageGateSummary(result = {}) {
  const known = isPortraitImageGateReason(result?.reasonCode) || isPortraitLandmarkGateReason(result?.reasonCode) || isPortraitCutoutGateReason(result?.reasonCode)
  return {
    gateAccepted: typeof result?.accepted === 'boolean' ? result.accepted : undefined,
    gateReasonCode: known ? result.reasonCode : undefined,
  }
}

const PORTRAIT_GATE_CHANNELS = new Set(['pet-model:check-portrait-image', 'pet-model:generate-portrait-draft'])

function resultPathSummary(result = {}) {
  return {
    packageDirectoryLength: textLength(result?.packageDirectory ?? result?.directoryPath),
    manifestPathLength: textLength(result?.manifestPath),
    spritesheetPathLength: textLength(result?.spritesheetPath),
    visualAuditPathLength: textLength(result?.visualAuditPath),
    archivePathLength: textLength(result?.archivePath),
  }
}

export function summarizePetModelRequest(channel, payload = {}) {
  switch (channel) {
    case 'pet-model:import':
      return { channel, dialogBacked: true }
    case 'pet-model:export-portrait-draft':
      return { channel, dialogBacked: true, displayNameLength: textLength(payload?.displayName), attributionLength: textLength(payload?.attributionText) }
    case 'pet-model:import-codex-gallery':
      return {
        channel,
        inputLength: textLength(payload),
        looksLikeUrl: /^https?:\/\//i.test(String(payload ?? '').trim()),
      }
    case 'pet-model:list-codex-gallery':
      return {
        channel,
        queryLength: textLength(payload?.query),
        limitPresent: typeof payload?.limit === 'number',
      }
    case 'pet-model:create-creator-kit':
      return {
        channel,
        displayNameLength: textLength(payload?.displayName),
        conceptLength: textLength(payload?.concept),
        descriptionLength: textLength(payload?.description),
        styleNotesLength: textLength(payload?.styleNotes),
      }
    case 'pet-model:inspect-creator-kit':
    case 'pet-model:assemble-creator-kit':
      return {
        channel,
        kitDirectory: pathSummary(payload?.kitDirectory),
        dialogBacked: !hasText(payload?.kitDirectory),
      }
    case 'pet-model:install-creator-kit-codex':
      return {
        channel,
        kitDirectory: pathSummary(payload?.kitDirectory),
        manifestPath: pathSummary(payload?.manifestPath),
      }
    case 'pet-model:check-portrait-image':
    case 'pet-model:generate-portrait-draft':
      return {
        channel,
        imagePath: pathSummary(payload?.imagePath),
        dialogBacked: !hasText(payload?.imagePath),
      }
    case 'pet-model:open-creator-kit-path':
      return {
        channel,
        kitDirectory: pathSummary(payload?.kitDirectory),
        targetPath: pathSummary(payload?.targetPath),
        mode: payload?.mode === 'reveal' ? 'reveal' : 'open',
      }
    default:
      return { channel }
  }
}

export function summarizePetModelResult(channel, result = {}, error = null) {
  const failed = Boolean(error)
  return {
    channel,
    ok: !failed,
    canceled: !failed && (result === null || result?.canceled === true),
    modelPresent: !failed && Boolean(result?.model),
    ready: !failed && typeof result?.ready === 'boolean' ? result.ready : undefined,
    warningCount: !failed && typeof result?.warningCount === 'number' ? result.warningCount : undefined,
    messageLength: !failed ? textLength(result?.message) : 0,
    ...(!failed ? resultPathSummary(result) : {}),
    ...(!failed && PORTRAIT_GATE_CHANNELS.has(channel) ? portraitImageGateSummary(result) : {}),
    ...(!failed && channel === 'pet-model:generate-portrait-draft' ? { draftCreated: typeof result?.draftId === 'string' } : {}),
    ...(!failed && channel === 'pet-model:export-portrait-draft' ? { exported: result?.exported === true } : {}),
    errorName: failed && error instanceof Error ? error.name : undefined,
    errorMessageLength: failed && error instanceof Error ? textLength(error.message) : 0,
  }
}

export function petModelActionNeedsConfirmation(channel, payload = {}) {
  switch (channel) {
    case 'pet-model:import-codex-gallery':
    case 'pet-model:create-creator-kit':
    case 'pet-model:install-creator-kit-codex':
    case 'pet-model:open-creator-kit-path':
      return true
    case 'pet-model:inspect-creator-kit':
    case 'pet-model:assemble-creator-kit':
      return hasText(payload?.kitDirectory)
    case 'pet-model:check-portrait-image':
    case 'pet-model:generate-portrait-draft':
      return hasText(payload?.imagePath)
    default:
      return false
  }
}
