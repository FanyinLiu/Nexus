// ESM resolve/load hooks for node --test: the app source is written for the
// Vite bundler, which accepts directory imports (`../../lib`) and
// extensionless relative imports (`../../lib/coreRuntime`). Node's resolver
// rejects both, so retry those specifiers as `/index.ts` / `.ts` before giving
// up. Production JSX lives in .tsx modules, which Node's type stripping alone
// cannot load, so transform those with esbuild (the same transformer Vite
// uses). CSS imports become empty modules — styles are irrelevant to behavior
// tests.
import { readFile } from 'node:fs/promises'

import { transformSync } from 'esbuild'

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

export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', shortCircuit: true, source: 'export default {}\n' }
  }
  if (!url.endsWith('.tsx')) return nextLoad(url, context)

  const source = await readFile(new URL(url), 'utf8')
  const transformed = transformSync(source, {
    format: 'esm',
    jsx: 'automatic',
    loader: 'tsx',
    sourcefile: url,
    sourcemap: 'inline',
    target: 'es2024',
  })
  return { format: 'module', shortCircuit: true, source: transformed.code }
}
