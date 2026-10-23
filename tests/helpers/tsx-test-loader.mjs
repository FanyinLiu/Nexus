/**
 * Load .tsx in node:test. Type-stripping does not transform JSX, and the
 * settings card imports a stylesheet. CSS becomes an empty module; TSX is
 * transpiled with the TypeScript already in this repo.
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export async function load(url, context, nextLoad) {
  if (url.endsWith('.css')) {
    return { format: 'module', shortCircuit: true, source: 'export default {}\n' }
  }
  if (url.endsWith('.tsx')) {
    const source = readFileSync(fileURLToPath(url), 'utf8')
    const transpiled = ts.transpileModule(source, {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: fileURLToPath(url),
    }).outputText
    return { format: 'module', shortCircuit: true, source: transpiled }
  }
  return nextLoad(url, context)
}
