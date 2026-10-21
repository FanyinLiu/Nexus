/**
 * Rules for the simplified settings surface.
 *
 * Combined controls write the old fields only when those fields already
 * agree, or still sit on their factory defaults. A mixed pair stays
 * mixed and is left for the advanced section.
 */

export type QuietHours = {
  start: number
  end: number
}

const AUTONOMY_QUIET_FACTORY: QuietHours = { start: 23, end: 7 }
const PROACTIVE_QUIET_FACTORY: QuietHours = { start: 23, end: 8 }

function sameHours(left: QuietHours, right: QuietHours): boolean {
  return left.start === right.start && left.end === right.end
}

/**
 * One quiet window when both pairs match, or when each pair is still the
 * factory default (23–7 and 23–8). Mixed custom pairs return null so the
 * page does not overwrite either side.
 */
export function unifiedQuietHours(autonomy: QuietHours, proactive: QuietHours): QuietHours | null {
  if (sameHours(autonomy, proactive)) return { start: autonomy.start, end: autonomy.end }
  if (sameHours(autonomy, AUTONOMY_QUIET_FACTORY) && sameHours(proactive, PROACTIVE_QUIET_FACTORY)) {
    return { start: PROACTIVE_QUIET_FACTORY.start, end: PROACTIVE_QUIET_FACTORY.end }
  }
  return null
}

/** Write both quiet-hour pairs to the same hours. Call only after an edit. */
export function quietHoursPatch(hours: QuietHours) {
  return {
    autonomyQuietHoursStart: hours.start,
    autonomyQuietHoursEnd: hours.end,
    proactiveQuietHoursStart: hours.start,
    proactiveQuietHoursEnd: hours.end,
  }
}

/**
 * Shared lookup switch. Null means search and weather disagree, so the
 * simple switch must not flip them together.
 */
export function sharedLookup(searchEnabled: boolean, weatherEnabled: boolean): boolean | null {
  if (searchEnabled === weatherEnabled) return searchEnabled
  return null
}

/** Turn search and weather on or off together. */
export function lookupPatch(enabled: boolean) {
  return {
    toolWebSearchEnabled: enabled,
    toolWeatherEnabled: enabled,
  }
}

type AwarenessFlags = {
  activeWindowContextEnabled: boolean
  clipboardContextEnabled: boolean
  screenContextEnabled: boolean
}

/**
 * Desktop awareness. Turning it on while every source is off enables the
 * window title only. Turning it off leaves the source switches stored.
 */
export function desktopAwarenessPatch(enabled: boolean, current: AwarenessFlags) {
  if (!enabled) return { contextAwarenessEnabled: false }
  const noneSelected = !current.activeWindowContextEnabled
    && !current.clipboardContextEnabled
    && !current.screenContextEnabled
  return {
    contextAwarenessEnabled: true,
    ...(noneSelected ? { activeWindowContextEnabled: true } : {}),
  }
}

/**
 * “Keep talking” turns continuous conversation and activity detection on
 * together. Turning it off clears only continuous conversation.
 */
export function keepTalkingPatch(enabled: boolean) {
  if (enabled) {
    return {
      continuousVoiceModeEnabled: true,
      voiceActivityDetectionEnabled: true,
    }
  }
  return { continuousVoiceModeEnabled: false }
}

/**
 * Opening settings must not rewrite speech languages. The computer
 * recommendation writes only when its button is pressed.
 */
export function voiceLanguagesAfterSettingsOpen<T extends {
  speechRecognitionLang: string
  speechSynthesisLang: string
}>(settings: T): Pick<T, 'speechRecognitionLang' | 'speechSynthesisLang'> {
  return {
    speechRecognitionLang: settings.speechRecognitionLang,
    speechSynthesisLang: settings.speechSynthesisLang,
  }
}
