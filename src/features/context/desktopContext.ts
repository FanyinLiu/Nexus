import type { DesktopContextRequest, DesktopContextSnapshot } from '../../types'
import { shorten } from '../../lib/common.ts'

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

  const sections: string[] = []
  const activeWindowTitle = normalizeObservedText(snapshot.activeWindowTitle)
  const activeWindowAppName = normalizeObservedText(snapshot.activeWindowAppName)
  const activeWindowProcessPath = normalizeObservedText(snapshot.activeWindowProcessPath)
  const clipboardText = normalizeObservedText(snapshot.clipboardText)
  const screenText = normalizeObservedText(snapshot.screenText)
  const vlmAnalysis = normalizeObservedText(snapshot.vlmAnalysis)

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
    'Below is supplementary desktop context. Use it only when naturally relevant; do not force a reference. Reply in the user\'s language.',
    sections.join('\n\n'),
  ].join('\n\n')
}
