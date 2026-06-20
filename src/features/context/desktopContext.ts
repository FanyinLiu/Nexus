import type { DesktopContextRequest, DesktopContextSnapshot } from '../../types'
import { shorten } from '../../lib/common.ts'
import { sanitizeDesktopContextSnapshotForPrompt } from '../../lib/privacy/desktopContextPrivacy.ts'

const MAX_ACTIVE_WINDOW_TITLE_LENGTH = 180
const MAX_ACTIVE_WINDOW_APP_NAME_LENGTH = 80
const MAX_ACTIVE_WINDOW_PROCESS_PATH_LENGTH = 220
const MAX_CLIPBOARD_CONTEXT_LENGTH = 1_600
const MAX_SCREEN_TEXT_CONTEXT_LENGTH = 1_800
const MAX_VLM_ANALYSIS_LENGTH = 800

type DesktopContextRequestOptions = {
  includeActiveWindow?: boolean
  includeClipboard?: boolean
  includeScreenshot?: boolean
}

export function buildDesktopContextRequest(options: DesktopContextRequestOptions = {}): DesktopContextRequest {
  return {
    includeActiveWindow: options.includeActiveWindow ?? true,
    includeClipboard: options.includeClipboard ?? true,
    includeScreenshot: options.includeScreenshot ?? false,
  }
}

function normalizeObservedText(value: unknown) {
  return String(value ?? '').replace(/\r/g, '').trim()
}

function quoteObservedText(text: string, maxLength: number) {
  return shorten(text, maxLength)
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n')
}

function formatObservedBlock(label: string, text: string, maxLength: number) {
  return `${label}:\n${quoteObservedText(text, maxLength)}`
}

export function formatDesktopContext(snapshot: DesktopContextSnapshot | null | undefined) {
  if (!snapshot) return ''

  const sanitizedSnapshot = sanitizeDesktopContextSnapshotForPrompt(snapshot)
  const sections: string[] = []
  const activeWindowTitle = normalizeObservedText(sanitizedSnapshot.activeWindowTitle)
  const activeWindowAppName = normalizeObservedText(sanitizedSnapshot.activeWindowAppName)
  const activeWindowProcessPath = normalizeObservedText(sanitizedSnapshot.activeWindowProcessPath)
  const clipboardText = normalizeObservedText(sanitizedSnapshot.clipboardText)
  const screenText = normalizeObservedText(sanitizedSnapshot.screenText)
  const vlmAnalysis = normalizeObservedText(sanitizedSnapshot.vlmAnalysis)

  if (activeWindowTitle || activeWindowAppName || activeWindowProcessPath) {
    const activeWindowLines = ['Current foreground window:']

    if (activeWindowTitle) {
      activeWindowLines.push(formatObservedBlock('Window title', activeWindowTitle, MAX_ACTIVE_WINDOW_TITLE_LENGTH))
    }

    if (activeWindowAppName) {
      activeWindowLines.push(formatObservedBlock('App name', activeWindowAppName, MAX_ACTIVE_WINDOW_APP_NAME_LENGTH))
    }

    if (activeWindowProcessPath) {
      activeWindowLines.push(formatObservedBlock('Process path', activeWindowProcessPath, MAX_ACTIVE_WINDOW_PROCESS_PATH_LENGTH))
    }

    sections.push(activeWindowLines.join('\n'))
  }

  if (clipboardText) {
    sections.push(formatObservedBlock('Clipboard text', clipboardText, MAX_CLIPBOARD_CONTEXT_LENGTH))
  }

  if (screenText) {
    sections.push(formatObservedBlock('Visible on-screen text', screenText, MAX_SCREEN_TEXT_CONTEXT_LENGTH))
  }

  if (vlmAnalysis) {
    sections.push(formatObservedBlock('Screen visual analysis (VLM)', vlmAnalysis, MAX_VLM_ANALYSIS_LENGTH))
  }

  if (!sections.length) {
    return ''
  }

  return [
    'Below is supplementary desktop context — a quiet sense of what the user is doing right now. '
      + 'Let it subtly shape your replies: be perceptive when it genuinely fits, the way someone in the room would pick up on what is going on. '
      + 'Never announce or draw attention to the fact that you can see their screen, window, or clipboard (do not say things like "I see you have X open") — '
      + 'just let the awareness color your tone and what you bring up, naturally. '
      + 'If it is not relevant, ignore it completely; never force a reference. Reply in the user\'s language.',
    sections.join('\n\n'),
  ].join('\n\n')
}
