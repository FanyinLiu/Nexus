import { performNetworkRequest, readJsonSafe } from '../net.js'

const TOOL_WEATHER_TIMEOUT_MS = 12_000

const WEATHER_LOCATION_NOISE_PATTERN = /^(?:嗯|呃|额|啊|呀|诶|欸|那个|这个|就是|然后|那|这)\s*/u
const WEATHER_LOCATION_PREFIX_PATTERN = /^(?:(?:请|麻烦|帮我|给我|我想|我想知道|你帮我)\s*)*(?:(?:查(?:一下|查看|查询)?|看(?:一下|看)?|找(?:一下)?|搜(?:索)?(?:一下)?|报(?:一下)?|告诉我)\s*)+/u
const WEATHER_LOCATION_PRONOUN_PREFIX_PATTERN = /^(?:(?:给)?我|我们|你|你们|咱们|自己|这里|这边|这儿|那边|那儿)\s*/u
const WEATHER_LOCATION_SUFFIX_PATTERN = /(?:今天|明天|后天|现在|目前|当前|这边|那边|我这边|当地)?\s*(?:的)?\s*(?:天气(?:怎么样|如何|咋样|情况)?|气温|温度|冷不冷|热不热|会不会下雨|下不下雨|有没有雨|降不降雨)\s*[呢吗啊呀吧嘛]*$/u
const WEATHER_LOCATION_FILLER_PATTERN = /(?:一下|现在|目前|当前|这边|那边|我这边|当地)/gu
const WEATHER_LOCATION_BEFORE_TOPIC_PATTERN = /(.+?)(?:今天|明天|后天|现在|目前|当前)?(?:的)?(?:天气(?:怎么样|如何|咋样|情况)?|气温|温度|冷不冷|热不热|会不会下雨|下不下雨|有没有雨|降不降雨)/u
const WEATHER_LOCATION_AFTER_TOPIC_PATTERN = /(?:天气(?:怎么样|如何|咋样|情况)?|气温|温度)\s*(?:在|是|如何|怎么样|咋样)?\s*(.+)$/u
const WEATHER_LOCATION_STT_COMMAND_PREFIX_PATTERN = /^(?:(?:你|你们|我|我们|咱们)\s*)?(?:在\s*)?(?:(?:一)?(?:查|看|找|搜|报|问)\s*)+/u
const WEATHER_LOCATION_TAIL_PATTERN = /([\u3400-\u9fff]{2,}(?:特别行政区|自治州|自治县|地区|省|市|区|县|镇|乡|州|盟|旗)?)$/u
const WEATHER_LOCATION_INVALID_PATTERN = /(?:怎么|为什么|告诉|看到|看见|搜(?:索|到)?|查(?:到)?|结果|回答|回复|你|我|我们|你们|不是|已经|刚才|刚刚|天气)/u
const WEATHER_LOCATION_TIME_WORD_PATTERN = /^(?:今天|明天|后天|现在|目前|当前|当地)$/u
const WEATHER_LOCATION_META_PREFIX_PATTERN = /^(?:(?:那)?(?:你|我|我们|咱们)\s*)?(?:(?:想问(?:一下)?(?:的|的是)?|问(?:一下)?(?:的|的是)?|想知道|想了解|想看|想查|就是想问|帮忙|帮个忙|说一下|说说)\s*)+/u
const WEATHER_LOCATION_PARTIAL_TOPIC_SUFFIX_PATTERN = /(?:的)?天(?:气)?$/u
const WEATHER_LOCATION_ALIAS_MAP = new Map([
  ['北京', ['北京市', 'Beijing']],
  ['上海', ['上海市', 'Shanghai']],
  ['天津', ['天津市', 'Tianjin']],
  ['重庆', ['重庆市', 'Chongqing']],
  ['香港', ['香港特别行政区', 'Hong Kong']],
  ['澳门', ['澳门特别行政区', 'Macau']],
])
const CHINESE_LOCATION_SUFFIX_PATTERN = /(特别行政区|自治州|自治县|地区|省|市|区|县|镇|乡|州|盟|旗)$/u

