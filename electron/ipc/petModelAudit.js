function textLength(value) {
  return typeof value === 'string' ? value.length : 0
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

export function petModelActionNeedsConfirmation(channel) {
  switch (channel) {
    case 'pet-model:import-codex-gallery':
      return true
    default:
      return false
  }
}
