import { normalizeWhitespace, normalizeSearchableText } from './textNormalize.js'

function normalizeFacet(value) {
  const normalized = normalizeWhitespace(value)
  if (!normalized) return ''
  if (/(?:官网|官方网站|网址|链接|official\s+site)/iu.test(normalized)) return 'official'
  if (/(?:最新|最近|新消息|新动态|latest\s+news)/iu.test(normalized)) return 'latest'
  if (/(?:歌词|歌詞|lyrics?|lyric)/iu.test(normalized)) return 'lyrics'
  return normalized.toLowerCase()
}

function tokenizeSubject(subject) {
  const normalized = normalizeWhitespace(subject)
  if (!normalized) return []

  return [...new Set(
    normalized
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .flatMap((token) => {
        if (/^[a-z0-9._-]+$/iu.test(token)) {
          return [token.toLowerCase()]
        }
        if (/[\u3400-\u9fff]/u.test(token) && token.length >= 2) {
          return [token, token.replace(/\s+/g, '').toLowerCase()]
        }
        return [token.toLowerCase()]
      })
      .filter(Boolean),
  )]
}

export function buildSearchPlanSignals({
  query,
  subject,
  facet,
  keywords = [],
  matchProfile = '',
  strictTerms = [],
  softTerms = [],
  phraseTerms = [],
}) {
  const normalizedFacet = normalizeFacet(facet || query)
  const normalizedSubject = normalizeWhitespace(subject)
  const subjectTerms = tokenizeSubject(normalizedSubject)
  const normalizedKeywords = [...new Set(
    (Array.isArray(keywords) ? keywords : [])
      .map((token) => normalizeWhitespace(token))
      .filter(Boolean),
  )]

  const derivedStrictTerms = [...new Set(subjectTerms.flatMap((term) => {
    if (/^[a-z0-9._-]+$/iu.test(term)) {
      return [term.toLowerCase()]
    }
    return term
      .split(/\s+/)
      .map((piece) => piece.trim().toLowerCase())
      .filter(Boolean)
  }))]

  const derivedPhraseTerms = normalizedSubject ? [normalizedSubject] : []
  const derivedSoftTerms = [...new Set([
    ...normalizedKeywords,
    ...(normalizedFacet === 'official' ? ['官网', 'official', '官方网站'] : []),
    ...(normalizedFacet === 'latest' ? ['最新', 'latest', 'news'] : []),
    ...(normalizedFacet === 'lyrics' ? ['歌词', 'lyrics'] : []),
  ])]

  return {
    matchProfile: normalizeWhitespace(matchProfile) || normalizedFacet || 'general_entity',
    strictTerms: [...new Set([
      ...derivedStrictTerms,
      ...(Array.isArray(strictTerms) ? strictTerms.map((term) => normalizeSearchableText(term)).filter(Boolean) : []),
    ])],
    softTerms: [...new Set([
      ...derivedSoftTerms,
      ...(Array.isArray(softTerms) ? softTerms.map((term) => normalizeWhitespace(term)).filter(Boolean) : []),
    ])],
    phraseTerms: [...new Set([
      ...derivedPhraseTerms,
      ...(Array.isArray(phraseTerms) ? phraseTerms.map((term) => normalizeWhitespace(term)).filter(Boolean) : []),
    ])],
  }
}

export function resolveSearchEvidenceQuery(query, subject, facet) {
  const normalizedSubject = normalizeWhitespace(subject)
  const normalizedFacet = normalizeFacet(facet || query)
  if (normalizedSubject && (normalizedFacet === 'official' || normalizedFacet === 'latest' || normalizedFacet === 'lyrics')) {
    return normalizedSubject
  }
  return normalizeWhitespace(query)
}

export function shouldFetchSearchPreviews(arg1, arg2, arg3) {
  const params = typeof arg1 === 'object' && arg1 !== null
    ? arg1
    : { query: arg1, facet: arg2, matchConfidence: arg3 }
  const normalizedFacet = normalizeFacet(params.facet || params.query)
  if (normalizedFacet === 'official' || normalizedFacet === 'latest' || normalizedFacet === 'lyrics') {
    return true
  }
  return params.matchConfidence !== 'high'
}

function normalizeUrlForDedupe(url) {
  try {
    const parsed = new URL(String(url ?? '').trim())
    parsed.hash = ''
    for (const key of [...parsed.searchParams.keys()]) {
      if (/^(?:utm_|from$|source$|ref$)/iu.test(key)) {
        parsed.searchParams.delete(key)
      }
    }
    return parsed.toString().replace(/\/$/u, '')
  } catch {
    return String(url ?? '').trim()
  }
}

function normalizeHost(url) {
  try {
    return new URL(String(url ?? '').trim()).hostname.toLowerCase().replace(/^www\./u, '')
  } catch {
    return ''
  }
}

