/**
 * setup-vendor.mjs
 * Copies Live2D vendor files from node_modules and downloads Cubism Core.
 * Run automatically via postinstall, or manually: node scripts/setup-vendor.mjs
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { createRequire } from 'node:module'
import { get } from 'node:https'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  assertCubismCoreContents,
  assertCubismCoreFile,
  CUBISM_CORE_SHA256,
  VendorIntegrityError,
} from './lib/vendorIntegrity.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const vendorDir = join(root, 'public', 'vendor')

const cubismUrl = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'
const CUBISM_FILE_LABEL = 'live2dcubismcore.min.js'
const MAX_REDIRECTS = 5

/**
 * Write a file only when its bytes differ from the existing copy so repeated
 * postinstall runs stay cheap while upgrades still refresh stale assets.
 * @param {string} src
 * @param {string} dest
 * @param {string} label
 * @returns {boolean} true when the file changed
 */
function copyFileIfChanged(src, dest, label) {
  if (!existsSync(src)) {
    console.warn(`[vendor] ✗ ${label} — source not found: ${src}`)
    return false
  }
  const contents = readFileSync(src)
  if (existsSync(dest) && readFileSync(dest).equals(contents)) {
    console.log(`[vendor] ✓ ${label} (already exists)`)
    return false
  }
  writeFileSync(dest, contents)
  console.log(`[vendor] ✓ ${label} (copied from node_modules)`)
  return true
}

/**
 * Resolve the onnxruntime-web dist directory that @huggingface/transformers
 * actually loads. npm may install a newer copy nested under the package, and
 * its WASM filenames/digests are the ones transformers.js expects.
 * @returns {string | null}
 */
function resolveTransformersOrtDist() {
  try {
    const transformersRequire = createRequire(
      join(root, 'node_modules', '@huggingface', 'transformers', 'package.json'),
    )
    // `onnxruntime-web` resolves to dist/ort.node.min.js; its directory is the
    // dist folder that contains the matching ort-wasm-* files.
    return dirname(transformersRequire.resolve('onnxruntime-web'))
  } catch {
    return null
  }
}

/**
 * Copy the ORT WASM assets a renderer runtime needs.
 * @param {string} sourceDir
 * @param {string[]} files
 * @param {string} label
 */
function copyOrtFiles(sourceDir, files, label) {
  let copied = 0
  let present = 0
  for (const file of files) {
    const src = join(sourceDir, file)
    const dest = join(vendorDir, 'ort', file)
    if (!existsSync(src)) {
      console.warn(`[vendor] ✗ ort/${file} — source not found`)
      continue
    }
    if (copyFileIfChanged(src, dest, `ort/${file}`)) {
      copied++
    } else {
      present++
    }
  }
  if (copied > 0 || present > 0) {
    console.log(`[vendor] ✓ ${label} (${copied} copied, ${present} already present)`)
  }
}

/**
 * Follow HTTPS redirects and stream the response to a temp file.
 * @param {string} url
 * @param {string} destPath
 * @param {number} [redirectsLeft]
 * @returns {Promise<void>}
 */
function downloadHttpsFile(url, destPath, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolveDownload, rejectDownload) => {
    let parsed
    try {
      parsed = new URL(url)
    } catch {
      rejectDownload(new Error(`invalid vendor download URL: ${url}`))
      return
    }
    if (parsed.protocol !== 'https:') {
      rejectDownload(new Error(`vendor downloads must use HTTPS, got ${parsed.protocol}`))
      return
    }

    const request = get(parsed, (response) => {
      const status = response.statusCode ?? 0
      if (status >= 300 && status < 400) {
        response.resume()
        if (redirectsLeft <= 0) {
          rejectDownload(new Error('too many vendor download redirects'))
          return
        }
        const location = response.headers.location
        if (!location) {
          rejectDownload(new Error(`vendor download redirect ${status} had no location`))
          return
        }
        let next
        try {
          next = new URL(location, parsed)
        } catch {
          rejectDownload(new Error(`vendor download redirect location is invalid: ${location}`))
          return
        }
        if (next.protocol !== 'https:') {
          rejectDownload(new Error(`vendor download redirect must stay on HTTPS: ${next.toString()}`))
          return
        }
        downloadHttpsFile(next.toString(), destPath, redirectsLeft - 1).then(resolveDownload, rejectDownload)
        return
      }

      if (status !== 200) {
        response.resume()
        rejectDownload(new Error(`vendor download returned HTTP ${status}`))
        return
      }

      const file = createWriteStream(destPath, { mode: 0o600 })
      response.on('error', rejectDownload)
      response.pipe(file)
      file.on('finish', () => file.close(() => resolveDownload()))
      file.on('error', rejectDownload)
    })
    request.on('error', rejectDownload)
  })
}

/**
 * Verify an existing Cubism Core file; delete and fail closed on mismatch.
 * @param {string} destPath
 * @returns {boolean} true when the existing file is verified
 */
function verifyExistingCubismCore(destPath) {
  try {
    assertCubismCoreFile(destPath, CUBISM_FILE_LABEL)
    console.log(`[vendor] ✓ ${CUBISM_FILE_LABEL} (already exists, SHA-256 verified)`)
    return true
  } catch (error) {
    try {
      unlinkSync(destPath)
    } catch {
      // The caller still refuses to continue even if deletion fails.
    }
    if (error instanceof VendorIntegrityError) {
      console.error(error.message)
    } else {
      console.error(`[vendor] ✗ ${CUBISM_FILE_LABEL} could not be verified: ${error instanceof Error ? error.message : String(error)}`)
    }
    return false
  }
}

