/** Resolve `electron` to the memory-vector test stub before the store loads. */
export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'electron') {
    return {
      url: new URL('./memory-vector-electron-stub.mjs', import.meta.url).href,
      shortCircuit: true,
    }
  }
  return nextResolve(specifier, context)
}
