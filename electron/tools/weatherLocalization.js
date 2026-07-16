const WEATHER_LOCALES = new Set(['zh-CN', 'zh-TW', 'en-US', 'ja', 'ko'])

const WEATHER_CODE_KEYS = {
  0: 'clear',
  1: 'mostlyClear',
  2: 'partlyCloudy',
  3: 'overcast',
  45: 'fog',
  48: 'rimeFog',
  51: 'lightDrizzle',
  53: 'drizzle',
  55: 'heavyDrizzle',
  56: 'lightFreezingDrizzle',
  57: 'heavyFreezingDrizzle',
  61: 'lightRain',
  63: 'rain',
  65: 'heavyRain',
  66: 'lightFreezingRain',
  67: 'heavyFreezingRain',
  71: 'lightSnow',
  73: 'snow',
  75: 'heavySnow',
  77: 'snowGrains',
  80: 'lightShowers',
  81: 'showers',
  82: 'heavyShowers',
  85: 'lightSnowShowers',
  86: 'heavySnowShowers',
  95: 'thunderstorm',
  96: 'thunderstormLightHail',
  99: 'thunderstormHeavyHail',
}

const WEATHER_CONDITIONS = {
  'zh-CN': {
    clear: '晴朗', mostlyClear: '大致晴', partlyCloudy: '局部多云', overcast: '阴天', fog: '有雾', rimeFog: '雾凇',
    lightDrizzle: '小毛毛雨', drizzle: '毛毛雨', heavyDrizzle: '强毛毛雨', lightFreezingDrizzle: '小冻毛毛雨', heavyFreezingDrizzle: '强冻毛毛雨',
    lightRain: '小雨', rain: '中雨', heavyRain: '大雨', lightFreezingRain: '小冻雨', heavyFreezingRain: '强冻雨',
    lightSnow: '小雪', snow: '中雪', heavySnow: '大雪', snowGrains: '冰粒', lightShowers: '小阵雨', showers: '阵雨', heavyShowers: '强阵雨',
    lightSnowShowers: '小阵雪', heavySnowShowers: '强阵雪', thunderstorm: '雷阵雨', thunderstormLightHail: '雷阵雨伴小冰雹', thunderstormHeavyHail: '强雷阵雨伴冰雹', changing: '天气变化中',
  },
  'zh-TW': {
    clear: '晴朗', mostlyClear: '大致晴朗', partlyCloudy: '局部多雲', overcast: '陰天', fog: '有霧', rimeFog: '霧淞',
    lightDrizzle: '小毛毛雨', drizzle: '毛毛雨', heavyDrizzle: '強毛毛雨', lightFreezingDrizzle: '小凍毛毛雨', heavyFreezingDrizzle: '強凍毛毛雨',
    lightRain: '小雨', rain: '中雨', heavyRain: '大雨', lightFreezingRain: '小凍雨', heavyFreezingRain: '強凍雨',
    lightSnow: '小雪', snow: '中雪', heavySnow: '大雪', snowGrains: '冰粒', lightShowers: '小陣雨', showers: '陣雨', heavyShowers: '強陣雨',
    lightSnowShowers: '小陣雪', heavySnowShowers: '強陣雪', thunderstorm: '雷陣雨', thunderstormLightHail: '雷陣雨伴小冰雹', thunderstormHeavyHail: '強雷陣雨伴冰雹', changing: '天氣變化中',
  },
  'en-US': {
    clear: 'clear', mostlyClear: 'mostly clear', partlyCloudy: 'partly cloudy', overcast: 'overcast', fog: 'foggy', rimeFog: 'rime fog',
    lightDrizzle: 'light drizzle', drizzle: 'drizzle', heavyDrizzle: 'heavy drizzle', lightFreezingDrizzle: 'light freezing drizzle', heavyFreezingDrizzle: 'heavy freezing drizzle',
    lightRain: 'light rain', rain: 'rain', heavyRain: 'heavy rain', lightFreezingRain: 'light freezing rain', heavyFreezingRain: 'heavy freezing rain',
    lightSnow: 'light snow', snow: 'snow', heavySnow: 'heavy snow', snowGrains: 'snow grains', lightShowers: 'light showers', showers: 'showers', heavyShowers: 'heavy showers',
    lightSnowShowers: 'light snow showers', heavySnowShowers: 'heavy snow showers', thunderstorm: 'thunderstorms', thunderstormLightHail: 'thunderstorms with light hail', thunderstormHeavyHail: 'severe thunderstorms with hail', changing: 'changing conditions',
  },
  ja: {
    clear: '晴れ', mostlyClear: 'おおむね晴れ', partlyCloudy: '一部くもり', overcast: 'くもり', fog: '霧', rimeFog: '着氷性の霧',
    lightDrizzle: '弱い霧雨', drizzle: '霧雨', heavyDrizzle: '強い霧雨', lightFreezingDrizzle: '弱い着氷性の霧雨', heavyFreezingDrizzle: '強い着氷性の霧雨',
    lightRain: '弱い雨', rain: '雨', heavyRain: '強い雨', lightFreezingRain: '弱い着氷性の雨', heavyFreezingRain: '強い着氷性の雨',
    lightSnow: '弱い雪', snow: '雪', heavySnow: '大雪', snowGrains: '氷の粒', lightShowers: '弱いにわか雨', showers: 'にわか雨', heavyShowers: '強いにわか雨',
    lightSnowShowers: '弱いにわか雪', heavySnowShowers: '強いにわか雪', thunderstorm: '雷雨', thunderstormLightHail: '小さなひょうを伴う雷雨', thunderstormHeavyHail: 'ひょうを伴う強い雷雨', changing: '変わりやすい天気',
  },
  ko: {
    clear: '맑음', mostlyClear: '대체로 맑음', partlyCloudy: '구름 조금', overcast: '흐림', fog: '안개', rimeFog: '착빙 안개',
    lightDrizzle: '약한 이슬비', drizzle: '이슬비', heavyDrizzle: '강한 이슬비', lightFreezingDrizzle: '약한 어는 이슬비', heavyFreezingDrizzle: '강한 어는 이슬비',
    lightRain: '약한 비', rain: '비', heavyRain: '강한 비', lightFreezingRain: '약한 어는 비', heavyFreezingRain: '강한 어는 비',
    lightSnow: '약한 눈', snow: '눈', heavySnow: '폭설', snowGrains: '싸락눈', lightShowers: '약한 소나기', showers: '소나기', heavyShowers: '강한 소나기',
    lightSnowShowers: '약한 눈 소나기', heavySnowShowers: '강한 눈 소나기', thunderstorm: '뇌우', thunderstormLightHail: '약한 우박을 동반한 뇌우', thunderstormHeavyHail: '우박을 동반한 강한 뇌우', changing: '변화가 잦은 날씨',
  },
}

