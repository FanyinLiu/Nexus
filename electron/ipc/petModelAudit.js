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
    case 'pet-model:create-from-image':
      return { channel, dialogBacked: true }
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
    default:
      return false
  }
}
