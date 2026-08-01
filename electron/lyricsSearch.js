const LRCLIB_SEARCH_ENDPOINT = 'https://lrclib.net/api/search'
const LRCLIB_GET_ENDPOINT = 'https://lrclib.net/api/get'
const LYRICS_QUERY_PATTERN = /(?:歌词|歌詞|lyrics?|lyric)/iu
const LYRICS_FILLER_PATTERN = /(?:请问|麻烦|帮我|给我|替我|搜索一下|搜一下|搜索|搜|查一下|查一查|查询|查找一下|查找|查|找一下|找|展示一下|展示|显示一下|显示|看看|告诉我|一下|完整|全文|原文|内容|版本|这首歌|那首歌|这首|那首|歌曲?)/giu
const CJK_PATTERN = /[\u3400-\u9fff]/u

function normalizeWhitespace(text) {
  return String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeComparableText(text) {
  return normalizeWhitespace(text)
    .replace(/[《》"'`·,，。！？!?;；:：()\[\]【】（）\s]/g, '')
    .toLowerCase()
}

function isLyricsLikeQuery(query) {
  return LYRICS_QUERY_PATTERN.test(String(query ?? ''))
}

function normalizeLyricsTopic(query) {
  return normalizeWhitespace(
    String(query ?? '')
      .replace(/[《》"'`]/g, ' ')
      .replace(LYRICS_QUERY_PATTERN, ' ')
      .replace(LYRICS_FILLER_PATTERN, ' ')
      .replace(/\b(?:lyrics?|lyric)\b/giu, ' ')
      .replace(/[()\[\]（）【】]/g, ' ')
      .replace(/[，。！？!?;；:：]/g, ' '),
  )
    .replace(/^(?:的|之)+/u, '')
    .replace(/(?:的|之)+$/u, '')
}

function addCandidate(candidates, seenKeys, artist, track, priority) {
  const normalizedArtist = normalizeWhitespace(artist)
  const normalizedTrack = normalizeWhitespace(track)
  if (!normalizedTrack) {
    return
  }

  const key = `${normalizeComparableText(normalizedArtist)}|${normalizeComparableText(normalizedTrack)}`
  if (!key || seenKeys.has(key)) {
    return
  }

  seenKeys.add(key)
  candidates.push({
    artist: normalizedArtist,
    track: normalizedTrack,
    priority,
  })
}

function addTopicCandidates(candidates, seenKeys, topic, rawQuery = '') {
  const normalizedTopic = normalizeLyricsTopic(topic)
  if (!normalizedTopic) {
    return
  }

  const titleMatch = String(rawQuery ?? '').match(/《([^》]+)》/u)
  if (titleMatch?.[1]) {
    const track = normalizeLyricsTopic(titleMatch[1])
    const artist = normalizeLyricsTopic(normalizedTopic.replace(track, ' '))
    addCandidate(candidates, seenKeys, artist, track, 160)
    addCandidate(candidates, seenKeys, '', track, 110)
  }

  const ofMatch = normalizedTopic.match(/^(.+?)[的之](.+)$/u)
  if (ofMatch?.[1] && ofMatch?.[2]) {
    addCandidate(candidates, seenKeys, ofMatch[1], ofMatch[2], 140)
    addCandidate(candidates, seenKeys, '', ofMatch[2], 95)
  }

  const tokens = normalizedTopic
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean)

  if (tokens.length >= 2) {
    addCandidate(candidates, seenKeys, tokens.slice(0, -1).join(' '), tokens.at(-1), 120)
    addCandidate(candidates, seenKeys, tokens[0], tokens.slice(1).join(' '), 115)
    addCandidate(candidates, seenKeys, '', tokens.join(' '), 80)
  } else {
    addCandidate(candidates, seenKeys, '', normalizedTopic, 70)
  }

  const compactTopic = normalizedTopic.replace(/\s+/g, '')
  if (!CJK_PATTERN.test(compactTopic) || compactTopic.length < 4) {
    return
  }

  const splitPoints = []
  for (let artistLength = 2; artistLength <= Math.min(5, compactTopic.length - 2); artistLength += 1) {
    splitPoints.push(artistLength)
  }

  splitPoints
    .sort((left, right) => {
      const leftTrackLength = compactTopic.length - left
      const rightTrackLength = compactTopic.length - right
      const leftScore = (left >= 2 && left <= 4 ? 4 : 0) + (leftTrackLength >= 2 && leftTrackLength <= 6 ? 3 : 0) - Math.abs(left - 3)
      const rightScore = (right >= 2 && right <= 4 ? 4 : 0) + (rightTrackLength >= 2 && rightTrackLength <= 6 ? 3 : 0) - Math.abs(right - 3)
      return rightScore - leftScore
    })
    .forEach((artistLength, index) => {
      addCandidate(
        candidates,
        seenKeys,
        compactTopic.slice(0, artistLength),
        compactTopic.slice(artistLength),
        100 - index,
      )
    })
}

export function buildLyricsLookupCandidates(inputs = []) {
  const candidates = []
  const seenKeys = new Set()

  for (const [index, input] of (Array.isArray(inputs) ? inputs : [inputs]).entries()) {
    const normalizedInput = normalizeWhitespace(input)
    if (!normalizedInput) {
      continue
    }

    addTopicCandidates(candidates, seenKeys, normalizedInput, normalizedInput)
    addTopicCandidates(candidates, seenKeys, normalizeLyricsTopic(normalizedInput), normalizedInput)

    if (index >= 5 && candidates.length >= 6) {
      break
    }
  }

  return candidates
    .sort((left, right) => right.priority - left.priority)
    .slice(0, 8)
    .map(({ artist, track }) => ({ artist, track }))
}

export function extractLyricsPreviewLines(lyricsText, maxLines = 8) {
  const normalizedText = String(lyricsText ?? '')
    .replace(/\[(?:(?:\d{1,2}:)?\d{1,2}(?:\.\d{1,3})?)\]/g, ' ')
    .replace(/\r/g, '')

  const lines = []
  const seen = new Set()

  for (const line of normalizedText.split('\n')) {
    const normalizedLine = normalizeWhitespace(line)
    if (!normalizedLine) {
      continue
    }

    if (/^(?:作词|作曲|编曲|词|曲|版权所有|未经许可)/iu.test(normalizedLine)) {
      continue
    }

    if (!/[\u3400-\u9fffA-Za-z0-9]/u.test(normalizedLine)) {
      continue
    }

    const key = normalizeComparableText(normalizedLine)
    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    lines.push(normalizedLine)

    if (lines.length >= maxLines) {
      return lines
    }
  }

  return lines
}

function buildApiUrl(baseUrl, params) {
  const url = new URL(baseUrl)

  for (const [key, value] of Object.entries(params)) {
    const normalizedValue = normalizeWhitespace(value)
    if (normalizedValue) {
      url.searchParams.set(key, normalizedValue)
    }
  }

  return url.toString()
}

function scoreLyricsEntry(entry, candidate, queryText) {
  const entryArtist = normalizeComparableText(entry?.artistName ?? '')
  const entryTrack = normalizeComparableText(entry?.trackName ?? '')
  const candidateArtist = normalizeComparableText(candidate.artist)
  const candidateTrack = normalizeComparableText(candidate.track)
  const combined = `${entryArtist}${entryTrack}`
  const normalizedQuery = normalizeComparableText(queryText)

  let score = 0

  if (candidateTrack) {
    if (entryTrack === candidateTrack) {
      score += 18
    } else if (entryTrack.includes(candidateTrack) || candidateTrack.includes(entryTrack)) {
      score += 9
    } else {
      score -= 6
    }
  }

  if (candidateArtist) {
    if (entryArtist === candidateArtist) {
      score += 15
    } else if (entryArtist.includes(candidateArtist) || candidateArtist.includes(entryArtist)) {
      score += 7
    } else {
      score -= 5
    }
  }

  if (normalizedQuery && combined.includes(normalizedQuery)) {
    score += 4
  }

  if (entry?.plainLyrics || entry?.syncedLyrics) {
    score += 3
  }

  if (entryArtist && entryTrack) {
    score += 2
  }

  return score
}

async function searchLrclibByCandidate(candidate, helpers) {
  const endpoint = buildApiUrl(LRCLIB_SEARCH_ENDPOINT, {
    track_name: candidate.track,
    artist_name: candidate.artist,
  })

  const response = await helpers.performNetworkRequest(endpoint, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    timeoutMs: helpers.timeoutMs,
    timeoutMessage: '歌词检索超时，请稍后再试。',
  })

  if (!response.ok) {
    return []
  }

  const data = await helpers.readJsonSafe(response)
  return Array.isArray(data) ? data : []
}

function buildLyricsSearchPayload(entry, request) {
  const previewLines = extractLyricsPreviewLines(entry?.plainLyrics || entry?.syncedLyrics || '', 8)
  if (!previewLines.length) {
    return null
  }

  const artistName = normalizeWhitespace(entry?.artistName ?? '')
  const trackName = normalizeWhitespace(entry?.trackName ?? '')
  const displayTitle = normalizeWhitespace(
    [artistName, trackName ? `《${trackName}》` : '']
      .filter(Boolean)
      .join(''),
  ) || normalizeWhitespace(request.displayQuery || request.query)
  const itemTitle = trackName
    ? `${artistName ? `${artistName} ` : ''}《${trackName}》歌词`
    : `${displayTitle} 歌词`
  const sourceUrl = buildApiUrl(LRCLIB_GET_ENDPOINT, {
    track_name: trackName,
    artist_name: artistName,
  })
  const previewText = previewLines.join('\n')

  return {
    items: [
      {
        title: itemTitle,
        url: sourceUrl,
        snippet: previewText,
        contentPreview: previewText,
      },
    ],
    providerLabel: 'LRCLIB 歌词库',
    rewrittenQueries: [normalizeWhitespace(request.query)].filter(Boolean),
    display: {
      mode: 'lyrics',
      title: displayTitle,
      summary: displayTitle
        ? `已找到 ${displayTitle} 的歌词片段。`
        : '已找到这首歌的歌词片段。',
      bodyLines: previewLines,
      sources: [
        {
          title: itemTitle,
          url: sourceUrl,
          host: 'lrclib.net',
        },
      ],
    },
    message: displayTitle
      ? `已通过 LRCLIB 歌词库找到 ${displayTitle} 的歌词片段。`
      : '已通过 LRCLIB 歌词库找到歌词片段。',
  }
}

export async function tryLookupLyricsSearch(request, helpers) {
  const searchInputs = [
    request.displayQuery,
    request.query,
    ...(Array.isArray(request.candidateQueries) ? request.candidateQueries : []),
  ]
  const shouldSearchLyrics = searchInputs.some((value) => isLyricsLikeQuery(value))

  if (!shouldSearchLyrics) {
    return null
  }

  const candidates = buildLyricsLookupCandidates(searchInputs)
  if (!candidates.length) {
    return null
  }

  const queryText = normalizeWhitespace(request.displayQuery || request.query)
  const matches = []

  for (const candidate of candidates) {
    const entries = await searchLrclibByCandidate(candidate, helpers)
    for (const entry of entries) {
      matches.push({
        candidate,
        entry,
        score: scoreLyricsEntry(entry, candidate, queryText),
      })
    }

    if (matches.some((match) => match.score >= 34)) {
      break
    }
  }

  const rankedMatches = matches
    .sort((left, right) => right.score - left.score)

  const bestMatch = rankedMatches[0]
  if (!bestMatch) {
    return null
  }

  const minimumScore = bestMatch.candidate.artist ? 22 : 20
  if (bestMatch.score < minimumScore) {
    return null
  }

  const secondMatch = rankedMatches.find((match) => (
    normalizeComparableText(match.entry?.artistName ?? '') !== normalizeComparableText(bestMatch.entry?.artistName ?? '')
    || normalizeComparableText(match.entry?.trackName ?? '') !== normalizeComparableText(bestMatch.entry?.trackName ?? '')
  ))

  if (
    !bestMatch.candidate.artist
    && secondMatch
    && bestMatch.score - secondMatch.score < 2
  ) {
    return null
  }

  return buildLyricsSearchPayload(bestMatch.entry, request)
}
