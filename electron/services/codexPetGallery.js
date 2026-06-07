const CODEX_PET_GALLERY_HOME_URL = 'https://codex-pet.com/'
const CODEX_PET_GALLERY_BASE_URL = 'https://codex-pet.com/pets/'
const CODEX_PET_ORG_HOME_URL = 'https://codex-pet.org/'
const CODEX_PET_ORG_BASE_URL = 'https://codex-pet.org/pets/'
const CODING_PETS_GALLERY_HOME_URL = 'https://codingpets.com/'
const CODING_PETS_GALLERY_BASE_URL = 'https://codingpets.com/pets/'
const CODEX_PETS_NET_GALLERY_HOME_URL = 'https://codexpets.net/gallery'
const CODEX_PETS_NET_BASE_URL = 'https://codexpets.net'
const OPENPETS_CATALOG_URL = 'https://openpets.dev/pets/catalog.v3.json'
const OPENPETS_GALLERY_URL = 'https://openpets.dev/gallery'
const DEFAULT_CATALOG_LIMIT = 12
const MAX_CATALOG_LIMIT = 40

function slugifyCodexPetId(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/[\\/]+/g, '-')
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()

  return normalized || 'codex-pet'
}

function isHttpUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

function resolveCodexPetGalleryUrl(input) {
  const rawInput = String(input ?? '').trim()
  if (!rawInput) {
    throw new Error('请输入 codex-pet 的宠物 slug 或详情页 URL。')
  }

  if (isHttpUrl(rawInput)) {
    return rawInput
  }

  const slug = slugifyCodexPetId(rawInput)
  if (slug !== rawInput.toLowerCase()) {
    throw new Error('codex-pet slug 只能包含字母、数字、短横线或下划线。')
  }

  return `${CODEX_PET_GALLERY_BASE_URL}${slug}`
}

function decodeJsString(value) {
  try {
    return JSON.parse(`"${value}"`)
  } catch {
    return value.replaceAll('\\"', '"').replaceAll('\\\\', '\\')
  }
}

function matchJsString(source, key, fromIndex = 0) {
  const expression = new RegExp(`${key}:"((?:\\\\.|[^"\\\\])*)"`, 'u')
  const match = expression.exec(source.slice(fromIndex))
  return match ? decodeJsString(match[1]) : ''
}

