#!/usr/bin/env node

import { createHash } from 'node:crypto'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { minify } from 'csso'

export function minifyCssText(source) {
  const compatibleMediaQueries = source.replace(
    /\((width|height|aspect-ratio|resolution)\s*(<=|>=)\s*([^)]+)\)/g,
    (_, feature, operator, value) => `(${operator === '>=' ? 'min' : 'max'}-${feature}:${value})`,
  )
  return minify(compatibleMediaQueries, {
    comments: 'exclamation',
    // CSSO cannot parse the media-range syntax emitted by Lightning CSS.
    // Normalize those queries first, then allow semantics-preserving merging
    // to keep the corrected build inside the existing CSS budget.
    restructure: true,
  }).css
}

export function getContentHash(source) {
  return createHash('sha256').update(source).digest('hex')
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const nested = await Promise.all(entries.map((entry) => {
    const entryPath = path.join(directory, entry.name)
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath]
  }))
  return nested.flat()
}

export async function minifyBuiltCss(distDirectory) {
  const assetsDirectory = path.join(distDirectory, 'assets')
  const cssPaths = (await listFiles(assetsDirectory))
    .filter((file) => file.endsWith('.css'))
    .sort((left, right) => left.localeCompare(right))
  if (!cssPaths.length) throw new Error(`No built CSS assets found in ${assetsDirectory}`)
  const assets = []

  for (const cssPath of cssPaths) {
    const minified = minifyCssText(await readFile(cssPath, 'utf8'))
    await writeFile(cssPath, minified)
    assets.push({
      bytes: Buffer.byteLength(minified),
      file: path.relative(distDirectory, cssPath),
      sha256: getContentHash(minified),
    })
  }

  const manifestPath = path.join(distDirectory, 'css-integrity.json')
  await writeFile(manifestPath, `${JSON.stringify({ algorithm: 'sha256', assets }, null, 2)}\n`)
  for (const asset of assets) {
    const finalCss = await readFile(path.join(distDirectory, asset.file), 'utf8')
    if (getContentHash(finalCss) !== asset.sha256) {
      throw new Error(`Final CSS integrity does not match content: ${asset.file}`)
    }
  }

  return assets
}

async function main() {
  const distDirectory = path.resolve(process.argv[2] ?? 'dist')
  const assets = await minifyBuiltCss(distDirectory)
  const totalBytes = assets.reduce((sum, asset) => sum + asset.bytes, 0)
  console.log(`Post-build CSS: ${assets.length} assets, ${totalBytes} bytes, content hashes verified`)
}

const entryUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (import.meta.url === entryUrl) {
  await main()
}
