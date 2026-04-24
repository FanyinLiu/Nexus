import { performNetworkRequest, readJsonSafe } from '../net.js'

const TOOL_WEATHER_TIMEOUT_MS = 12_000

// SC=Simplified Chinese  TC=Traditional Chinese  JA=Japanese  KO=Korean
const WEATHER_LOCATION_NOISE_PATTERN = /^(?:嗯|呃|额|額|啊|呀|诶|誒|欸|那个|那個|这个|這個|就是|然后|然後|那|这|這|えーと|あのー?|ええと|その|えー|まあ|なんか|あー|うーん|음+|어+|그|저기?|뭐|그러니까|이제|근데)\s*/u
const WEATHER_LOCATION_PREFIX_PATTERN = /^(?:(?:请|請|麻烦|麻煩|帮我|幫我|给我|給我|我想|我想知道|你帮我|你幫我)\s*)*(?:(?:查(?:一下|查看|查询|查詢)?|看(?:一下|看)?|找(?:一下)?|搜(?:索)?(?:一下)?|报(?:一下)?|報(?:一下)?|告诉我|告訴我|教えて|調べて|검색해|알려\s*줘)\s*)+/u
const WEATHER_LOCATION_PRONOUN_PREFIX_PATTERN = /^(?:(?:给)?我|(?:給)?我|我们|我們|你|你们|你們|咱们|咱們|自己|这里|這裡|这边|這邊|这儿|這兒|那边|那邊|那儿|那兒|ここ|そこ|あそこ|こっち|나|우리|여기|저기|거기)\s*/u
const WEATHER_LOCATION_SUFFIX_PATTERN = /(?:今天|明天|后天|後天|现在|現在|目前|当前|當前|这边|這邊|那边|那邊|我这边|我這邊|当地|當地|今日|明日|あさって|오늘|내일|모레)?\s*(?:的|の|의)?\s*(?:天气(?:怎么样|怎麼樣|如何|咋样|咋樣|情况|情況)?|天氣(?:怎麼樣|如何|情況)?|天気(?:は)?(?:どう(?:です(?:か)?)?|を?(?:教えて|調べて|見て)(?:ください)?)?|날씨(?:\s*(?:어때|어떨까|어떤가요?|알려\s*줘|봐\s*줘|확인해\s*줘|어떻게))?|气温|氣溫|気温|기온|温度|溫度|온도|冷不冷|热不热|熱不熱|会不会下雨|會不會下雨|下不下雨|有没有雨|有沒有雨|降不降雨|雨降る|비\s*오[나는]?)\s*[呢吗啊呀吧嘛よねかなのさ요까지]*$/u
const WEATHER_LOCATION_FILLER_PATTERN = /(?:一下|现在|現在|目前|当前|當前|这边|這邊|那边|那邊|我这边|我這邊|当地|當地|ちょっと|좀)/gu
const WEATHER_LOCATION_BEFORE_TOPIC_PATTERN = /(.+?)(?:今天|明天|后天|後天|现在|現在|目前|当前|當前|今日|明日|오늘|내일)?(?:的|の|의)?(?:天气(?:怎么样|怎麼樣|如何|咋样|咋樣|情况|情況)?|天氣(?:怎麼樣|如何|情況)?|天気(?:は)?(?:どう)?|날씨|气温|氣溫|気温|기온|温度|溫度|온도|冷不冷|热不热|熱不熱|会不会下雨|會不會下雨|下不下雨|有没有雨|有沒有雨|降不降雨)/u
const WEATHER_LOCATION_AFTER_TOPIC_PATTERN = /(?:天气(?:怎么样|怎麼樣|如何|咋样|咋樣|情况|情況)?|天氣(?:怎麼樣|如何|情況)?|天気|날씨|气温|氣溫|気温|기온|温度|溫度|온도)\s*(?:在|は|에서|是|如何|怎么样|怎麼樣|咋样|咋樣|どう)?\s*(.+)$/u
const WEATHER_LOCATION_STT_COMMAND_PREFIX_PATTERN = /^(?:(?:你|你们|你們|我|我们|我們|咱们|咱們)\s*)?(?:在\s*)?(?:(?:一)?(?:查|看|找|搜|报|報|问|問)\s*)+/u
const WEATHER_LOCATION_TAIL_PATTERN = /([\u3400-\u9fff]{2,}(?:特别行政区|特別行政區|自治州|自治县|自治縣|地区|地區|省|市|区|區|县|縣|镇|鎮|乡|鄉|州|盟|旗|都|道|府|県|町|村|郡)?)$/u
const WEATHER_LOCATION_INVALID_PATTERN = /(?:怎么|怎麼|为什么|為什麼|告诉|告訴|看到|看见|看見|搜(?:索|到)?|查(?:到)?|结果|結果|回答|回复|回覆|你|我|我们|我們|你们|你們|不是|已经|已經|刚才|剛才|刚刚|剛剛|天气|天氣|天気|날씨|なぜ|どうして|왜|어째서)/u
const WEATHER_LOCATION_TIME_WORD_PATTERN = /^(?:今天|明天|后天|後天|现在|現在|目前|当前|當前|当地|當地|今日|明日|あさって|오늘|내일|모레|지금|현재)$/u
const WEATHER_LOCATION_META_PREFIX_PATTERN = /^(?:(?:那)?(?:你|我|我们|我們|咱们|咱們)\s*)?(?:(?:想问(?:一下)?(?:的|的是)?|想問(?:一下)?(?:的|的是)?|问(?:一下)?(?:的|的是)?|問(?:一下)?(?:的|的是)?|想知道|想了解|想看|想查|就是想问|就是想問|帮忙|幫忙|帮个忙|幫個忙|说一下|說一下|说说|說說|知りたい|教えて|聞きたい|알고\s*싶|궁금)\s*)+/u
const WEATHER_LOCATION_PARTIAL_TOPIC_SUFFIX_PATTERN = /(?:的|の|의)?(?:天(?:气|氣)?|天気|날씨)$/u
const WEATHER_LOCATION_ALIAS_MAP = new Map([
  // SC / TC
  ['北京', ['北京市', 'Beijing']],
  ['上海', ['上海市', 'Shanghai']],
  ['天津', ['天津市', 'Tianjin']],
  ['重庆', ['重庆市', 'Chongqing']],
  ['重慶', ['重庆市', 'Chongqing']],
  ['香港', ['香港特别行政区', 'Hong Kong']],
  ['澳门', ['澳门特别行政区', 'Macau']],
  ['澳門', ['澳门特别行政区', 'Macau']],
  ['台北', ['台北市', 'Taipei']],
  ['台中', ['台中市', 'Taichung']],
  ['高雄', ['高雄市', 'Kaohsiung']],
  // JA
  ['東京', ['東京都', 'Tokyo']],
  ['东京', ['東京都', 'Tokyo']],
  ['大阪', ['大阪市', 'Osaka']],
  ['京都', ['京都市', 'Kyoto']],
  ['横浜', ['横浜市', 'Yokohama']],
  ['名古屋', ['名古屋市', 'Nagoya']],
  ['札幌', ['札幌市', 'Sapporo']],
  ['福岡', ['福岡市', 'Fukuoka']],
  // KO
  ['서울', ['서울특별시', 'Seoul']],
  ['부산', ['부산광역시', 'Busan']],
  ['인천', ['인천광역시', 'Incheon']],
  ['대구', ['대구광역시', 'Daegu']],
  ['대전', ['대전광역시', 'Daejeon']],
  ['광주', ['광주광역시', 'Gwangju']],
  ['제주', ['제주특별자치도', 'Jeju']],
])
const LOCATION_ADMIN_SUFFIX_PATTERN = /(特别行政区|特別行政區|自治州|自治县|自治縣|地区|地區|省|市|区|區|县|縣|镇|鎮|乡|鄉|州|盟|旗|都|道|府|県|町|村|郡|특별시|광역시|특별자치도|특별자치시|시|도|군|구)$/u

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