function matchJsonString(source, key, fromIndex = 0) {
  const expression = new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`, 'u')
  const match = expression.exec(source.slice(fromIndex))
  return match ? decodeJsString(match[1]) : ''
}

function inferSpriteExtension(spriteUrl, declaredExtension) {
  const declared = String(declaredExtension ?? '').trim().toLowerCase()
  if (declared === 'png' || declared === 'webp') {
    return declared
  }

  const pathname = new URL(spriteUrl).pathname.toLowerCase()
  if (pathname.endsWith('.png')) return 'png'
  if (pathname.endsWith('.webp')) return 'webp'

  throw new Error('无法识别 spritesheet 格式，只支持 PNG 或 WebP。')
}

function normalizeEmbeddedNextData(value) {
  return decodeHtmlEntities(String(value ?? ''))
    .replace(/\\\\u002F/gu, '/')
    .replace(/\\u002F/gu, '/')
    .replace(/\\"/gu, '"')
    .replace(/\\\//gu, '/')
}

function parseCodexPetGalleryPage(html, pageUrl) {
  const petIndex = html.indexOf('pet:$R')
  const searchIndex = petIndex >= 0 ? petIndex : 0
  const petJsonIndex = html.indexOf('petJson', searchIndex)
  const spriteUrl = matchJsString(html, 'spritesheetUrl', searchIndex)

  if (!spriteUrl || !isHttpUrl(spriteUrl)) {
    throw new Error(`未能从 ${pageUrl} 读取 spritesheetUrl。`)
  }

  const declaredExtension = matchJsString(html, 'spritesheetExt', searchIndex)
  const slug = matchJsString(html, 'slug', searchIndex)
  const displayName = matchJsString(html, 'displayName', searchIndex)
  const description = matchJsString(html, 'description', searchIndex)
  const manifestId = petJsonIndex >= 0 ? matchJsString(html, 'id', petJsonIndex) : ''

  return {
    id: manifestId || slug || slugifyCodexPetId(pathnameSlug(pageUrl)),
    displayName: displayName || manifestId || slug || 'Codex Pet',
    description,
    spriteUrl,
    spriteExtension: inferSpriteExtension(spriteUrl, declaredExtension),
    sourcePageUrl: pageUrl,
  }
}

function parseCodexPetOrgPage(html, pageUrl) {
  const normalizedHtml = normalizeEmbeddedNextData(html)
  const petIndex = normalizedHtml.indexOf('"slug":"')
  const searchIndex = petIndex >= 0 ? petIndex : 0
  const assetLinksIndex = normalizedHtml.indexOf('"assetLinks"', searchIndex)
  const canonicalMatch = /<link\b[^>]*rel="canonical"[^>]*href="([^"]+)"/iu.exec(normalizedHtml)
  const pageSlug = slugifyCodexPetId(pathnameSlug(canonicalMatch?.[1] || pageUrl))
  const spriteUrl = matchJsonString(normalizedHtml, 'spritesheetUrl', assetLinksIndex >= 0 ? assetLinksIndex : searchIndex)
    || matchJsonString(normalizedHtml, 'image_url', searchIndex)
  const manifestUrl = matchJsonString(normalizedHtml, 'manifestUrl', assetLinksIndex >= 0 ? assetLinksIndex : searchIndex)
  const slug = matchJsonString(normalizedHtml, 'slug', searchIndex) || pageSlug
  const displayName = matchJsonString(normalizedHtml, 'name', searchIndex)
  const description = matchJsonString(normalizedHtml, 'description', searchIndex)

  if (!spriteUrl || !isHttpUrl(spriteUrl)) {
    throw new Error(`未能从 ${pageUrl} 读取 Codex-pet.org spritesheetUrl。`)
  }

  return {
    id: slug || pageSlug || slugifyCodexPetId(displayName),
    displayName: displayName || slug || pageSlug || 'Codex Pet',
    description,
    spriteUrl,
    spriteExtension: inferSpriteExtension(spriteUrl),
    manifestUrl,
    sourceName: 'codex-pet.org',
    sourcePageUrl: canonicalMatch?.[1] || pageUrl,
  }
}

function cleanCodingPetsDisplayName(value) {
  return cleanHtmlText(value)
    .replace(/^View\s+/iu, '')
    .replace(/\s+Codex\s+pet\s+page$/iu, '')
    .replace(/\s+Codex\s+Pet$/u, '')
    .trim()
}

function pathnameSlug(url) {
  try {
    return new URL(url).pathname.split('/').filter(Boolean).at(-1) ?? ''
  } catch {
    return ''
  }
}

function decodeHtmlEntities(value) {
  const namedEntities = {
    amp: '&',
    apos: "'",
    gt: '>',
    lt: '<',
    quot: '"',
    x27: "'",
  }

  return String(value ?? '').replace(/&(#x[0-9a-f]+|#[0-9]+|[a-zA-Z][a-zA-Z0-9]+);/gu, (match, entity) => {
    const normalized = String(entity).toLowerCase()
    if (normalized.startsWith('#x')) {
      const codePoint = Number.parseInt(normalized.slice(2), 16)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    if (normalized.startsWith('#')) {
      const codePoint = Number.parseInt(normalized.slice(1), 10)
      return Number.isFinite(codePoint) ? String.fromCodePoint(codePoint) : match
    }
    return namedEntities[normalized] ?? match
  })
}

function cleanHtmlText(value) {
  return decodeHtmlEntities(String(value ?? '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function parseCatalogArticle(articleHtml, galleryUrl) {
  const hrefMatch = /href="\/pets\/([^"#?]+)"/iu.exec(articleHtml)
  if (!hrefMatch) {
    return null
  }

  const hrefSlug = slugifyCodexPetId(decodeHtmlEntities(hrefMatch[1]))
  if (!hrefSlug) {
    return null
  }

  const commandMatch = /npx\s+codex-pet-cli\s+add\s+([a-zA-Z0-9_-]+)/u.exec(articleHtml)
  const commandSlug = commandMatch ? slugifyCodexPetId(commandMatch[1]) : hrefSlug
  const titleMatch = /<h3\b[^>]*>([\s\S]*?)<\/h3>/iu.exec(articleHtml)
  const ariaLabelMatch = /aria-label="([^"]+)"/iu.exec(articleHtml)
  const descriptionMatch = /<p\b[^>]*>([\s\S]*?)<\/p>/iu.exec(articleHtml)
  const displayName = cleanHtmlText(titleMatch?.[1] ?? ariaLabelMatch?.[1] ?? hrefSlug)
  const description = cleanHtmlText(descriptionMatch?.[1] ?? '')

  return {
    id: commandSlug || hrefSlug,
    slug: commandSlug || hrefSlug,
    displayName: displayName || commandSlug || hrefSlug,
    description,
    sourceUrl: new URL(`/pets/${hrefSlug}`, galleryUrl).toString(),
    installCommand: `npx codex-pet-cli add ${commandSlug || hrefSlug}`,
  }
}

function parseCodexPetGalleryCatalog(html, galleryUrl = CODEX_PET_GALLERY_HOME_URL) {
  const cleanedPageText = cleanHtmlText(html)
  const totalMatch = /([0-9][0-9,]*)\s*pet\s*s?\s*ready to install/iu.exec(cleanedPageText)
  const declaredTotal = totalMatch ? Number.parseInt(totalMatch[1].replaceAll(',', ''), 10) : 0
  const articles = Array.from(String(html ?? '').matchAll(/<article\b[\s\S]*?<\/article>/giu))
  const seen = new Set()
  const pets = []

  for (const match of articles) {
    const pet = parseCatalogArticle(match[0], galleryUrl)
    if (!pet || seen.has(pet.slug)) {
      continue
    }
    seen.add(pet.slug)
    pets.push(pet)
  }

  return {
    sourceUrl: galleryUrl,
    totalCount: declaredTotal || pets.length,
    pets,
  }
}

function parseCodingPetsArticle(articleHtml, galleryUrl) {
  const hrefMatch = /href="\/pets\/([^"#?]+)"[^>]*aria-label="View\s+([^"]+)"/iu.exec(articleHtml)
    || /href="\/pets\/([^"#?]+)"/iu.exec(articleHtml)
  if (!hrefMatch) {
    return null
  }

  const hrefSlug = slugifyCodexPetId(decodeHtmlEntities(hrefMatch[1]))
  if (!hrefSlug) {
    return null
  }

  const titleMatch = /<h3\b[^>]*>([\s\S]*?)<\/h3>/iu.exec(articleHtml)
  const descriptionMatch = /<p\b[^>]*class="[^"]*pet-description[^"]*"[^>]*>([\s\S]*?)<\/p>/iu.exec(articleHtml)
    || /<p\b[^>]*>([\s\S]*?)<\/p>/iu.exec(articleHtml)
  const downloadMatch = /href="(https?:\/\/[^"]+)"[^>]*aria-label="Download\s+[^"]+\s+ZIP"/iu.exec(articleHtml)
  const displayName = cleanCodingPetsDisplayName(hrefMatch[2] ?? titleMatch?.[1] ?? hrefSlug)

  return {
    id: hrefSlug,
    slug: hrefSlug,
    displayName: displayName || formatCodingPetsSlug(hrefSlug),
    description: cleanHtmlText(descriptionMatch?.[1] ?? ''),
    sourceName: 'Coding Pets',
    sourceUrl: new URL(`/pets/${hrefSlug}`, galleryUrl).toString(),
    downloadUrl: downloadMatch ? decodeHtmlEntities(downloadMatch[1]) : '',
    installCommand: 'Download ZIP',
  }
}

function formatCodingPetsSlug(slug) {
  return String(slug ?? '')
    .replace(/-[^-]+$/u, '')
    .replace(/[-_]+/gu, ' ')
    .replace(/\b\w/gu, (character) => character.toUpperCase())
}

function parseCodingPetsCatalog(html, galleryUrl = CODING_PETS_GALLERY_HOME_URL) {
  const cleanedPageText = cleanHtmlText(html)
  const totalMatch = /([0-9][0-9,]*)\s*\/\s*([0-9][0-9,]*)/u.exec(cleanedPageText)
  const declaredTotal = totalMatch ? Number.parseInt(totalMatch[2].replaceAll(',', ''), 10) : 0
  const articles = Array.from(String(html ?? '').matchAll(/<article\b[\s\S]*?<\/article>/giu))
  const seen = new Set()
  const pets = []

  for (const match of articles) {
    const pet = parseCodingPetsArticle(match[0], galleryUrl)
    if (!pet || seen.has(pet.slug)) {
      continue
    }
    seen.add(pet.slug)
    pets.push(pet)
  }

  return {
    sourceUrl: galleryUrl,
    totalCount: declaredTotal || pets.length,
    pets,
  }
}

function parseCodingPetsPage(html, pageUrl) {
  const downloadMatch = /href="(https?:\/\/[^"]+)"[^>]*aria-label="Download\s+[^"]+\s+ZIP"/iu.exec(html)
  if (!downloadMatch) {
    throw new Error(`未能从 ${pageUrl} 读取 Coding Pets ZIP 下载链接。`)
  }

  const titleMatch = /<h1\b[^>]*>([\s\S]*?)<\/h1>/iu.exec(html)
  const descriptionMatch = /<meta\b[^>]*name="description"[^>]*content="([^"]*)"/iu.exec(html)
    || /<p\b[^>]*class="[^"]*pet-description[^"]*"[^>]*>([\s\S]*?)<\/p>/iu.exec(html)
  const slug = slugifyCodexPetId(pathnameSlug(pageUrl))
  const displayName = cleanCodingPetsDisplayName(titleMatch?.[1] ?? slug)

  return {
    id: slug,
    displayName: displayName || formatCodingPetsSlug(slug),
    description: cleanHtmlText(descriptionMatch?.[1] ?? ''),
    downloadUrl: decodeHtmlEntities(downloadMatch[1]),
    sourceName: 'Coding Pets',
    sourcePageUrl: pageUrl,
  }
}

function parseCodexPetsNetCatalog(html, galleryUrl = CODEX_PETS_NET_GALLERY_HOME_URL) {
  const normalizedHtml = normalizeEmbeddedNextData(html)
  const cleanedPageText = cleanHtmlText(normalizedHtml)
  const totalMatch = /([0-9][0-9,]*)\s*pets/iu.exec(cleanedPageText)
  const declaredTotal = totalMatch ? Number.parseInt(totalMatch[1].replaceAll(',', ''), 10) : 0
  const petExpression = /"slug":"((?:\\.|[^"\\])*)","name":"((?:\\.|[^"\\])*)","description":"((?:\\.|[^"\\])*)"[\s\S]{0,4000}?"spritesheetUrl":"((?:\\.|[^"\\])*)"[\s\S]{0,1200}?"detailHref":"((?:\\.|[^"\\])*)"[\s\S]{0,800}?"downloadHref":"((?:\\.|[^"\\])*)"/gu
  const seen = new Set()
  const pets = []

  for (const match of normalizedHtml.matchAll(petExpression)) {
    const slug = slugifyCodexPetId(decodeJsString(match[1]))
    if (!slug || seen.has(slug)) {
      continue
    }

    const detailHref = decodeJsString(match[5])
    const downloadHref = decodeJsString(match[6])
    seen.add(slug)
    pets.push({
      id: slug,
      slug,
      displayName: cleanHtmlText(decodeJsString(match[2])) || formatCodingPetsSlug(slug),
      description: cleanHtmlText(decodeJsString(match[3])),
      sourceName: 'CodexPets.net',
      sourceUrl: new URL(detailHref || `/pets/${slug}`, galleryUrl).toString(),
      downloadUrl: new URL(downloadHref || `/api/pets/${slug}/download`, CODEX_PETS_NET_BASE_URL).toString(),
      installCommand: 'Download ZIP',
    })
  }

  return {
    sourceUrl: galleryUrl,
    totalCount: declaredTotal || pets.length,
    pets,
  }
}

function parseCodexPetOrgCatalog(html, galleryUrl = CODEX_PET_ORG_HOME_URL) {
  const normalizedHtml = normalizeEmbeddedNextData(html)
  const cleanedPageText = cleanHtmlText(normalizedHtml)
  const totalMatch = /([0-9][0-9,]*)\s*pet\s*s?/iu.exec(cleanedPageText)
  const declaredTotal = totalMatch ? Number.parseInt(totalMatch[1].replaceAll(',', ''), 10) : 0
  const petExpression = /"slug":"((?:\\.|[^"\\])*)","name":"((?:\\.|[^"\\])*)"[\s\S]{0,3000}?"description":"((?:\\.|[^"\\])*)"[\s\S]{0,2000}?"image_url":"((?:\\.|[^"\\])*)"[\s\S]{0,1200}?"command":"npx\s+codex-pet-installer\s+add\s+([^"]+)"/gu
  const seen = new Set()
  const pets = []

  for (const match of normalizedHtml.matchAll(petExpression)) {
    const hrefSlug = slugifyCodexPetId(decodeJsString(match[1]))
    const commandSlug = slugifyCodexPetId(decodeJsString(match[5]))
    const slug = commandSlug || hrefSlug
    if (!slug || seen.has(slug)) {
      continue
    }

    seen.add(slug)
    pets.push({
      id: slug,
      slug,
      displayName: cleanHtmlText(decodeJsString(match[2])) || slug,
      description: cleanHtmlText(decodeJsString(match[3])),
      sourceName: 'codex-pet.org',
      sourceUrl: new URL(`/pets/${hrefSlug || slug}/`, galleryUrl).toString(),
      spriteUrl: decodeJsString(match[4]),
      installCommand: `npx codex-pet-installer add ${slug}`,
    })
  }

  return {
    sourceUrl: galleryUrl,
    totalCount: declaredTotal || pets.length,
    pets,
  }
}

function parseOpenPetsCatalog(catalogJson, catalogUrl = OPENPETS_CATALOG_URL) {
  let catalog
  try {
    catalog = JSON.parse(String(catalogJson ?? ''))
  } catch {
    throw new Error('OpenPets catalog is not valid JSON.')
  }

  const entries = Array.isArray(catalog)
    ? catalog
    : Array.isArray(catalog?.pets)
      ? catalog.pets
      : Array.isArray(catalog?.items)
        ? catalog.items
        : []
  const declaredTotal = Number.parseInt(String(catalog?.totalCount ?? catalog?.total ?? entries.length), 10) || 0
  const seen = new Set()
  const pets = []

  for (const entry of entries) {
    const slug = slugifyCodexPetId(entry?.id || entry?.slug || entry?.name)
    if (!slug || seen.has(slug)) {
      continue
    }

    const rawZipUrl = String(entry?.zip || entry?.downloadUrl || entry?.packageUrl || '').trim()
    if (!rawZipUrl) {
      continue
    }

    let downloadUrl
    try {
      downloadUrl = new URL(rawZipUrl, catalogUrl).toString()
    } catch {
      continue
    }

    seen.add(slug)
    pets.push({
      id: slug,
      slug,
      displayName: cleanHtmlText(entry?.displayName || entry?.name || entry?.title || slug),
      description: cleanHtmlText(entry?.description || ''),
      sourceName: 'OpenPets',
      sourceUrl: OPENPETS_GALLERY_URL,
      downloadUrl,
      installCommand: 'Download ZIP',
    })
  }

  return {
    sourceUrl: catalogUrl,
    totalCount: declaredTotal || pets.length,
    pets,
  }
}

function resolveCodexPetsNetDownloadUrl(input) {
  const url = new URL(input)
  const pathParts = url.pathname.split('/').filter(Boolean)
  const section = pathParts[0] ?? ''
  const slug = slugifyCodexPetId(pathParts[1] ?? '')

  if (!slug) {
    throw new Error('请粘贴 CodexPets.net 的具体宠物详情页 URL。')
  }

  if (section === 'gallery') {
    return new URL(`/api/gallery-pets/${slug}/download`, CODEX_PETS_NET_BASE_URL).toString()
  }

  if (section === 'pets') {
    return new URL(`/api/pets/${slug}/download`, CODEX_PETS_NET_BASE_URL).toString()
  }

  throw new Error('请粘贴 CodexPets.net 的具体宠物详情页 URL。')
}

function normalizeCatalogQuery(value) {
  return String(value ?? '').trim().toLowerCase()
}

function filterCodexPetGalleryCatalog(catalog, options = {}) {
  const query = normalizeCatalogQuery(options.query)
  const terms = query.split(/\s+/u).filter(Boolean)
  const limit = Math.min(
    Math.max(Number.parseInt(String(options.limit ?? DEFAULT_CATALOG_LIMIT), 10) || DEFAULT_CATALOG_LIMIT, 1),
    MAX_CATALOG_LIMIT,
  )
  const matchedPets = terms.length
    ? catalog.pets.filter((pet) => {
        const haystack = [
          pet.slug,
          pet.displayName,
          pet.description,
          pet.sourceName,
          pet.installCommand,
        ].join(' ').toLowerCase()
        return terms.every((term) => haystack.includes(term))
      })
    : catalog.pets

  return {
    sourceUrl: catalog.sourceUrl,
    totalCount: catalog.totalCount,
    matchedCount: matchedPets.length,
    query,
    pets: matchedPets.slice(0, limit),
  }
}

async function fetchCodexPetGalleryCatalog(options = {}) {
  const fetchText = typeof options.fetchText === 'function'
    ? options.fetchText
    : fetchCatalogText
  const results = await Promise.allSettled([
    fetchCatalog(CODEX_PET_GALLERY_HOME_URL, parseCodexPetGalleryCatalog, fetchText),
    fetchCatalog(CODEX_PET_ORG_HOME_URL, parseCodexPetOrgCatalog, fetchText),
    fetchCatalog(CODING_PETS_GALLERY_HOME_URL, parseCodingPetsCatalog, fetchText),
    fetchCatalog(CODEX_PETS_NET_GALLERY_HOME_URL, parseCodexPetsNetCatalog, fetchText),
    fetchCatalog(OPENPETS_CATALOG_URL, parseOpenPetsCatalog, fetchText),
  ])
  const catalogs = results
    .filter((result) => result.status === 'fulfilled')
    .map((result) => result.value)

  if (!catalogs.length) {
    const reason = results.find((result) => result.status === 'rejected')?.reason
    throw new Error(`请求 Codex 宠物图库失败：${reason?.message ?? String(reason)}`)
  }

  return filterCodexPetGalleryCatalog(mergeCatalogs(catalogs), options)
}

async function fetchCatalogText(url) {
  const response = await fetch(url)
  if (!response.ok) {
    throw new Error(`请求 ${url} 失败：${response.status} ${response.statusText}`)
  }

  return response.text()
}

async function fetchCatalog(url, parser, fetchText) {
  return parser(await fetchText(url), url)
}

function mergeCatalogs(catalogs) {
  const pets = []
  const seen = new Set()
  const queues = catalogs.map((catalog) => [...catalog.pets])

  while (queues.some((queue) => queue.length > 0)) {
    for (const queue of queues) {
      const pet = queue.shift()
      if (!pet) {
        continue
      }
      const key = `${pet.sourceName ?? 'codex-pet.com'}:${pet.slug}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      pets.push(pet)
    }
  }

  return {
    sourceUrl: CODEX_PET_GALLERY_HOME_URL,
    // Report the count of pets actually browsable here (post-dedup), not the
    // sum of each source's self-declared site totals — we only fetch a page
    // from each, so those totals are unreachable and the UI count would
    // otherwise claim thousands of searchable pets when only these exist.
    totalCount: pets.length,
    pets,
  }
}

export {
  CODEX_PET_GALLERY_HOME_URL,
  CODEX_PET_GALLERY_BASE_URL,
  CODEX_PET_ORG_HOME_URL,
  CODEX_PET_ORG_BASE_URL,
  CODING_PETS_GALLERY_HOME_URL,
  CODING_PETS_GALLERY_BASE_URL,
  CODEX_PETS_NET_GALLERY_HOME_URL,
  CODEX_PETS_NET_BASE_URL,
  OPENPETS_CATALOG_URL,
  OPENPETS_GALLERY_URL,
  slugifyCodexPetId,
  isHttpUrl,
  resolveCodexPetGalleryUrl,
  resolveCodexPetsNetDownloadUrl,
  parseCodexPetGalleryPage,
  parseCodexPetOrgPage,
  parseCodexPetGalleryCatalog,
  parseCodexPetOrgCatalog,
  parseCodingPetsCatalog,
  parseCodingPetsPage,
  parseCodexPetsNetCatalog,
  parseOpenPetsCatalog,
  filterCodexPetGalleryCatalog,
  fetchCodexPetGalleryCatalog,
}
