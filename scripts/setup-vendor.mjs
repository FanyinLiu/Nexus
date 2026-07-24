/**
 * setup-vendor.mjs
 * Copies Live2D vendor files from node_modules and downloads Cubism Core.
 * Run automatically via postinstall, or manually: node scripts/setup-vendor.mjs
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createWriteStream } from 'node:fs'
import { get } from 'node:https'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = join(__dirname, '..')
const vendorDir = join(root, 'public', 'vendor')

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

// onnxruntime-web wasm + mjs bundles — browserVad.ts sets
// `onnxWASMBasePath: resolvePublicAssetPath('vendor/ort/')`, so vad-web
// looks for its ORT runtime under public/vendor/ort/. Without this copy
// vad-web falls back to a CJS require() that doesn't work in Vite's ESM
// environment, and the whole Silero VAD path fails with "legacy recording".
const ortSrcDir = join(root, 'node_modules', 'onnxruntime-web', 'dist')
if (existsSync(ortSrcDir)) {
  const ortPatterns = ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs']
  let copied = 0
  let skipped = 0
  for (const file of ortPatterns) {
    const src = join(ortSrcDir, file)
    const dest = join(ortDir, file)
    if (existsSync(dest)) { skipped++; continue }
    if (!existsSync(src)) {
      console.warn(`[vendor] ✗ ort/${file} — source not found`)
      continue
    }
    copyFileSync(src, dest)
    copied++
  }
  if (copied > 0) {
    console.log(`[vendor] ✓ ort/ runtime (${copied} files copied, ${skipped} already present)`)
  } else if (skipped > 0) {
    console.log(`[vendor] ✓ ort/ runtime (${skipped} files, already present)`)
  }
} else {
  console.warn('[vendor] ✗ onnxruntime-web not installed — Silero VAD will fall back to legacy recording')
}

// Download Cubism Core from official CDN
const cubismDest = join(vendorDir, 'live2dcubismcore.min.js')
const cubismUrl = 'https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js'

if (existsSync(cubismDest)) {
  console.log('[vendor] ✓ live2dcubismcore.min.js (already exists)')
} else {
  console.log('[vendor] Downloading live2dcubismcore.min.js ...')
  await new Promise((resolve, reject) => {
    const file = createWriteStream(cubismDest)
    get(cubismUrl, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode}`))
        return
      }
      res.pipe(file)
      file.on('finish', () => file.close(resolve))
    }).on('error', reject)
  })
  console.log('[vendor] ✓ live2dcubismcore.min.js (downloaded)')
}