function spokenHumidity(percent) {
  if (!Number.isFinite(percent)) return ''
  const rounded = Math.round(percent)
  if (rounded < 30) return `空气干燥（湿度${rounded}%）`
  if (rounded < 60) return `湿度${rounded}%`
  if (rounded < 80) return `湿度偏高${rounded}%`
  return `空气湿润（湿度${rounded}%）`
}

function spokenApparentDelta(actual, apparent) {
  if (!Number.isFinite(actual) || !Number.isFinite(apparent)) return ''
  const delta = apparent - actual
  if (Math.abs(delta) < 1.5) return ''
  // Feels-like only mentioned when meaningfully different from actual.
  return `体感${spokenTemperature(apparent)}`
}

// Inspect the next 12 hours of hourly data and extract intra-day shifts —
// the difference between "今天阵雨" (single daily code) and "傍晚 18 点起
// 有阵雨" (intra-day precision).
function summarizeUpcomingHourly(hourly, currentIsoTime) {
  if (!hourly?.time?.length) return ''
  const startMs = currentIsoTime ? Date.parse(currentIsoTime) : Date.now()
  if (!Number.isFinite(startMs)) return ''
  // Find first index at or after the current hour.
  let startIdx = -1
  for (let i = 0; i < hourly.time.length; i += 1) {
    const ts = Date.parse(hourly.time[i])
    if (Number.isFinite(ts) && ts >= startMs) { startIdx = i; break }
  }
  if (startIdx === -1) return ''

  const PRECIP_PROB_THRESHOLD = 50
  const nextHours = Math.min(12, hourly.time.length - startIdx)
  let firstRainIdx = -1
  let firstRainProb = 0
  for (let offset = 0; offset < nextHours; offset += 1) {
    const idx = startIdx + offset
    const prob = Number(hourly.precipitation_probability?.[idx])
    const code = Number(hourly.weather_code?.[idx])
    const isRainCode = (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || (code >= 95 && code <= 99)
    if ((Number.isFinite(prob) && prob >= PRECIP_PROB_THRESHOLD) || isRainCode) {
      firstRainIdx = offset
      firstRainProb = Number.isFinite(prob) ? prob : firstRainProb
      break
    }
  }
  if (firstRainIdx === -1) return ''

  const rainTimeMs = Date.parse(hourly.time[startIdx + firstRainIdx])
  if (!Number.isFinite(rainTimeMs)) return ''
  const rainHour = new Date(rainTimeMs).getHours()
  const periodLabel = (
    rainHour < 6 ? '凌晨'
    : rainHour < 11 ? '上午'
    : rainHour < 14 ? '中午'
    : rainHour < 18 ? '下午'
    : rainHour < 22 ? '傍晚'
    : '深夜'
  )
  const probText = firstRainProb > 0 ? `（概率${Math.round(firstRainProb)}%）` : ''
  if (firstRainIdx === 0) {
    return `现在就在下雨${probText}`
  }
  return `${periodLabel}${rainHour}点起可能有降水${probText}`
}

function formatDailyWeatherSummary(label, daily, index) {
  if (!daily?.time?.[index]) {
    return ''
  }

  const min = daily.temperature_2m_min?.[index]
  const max = daily.temperature_2m_max?.[index]
  const precipitation = daily.precipitation_probability_max?.[index]
  const precipitationSum = Number(daily.precipitation_sum?.[index])
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
  // Append exact mm only when there is actual rain expected — keeps the
  // dry-day summary clean.
  if (Number.isFinite(precipitationSum) && precipitationSum >= 0.5) {
    pieces.push(`累计${precipitationSum.toFixed(1)}mm`)
  }

  return pieces.join('，')
}

function normalizeWeatherLocationCompareKey(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\u3000\s·•．.，,、_-]+/gu, '')
    .replace(LOCATION_ADMIN_SUFFIX_PATTERN, '')
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
      .replace(/^(?:儿|是|在|去|到|は|が|を|で|に|へ|은|는|을|를|에서|에)\s*/u, '')
      .replace(WEATHER_LOCATION_FILLER_PATTERN, ' ')
      .replace(WEATHER_LOCATION_PARTIAL_TOPIC_SUFFIX_PATTERN, '')
      .replace(/^[的地得の의]\s*/u, '')
      .replace(/\s+/gu, ' ')
      .trim()
  }

  value = value
    .replace(WEATHER_LOCATION_SUFFIX_PATTERN, '')
    .replace(/[的地得の의]$/u, '')
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

  if (/[\u3400-\u9fff\uAC00-\uD7AF\u3040-\u309F\u30A0-\u30FF]/u.test(compact)) {
    return compact.length >= 2
  }

  if (/[a-z]/iu.test(normalized)) {
    return /^[a-z][a-z\s.'-]{1,40}$/iu.test(normalized)
  }

  return false
}

