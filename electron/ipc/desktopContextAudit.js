function textLength(value) {
  return typeof value === 'string' ? value.length : 0
}

function hasText(value) {
  return textLength(value) > 0
}

export function summarizeDesktopContextRequest(request = {}, policy = {}) {
  const requested = {
    activeWindow: Boolean(request?.includeActiveWindow),
    clipboard: Boolean(request?.includeClipboard),
    screenshot: Boolean(request?.includeScreenshot),
  }
  const allowed = {
    activeWindow: policy?.activeWindow !== false,
    clipboard: policy?.clipboard !== false,
    screenshot: policy?.screenshot !== false,
  }

  return {
    requested,
    allowed,
    enabled: {
      activeWindow: requested.activeWindow && allowed.activeWindow,
      clipboard: requested.clipboard && allowed.clipboard,
      screenshot: requested.screenshot && allowed.screenshot,
    },
  }
}

export function summarizeDesktopContextSnapshot(snapshot = {}) {
  const hasActiveWindow =
    hasText(snapshot?.activeWindowTitle) ||
    hasText(snapshot?.activeWindowAppName) ||
    hasText(snapshot?.activeWindowProcessPath)

  return {
    capturedAtPresent: hasText(snapshot?.capturedAt),
    activeWindow: {
      present: hasActiveWindow,
      titleLength: textLength(snapshot?.activeWindowTitle),
      appNameLength: textLength(snapshot?.activeWindowAppName),
      processPathLength: textLength(snapshot?.activeWindowProcessPath),
    },
    companionAwareness: {
      present: hasText(snapshot?.companionAwarenessSummary),
      textLength: textLength(snapshot?.companionAwarenessSummary),
    },
    clipboard: {
      present: hasText(snapshot?.clipboardText),
      textLength: textLength(snapshot?.clipboardText),
    },
    screenshot: {
      present: hasText(snapshot?.screenshotDataUrl),
      dataUrlLength: textLength(snapshot?.screenshotDataUrl),
      displayNameLength: textLength(snapshot?.displayName),
    },
  }
}
