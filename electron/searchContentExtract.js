import { decodeHtmlEntities, normalizeSearchableText } from './textNormalize.js'

const META_DESCRIPTION_PATTERNS = [
  /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"]+)["'][^>]*>/iu,
  /<meta[^>]+name=["']description["'][^>]+content=["']([^"]+)["'][^>]*>/iu,
  /<meta[^>]+name=["']twitter:description["'][^>]+content=["']([^"]+)["'][^>]*>/iu,
]

const REMOVABLE_BLOCK_PATTERN = /<(script|style|noscript|svg|canvas|iframe|nav|footer|header|aside|form)[^>]*>[\s\S]*?<\/\1>/giu
const REMOVABLE_LAYOUT_PATTERN = /<([a-z0-9:-]+)[^>]*(?:class|id)=["'][^"']*(?:footer|header|nav|sidebar|aside|breadcrumb|comment|related|recommend|share|toolbar|popup|modal|advert|ads?|cookie|login|subscribe)[^"']*["'][^>]*>[\s\S]*?<\/\1>/giu
const BLOCK_BREAK_PATTERN = /<\/(?:p|div|li|section|article|main|h1|h2|h3|h4|blockquote|tr|td|pre|ul|ol)>/giu
const BOILERPLATE_TEXT_PATTERN = /(?:contact us|customer service|support|help center|account help|privacy policy|cookie|terms(?: of use| of service)?|all rights reserved|copyright|免责声明|版权声明|展开全部|阅读全文|更多内容|查看原文|查看详情|相关阅读|相关推荐|猜你喜欢|上一篇|下一篇|登录|注册|打开app|下载app|广告|赞助|返回顶部|相关搜索|热门搜索)/iu
const URLISH_PATTERN = /(?:https?:\/\/|www\.)/iu
const SEARCH_QUERY_NOISE_PATTERN = /(?:帮我|请|搜索|搜一下|查一下|查询|网页|网页搜索|一下|给我|看看|关于|相关|内容|结果|最新|帮忙)/giu

function buildSearchTokens(query) {
  const normalized = decodeHtmlEntities(String(query ?? ''))
    .replace(SEARCH_QUERY_NOISE_PATTERN, ' ')
    .replace(/(?:歌词|歌詞|lyrics?|lyric)/giu, ' ')
    .replace(/[《》"'`]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (!normalized) {
    return []
  }

  const pieces = normalized
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)

  const tokens = new Set()
  for (const piece of pieces) {
    const compact = piece.replace(/\s+/g, '')
    if (compact.length >= 2) {
      tokens.add(compact.toLowerCase())
    }

    if (/[\u3400-\u9fff]/u.test(piece) && piece.length >= 4) {
      for (let length = Math.min(6, piece.length); length >= 2; length -= 1) {
        const head = piece.slice(0, length).trim()
        const tail = piece.slice(-length).trim()
        if (head.length >= 2) tokens.add(head.toLowerCase())
        if (tail.length >= 2) tokens.add(tail.toLowerCase())
      }
    }
  }

  return [...tokens]
}

function cleanCandidateText(value) {
  return decodeHtmlEntities(String(value ?? ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/(?:展开全部|阅读全文|更多内容|网页链接|查看原文|查看详情)/giu, ' ')
    .replace(/(?:版权声明|免责声明).*/giu, ' ')
    .replace(/\s*[|｜丨]\s*/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function sanitizeHtmlForTextExtraction(html) {
  return String(html ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(REMOVABLE_BLOCK_PATTERN, ' ')
    .replace(REMOVABLE_LAYOUT_PATTERN, ' ')
    .replace(/<br\s*\/?>/giu, '\n')
    .replace(BLOCK_BREAK_PATTERN, '\n')
}

function stripHtmlTagsPreserveNewlines(value) {
  return decodeHtmlEntities(String(value ?? ''))
    .replace(/<[^>]+>/g, ' ')
    .replace(/\r/g, '')
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

function splitLongCandidate(text) {
  const cleaned = cleanCandidateText(text)
  if (!cleaned) {
    return []
  }

  if (cleaned.length <= 180) {
    return [cleaned]
  }

  const sentenceParts = cleaned
    .split(/(?<=[。！？!?；;])/u)
    .map((part) => part.trim())
    .filter(Boolean)

  if (sentenceParts.length <= 1) {
    return [cleaned.slice(0, 180).trim()]
  }

  const chunks = []
  let currentChunk = ''

  for (const part of sentenceParts) {
    const nextChunk = currentChunk ? `${currentChunk}${part}` : part
    if (nextChunk.length > 180 && currentChunk) {
      chunks.push(currentChunk.trim())
      currentChunk = part
      continue
    }

    currentChunk = nextChunk
  }

  if (currentChunk) {
    chunks.push(currentChunk.trim())
  }

  return chunks
    .map((chunk) => chunk.trim())
    .filter(Boolean)
}

function isValidCandidateText(text, minLength = 10) {
  if (!text) {
    return false
  }

  if (!/[\u3400-\u9fffA-Za-z0-9]/u.test(text)) {
    return false
  }

  if (URLISH_PATTERN.test(text)) {
    return false
  }

  if (text.length < minLength || text.length > 240) {
    return false
  }

  if (BOILERPLATE_TEXT_PATTERN.test(text)) {
    return false
  }

  return true
}

function scoreCandidateText(text, query, baseScore = 0) {
  const normalizedText = normalizeSearchableText(text, { decodeEntities: true })
  const normalizedQuery = normalizeSearchableText(query, { decodeEntities: true })
  const compactText = normalizedText.replace(/\s+/g, '')
  const compactQuery = normalizedQuery.replace(/\s+/g, '')
  const tokens = buildSearchTokens(query)

  let score = baseScore
  let tokenHitCount = 0

  for (const token of tokens) {
    if (!token || !normalizedText.includes(token)) {
      continue
    }

    tokenHitCount += 1
    score += token.length >= 4 ? 5 : 3
  }

  if (compactQuery && compactText.includes(compactQuery)) {
    score += 12
  }

  if (tokens.length > 1 && tokenHitCount === tokens.length) {
    score += 5
  }

  if (tokens.length && tokenHitCount === 0) {
    score -= 8
  }

  if (text.length >= 20 && text.length <= 140) {
    score += 4
  } else if (text.length <= 180) {
    score += 2
  } else {
    score -= 2
  }

  if (/^(?:来源|作者|编辑|发布时间|更新时间|标签)[:：]/u.test(text)) {
    score -= 6
  }

  if (BOILERPLATE_TEXT_PATTERN.test(text)) {
    score -= 16
  }

  return score
}

function extractMetaCandidates(html) {
  const candidates = []

  for (const pattern of META_DESCRIPTION_PATTERNS) {
    const match = String(html ?? '').match(pattern)
    const cleaned = cleanCandidateText(match?.[1] ?? '')
    if (cleaned) {
      candidates.push({ text: cleaned, baseScore: 4 })
    }
  }

  return candidates
}

function extractBodyCandidates(html) {
  const sanitized = sanitizeHtmlForTextExtraction(html)
  const preserved = stripHtmlTagsPreserveNewlines(sanitized)

  return preserved
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((text) => ({ text, baseScore: 0 }))
}

export function extractRelevantSegmentsFromHtml(html, query, options = {}) {
  const maxSegments = Math.max(1, Math.min(Number(options.maxSegments) || 3, 6))
  const rankedCandidates = []
  const seen = new Set()

  for (const candidate of [...extractMetaCandidates(html), ...extractBodyCandidates(html)]) {
    for (const part of splitLongCandidate(candidate.text)) {
      const cleaned = cleanCandidateText(part)
      if (!isValidCandidateText(cleaned, 10)) {
        continue
      }

      const normalizedKey = normalizeSearchableText(cleaned, { decodeEntities: true }).replace(/\s+/g, '')
      if (!normalizedKey || seen.has(normalizedKey)) {
        continue
      }

      seen.add(normalizedKey)
      rankedCandidates.push({
        text: cleaned,
        score: scoreCandidateText(cleaned, query, candidate.baseScore),
        order: rankedCandidates.length,
      })
    }
  }

  const selected = rankedCandidates
    .sort((left, right) => right.score - left.score || left.order - right.order)
    .filter((candidate, index) => candidate.score > -5 || index < 2)
    .slice(0, maxSegments)
    .map((candidate) => candidate.text)

  return selected
}

export function extractPagePreviewFromHtml(html, query, options = {}) {
  return extractRelevantSegmentsFromHtml(html, query, options).join('\n')
}

export function collectSearchContentBodyLines(items, maxLines = 5) {
  const lines = []
  const seen = new Set()

  for (const item of items ?? []) {
    const sources = [item?.contentPreview, item?.snippet]

    for (const source of sources) {
      const rawPieces = String(source ?? '')
        .split(/\r?\n+/)
        .map((piece) => piece.trim())
        .filter(Boolean)

      for (const piece of rawPieces) {
        for (const candidate of splitLongCandidate(piece)) {
          const cleaned = cleanCandidateText(candidate)
          if (!isValidCandidateText(cleaned, 4)) {
            continue
          }

          const normalizedKey = normalizeSearchableText(cleaned, { decodeEntities: true }).replace(/\s+/g, '')
          if (!normalizedKey || seen.has(normalizedKey)) {
            continue
          }

          seen.add(normalizedKey)
          lines.push(cleaned)

          if (lines.length >= maxLines) {
            return lines
          }
        }
      }
    }
  }

  return lines
}
