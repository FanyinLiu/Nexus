export type CodexPetGalleryCatalogItem = {
  id: string
  slug: string
  displayName: string
  description: string
  sourceName?: string
  sourceUrl: string
  downloadUrl?: string
  installCommand: string
}

export type CodexPetGalleryCatalogResult = {
  sourceUrl: string
  totalCount: number
  matchedCount: number
  query: string
  pets: CodexPetGalleryCatalogItem[]
}
