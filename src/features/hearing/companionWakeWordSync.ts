import type { AppSettings } from '../../types'

type CompanionWakeWordFields = Pick<AppSettings, 'companionName' | 'wakeWord'>

const WAKE_WORD_LIST_SEPARATOR_PATTERN = /[\s,，;；|/\n\r]+/g

function splitWakeWordInput(value: unknown) {
  return typeof value === 'string'
    ? value
      .trim()
      .split(WAKE_WORD_LIST_SEPARATOR_PATTERN)
      .map((candidate) => candidate.trim())
      .filter(Boolean)
    : []
}

function normalizeName(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function shouldSyncWakeWordWithCompanionName(
  previous: CompanionWakeWordFields,
) {
  const previousWakeWord = normalizeName(previous.wakeWord)
  const previousCompanionName = normalizeName(previous.companionName)

  if (previousWakeWord === previousCompanionName) {
    return true
  }

  const [firstWakeWord] = splitWakeWordInput(previousWakeWord)
  return normalizeName(firstWakeWord) === previousCompanionName
}

export function getDirectSendFallbackWakeWord(
  settings: Pick<AppSettings, 'wakeWord' | 'companionName'>,
) {
  const normalizedWakeWord = typeof settings.wakeWord === 'string'
    ? settings.wakeWord.trim()
    : ''
  if (normalizedWakeWord) {
    return normalizedWakeWord
  }

  const normalizedCompanionName = typeof settings.companionName === 'string'
    ? settings.companionName.trim()
    : ''
  return normalizedCompanionName || '星绘'
}

export function syncWakeWordWithCompanionNameChange<T extends CompanionWakeWordFields>(
  previous: T,
  next: T,
): T {
  if (!shouldSyncWakeWordWithCompanionName(previous)) return next

  const nextCompanionName = normalizeName(next.companionName)
  if (!nextCompanionName) {
    return {
      ...next,
      wakeWord: '',
    }
  }

  const nextWakeWordList = splitWakeWordInput(next.wakeWord)
  const [, ...tailWakeWords] = nextWakeWordList

  return {
    ...next,
    wakeWord: [nextCompanionName, ...tailWakeWords].join(', '),
  }
}

export function setCompanionNameWithWakeWordSync<T extends CompanionWakeWordFields>(
  settings: T,
  companionName: string,
): T {
  return syncWakeWordWithCompanionNameChange(settings, {
    ...settings,
    companionName,
  })
}