const WEATHER_COPY = {
  'zh-CN': {
    locationRequired: '天气查询需要城市或地区名称。', explicitLocationRequired: '天气查询需要明确的城市或地区名称。',
    geocodeTimeout: '天气定位超时，请稍后再试。', forecastTimeout: '天气查询超时，请稍后再试。',
    geocodeStatus: (status) => `天气定位没成功，服务那边回了个 ${status}。`, forecastStatus: (status) => `天气查不出来，服务那边回了个 ${status}。`,
    placeNotFound: (location) => `没有找到“${location}”对应的天气地点。`, success: (name) => `已获取 ${name} 的天气。`,
    currentTemperature: (value) => `当前${value}`, currentTemperatureUnknown: '当前气温未知', apparent: (value) => `体感${value}`,
    raining: (mm) => `正在下雨（过去1小时${mm}mm）`, accumulated: (mm) => `累计${mm}mm`, range: (min, max) => `${min}到${max}`,
    windCalm: '几乎无风', windLight: '微风', windSpeed: (speed) => `风速${speed}公里每小时`, windStrong: '风比较大', windGale: '大风',
    precipNone: '基本不会下雨', precipLight: '可能有零星小雨', precipChance: (value) => `降水概率百分之${value}`, precipLikely: (value) => `降水概率比较高，百分之${value}`, precipVeryLikely: (value) => `很可能会下雨，降水概率百分之${value}`,
    humidityDry: (value) => `空气干燥（湿度${value}%）`, humidity: (value) => `湿度${value}%`, humidityHigh: (value) => `湿度偏高${value}%`, humidityWet: (value) => `空气湿润（湿度${value}%）`,
    periods: ['凌晨', '上午', '中午', '下午', '傍晚', '深夜'], rainNow: (prob) => `现在就在下雨${prob}`, rainLater: (period, hour, prob) => `${period}${hour}点起可能有降水${prob}`, probability: (value) => `（概率${value}%）`,
    days: ['今天', '明天', '后天'], separator: '，', nominatimLanguage: 'zh-CN',
  },
  'zh-TW': {
    locationRequired: '天氣查詢需要城市或地區名稱。', explicitLocationRequired: '天氣查詢需要明確的城市或地區名稱。',
    geocodeTimeout: '天氣定位逾時，請稍後再試。', forecastTimeout: '天氣查詢逾時，請稍後再試。',
    geocodeStatus: (status) => `天氣定位失敗，服務回傳 ${status}。`, forecastStatus: (status) => `無法查詢天氣，服務回傳 ${status}。`,
    placeNotFound: (location) => `找不到「${location}」對應的天氣地點。`, success: (name) => `已取得 ${name} 的天氣。`,
    currentTemperature: (value) => `目前${value}`, currentTemperatureUnknown: '目前氣溫未知', apparent: (value) => `體感${value}`,
    raining: (mm) => `正在下雨（過去1小時${mm}mm）`, accumulated: (mm) => `累計${mm}mm`, range: (min, max) => `${min}到${max}`,
    windCalm: '幾乎無風', windLight: '微風', windSpeed: (speed) => `風速每小時${speed}公里`, windStrong: '風勢較強', windGale: '強風',
    precipNone: '幾乎不會下雨', precipLight: '可能有零星小雨', precipChance: (value) => `降水機率${value}%`, precipLikely: (value) => `降水機率偏高，${value}%`, precipVeryLikely: (value) => `很可能下雨，降水機率${value}%`,
    humidityDry: (value) => `空氣乾燥（濕度${value}%）`, humidity: (value) => `濕度${value}%`, humidityHigh: (value) => `濕度偏高${value}%`, humidityWet: (value) => `空氣潮濕（濕度${value}%）`,
    periods: ['凌晨', '上午', '中午', '下午', '傍晚', '深夜'], rainNow: (prob) => `現在正在下雨${prob}`, rainLater: (period, hour, prob) => `${period}${hour}點起可能有降水${prob}`, probability: (value) => `（機率${value}%）`,
    days: ['今天', '明天', '後天'], separator: '，', nominatimLanguage: 'zh-TW',
  },
  'en-US': {
    locationRequired: 'Weather lookup requires a city or region.', explicitLocationRequired: 'Please provide a specific city or region for the weather lookup.',
    geocodeTimeout: 'Weather location lookup timed out. Please try again later.', forecastTimeout: 'Weather lookup timed out. Please try again later.',
    geocodeStatus: (status) => `Weather location lookup failed with status ${status}.`, forecastStatus: (status) => `Weather lookup failed with status ${status}.`,
    placeNotFound: (location) => `No weather location was found for “${location}”.`, success: (name) => `Weather retrieved for ${name}.`,
    currentTemperature: (value) => `Currently ${value}`, currentTemperatureUnknown: 'Current temperature unavailable', apparent: (value) => `feels like ${value}`,
    raining: (mm) => `raining now (${mm} mm in the past hour)`, accumulated: (mm) => `${mm} mm total`, range: (min, max) => `${min} to ${max}`,
    windCalm: 'calm winds', windLight: 'light breeze', windSpeed: (speed) => `winds at ${speed} km/h`, windStrong: 'strong winds', windGale: 'gale-force winds',
    precipNone: 'rain is unlikely', precipLight: 'a slight chance of rain', precipChance: (value) => `${value}% chance of precipitation`, precipLikely: (value) => `a high ${value}% chance of precipitation`, precipVeryLikely: (value) => `rain is very likely (${value}%)`,
    humidityDry: (value) => `dry air (${value}% humidity)`, humidity: (value) => `${value}% humidity`, humidityHigh: (value) => `high humidity at ${value}%`, humidityWet: (value) => `very humid (${value}%)`,
    periods: ['early morning', 'morning', 'midday', 'afternoon', 'evening', 'late night'], rainNow: (prob) => `rain is starting now${prob}`, rainLater: (period, hour, prob) => `precipitation may begin in the ${period} around ${hour}:00${prob}`, probability: (value) => ` (${value}% chance)`,
    days: ['Today', 'Tomorrow', 'The day after tomorrow'], separator: ', ', nominatimLanguage: 'en',
  },
  ja: {
    locationRequired: '天気を調べるには都市名または地域名が必要です。', explicitLocationRequired: '天気を調べる都市名または地域名を指定してください。',
    geocodeTimeout: '天気の場所検索がタイムアウトしました。しばらくしてからもう一度お試しください。', forecastTimeout: '天気検索がタイムアウトしました。しばらくしてからもう一度お試しください。',
    geocodeStatus: (status) => `天気の場所検索に失敗しました（${status}）。`, forecastStatus: (status) => `天気を取得できませんでした（${status}）。`,
    placeNotFound: (location) => `「${location}」に対応する天気の場所が見つかりませんでした。`, success: (name) => `${name}の天気を取得しました。`,
    currentTemperature: (value) => `現在${value}`, currentTemperatureUnknown: '現在の気温は不明', apparent: (value) => `体感${value}`,
    raining: (mm) => `現在雨（過去1時間${mm}mm）`, accumulated: (mm) => `合計${mm}mm`, range: (min, max) => `${min}から${max}`,
    windCalm: 'ほぼ無風', windLight: 'そよ風', windSpeed: (speed) => `風速${speed}km/h`, windStrong: '強めの風', windGale: '強風',
    precipNone: '雨の可能性はほぼなし', precipLight: 'にわか雨の可能性あり', precipChance: (value) => `降水確率${value}%`, precipLikely: (value) => `降水確率は高めで${value}%`, precipVeryLikely: (value) => `雨の可能性が非常に高く、降水確率${value}%`,
    humidityDry: (value) => `乾燥（湿度${value}%）`, humidity: (value) => `湿度${value}%`, humidityHigh: (value) => `湿度は高めの${value}%`, humidityWet: (value) => `蒸し暑い（湿度${value}%）`,
    periods: ['明け方', '午前', '昼', '午後', '夕方', '深夜'], rainNow: (prob) => `現在雨が降り始めています${prob}`, rainLater: (period, hour, prob) => `${period}${hour}時ごろから降水の可能性${prob}`, probability: (value) => `（確率${value}%）`,
    days: ['今日', '明日', '明後日'], separator: '、', nominatimLanguage: 'ja',
  },
  ko: {
    locationRequired: '날씨를 조회하려면 도시나 지역 이름이 필요합니다.', explicitLocationRequired: '날씨를 조회할 도시나 지역을 정확히 입력해 주세요.',
    geocodeTimeout: '날씨 위치 조회 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.', forecastTimeout: '날씨 조회 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.',
    geocodeStatus: (status) => `날씨 위치 조회에 실패했습니다(상태 ${status}).`, forecastStatus: (status) => `날씨를 조회할 수 없습니다(상태 ${status}).`,
    placeNotFound: (location) => `“${location}”에 해당하는 날씨 위치를 찾지 못했습니다.`, success: (name) => `${name}의 날씨를 가져왔습니다.`,
    currentTemperature: (value) => `현재 ${value}`, currentTemperatureUnknown: '현재 기온을 알 수 없음', apparent: (value) => `체감 ${value}`,
    raining: (mm) => `현재 비가 내림(지난 1시간 ${mm}mm)`, accumulated: (mm) => `누적 ${mm}mm`, range: (min, max) => `${min}~${max}`,
    windCalm: '거의 바람 없음', windLight: '산들바람', windSpeed: (speed) => `풍속 ${speed}km/h`, windStrong: '바람이 강함', windGale: '강풍',
    precipNone: '비 올 가능성 거의 없음', precipLight: '약한 비 가능성', precipChance: (value) => `강수 확률 ${value}%`, precipLikely: (value) => `강수 확률이 높은 ${value}%`, precipVeryLikely: (value) => `비 올 가능성이 매우 높음(${value}%)`,
    humidityDry: (value) => `건조함(습도 ${value}%)`, humidity: (value) => `습도 ${value}%`, humidityHigh: (value) => `높은 습도 ${value}%`, humidityWet: (value) => `매우 습함(습도 ${value}%)`,
    periods: ['새벽', '오전', '정오', '오후', '저녁', '늦은 밤'], rainNow: (prob) => `지금 비가 내리기 시작합니다${prob}`, rainLater: (period, hour, prob) => `${period} ${hour}시경부터 강수 가능성${prob}`, probability: (value) => ` (확률 ${value}%)`,
    days: ['오늘', '내일', '모레'], separator: ', ', nominatimLanguage: 'ko',
  },
}

