export declare const PORTRAIT_DRAFT_EXPORT_LIMITS: Readonly<{ displayNameChars: 120; attributionChars: 8192; manifestBytes: 65536 }>
export declare const PORTRAIT_DRAFT_EXPORT_ERROR_CODES: Readonly<{
  INVALID: 'portrait_draft_export_invalid'
  UNAVAILABLE: 'portrait_draft_export_unavailable'
  EXISTS: 'portrait_draft_export_exists'
  WRITE_FAILED: 'portrait_draft_export_write_failed'
}>
export declare const PORTRAIT_DRAFT_EXPORT_MESSAGE_KEY: 'settings.chat.portrait_flow.export_saved'
export type PortraitDraftExportErrorCode = (typeof PORTRAIT_DRAFT_EXPORT_ERROR_CODES)[keyof typeof PORTRAIT_DRAFT_EXPORT_ERROR_CODES]
export type PortraitDraftExportPayload = { draftId: string; displayName?: string; attributionText?: string }
export type PortraitDraftExportResult = {
  exported: true
  formatVersion: 2
  static: true
  width: number
  height: number
  fileName: string
  messageKey: typeof PORTRAIT_DRAFT_EXPORT_MESSAGE_KEY
}
export declare function isPortraitDraftId(value: unknown): value is string
export declare function normalizePortraitDraftExportPayload(value: unknown): PortraitDraftExportPayload | null
export declare function extractPortraitDraftExportErrorCode(error: unknown): PortraitDraftExportErrorCode | null
