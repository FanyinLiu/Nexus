import { normalizeIntentText } from '../intent/preprocess.ts'

const SEARCH_META_PREFIX_PATTERN = new RegExp(
  String.raw`^(?:(?:那|这|诶|嗯|嘛|呃|啊|哦|那么)\s*)?(?:(?:你|你们|我|我们|咱|咱们)\s*)?(?:(?:能|能不能|可以|可不可以|会|会不会|麻烦|请|要不|要不要)\s*)?(?:(?:帮我|帮帮我|给我|替我|我想|我想要|我要|我要的是|我是想)\s*)?(?:(?:搜索一下|搜一下|搜索|搜|查一下|查一查|查询|查找|查|找一下|找一找|找)\s*)+`,
  'iu',
)

const SEARCH_QUERY_TITLE_BRACKET_PATTERN = new RegExp(
  String.raw`[《》「」『』【】]`,
  'gu',
)

const SEARCH_QUERY_TRAILING_PARTICLE_PATTERN = new RegExp(
  String.raw`[\s吗嘛呢吧啊呀么\uFF1F\?]+$`,
  'u',
)

const SEARCH_QUERY_COMPLAINT_PREFIX_PATTERN = new RegExp(
  String.raw`^(?:你|你们|我|我们|咱|咱们)的`,
  'iu',
)

const SEARCH_QUERY_COMPLAINT_BODY_PATTERN = new RegExp(
  String.raw`(?:功能|逻辑|系统|结果|体验|准确|质量|表现).{0,6}(?:不太好|不好|很差|太差|不行|有问题|不准|不太行|太烂|真烂)`,
  'iu',
)

const WEATHER_FILLER_PATTERN = new RegExp(
  String.raw`(?:一下|目前|当前|最近|当地|这里|那边|我这边)`,
  'giu',
)

const WEATHER_PRONOUN_PREFIX_PATTERN = new RegExp(
  String.raw`^(?:(?:给)?我|我们|你|你们|咱们|自己|这里|这边|这儿|那边|那儿)\s*`,
  'iu',
)

const WEATHER_TRAILING_PARTICLE_PATTERN = new RegExp(
  String.raw`[的地得呢吗啊呀吧嘛]+$`,
  'iu',
)

const WEATHER_PARTIAL_TOPIC_SUFFIX_PATTERN = new RegExp(
  String.raw`(?:的)?天(?:气)?$`,
  'iu',
)

const WEATHER_STT_COMMAND_PREFIX_PATTERN = new RegExp(
  String.raw`^(?:(?:你|你们|我|我们|咱们)\s*)?(?:在\s*)?(?:(?:一)?(?:查|看|找|搜|报|问)\s*)+`,
  'iu',
)

const WEATHER_LOCATION_TAIL_PATTERN = new RegExp(
  String.raw`([\u3400-\u9fff]{2,}(?:特别行政区|自治州|自治县|地区|省|市|区|县|镇|乡|州|盟|旗)?)$`,
  'u',
)

const WEATHER_LOCATION_INVALID_PATTERN = new RegExp(
  String.raw`(?:怎么|为什么|什么|啥|告诉|看到|看见|搜(?:索|到)?|查(?:到)?|结果|回答|回复|你|我|我们|你们|不是|已经|刚才|刚刚|天气)`,
  'iu',
)

const WEATHER_LOCATION_DISQUALIFIER_SUBSTRING_PATTERN = new RegExp(
  String.raw`(?:一眼|看看|看一|瞧瞧|具体|大概|大致|明天|今天|后天|现在|目前|当前|早上|上午|中午|下午|晚上|凌晨|傍晚|夜里|想知道|想问|想看|想查|想了解|帮我|帮忙|给我|能不能|可不可以|麻烦)`,
  'iu',
)

const WEATHER_LOCATION_TIME_WORD_PATTERN = new RegExp(
  String.raw`^(?:今天|明天|后天|现在|目前|当前|当地|早上|上午|中午|下午|晚上|凌晨|傍晚|夜里)$`,
  'iu',
)

const WEATHER_LOCATION_FRAGMENT_PATTERN = new RegExp(
  String.raw`^(?:怎(?:么|样)?|咋样|怎样|如何|情况|什么(?:样)?|啥(?:样)?|么样)$`,
  'iu',
)

const WEATHER_LOCATION_QUERY_MARKER_PATTERN = new RegExp(
  String.raw`(?:天气|气温|温度|下雨|降雨|怎么|怎样|咋样|如何|情况|什么|啥|么样)`,
  'iu',
)

const WEATHER_META_PREFIX_PATTERN = new RegExp(
  String.raw`^(?:(?:那)?(?:你|我|我们|咱们)\s*)?(?:(?:想问(?:一下)?(?:的|的是)?|问(?:一下)?(?:的|的是)?|想知道|想了解|想看|想查|就是想问|帮忙|帮个忙|说一下|说说)\s*)+`,
  'iu',
)

const CHINESE_LOCATION_SUFFIX_PATTERN = new RegExp(
  String.raw`(?:特别行政区|自治州|自治县|地区|省|市|区|县|镇|乡|州|盟|旗)$`,
  'u',
)

const STT_NOISE_PATTERN = new RegExp(
  String.raw`^(?:能|嗯|嘛|那|这|诶|的|那个|这个|就是|就|好|对|嘿|然后|而且)\s*`,
  'iu',
)

function normalizeToolText(content: string) {
  return normalizeIntentText(content)
}

function cleanSttNoise(text: string) {
  return normalizeToolText(text.replace(STT_NOISE_PATTERN, ''))
}

