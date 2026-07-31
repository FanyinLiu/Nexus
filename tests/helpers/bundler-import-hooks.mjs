// ESM resolve hooks for node --test: the app source is written for the Vite
// bundler, which accepts directory imports (`../../lib`) and extensionless
// relative imports (`../../lib/coreRuntime`). Node's resolver rejects both,
// so retry those specifiers as `/index.ts` / `.ts` before giving up.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (!context.parentURL || !specifier.startsWith('.')) throw err
    const candidates = []
    if (/Directory import/.test(String(err?.message))) {
      candidates.push(specifier.replace(/\/?$/, '/index.ts'))
    } else if (err?.code === 'ERR_MODULE_NOT_FOUND') {
      candidates.push(`${specifier}.ts`, `${specifier}/index.ts`)
    }
    for (const candidate of candidates) {
      try {
        return await nextResolve(new URL(candidate, context.parentURL).href, context)
      } catch { /* try the next candidate */ }
    }
    throw err
  }
}
