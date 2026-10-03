/**
 * isnet-anime cutout for portrait drafts (main process side).
 *
 * Decodes with sharp (EXIF-rotated, embedded ICC profile ignored and alpha
 * dropped, like the spike's Pillow `convert('RGB')`) and hands the RGB raster to the model worker
 * (`engine.cutout`), which squashes it to 1024x1024, runs isnet and resizes
 * the mask to the requested size, both with Pillow-exact Lanczos
 * (`cutoutModel.js`), so the masks match the spike's Python results. Only
 * images larger than CUTOUT_DECODE_LONG_SIDE_PX are pre-shrunk by sharp.
 *
 * Never throws: problems come back as a stable status, which
 * `portraitDraft.js` turns into a rejection (no fallback). Statuses: `ok`, `missing` / `invalid`
 * / `runtime_unavailable` (models or runtime not ready), `load_failed` /
 * `analysis_failed` / `timeout` (worker), `empty` (the mask is nearly all
 * background or all foreground, so it is not trusted).
 */

import sharp from 'sharp'

/** Foreground share bounds (alpha > 127) for a mask to count as a cutout. */
export const CUTOUT_FOREGROUND_RANGE = Object.freeze({ min: 0.01, max: 0.99 })
/** Larger inputs are pre-shrunk (keeps the worker transfer and resize bounded). */
export const CUTOUT_DECODE_LONG_SIDE_PX = 4096

/** @param {{ filePath?: string, buffer?: Buffer }} source */
export async function decodeCutoutInput(source) {
  const input = source.buffer ?? source.filePath
  // `ignoreIcc`: use the stored pixel values like Pillow's `convert('RGB')`,
  // which the spike (and isnet's training pipeline) used.
  const { data, info } = await sharp(input, { failOn: 'error', limitInputPixels: 64_000_000, ignoreIcc: true })
    .rotate()
    .removeAlpha()
    .resize({ width: CUTOUT_DECODE_LONG_SIDE_PX, height: CUTOUT_DECODE_LONG_SIDE_PX, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.channels !== 3) throw new Error('expected RGB')
  return { rgb: new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice(), width: info.width, height: info.height }
}

function foregroundShare(alpha) {
  let count = 0
  for (let i = 0; i < alpha.length; i += 1) if (alpha[i] > 127) count += 1
  return count / Math.max(1, alpha.length)
}

/**
 * @param {{ filePath?: string, buffer?: Buffer }} source
 * @param {{
 *   prepareCutout?: () => Promise<{ status: string }>,
 *   cutout?: (image: { rgb: Uint8Array, width: number, height: number }, output: { width: number, height: number }) => Promise<{ ok: boolean, mask?: Uint8Array, code?: string }>,
 * }} engine
 * @param {{ width: number, height: number }} size output size (the layer working raster)
 * @returns {Promise<{ status: 'ok', alpha: Uint8Array, foreground: number } | { status: string }>}
 */
export async function runPortraitCutout(source, engine, size) {
  if (typeof engine?.prepareCutout !== 'function' || typeof engine.cutout !== 'function') return { status: 'runtime_unavailable' }
  try {
    const prepared = await engine.prepareCutout()
    if (prepared.status !== 'ready') return { status: prepared.status }
    const result = await engine.cutout(await decodeCutoutInput(source), { width: size.width, height: size.height })
    if (!result.ok) return { status: result.code ?? 'analysis_failed' }
    const alpha = result.mask
    if (!(alpha instanceof Uint8Array) || alpha.length !== size.width * size.height) return { status: 'analysis_failed' }
    const foreground = foregroundShare(alpha)
    if (foreground < CUTOUT_FOREGROUND_RANGE.min || foreground > CUTOUT_FOREGROUND_RANGE.max) return { status: 'empty' }
    return { status: 'ok', alpha, foreground: Math.round(foreground * 1000) / 1000 }
  } catch {
    return { status: 'analysis_failed' }
  }
}