function getWeatherCodeDescription(code) {
  const normalizedCode = Number(code)
  const weatherCodeMap = {
    0: '晴朗',
    1: '大致晴',
    2: '局部多云',
    3: '阴天',
    45: '有雾',
    48: '雾凇',
    51: '小毛毛雨',
    53: '毛毛雨',
    55: '强毛毛雨',
    56: '小冻毛毛雨',
    57: '强冻毛毛雨',
    61: '小雨',
    63: '中雨',
    65: '大雨',
    66: '小冻雨',
    67: '强冻雨',
    71: '小雪',
    73: '中雪',
    75: '大雪',
    77: '冰粒',
    80: '小阵雨',
    81: '阵雨',
    82: '强阵雨',
    85: '小阵雪',
    86: '强阵雪',
    95: '雷阵雨',
    96: '雷阵雨伴小冰雹',
    99: '强雷阵雨伴冰雹',
  }

  return weatherCodeMap[normalizedCode] ?? '天气变化中'
}

function spokenTemperature(value) {
  if (!Number.isFinite(value)) return ''
  const rounded = Math.round(value)
  return rounded < 0 ? `零下${Math.abs(rounded)}度` : `${rounded}度`
}

function spokenWindSpeed(kmh) {
  if (!Number.isFinite(kmh)) return ''
  const rounded = Math.round(kmh)
  if (rounded <= 1) return '几乎无风'
  if (rounded <= 10) return '微风'
  if (rounded <= 20) return `风速${rounded}公里每小时`
  if (rounded <= 40) return '风比较大'
  return '大风'
}

function spokenPrecipitation(percent) {
  if (!Number.isFinite(percent)) return ''
  if (percent <= 5) return '基本不会下雨'
  if (percent <= 20) return '可能有零星小雨'
  if (percent <= 50) return `降水概率百分之${percent}`
  if (percent <= 80) return `降水概率比较高，百分之${percent}`
  return `很可能会下雨，降水概率百分之${percent}`
}

function formatDailyWeatherSummary(label, daily, index) {
  if (!daily?.time?.[index]) {
    return ''
  }

  const min = daily.temperature_2m_min?.[index]
  const max = daily.temperature_2m_max?.[index]
  const precipitation = daily.precipitation_probability_max?.[index]
  const weatherCode = daily.weather_code?.[index]
  const pieces = [
    label,
    getWeatherCodeDescription(weatherCode),
  ]

  if (Number.isFinite(min) && Number.isFinite(max)) {
    pieces.push(`${spokenTemperature(min)}到${spokenTemperature(max)}`)
  }

  const precipitationText = spokenPrecipitation(precipitation)
  if (precipitationText) {
    pieces.push(precipitationText)
  }

  return pieces.join('，')
}

function normalizeWeatherLocationCompareKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u3000\s·•．.，,、_-]+/gu, '')
    .replace(/(特别行政区|自治州|自治县|地区|省|市|区|县|镇|乡|州|盟|旗)$/u, '')
}

function normalizeWeatherLocationFragment(text) {
  let value = String(text ?? '')
    .replace(/[\u3000\s]+/gu, ' ')
    .replace(/^[,，。！？!?:：；;、\s]+|[,，。！？!?:：；;、\s]+$/gu, '')
    .trim()

  if (!value) {
    return ''
  }

  let previous = ''
  while (value && value !== previous) {
    previous = value
    value = value
      .replace(WEATHER_LOCATION_NOISE_PATTERN, '')
      .replace(WEATHER_LOCATION_META_PREFIX_PATTERN, '')
      .replace(WEATHER_LOCATION_PREFIX_PATTERN, '')
      .replace(WEATHER_LOCATION_STT_COMMAND_PREFIX_PATTERN, '')
      .replace(WEATHER_LOCATION_PRONOUN_PREFIX_PATTERN, '')
      .replace(/^(?:儿|是|在|去|到)\s*/u, '')
      .replace(WEATHER_LOCATION_FILLER_PATTERN, ' ')
      .replace(WEATHER_LOCATION_PARTIAL_TOPIC_SUFFIX_PATTERN, '')
      .replace(/^[的地得]\s*/u, '')
      .replace(/\s+/gu, ' ')
      .trim()
  }

  value = value
    .replace(WEATHER_LOCATION_SUFFIX_PATTERN, '')
    .replace(/[的地得]$/u, '')
    .replace(/^[,，。！？!?:：；;、\s]+|[,，。！？!?:：；;、\s]+$/gu, '')
    .trim()

  return value
}

