export type PortraitPreview = {
  dataUrl: string
  width: number
  height: number
}

export declare const PORTRAIT_PREVIEW_MAX_BASE64_BYTES: number
export declare function normalizePortraitPreview(value: unknown): PortraitPreview | null
