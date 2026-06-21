import type { DesktopContextSnapshot } from '../../types'

export const DESKTOP_CONTEXT_REDACTION = '[redacted sensitive desktop context]'

const SECRET_LINE_PATTERNS: RegExp[] = [
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|bearer|client[_-]?secret|refresh[_-]?token|password|passwd|pwd)\b\s*[:=]\s*["']?[^"'\s]{6,}/i,
  /\b(?:ghp|github_pat|xox[baprs]|ya29)\b[A-Za-z0-9._-]{12,}\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
]

const SECRET_VALUE_PATTERNS: RegExp[] = [
  /^[A-Za-z0-9._-]{32,}$/,
  /^[A-Za-z0-9+/]{40,}={0,2}$/,
]

export function containsSensitiveDesktopContext(value: unknown): boolean {
  const text = String(value ?? '').trim()
  if (!text) return false

  if (SECRET_LINE_PATTERNS.some((pattern) => pattern.test(text))) {
    return true
  }

  return text
    .split(/\s+/)
    .some((token) => SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(token)))
}

export function redactSensitiveDesktopContextText(value: unknown): string {
  const text = String(value ?? '').trim()
  if (!text) return ''
  return containsSensitiveDesktopContext(text) ? DESKTOP_CONTEXT_REDACTION : text
}

export function sanitizeDesktopContextSnapshotForPrompt(
  snapshot: DesktopContextSnapshot,
): DesktopContextSnapshot {
  const sanitized: DesktopContextSnapshot = {
    ...snapshot,
  }

  for (const field of [
    'activeWindowTitle',
    'activeWindowAppName',
    'activeWindowProcessPath',
    'companionAwarenessSummary',
    'clipboardText',
    'screenText',
    'vlmAnalysis',
  ] as const) {
    if (Object.prototype.hasOwnProperty.call(snapshot, field)) {
      sanitized[field] = redactSensitiveDesktopContextText(snapshot[field])
    }
  }

  return sanitized
}

export function stripDesktopContextScreenshotPayload(
  snapshot: DesktopContextSnapshot | null | undefined,
): DesktopContextSnapshot | null {
  if (!snapshot) return null

  const {
    screenshotDataUrl: _screenshotDataUrl,
    displayName: _displayName,
    ...contentOnlySnapshot
  } = snapshot

  void _screenshotDataUrl
  void _displayName

  return contentOnlySnapshot
}
