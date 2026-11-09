// Redirects every `electron/net.js` import in the TTS service graph to the
// in-memory request mock. Keeping the swap at the resolver means ttsHelpers and
// ttsVolcengine observe the same module instance as ttsService.

export async function resolve(specifier, context, nextResolve) {
  const resolved = await nextResolve(specifier, context)
  if (resolved.url.endsWith('/electron/net.js')) {
    return {
      url: new URL('./tts-net-request-mock.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  }
  return resolved
}
