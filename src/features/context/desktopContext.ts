import type { DesktopContextRequest, DesktopContextSnapshot } from '../../types'
import { shorten } from '../../lib/common.ts'
import { sanitizeDesktopContextSnapshotForPrompt } from '../../lib/privacy/desktopContextPrivacy.ts'
import { pickTranslatedUiText } from '../../lib/uiLanguage.ts'
import type { UiLanguage } from '../../types'

const MAX_ACTIVE_WINDOW_TITLE_LENGTH = 180
const MAX_ACTIVE_WINDOW_APP_NAME_LENGTH = 80
const MAX_ACTIVE_WINDOW_PROCESS_PATH_LENGTH = 220
const MAX_CLIPBOARD_CONTEXT_LENGTH = 1_600
const MAX_SCREEN_TEXT_CONTEXT_LENGTH = 1_800
const MAX_VLM_ANALYSIS_LENGTH = 800
const MAX_COMPANION_AWARENESS_LENGTH = 900

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

export function formatDesktopContext(snapshot: DesktopContextSnapshot | null | undefined, uiLanguage: UiLanguage = 'en-US') {
  if (!snapshot) return ''

  const sanitizedSnapshot = sanitizeDesktopContextSnapshotForPrompt(snapshot)
  const sections: string[] = []
  const activeWindowTitle = normalizeObservedText(sanitizedSnapshot.activeWindowTitle)
  const activeWindowAppName = normalizeObservedText(sanitizedSnapshot.activeWindowAppName)
  const activeWindowProcessPath = normalizeObservedText(sanitizedSnapshot.activeWindowProcessPath)
  const companionAwarenessSummary = normalizeObservedText(sanitizedSnapshot.companionAwarenessSummary)
  const clipboardText = normalizeObservedText(sanitizedSnapshot.clipboardText)
  const screenText = normalizeObservedText(sanitizedSnapshot.screenText)
  const vlmAnalysis = normalizeObservedText(sanitizedSnapshot.vlmAnalysis)

  if (companionAwarenessSummary) {
    sections.push(formatObservedBlock(
      pickTranslatedUiText(uiLanguage, 'desktop_context.prompt.companion_summary_heading'),
      companionAwarenessSummary,
      MAX_COMPANION_AWARENESS_LENGTH,
    ))
  }

  if (activeWindowTitle || activeWindowAppName || activeWindowProcessPath) {
    const activeWindowLines = [`${pickTranslatedUiText(uiLanguage, 'desktop_context.prompt.current_foreground_window_heading')}:`]

    if (activeWindowTitle) {
      activeWindowLines.push(formatObservedBlock(
        pickTranslatedUiText(uiLanguage, 'desktop_context.prompt.window_title'),
        activeWindowTitle,
        MAX_ACTIVE_WINDOW_TITLE_LENGTH,
      ))
    }

    if (activeWindowAppName) {
      activeWindowLines.push(formatObservedBlock(
        pickTranslatedUiText(uiLanguage, 'desktop_context.prompt.app_name'),
        activeWindowAppName,
        MAX_ACTIVE_WINDOW_APP_NAME_LENGTH,
      ))
    }

    if (activeWindowProcessPath) {
      activeWindowLines.push(formatObservedBlock(
        pickTranslatedUiText(uiLanguage, 'desktop_context.prompt.process_path'),
        activeWindowProcessPath,
        MAX_ACTIVE_WINDOW_PROCESS_PATH_LENGTH,
      ))
    }

    sections.push(activeWindowLines.join('\n'))
  }

  if (clipboardText) {
    sections.push(formatObservedBlock(
      pickTranslatedUiText(uiLanguage, 'desktop_context.prompt.clipboard_text'),
      clipboardText,
      MAX_CLIPBOARD_CONTEXT_LENGTH,
    ))
  }

  if (screenText) {
    sections.push(formatObservedBlock(
      pickTranslatedUiText(uiLanguage, 'desktop_context.prompt.screen_text'),
      screenText,
      MAX_SCREEN_TEXT_CONTEXT_LENGTH,
    ))
  }

  if (vlmAnalysis) {
    sections.push(formatObservedBlock(
      pickTranslatedUiText(uiLanguage, 'desktop_context.prompt.vlm_analysis'),
      vlmAnalysis,
      MAX_VLM_ANALYSIS_LENGTH,
    ))
  }

  if (!sections.length) {
    return ''
  }

  return [
    pickTranslatedUiText(uiLanguage, 'desktop_context.prompt.header'),
    sections.join('\n\n'),
  ].join('\n\n')
}