function isLikelyWeatherLocationFragment(text) {
  const normalized = String(text ?? '').replace(/[\u3000\s]+/gu, ' ').trim()
  const compact = normalized.replace(/[\s,，。！？!?:：；;、]/gu, '')
  if (!compact) {
    return false
  }

  if (compact.length > 20) {
    return false
  }

  if (/\d/u.test(compact)) {
    return false
  }

  if (WEATHER_LOCATION_TIME_WORD_PATTERN.test(compact)) {
    return false
  }

  if (WEATHER_LOCATION_INVALID_PATTERN.test(compact)) {
    return false
  }

  if (/[\u3400-\u9fff]/u.test(compact)) {
    return compact.length >= 2
  }

  if (/[a-z]/iu.test(normalized)) {
    return /^[a-z][a-z\s.'-]{1,40}$/iu.test(normalized)
  }

  return false
}

function stripChineseWeatherLocationSuffix(value) {
  return String(value ?? '').replace(CHINESE_LOCATION_SUFFIX_PATTERN, '').trim()
}

function collectChineseWeatherLocationTailCandidates(value) {
  const compact = String(value ?? '').replace(/[\u3000\s]+/gu, '')
  const candidates = []
  const pushCandidate = (text) => {
    const normalized = normalizeWeatherLocationFragment(text)
    if (normalized && isLikelyWeatherLocationFragment(normalized) && !candidates.includes(normalized)) {
      candidates.push(normalized)
    }
  }

  if (!/^[\u3400-\u9fff]+$/u.test(compact)) {
    return candidates
  }

  const stripped = stripChineseWeatherLocationSuffix(compact)
  if (stripped) {
    pushCandidate(stripped)
  }

  const base = stripped || compact
  for (let length = 2; length <= Math.min(5, base.length); length += 1) {
    pushCandidate(base.slice(-length))
  }

  return candidates
}

function getWeatherLocationQueryVariants(location) {
  const variants = []
  const pushVariant = (value) => {
    const normalized = normalizeWeatherLocationFragment(value)
    if (!normalized || !isLikelyWeatherLocationFragment(normalized) || variants.includes(normalized)) {
      return
    }
    variants.push(normalized)
  }

  const normalizedLocation = normalizeWeatherLocationFragment(location)
  const compareKey = normalizeWeatherLocationCompareKey(normalizedLocation)
  const aliasValues = WEATHER_LOCATION_ALIAS_MAP.get(normalizedLocation) ?? WEATHER_LOCATION_ALIAS_MAP.get(compareKey) ?? []

  for (const aliasValue of aliasValues) {
    pushVariant(aliasValue)
  }

  if (
    normalizedLocation
    && /[\u3400-\u9fff]/u.test(normalizedLocation)
    && !/[省市区县州盟旗特别行政区自治州自治县地区]$/u.test(normalizedLocation)
  ) {
    pushVariant(`${normalizedLocation}市`)
  }

  pushVariant(normalizedLocation)

  for (const tailCandidate of collectChineseWeatherLocationTailCandidates(normalizedLocation)) {
    pushVariant(tailCandidate)
  }

  return variants
}

function buildWeatherLocationCandidates(location) {
  const raw = String(location ?? '').trim()
  const candidates = []

  const pushCandidate = (value) => {
    for (const normalized of getWeatherLocationQueryVariants(value)) {
      if (!candidates.includes(normalized)) {
        candidates.push(normalized)
      }

      const tail = normalized.match(WEATHER_LOCATION_TAIL_PATTERN)?.[1]?.trim()
      if (tail && isLikelyWeatherLocationFragment(tail) && !candidates.includes(tail)) {
        candidates.push(tail)
      }
    }
  }

  pushCandidate(raw)

  const beforeTopicMatch = raw.match(WEATHER_LOCATION_BEFORE_TOPIC_PATTERN)
  if (beforeTopicMatch?.[1]) {
    pushCandidate(beforeTopicMatch[1])
  }

  const afterTopicMatch = raw.match(WEATHER_LOCATION_AFTER_TOPIC_PATTERN)
  if (afterTopicMatch?.[1]) {
    pushCandidate(afterTopicMatch[1])
  }

  const withoutSuffix = raw.replace(WEATHER_LOCATION_SUFFIX_PATTERN, '').trim()
  if (withoutSuffix && withoutSuffix !== raw) {
    pushCandidate(withoutSuffix)
  }

  const tokens = raw.split(/\s+/u).filter(Boolean)
  for (let index = 0; index < tokens.length; index += 1) {
    pushCandidate(tokens.slice(index).join(' '))
    pushCandidate(tokens.slice(index).join(''))
  }

  return candidates
}

function getWeatherPlaceFeatureScore(featureCode) {
  switch (String(featureCode ?? '').toUpperCase()) {
    case 'PPLC':
      return 12
    case 'PPLA':
      return 10
    case 'PPLA2':
      return 8
    case 'PPLA3':
      return 7
    case 'PPLA4':
      return 6
    case 'PPLG':
      return 5
    case 'PPLL':
      return 4
    case 'PPL':
      return 3
    default:
      return 0
  }
}

function getWeatherPlacePopulationScore(population) {
  const numericPopulation = Number(population)
  if (!Number.isFinite(numericPopulation) || numericPopulation <= 0) {
    return 0
  }

  if (numericPopulation >= 10_000_000) return 10
  if (numericPopulation >= 5_000_000) return 8
  if (numericPopulation >= 1_000_000) return 6
  if (numericPopulation >= 300_000) return 4
  if (numericPopulation >= 100_000) return 3
  if (numericPopulation >= 20_000) return 2
  return 1
}

function pickBestWeatherPlace(results, query) {
  if (!Array.isArray(results) || !results.length) {
    return null
  }

  const normalizedQuery = normalizeWeatherLocationFragment(query).toLowerCase()
  const queryHasChinese = /[\u3400-\u9fff]/u.test(normalizedQuery)
  const normalizedQueryKey = normalizeWeatherLocationCompareKey(query)

  const scored = results.map((place) => {
    const name = String(place?.name ?? '')
    const admin = String(place?.admin1 ?? '')
    const admin2 = String(place?.admin2 ?? '')
    const country = String(place?.country ?? '')
    const searchable = `${name} ${admin} ${admin2} ${country}`.toLowerCase()
    const nameKey = normalizeWeatherLocationCompareKey(name)
    const adminKey = normalizeWeatherLocationCompareKey(admin)
    const admin2Key = normalizeWeatherLocationCompareKey(admin2)
    let score = 0

    if (nameKey && normalizedQueryKey && nameKey === normalizedQueryKey) {
      score += 18
    } else if (name.toLowerCase() === normalizedQuery) {
      score += 10
    } else if (adminKey && normalizedQueryKey && adminKey === normalizedQueryKey) {
      score += 9
    } else if (admin2Key && normalizedQueryKey && admin2Key === normalizedQueryKey) {
      score += 7
    } else if (searchable.includes(normalizedQuery)) {
      score += 4
    }

    if (queryHasChinese && (place?.country_code === 'CN' || country.includes('中国'))) {
      score += 3
    }

    score += getWeatherPlaceFeatureScore(place?.feature_code)
    score += getWeatherPlacePopulationScore(place?.population)

    return { place, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored[0] ?? null
}

function formatResolvedWeatherPlaceName(place) {
  const country = String(place?.country ?? '').trim()
  const admin = String(place?.admin1 ?? '').trim()
  const name = String(place?.name ?? '').trim()
  const adminKey = normalizeWeatherLocationCompareKey(admin)
  const nameKey = normalizeWeatherLocationCompareKey(name)

  return [country, adminKey && adminKey === nameKey ? '' : admin, name]
    .filter(Boolean)
    .join(' · ')
}

export async function lookupWeatherByLocation(location, fallbackLocation = '') {
  const requestedLocation = String(location ?? '').trim()
  const trimmedLocation = requestedLocation || String(fallbackLocation ?? '').trim()
  const usedFallbackLocation = !requestedLocation && Boolean(trimmedLocation)
  if (!trimmedLocation) {
    throw new Error('天气查询需要城市或地区名称。')
  }

  if (WEATHER_LOCATION_TIME_WORD_PATTERN.test(normalizeWeatherLocationFragment(trimmedLocation))) {
    throw new Error('天气查询需要明确的城市或地区名称。')
  }

  const locationCandidates = buildWeatherLocationCandidates(trimmedLocation)
  if (!locationCandidates.length) {
    throw new Error('天气查询需要明确的城市或地区名称。')
  }

  let place = null
  let resolvedLocation = locationCandidates[0]
  let bestScore = Number.NEGATIVE_INFINITY

  for (const candidate of locationCandidates) {
    const geocodingResponse = await performNetworkRequest(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(candidate)}&count=5&language=zh&format=json`,
      {
        method: 'GET',
        timeoutMs: TOOL_WEATHER_TIMEOUT_MS,
        timeoutMessage: '天气定位超时，请稍后再试。',
      },
    )

    if (!geocodingResponse.ok) {
      throw new Error(`天气定位失败（状态码：${geocodingResponse.status}）。`)
    }

    const geocodingData = await readJsonSafe(geocodingResponse)
    const matchedResult = pickBestWeatherPlace(geocodingData?.results, candidate)
    if (matchedResult && matchedResult.score > bestScore) {
      place = matchedResult.place
      resolvedLocation = candidate
      bestScore = matchedResult.score
    }
  }

  if (!place) {
    throw new Error(`没有找到"${trimmedLocation}"对应的天气地点。`)
  }

  const forecastResponse = await performNetworkRequest(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}`
      + '&current=temperature_2m,weather_code,wind_speed_10m'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max'
      + '&timezone=auto&forecast_days=2',
    {
      method: 'GET',
      timeoutMs: TOOL_WEATHER_TIMEOUT_MS,
      timeoutMessage: '天气查询超时，请稍后再试。',
    },
  )

  if (!forecastResponse.ok) {
    throw new Error(`天气查询失败（状态码：${forecastResponse.status}）。`)
  }

  const forecastData = await readJsonSafe(forecastResponse)
  const current = forecastData?.current ?? {}
  const daily = forecastData?.daily ?? {}
  const resolvedName = formatResolvedWeatherPlaceName(place)
  const currentTemperature = Number(current.temperature_2m)
  const currentWind = Number(current.wind_speed_10m)
  const currentSummary = [
    Number.isFinite(currentTemperature) ? `当前${spokenTemperature(currentTemperature)}` : '当前气温未知',
    getWeatherCodeDescription(current.weather_code),
    spokenWindSpeed(currentWind),
  ]
    .filter(Boolean)
    .join('，')

  return {
    location: resolvedLocation,
    resolvedName,
    timezone: forecastData?.timezone,
    currentSummary,
    todaySummary: formatDailyWeatherSummary('今天', daily, 0),
    tomorrowSummary: formatDailyWeatherSummary('明天', daily, 1),
    usedFallbackLocation,
    message: `已获取 ${resolvedName} 的天气。`,
  }
}
