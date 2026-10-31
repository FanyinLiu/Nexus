// Minimal `electron` stub for tests that import the TTS service directly.
// `electron/net.js` only touches `net.fetch` for non-loopback requests; these
// tests use a loopback HTTP server, but the named import still has to resolve.

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return { url: import.meta.url, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}

export const net = {
  fetch: (...args) => globalThis.fetch(...args),
}