function normalizeTitleFingerprint(title) {
  return normalizeSearchableText(title)
    .replace(/(?:official|site|news|example|官网|官方网站)/giu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function dedupeSearchItems(items) {
  const seen = new Set()
  const nearSeen = new Set()
  const deduped = []
  for (const item of Array.isArray(items) ? items : []) {
    const key = normalizeUrlForDedupe(item?.url)
    if (!key || seen.has(key)) {
      continue
    }

    const host = normalizeHost(item?.url)
    const titleFingerprint = normalizeTitleFingerprint(item?.title)
    const nearKey = host && titleFingerprint ? `${host}::${titleFingerprint}` : ''
    if (nearKey && nearSeen.has(nearKey)) {
      continue
    }

    seen.add(key)
    if (nearKey) {
      nearSeen.add(nearKey)
    }
    deduped.push(item)
  }
  return deduped
}

export function buildAnswerDisplaySummary({ query, topTitle, leadBody, matchConfidence }) {
  const normalizedQuery = normalizeWhitespace(query)
  const normalizedTitle = normalizeWhitespace(topTitle)
  const normalizedLeadBody = normalizeWhitespace(leadBody)

  if (matchConfidence === 'low') {
    if (normalizedTitle) {
      return `这次搜索对“${normalizedQuery}”还不确定，目前最接近的是“${normalizedTitle}”，但我还不能确认它就是你要找的结果。`
    }
    return `这次搜索对“${normalizedQuery}”还不确定，当前结果还不够可靠。`
  }

  if (normalizedLeadBody) {
    return `最相关的结果提到：${normalizedLeadBody}`
  }

  if (normalizedTitle) {
    return `目前最相关的结果是“${normalizedTitle}”。`
  }

  return `我先整理了“${normalizedQuery}”的搜索结果。`
}

export function computeCoverageScore(item, signals) {
  const title = normalizeSearchableText(item?.title)
  const snippet = normalizeSearchableText([item?.contentPreview, item?.snippet].filter(Boolean).join(' '))
  const url = normalizeSearchableText(item?.url)
  const strictTerms = Array.isArray(signals?.strictTerms) ? signals.strictTerms : []
  let matched = 0
  for (const term of strictTerms) {
    const normalizedTerm = normalizeSearchableText(term)
    if (!normalizedTerm) continue
    if (title.includes(normalizedTerm) || snippet.includes(normalizedTerm) || url.includes(normalizedTerm)) {
      matched += 1
    }
  }
  return strictTerms.length ? matched / strictTerms.length : 1
}

export function computePhraseMatchScore(item, signals) {
  const title = normalizeSearchableText(item?.title)
  const snippet = normalizeSearchableText([item?.contentPreview, item?.snippet].filter(Boolean).join(' '))
  const url = normalizeSearchableText(item?.url)
  const phrases = Array.isArray(signals?.phraseTerms) ? signals.phraseTerms : []

  for (const phrase of phrases) {
    const normalizedPhrase = normalizeSearchableText(phrase)
    if (!normalizedPhrase) continue
    if (title.includes(normalizedPhrase)) return 1
    if (snippet.includes(normalizedPhrase) || url.includes(normalizedPhrase)) return 0.7
  }

  return 0
}

export function computeSoftTermScore(item, signals) {
  const title = normalizeSearchableText(item?.title)
  const snippet = normalizeSearchableText([item?.contentPreview, item?.snippet].filter(Boolean).join(' '))
  const url = normalizeSearchableText(item?.url)
  const softTerms = Array.isArray(signals?.softTerms) ? signals.softTerms : []
  if (!softTerms.length) return 0

  let matched = 0
  for (const term of softTerms) {
    const normalizedTerm = normalizeSearchableText(term)
    if (!normalizedTerm) continue
    if (title.includes(normalizedTerm) || snippet.includes(normalizedTerm) || url.includes(normalizedTerm)) {
      matched += 1
    }
  }

  return matched / softTerms.length
}

export function computeFacetSatisfactionScore(item, signals) {
  const profile = normalizeFacet(signals?.matchProfile)
  const haystack = `${item?.title ?? ''} ${item?.contentPreview ?? ''} ${item?.snippet ?? ''} ${item?.url ?? ''} ${item?.publishedAt ?? ''}`

  if (profile === 'official') {
    if (/(?:官网|官方网站|official|official site)/iu.test(haystack)) return 1
    if (/\b(?:mi\.com|xiaomi\.com|apple\.com|microsoft\.com)\b/iu.test(haystack)) return 0.8
    return 0
  }

  if (profile === 'latest') {
    if (/(?:历史|回顾|旧闻|archive)/iu.test(haystack)) return 0
    if (/(?:最新|最近|刚刚|今日|本周|today|latest|new)/iu.test(haystack)) return 1
    if (/\b(?:202[4-9]|20[3-9][0-9])\b/u.test(haystack)) return 0.5
    return 0
  }

  if (profile === 'lyrics') {
    if (/(?:歌词|歌詞|lyrics?|lyric)/iu.test(haystack)) return 1
    return 0
  }

  return 0
}
