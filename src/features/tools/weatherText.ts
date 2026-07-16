function normalizeWeatherText(text: string) {
  return String(text ?? '').replace(/\s+/g, ' ').trim()
}

export function stripWeatherPeriodPrefix(summary: string, label: string) {
  const normalizedSummary = normalizeWeatherText(summary)
  const normalizedLabel = normalizeWeatherText(label)

  if (!normalizedSummary || !normalizedLabel) {
    return normalizedSummary
  }

  const escapedLabel = normalizedLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return normalizeWeatherText(
    normalizedSummary.replace(new RegExp(`^${escapedLabel}[，,、:：\\s]*`, 'u'), ''),
  )
}

export function formatWeatherPeriodSummary(label: string, summary: string) {
  const normalizedLabel = normalizeWeatherText(label)
  const strippedSummary = stripWeatherPeriodPrefix(summary, normalizedLabel)

  if (!normalizedLabel) {
    return strippedSummary
  }

  if (!strippedSummary) {
    return normalizedLabel
  }

  return `${normalizedLabel}，${strippedSummary}`
}

const WEATHER_PERIOD_LABELS = {
  today: ['今天', '今日', 'Today', '오늘'],
  tomorrow: ['明天', '明日', 'Tomorrow', '내일'],
} as const

export function stripLocalizedWeatherPeriodPrefix(
  summary: string,
  period: keyof typeof WEATHER_PERIOD_LABELS,
) {
  let normalizedSummary = normalizeWeatherText(summary)
  for (const label of WEATHER_PERIOD_LABELS[period]) {
    const stripped = stripWeatherPeriodPrefix(normalizedSummary, label)
    if (stripped !== normalizedSummary) {
      return stripped
    }
    normalizedSummary = stripped
  }
  return normalizedSummary
}