// Minimal cleanup only — strip command framing (leading 帮我搜一下, title
// brackets, trailing 吗/呢/？) but DO NOT strip stopword/interrogative tokens
// from the middle of the query. Tavily (and every other semantic search
// provider) handles 的/了/过/etc. natively, and our previous aggressive
// pipeline kept shredding real queries into broken keyword soup. See
// feedback_nexus_trust_downstream_providers.md.
//
// Exported separately from extractSearchQuery so queryRewrite.ts can share the
// same framing-strip logic — the two regex lists used to drift and the
// downstream rewrite pipeline kept producing "能 XXX 的 吗 歌词"-style noise.
export function stripSearchCommandFraming(content: string) {
  return normalizeToolText(
    content
      .replace(SEARCH_QUERY_TITLE_BRACKET_PATTERN, '')
      .replace(SEARCH_META_PREFIX_PATTERN, '')
      .replace(SEARCH_QUERY_TRAILING_PARTICLE_PATTERN, ''),
  )
}

export function extractSearchQuery(content: string) {
  const cleaned = stripSearchCommandFraming(content)
  if (!cleaned) {
    return ''
  }

  if (
    SEARCH_QUERY_COMPLAINT_PREFIX_PATTERN.test(cleaned)
    || SEARCH_QUERY_COMPLAINT_BODY_PATTERN.test(cleaned)
  ) {
    return ''
  }

  if (cleaned.replace(/\s+/g, '').length < 2) {
    return ''
  }

  return cleaned
}

function cleanWeatherLocation(text: string) {
  return cleanSttNoise(
    normalizeToolText(
      text
        .replace(WEATHER_META_PREFIX_PATTERN, '')
        .replace(WEATHER_STT_COMMAND_PREFIX_PATTERN, '')
        .replace(WEATHER_FILLER_PATTERN, ' ')
        .replace(WEATHER_PRONOUN_PREFIX_PATTERN, '')
        .replace(/^(?:儿|是|在|去|到)\s*/u, '')
        .replace(WEATHER_TRAILING_PARTICLE_PATTERN, '')
        .replace(WEATHER_PARTIAL_TOPIC_SUFFIX_PATTERN, ''),
    ),
  )
}

function stripChineseLocationSuffix(text: string) {
  return String(text ?? '').replace(CHINESE_LOCATION_SUFFIX_PATTERN, '').trim()
}

function collectChineseLocationTailCandidates(text: string) {
  const compact = normalizeToolText(String(text ?? '')).replace(/\s+/g, '')
  const candidates: string[] = []

  const pushCandidate = (value: string) => {
    const normalized = cleanWeatherLocation(value)
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized)
    }
  }

  if (!/^[\u3400-\u9fff]+$/u.test(compact)) {
    return candidates
  }

  if (WEATHER_LOCATION_FRAGMENT_PATTERN.test(compact) || WEATHER_LOCATION_QUERY_MARKER_PATTERN.test(compact)) {
    return candidates
  }

  const stripped = stripChineseLocationSuffix(compact)
  if (stripped) {
    pushCandidate(stripped)
  }

  const base = stripped || compact
  for (let length = 2; length <= Math.min(5, base.length); length += 1) {
    pushCandidate(base.slice(-length))
  }

  return candidates
}

function collectWeatherLocationCandidates(text: string) {
  const raw = String(text ?? '').trim()
  const candidates: string[] = []

  const pushCandidate = (value: string) => {
    const normalized = cleanWeatherLocation(value)
    if (normalized && !candidates.includes(normalized)) {
      candidates.push(normalized)
    }

    const compact = cleanWeatherLocation(String(value ?? '').replace(/\s+/g, ''))
    if (compact && !candidates.includes(compact)) {
      candidates.push(compact)
    }

    const tail = normalized.match(WEATHER_LOCATION_TAIL_PATTERN)?.[1]?.trim() ?? ''
    if (tail && !candidates.includes(tail)) {
      candidates.push(tail)
    }

    for (const tailCandidate of collectChineseLocationTailCandidates(normalized)) {
      if (!candidates.includes(tailCandidate)) {
        candidates.push(tailCandidate)
      }
    }
  }

  if (!raw) {
    return candidates
  }

  pushCandidate(raw)

  const tokens = normalizeToolText(raw).split(' ').filter(Boolean)
  for (let index = 0; index < tokens.length; index += 1) {
    pushCandidate(tokens.slice(index).join(' '))
    pushCandidate(tokens.slice(index).join(''))
  }

  return candidates
}

function isLikelyWeatherLocation(text: string) {
  const normalized = normalizeToolText(String(text ?? ''))
  const compact = normalized.replace(/[\s,，。！？!?:：；;、]/g, '')
  if (!compact) {
    return false
  }

  if (compact.length > 20 || /\d/.test(compact)) {
    return false
  }

  if (WEATHER_LOCATION_TIME_WORD_PATTERN.test(compact)) {
    return false
  }

  if (WEATHER_LOCATION_FRAGMENT_PATTERN.test(compact)) {
    return false
  }

  if (WEATHER_LOCATION_INVALID_PATTERN.test(compact)) {
    return false
  }

  if (WEATHER_LOCATION_DISQUALIFIER_SUBSTRING_PATTERN.test(compact)) {
    return false
  }

  if (/[\u3400-\u9fff]/u.test(compact)) {
    return compact.length >= 2
  }

  if (/[a-z]/i.test(normalized)) {
    return /^[a-z][a-z\s.'-]{1,40}$/iu.test(normalized)
  }

  return false
}

function pickWeatherLocationCandidate(text: string) {
  return collectWeatherLocationCandidates(text).find((candidate) => isLikelyWeatherLocation(candidate)) ?? ''
}

export function extractLikelyWeatherLocation(text: string) {
  return pickWeatherLocationCandidate(normalizeToolText(String(text ?? '')))
}