export function normalizeWeatherLocale(locale) {
  return WEATHER_LOCALES.has(locale) ? locale : 'zh-CN'
}

export function getWeatherLocalizationCopy(locale) {
  return WEATHER_COPY[normalizeWeatherLocale(locale)]
}

function strictNumeric(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function getWeatherCodeDescription(code, locale = 'zh-CN') {
  const normalizedCode = strictNumeric(code)
  const normalizedLocale = normalizeWeatherLocale(locale)
  const conditionKey = WEATHER_CODE_KEYS[normalizedCode]
  return WEATHER_CONDITIONS[normalizedLocale][conditionKey]
    ?? WEATHER_CONDITIONS[normalizedLocale].changing
}

function spokenTemperature(value) {
  if (!Number.isFinite(value)) return ''
  return `${Math.round(value)}°C`
}

function spokenWindSpeed(kmh, locale = 'zh-CN') {
  if (!Number.isFinite(kmh)) return ''
  const copy = WEATHER_COPY[normalizeWeatherLocale(locale)]
  const rounded = Math.round(kmh)
  if (rounded <= 1) return copy.windCalm
  if (rounded <= 10) return copy.windLight
  if (rounded <= 20) return copy.windSpeed(rounded)
  if (rounded <= 40) return copy.windStrong
  return copy.windGale
}

function spokenPrecipitation(percent, locale = 'zh-CN') {
  if (!Number.isFinite(percent)) return ''
  const copy = WEATHER_COPY[normalizeWeatherLocale(locale)]
  if (percent <= 5) return copy.precipNone
  if (percent <= 20) return copy.precipLight
  if (percent <= 50) return copy.precipChance(percent)
  if (percent <= 80) return copy.precipLikely(percent)
  return copy.precipVeryLikely(percent)
}

function spokenHumidity(percent, locale = 'zh-CN') {
  if (!Number.isFinite(percent)) return ''
  const copy = WEATHER_COPY[normalizeWeatherLocale(locale)]
  const rounded = Math.round(percent)
  if (rounded < 30) return copy.humidityDry(rounded)
  if (rounded < 60) return copy.humidity(rounded)
  if (rounded < 80) return copy.humidityHigh(rounded)
  return copy.humidityWet(rounded)
}

function spokenApparentDelta(actual, apparent, locale = 'zh-CN') {
  if (!Number.isFinite(actual) || !Number.isFinite(apparent)) return ''
  const delta = apparent - actual
  if (Math.abs(delta) < 1.5) return ''
  // Feels-like only mentioned when meaningfully different from actual.
  return WEATHER_COPY[normalizeWeatherLocale(locale)].apparent(spokenTemperature(apparent))
}

// Inspect the next 12 hours of hourly data and extract intra-day shifts —
// the difference between "今天阵雨" (single daily code) and "傍晚 18 点起
// 有阵雨" (intra-day precision).
function summarizeUpcomingHourly(hourly, currentIsoTime, locale = 'zh-CN') {
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
    const prob = strictNumeric(hourly.precipitation_probability?.[idx])
    const code = strictNumeric(hourly.weather_code?.[idx])
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
  const copy = WEATHER_COPY[normalizeWeatherLocale(locale)]
  const periodIndex = rainHour < 6 ? 0 : rainHour < 11 ? 1 : rainHour < 14 ? 2 : rainHour < 18 ? 3 : rainHour < 22 ? 4 : 5
  const periodLabel = copy.periods[periodIndex]
  const probText = firstRainProb > 0 ? copy.probability(Math.round(firstRainProb)) : ''
  if (firstRainIdx === 0) {
    return copy.rainNow(probText)
  }
  return copy.rainLater(periodLabel, rainHour, probText)
}

function formatDailyWeatherSummary(label, daily, index, locale = 'zh-CN') {
  if (!daily?.time?.[index]) {
    return ''
  }

  const min = strictNumeric(daily.temperature_2m_min?.[index])
  const max = strictNumeric(daily.temperature_2m_max?.[index])
  const precipitation = strictNumeric(daily.precipitation_probability_max?.[index])
  const precipitationSum = strictNumeric(daily.precipitation_sum?.[index])
  const weatherCode = strictNumeric(daily.weather_code?.[index])
  const copy = WEATHER_COPY[normalizeWeatherLocale(locale)]
  const pieces = [
    label,
    getWeatherCodeDescription(weatherCode, locale),
  ]

  if (Number.isFinite(min) && Number.isFinite(max)) {
    pieces.push(copy.range(spokenTemperature(min), spokenTemperature(max)))
  }

  const precipitationText = spokenPrecipitation(precipitation, locale)
  if (precipitationText) {
    pieces.push(precipitationText)
  }
  // Append exact mm only when there is actual rain expected — keeps the
  // dry-day summary clean.
  if (Number.isFinite(precipitationSum) && precipitationSum >= 0.5) {
    pieces.push(copy.accumulated(precipitationSum.toFixed(1)))
  }

  return pieces.join(copy.separator)
}

export function formatWeatherContentForLocale(
  { current = {}, daily = {}, hourly = {} } = {},
  locale = 'zh-CN',
) {
  const normalizedLocale = normalizeWeatherLocale(locale)
  const copy = WEATHER_COPY[normalizedLocale]
  const currentTemperature = strictNumeric(current.temperature_2m)
  const currentApparent = strictNumeric(current.apparent_temperature)
  const currentHumidity = strictNumeric(current.relative_humidity_2m)
  const currentPrecipitation = strictNumeric(current.precipitation)
  const currentWind = strictNumeric(current.wind_speed_10m)
  const currentWeatherCode = strictNumeric(current.weather_code)
  const upcomingHourlyHint = summarizeUpcomingHourly(hourly, current.time, normalizedLocale)
  const currentSummary = [
    Number.isFinite(currentTemperature)
      ? copy.currentTemperature(spokenTemperature(currentTemperature))
      : copy.currentTemperatureUnknown,
    spokenApparentDelta(currentTemperature, currentApparent, normalizedLocale),
    getWeatherCodeDescription(currentWeatherCode, normalizedLocale),
    Number.isFinite(currentPrecipitation) && currentPrecipitation > 0.1
      ? copy.raining(currentPrecipitation.toFixed(1))
      : '',
    spokenHumidity(currentHumidity, normalizedLocale),
    spokenWindSpeed(currentWind, normalizedLocale),
    upcomingHourlyHint,
  ]
    .filter(Boolean)
    .join(copy.separator)

  return {
    currentSummary,
    todaySummary: formatDailyWeatherSummary(copy.days[0], daily, 0, normalizedLocale),
    tomorrowSummary: formatDailyWeatherSummary(copy.days[1], daily, 1, normalizedLocale),
    dayAfterSummary: formatDailyWeatherSummary(copy.days[2], daily, 2, normalizedLocale),
    upcomingHourly: upcomingHourlyHint || '',
    currentTemperature: Number.isFinite(currentTemperature) ? currentTemperature : null,
    currentApparentTemperature: Number.isFinite(currentApparent) ? currentApparent : null,
    currentHumidity: Number.isFinite(currentHumidity) ? currentHumidity : null,
    currentPrecipitationMm: Number.isFinite(currentPrecipitation) ? currentPrecipitation : null,
    currentWeatherCode,
    currentConditionLabel: getWeatherCodeDescription(current.weather_code, normalizedLocale),
    currentWindSpeedKmh: Number.isFinite(currentWind) ? currentWind : null,
    currentIsDay: current.is_day === 1 || current.is_day === true,
  }
}