function stripChineseWeatherLocationSuffix(value) {
  return String(value ?? '').replace(LOCATION_ADMIN_SUFFIX_PATTERN, '').trim()
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

  if (!/^[\u3400-\u9fff\uAC00-\uD7AF\u3040-\u309F\u30A0-\u30FF]+$/u.test(compact)) {
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
    && !LOCATION_ADMIN_SUFFIX_PATTERN.test(normalizedLocation)
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

// Nominatim (OpenStreetMap) returns a different result shape than open-meteo's
// geocoding API. Adapt each Nominatim hit into the shape `pickBestWeatherPlace`
// already knows how to score, so swapping the provider at the request level
// doesn't require touching any of the scoring / formatting logic below.
//
// We switched away from `geocoding-api.open-meteo.com` because that subdomain's
// TLS cert started being reissued with notBefore dates several hours in the
// future, failing handshake on correctly-clocked clients worldwide — not a
// user or client bug. Nominatim is the canonical OSM geocoding endpoint and
// is hosted on stable infrastructure.
function normalizeNominatimPlace(item) {
  const address = item?.address ?? {}
  // Prefer the most specific populated-place field OSM gave us for `name`;
  // fall back through the administrative ladder to the first comma-separated
  // piece of display_name so tiny hamlets still end up with SOMETHING usable.
  const displayHead = typeof item?.display_name === 'string'
    ? item.display_name.split(',')[0]?.trim() ?? ''
    : ''
  const name = String(
    item?.name
    || address.city
    || address.town
    || address.village
    || address.hamlet
    || address.suburb
    || address.county
    || address.state
    || displayHead
    || '',
  ).trim()
  const admin1 = String(address.state || address.province || address.region || '').trim()
  const admin2 = String(address.county || address.municipality || address.city_district || '').trim()
  const country = String(address.country || '').trim()
  const countryCode = String(address.country_code || '').toUpperCase()
  // Nominatim doesn't expose GeoNames feature codes. `place_rank` gives a
  // rough equivalent (lower = more important / larger admin area): capitals
  // and first-level admin centres usually rank 4-12, cities 12-16, towns and
  // villages 16-20. Map to the feature-code tiers the existing scorer
  // already understands.
  const placeRank = Number(item?.place_rank)
  let featureCode = 'PPL'
  if (Number.isFinite(placeRank)) {
    if (placeRank <= 8) featureCode = 'PPLC'
    else if (placeRank <= 12) featureCode = 'PPLA'
    else if (placeRank <= 14) featureCode = 'PPLA2'
    else if (placeRank <= 16) featureCode = 'PPLA3'
    else featureCode = 'PPL'
  }
  // No population in Nominatim, but `importance` (0-1 relevance score) is a
  // reasonable proxy for "how major is this place" in the scorer.
  const importance = Number(item?.importance)
  let population = 0
  if (Number.isFinite(importance)) {
    if (importance >= 0.8) population = 5_000_000
    else if (importance >= 0.6) population = 1_000_000
    else if (importance >= 0.4) population = 300_000
    else if (importance >= 0.25) population = 100_000
    else if (importance > 0) population = 20_000
  }
  return {
    name,
    admin1,
    admin2,
    country,
    country_code: countryCode,
    feature_code: featureCode,
    population,
    latitude: Number(item?.lat),
    longitude: Number(item?.lon),
  }
}

function pickBestWeatherPlace(results, query) {
  if (!Array.isArray(results) || !results.length) {
    return null
  }

  const normalizedQuery = normalizeWeatherLocationFragment(query).toLowerCase()
  const queryHasChinese = /[\u3400-\u9fff]/u.test(normalizedQuery)
  const queryHasKana = /[\u3040-\u30FF]/u.test(normalizedQuery)
  const queryHasHangul = /[\uAC00-\uD7AF]/u.test(normalizedQuery)
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
    if (queryHasKana && place?.country_code === 'JP') {
      score += 3
    }
    if (queryHasHangul && place?.country_code === 'KR') {
      score += 3
    }

    score += getWeatherPlaceFeatureScore(place?.feature_code)
    score += getWeatherPlacePopulationScore(place?.population)

    return { place, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored[0] ?? null
}

function detectWeatherQueryLanguage(query) {
  if (/[\uAC00-\uD7AF]/u.test(query)) return 'ko'
  if (/[\u3040-\u30FF]/u.test(query)) return 'ja'
  if (/[\u3400-\u9FFF]/u.test(query)) return 'zh'
  return 'en'
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
  // An exact name/admin match in pickBestWeatherPlace scores 18+ on its own;
  // once we've seen one we can stop iterating candidates — remaining variants
  // are just defensive reformulations of the same query, firing more of them
  // burns through Nominatim's ~1 req/sec hospitality for no accuracy gain and
  // adds noticeable latency to voice-triggered "帮我看一下北京天气" lookups.
  const STRONG_GEOCODE_MATCH_SCORE = 18

  for (const candidate of locationCandidates) {
    // Use Nominatim instead of open-meteo's geocoding subdomain. See
    // `normalizeNominatimPlace` for why: open-meteo's geocoding cert has
    // been getting re-issued with notBefore timestamps in the future,
    // breaking TLS handshake on correctly-clocked clients globally. The
    // forecast endpoint (`api.open-meteo.com`) still works fine and keeps
    // serving a valid cert, so we only replace the geocoding leg.
    //
    // Nominatim's usage policy requires a User-Agent that identifies this
    // app, and throttles anonymous callers to ~1 req/sec. Occasional
    // user-driven weather lookups easily fit inside that budget.
    const acceptLang = detectWeatherQueryLanguage(candidate)
    const geocodingResponse = await performNetworkRequest(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(candidate)}&format=jsonv2&limit=5&addressdetails=1&accept-language=${acceptLang}`,
      {
        method: 'GET',
        timeoutMs: TOOL_WEATHER_TIMEOUT_MS,
        timeoutMessage: '天气定位超时，请稍后再试。',
        headers: {
          'User-Agent': 'Nexus-Companion/0.2.8 (https://github.com/FanyinLiu/Nexus)',
          Accept: 'application/json',
        },
        // Route via Node's undici fetch so TLS verification uses the OS
        // trust store (same rationale as every other public-API call made
        // from the main process — see `forceNativeFetch` in electron/net.js).
        forceNativeFetch: true,
      },
    )

    if (!geocodingResponse.ok) {
      throw new Error(`天气定位失败（状态码：${geocodingResponse.status}）。`)
    }

    const geocodingData = await readJsonSafe(geocodingResponse)
    const normalizedPlaces = Array.isArray(geocodingData)
      ? geocodingData.map(normalizeNominatimPlace)
      : []
    const matchedResult = pickBestWeatherPlace(normalizedPlaces, candidate)
    if (matchedResult && matchedResult.score > bestScore) {
      place = matchedResult.place
      resolvedLocation = candidate
      bestScore = matchedResult.score
    }
    if (bestScore >= STRONG_GEOCODE_MATCH_SCORE) {
      break
    }
  }

  if (!place) {
    throw new Error(`没有找到"${trimmedLocation}"对应的天气地点。`)
  }

  const forecastResponse = await performNetworkRequest(
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}`
      + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,wind_speed_10m'
      + '&hourly=temperature_2m,precipitation_probability,weather_code'
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum'
      + '&timezone=auto&forecast_days=3',
    {
      method: 'GET',
      timeoutMs: TOOL_WEATHER_TIMEOUT_MS,
      timeoutMessage: '天气查询超时，请稍后再试。',
      // Same CA-bundle workaround as the geocoding call above.
      forceNativeFetch: true,
    },
  )

  if (!forecastResponse.ok) {
    throw new Error(`天气查询失败（状态码：${forecastResponse.status}）。`)
  }

  const forecastData = await readJsonSafe(forecastResponse)
  const current = forecastData?.current ?? {}
  const daily = forecastData?.daily ?? {}
  const hourly = forecastData?.hourly ?? {}
  const resolvedName = formatResolvedWeatherPlaceName(place)
  const currentTemperature = Number(current.temperature_2m)
  const currentApparent = Number(current.apparent_temperature)
  const currentHumidity = Number(current.relative_humidity_2m)
  const currentPrecipitation = Number(current.precipitation)
  const currentWind = Number(current.wind_speed_10m)
  const upcomingHourlyHint = summarizeUpcomingHourly(hourly, current.time)
  const currentSummary = [
    Number.isFinite(currentTemperature) ? `当前${spokenTemperature(currentTemperature)}` : '当前气温未知',
    spokenApparentDelta(currentTemperature, currentApparent),
    getWeatherCodeDescription(current.weather_code),
    Number.isFinite(currentPrecipitation) && currentPrecipitation > 0.1
      ? `正在下雨（过去1小时${currentPrecipitation.toFixed(1)}mm）`
      : '',
    spokenHumidity(currentHumidity),
    spokenWindSpeed(currentWind),
    upcomingHourlyHint,
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
    dayAfterSummary: formatDailyWeatherSummary('后天', daily, 2),
    upcomingHourly: upcomingHourlyHint || '',
    usedFallbackLocation,
    message: `已获取 ${resolvedName} 的天气。`,
    // Structured fields consumed by the ambient weather chip in the panel —
    // the LLM-facing summary strings above stay untouched so existing tool
    // calls keep returning exactly the text the model was trained on.
    currentTemperature: Number.isFinite(currentTemperature) ? currentTemperature : null,
    currentApparentTemperature: Number.isFinite(currentApparent) ? currentApparent : null,
    currentHumidity: Number.isFinite(currentHumidity) ? currentHumidity : null,
    currentPrecipitationMm: Number.isFinite(currentPrecipitation) ? currentPrecipitation : null,
    currentWeatherCode: Number.isFinite(Number(current.weather_code)) ? Number(current.weather_code) : null,
    currentConditionLabel: getWeatherCodeDescription(current.weather_code),
    currentWindSpeedKmh: Number.isFinite(currentWind) ? currentWind : null,
    currentIsDay: current.is_day === 1 || current.is_day === true,
  }
}
