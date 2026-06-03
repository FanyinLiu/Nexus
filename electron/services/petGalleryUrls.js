// Pure URL detection / slug / page-parser-routing helpers for the community
// Codex pet galleries (codex-pet.com / .org, codingpets.com, codexpets.net).
// Extracted from petModelService so the import flows there stay focused on
// model discovery + I/O. No app/electron state — only string/URL logic.
import {
  CODEX_PET_ORG_BASE_URL,
  isHttpUrl,
  parseCodexPetGalleryPage,
  parseCodexPetOrgPage,
  resolveCodexPetGalleryUrl,
  slugifyCodexPetId,
} from './codexPetGallery.js'

export function isCodingPetsDetailUrl(input) {
  if (!isHttpUrl(input)) {
    return false
  }

  const url = new URL(input)
  return (url.hostname === 'codingpets.com' || url.hostname.endsWith('.codingpets.com'))
    && url.pathname.startsWith('/pets/')
}

export function isCodexPetGalleryDetailUrl(input) {
  if (!isHttpUrl(input)) {
    return false
  }

  const url = new URL(input)
  return (url.hostname === 'codex-pet.com' || url.hostname.endsWith('.codex-pet.com'))
    && url.pathname.startsWith('/pets/')
}

export function isCodexPetOrgDetailUrl(input) {
  if (!isHttpUrl(input)) {
    return false
  }

  const url = new URL(input)
  const pathParts = url.pathname.split('/').filter(Boolean)
  const petIndex = pathParts.indexOf('pets')
  return (url.hostname === 'codex-pet.org' || url.hostname.endsWith('.codex-pet.org'))
    && petIndex >= 0
    && Boolean(pathParts[petIndex + 1])
}

export function isCodexPetsNetDetailUrl(input) {
  if (!isHttpUrl(input)) {
    return false
  }

  const url = new URL(input)
  return (url.hostname === 'codexpets.net' || url.hostname.endsWith('.codexpets.net'))
    && (url.pathname.startsWith('/pets/') || url.pathname.startsWith('/gallery/'))
}

export function isKnownPetGalleryZipUrl(input) {
  if (!isHttpUrl(input)) {
    return false
  }

  const url = new URL(input)
  return url.pathname.toLowerCase().endsWith('.zip') || url.pathname.endsWith('/download')
}

export function isKnownPetGalleryHost(input) {
  if (!isHttpUrl(input)) {
    return false
  }

  const { hostname } = new URL(input)
  return hostname === 'codex-pet.com'
    || hostname.endsWith('.codex-pet.com')
    || hostname === 'codex-pet.org'
    || hostname.endsWith('.codex-pet.org')
    || hostname === 'codingpets.com'
    || hostname.endsWith('.codingpets.com')
    || hostname === 'codexpets.net'
    || hostname.endsWith('.codexpets.net')
}

function normalizeCodexPetGallerySlug(value) {
  const slug = slugifyCodexPetId(value)
  return slug || ''
}

export function resolveCodexPetFallbackSlug(input) {
  const rawInput = String(input ?? '').trim()
  if (!rawInput) {
    return ''
  }

  if (!isHttpUrl(rawInput)) {
    return normalizeCodexPetGallerySlug(rawInput)
  }

  const url = new URL(rawInput)
  const pathParts = url.pathname.split('/').filter(Boolean)
  const petIndex = pathParts.indexOf('pets')
  if (petIndex < 0 || !pathParts[petIndex + 1]) {
    return ''
  }

  return normalizeCodexPetGallerySlug(pathParts[petIndex + 1])
}

export function uniqueCodexPetGalleryCandidates(rawInput, includePrimary = false) {
  const candidates = new Set()
  if (!rawInput) {
    return []
  }

  const slug = resolveCodexPetFallbackSlug(rawInput)
  const baseSlugUrl = resolveCodexPetGalleryUrl(rawInput)

  if (includePrimary) {
    candidates.add(baseSlugUrl)
  }

  if (slug) {
    candidates.add(`${CODEX_PET_ORG_BASE_URL}${slug}/`)
  }

  return Array.from(candidates)
}

export function parseCodexPetGalleryPageByHost(pageUrl, html) {
  if (isCodexPetOrgDetailUrl(pageUrl)) {
    return parseCodexPetOrgPage(html, pageUrl)
  }
  if (isCodexPetGalleryDetailUrl(pageUrl) || !isHttpUrl(pageUrl)) {
    return parseCodexPetGalleryPage(html, pageUrl)
  }

  throw new Error(`不支持的 Codex 宠物详情页地址：${pageUrl}`)
}
