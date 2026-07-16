/**
 * Pure async coordinator for Settings language draft selection.
 *
 * Guarantees:
 * - loaded locales apply immediately
 * - delayed loads apply only if still the latest request and the drawer is active
 * - out-of-order resolutions keep the latest selection
 * - invalidate() (close/unmount) drops in-flight applications
 * - load failure still falls back to applying the draft when current
 * - a no-op is never silent: callers get an explicit outcome
 */

export type LanguageSelectionOutcome =
  | 'applied'
  | 'ignored-stale'
  | 'ignored-inactive'
  | 'failed-applied'
  | 'failed-ignored-stale'
  | 'failed-ignored-inactive'

export type LanguageSelectionCoordinatorOptions<TLocale extends string> = {
  isLocaleLoaded: (locale: TLocale) => boolean
  ensureLocaleLoaded: (locale: TLocale) => Promise<unknown>
  applyLanguage: (locale: TLocale) => void
  /** Drawer still mounted/open and selection session still valid beyond generation. */
  isActive: () => boolean
  onLoadFailure?: (locale: TLocale, error: unknown) => void
}

export type LanguageSelectionCoordinator<TLocale extends string> = {
  selectLanguage: (locale: TLocale) => Promise<LanguageSelectionOutcome>
  invalidate: () => void
  getGeneration: () => number
}

export function createLanguageSelectionCoordinator<TLocale extends string>(
  options: LanguageSelectionCoordinatorOptions<TLocale>,
): LanguageSelectionCoordinator<TLocale> {
  let generation = 0

  function invalidate() {
    generation += 1
  }

  function getGeneration() {
    return generation
  }

  function isCurrent(requestGeneration: number) {
    return generation === requestGeneration
  }

  async function selectLanguage(locale: TLocale): Promise<LanguageSelectionOutcome> {
    const requestGeneration = generation + 1
    generation = requestGeneration

    const resolveCurrent = (): 'current' | 'stale' | 'inactive' => {
      if (!isCurrent(requestGeneration)) return 'stale'
      if (!options.isActive()) return 'inactive'
      return 'current'
    }

    const applyIfCurrent = (): LanguageSelectionOutcome => {
      const status = resolveCurrent()
      if (status === 'stale') return 'ignored-stale'
      if (status === 'inactive') return 'ignored-inactive'
      options.applyLanguage(locale)
      return 'applied'
    }

    if (options.isLocaleLoaded(locale)) {
      return applyIfCurrent()
    }

    try {
      await options.ensureLocaleLoaded(locale)
      return applyIfCurrent()
    } catch (error) {
      options.onLoadFailure?.(locale, error)
      const status = resolveCurrent()
      if (status === 'stale') return 'failed-ignored-stale'
      if (status === 'inactive') return 'failed-ignored-inactive'
      options.applyLanguage(locale)
      return 'failed-applied'
    }
  }

  return {
    selectLanguage,
    invalidate,
    getGeneration,
  }
}
