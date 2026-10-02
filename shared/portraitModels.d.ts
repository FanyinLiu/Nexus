export type PortraitModelRole = 'detector' | 'landmarks' | 'cutout'

export type PortraitModelEntry = Readonly<{
  id: string
  role: PortraitModelRole
  wired: boolean
  fileName: string
  sizeBytes: number
  sha256: string
  url: string
  source: Readonly<{ name: string, url: string, revision: string }>
  license: Readonly<{ spdx: string, url: string }>
  trainingDataDocumented: boolean
}>

export declare const PORTRAIT_MODEL_RELEASE: Readonly<{ tag: string, baseUrl: string, published: boolean }>
export declare const PORTRAIT_MODEL_CATALOG: readonly PortraitModelEntry[]

/** Attribution shown wherever the app lists portrait models. */
export type PortraitModelAttribution = {
  id: string
  role: PortraitModelRole
  wired: boolean
  sizeBytes: number
  sourceName: string
  sourceUrl: string
  licenseSpdx: string
  licenseUrl: string
  trainingDataDocumented: boolean
}

export declare function selectPortraitModels(options?: { includePlanned?: boolean }): PortraitModelEntry[]
export declare function describePortraitModel(model: PortraitModelEntry): PortraitModelAttribution
