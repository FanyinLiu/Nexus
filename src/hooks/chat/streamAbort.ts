export function bindStreamingAbort<T>(
  request: Promise<T> & { abort?: () => Promise<void> },
  setAbort: (abort: (() => Promise<void>) | null) => void,
) {
  const abort = request.abort?.bind(request)
  setAbort(abort ?? null)

  return request.finally(() => {
    setAbort(null)
  })
}
