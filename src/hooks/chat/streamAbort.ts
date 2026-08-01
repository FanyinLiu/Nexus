export type AbortSetter = (
  abortOrUpdater:
    | ((() => Promise<void>) | null)
    | ((current: (() => Promise<void>) | null) => (() => Promise<void>) | null),
) => void

export function bindStreamingAbort<T>(
  request: Promise<T> & { abort?: () => Promise<void> },
  setAbort: AbortSetter,
) {
  const boundAbort = request.abort?.bind(request) ?? null
  setAbort(boundAbort)

  return request.finally(() => {
    // Only clear if this is still OUR abort function, not a newer turn's
    setAbort((current) => (current === boundAbort ? null : current))
  })
}
