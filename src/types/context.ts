export interface DesktopContextSnapshot {
  capturedAt: string
  activeWindowTitle?: string
  activeWindowAppName?: string
  activeWindowProcessPath?: string
  companionAwarenessSummary?: string
  clipboardText?: string
  screenText?: string
  screenshotDataUrl?: string
  displayName?: string
  vlmAnalysis?: string
}

export interface DesktopContextRequest {
  includeActiveWindow?: boolean
  includeClipboard?: boolean
  includeScreenshot?: boolean
  policy?: {
    activeWindow?: boolean
    clipboard?: boolean
    screenshot?: boolean
  }
}