async function main() {
  if (!existsSync(vendorDir)) {
    mkdirSync(vendorDir, { recursive: true })
  }

  const ortDir = join(vendorDir, 'ort')
  if (!existsSync(ortDir)) {
    mkdirSync(ortDir, { recursive: true })
  }

  const vadDir = join(vendorDir, 'vad')
  if (!existsSync(vadDir)) {
    mkdirSync(vadDir, { recursive: true })
  }

  // Copy from node_modules
  const copies = [
    {
      // PixiJS v8 ships the browser bundle at dist/pixi.min.js (no dist/browser/).
      src: join(root, 'node_modules', 'pixi.js', 'dist', 'pixi.min.js'),
      dest: join(vendorDir, 'pixi.min.js'),
      label: 'pixi.min.js',
    },
    {
      // Pixi v8 Live2D plugin (fork of guansss/pixi-live2d-display).
      src: join(root, 'node_modules', '@jannchie', 'pixi-live2d-display', 'dist', 'cubism4.min.js'),
      dest: join(vendorDir, 'pixi-live2d-display.cubism4.min.js'),
      label: 'pixi-live2d-display.cubism4.min.js',
    },
  ]

  for (const { src, dest, label } of copies) {
    if (!existsSync(src)) {
      console.warn(`[vendor] ✗ ${label} — source not found: ${src}`)
      continue
    }
    // Always rewrite so post-processing below stays in sync with node_modules.
    let contents = readFileSync(src)
    if (label === 'pixi-live2d-display.cubism4.min.js') {
      // The jannchie UMD bundle references process.env.NODE_ENV, but we load it
      // as a classic <script> where `process` does not exist. Inline the value.
      const text = contents.toString('utf8')
      if (text.includes('process.env.NODE_ENV')) {
        contents = Buffer.from(text.replaceAll('process.env.NODE_ENV', '"production"'), 'utf8')
      }
    }
    if (existsSync(dest) && readFileSync(dest).equals(contents)) {
      console.log(`[vendor] ✓ ${label} (already exists)`)
      continue
    }
    writeFileSync(dest, contents)
    console.log(`[vendor] ✓ ${label} (copied from node_modules)`)
  }

  // @ricky0123/vad-web resolves the AudioWorklet relative to baseAssetPath.
  // MicVAD uses startOnLoad:false in Nexus, so a missing worklet is only exposed
  // when listening starts. Always refresh this lockfile-pinned runtime asset so
  // an old public/vendor cache cannot silently force legacy recording.
  const vadWorkletSource = join(root, 'node_modules', '@ricky0123', 'vad-web', 'dist', 'vad.worklet.bundle.min.js')
  const vadWorkletDest = join(vadDir, 'vad.worklet.bundle.min.js')
  if (!existsSync(vadWorkletSource)) {
    throw new Error(`[vendor] required VAD worklet source not found: ${vadWorkletSource}`)
  }
  copyFileSync(vadWorkletSource, vadWorkletDest)
  console.log('[vendor] ✓ vad/vad.worklet.bundle.min.js (refreshed from node_modules)')

  // ONNX Runtime WASM + mjs bundles. Two consumers share public/vendor/ort:
  //   - vad-web (top-level onnxruntime-web, via onnxWASMBasePath)
  //   - @huggingface/transformers (nested onnxruntime-web under the package)
  // The asyncify pair must come from the version transformers.js resolves,
  // because that is the JS/WASM glue it loads when wasmPaths points here.
  const ortSrcDir = join(root, 'node_modules', 'onnxruntime-web', 'dist')
  if (existsSync(ortSrcDir)) {
    copyOrtFiles(
      ortSrcDir,
      ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs'],
      'ort/ runtime',
    )
  } else {
    console.warn('[vendor] ✗ onnxruntime-web not installed — Silero VAD will fall back to legacy recording')
  }

  const transformersOrtSrcDir = resolveTransformersOrtDist()
  if (transformersOrtSrcDir && existsSync(transformersOrtSrcDir)) {
    copyOrtFiles(
      transformersOrtSrcDir,
      ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm'],
      'ort/ transformers asyncify runtime',
    )
  } else {
    console.warn('[vendor] ✗ @huggingface/transformers onnxruntime-web dist not found — local embeddings may fall back to the CDN')
  }

  // Download Cubism Core from the official CDN and pin its exact bytes.
  const cubismDest = join(vendorDir, CUBISM_FILE_LABEL)
  if (existsSync(cubismDest)) {
    if (!verifyExistingCubismCore(cubismDest)) {
      process.exitCode = 1
      return
    }
    return
  }

  console.log(`[vendor] Downloading ${CUBISM_FILE_LABEL} ...`)
  const tempPath = `${cubismDest}.${process.pid}.${Date.now()}.tmp`
  try {
    await downloadHttpsFile(cubismUrl, tempPath)
    assertCubismCoreContents(readFileSync(tempPath), CUBISM_FILE_LABEL)
    renameSync(tempPath, cubismDest)
  } catch (error) {
    try {
      unlinkSync(tempPath)
    } catch {
      // A missing temp file is fine; the download already failed.
    }
    if (error instanceof VendorIntegrityError) {
      console.error(error.message)
    } else {
      console.error(`[vendor] ✗ ${CUBISM_FILE_LABEL} download failed: ${error instanceof Error ? error.message : String(error)}`)
    }
    process.exitCode = 1
    return
  }
  console.log(`[vendor] ✓ ${CUBISM_FILE_LABEL} (downloaded, SHA-256 ${CUBISM_CORE_SHA256})`)
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null
if (invokedPath && resolve(fileURLToPath(import.meta.url)) === invokedPath) {
  main().catch((error) => {
    console.error(`[vendor] ✗ ${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
