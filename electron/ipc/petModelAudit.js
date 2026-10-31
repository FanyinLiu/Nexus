// @ts-check
/** @param {unknown} value */
function textLength(value) {
  return typeof value === 'string' ? value.length : 0
}

/** @param {Record<string, unknown>} [result] */
function resultPathSummary(result = {}) {
  return {
    packageDirectoryLength: textLength(result?.packageDirectory ?? result?.directoryPath),
    manifestPathLength: textLength(result?.manifestPath),
    visualAuditPathLength: textLength(result?.visualAuditPath),
    archivePathLength: textLength(result?.archivePath),
  }
}

/**
 * @param {string} channel
 * @param {Record<string, unknown>} [payload]
 */
export function summarizePetModelRequest(channel, payload = {}) {
  // Renderer payloads can carry a local path. The audit record stays metadata-only.
  void payload
  switch (channel) {
    case 'pet-model:import':
      return { channel, dialogBacked: true }
    default:
      return { channel }
  }
}

/**
 * @param {string} channel
 * @param {Record<string, unknown> | null} [result]
 * @param {unknown} [error]
 */
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
    ...(!failed ? resultPathSummary(result ?? {}) : {}),
    errorName: failed && error instanceof Error ? error.name : undefined,
    errorMessageLength: failed && error instanceof Error ? textLength(error.message) : 0,
  }
}

export function petModelActionNeedsConfirmation() {
  return false
}
