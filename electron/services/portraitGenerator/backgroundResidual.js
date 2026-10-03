/**
 * Post-cutout background check (generation path, opaque images only).
 *
 * Stage A only looks at the image border, so a plain border around a busy
 * interior passes: a faded close-up of the character, scenery or props
 * behind the figure. Once isnet has cut the figure out, everything outside
 * its mask (dilated by 3% of the long side, so the anti-aliased fringe and
 * thin missed strands do not count) should be the plain background.
 *
 * - `offColour`: share of those pixels more than 24 (any RGB channel) from
 *   the dominant background colour.
 * - `textured`: share with a 7 x 7 grey local standard deviation above 6.
 *
 * Either above its limit rejects with `background_not_separable`. When
 * unsure, reject: the limits sit far above clean cutouts (both 0.000 on the
 * acceptance images) and well below a faded background figure (0.24 / 0.09).
 */

export const PORTRAIT_BACKGROUND_RESIDUAL_LIMITS = Object.freeze({
  dilateShare: 0.03,
  colourDelta: 24,
  textureStd: 6,
  maxOffColour: 0.05,
  maxTextured: 0.04,
  /** Less background than this share of the image: nothing to judge. */
  minOutsideShare: 0.02,
})

function dilate(mask, width, height, size) {
  const half = Math.floor(size / 2)
  const tmp = new Uint8Array(mask.length)
  const out = new Uint8Array(mask.length)
  for (let y = 0; y < height; y += 1) {
    let last = -Infinity
    for (let x = 0; x < width + half; x += 1) {
      if (x < width && mask[y * width + x]) last = x
      const cx = x - half
      if (cx >= 0 && cx < width && x - last <= 2 * half) tmp[y * width + cx] = 1
    }
    last = Infinity
    for (let x = width - 1; x >= -half; x -= 1) {
      if (x >= 0 && mask[y * width + x]) last = x
      const cx = x + half
      if (cx >= 0 && cx < width && last - x <= 2 * half) tmp[y * width + cx] = 1
    }
  }
  for (let x = 0; x < width; x += 1) {
    let last = -Infinity
    for (let y = 0; y < height + half; y += 1) {
      if (y < height && tmp[y * width + x]) last = y
      const cy = y - half
      if (cy >= 0 && cy < height && y - last <= 2 * half) out[cy * width + x] = 1
    }
    last = Infinity
    for (let y = height - 1; y >= -half; y -= 1) {
      if (y >= 0 && tmp[y * width + x]) last = y
      const cy = y + half
      if (cy >= 0 && cy < height && last - y <= 2 * half) out[cy * width + x] = 1
    }
  }
  return out
}

/**
 * @param {{ rgb: Uint8Array, width: number, height: number }} raster
 * @param {Uint8Array} mask cutout alpha (0-255), raster size
 * @returns {{ outside: number, offColour: number, textured: number }}
 */
export function backgroundResidualFeatures(raster, mask) {
  const limits = PORTRAIT_BACKGROUND_RESIDUAL_LIMITS
  const { rgb, width, height } = raster
  const n = width * height
  const figure = new Uint8Array(n)
  for (let i = 0; i < n; i += 1) figure[i] = mask[i] > 127 ? 1 : 0
  const size = Math.max(3, Math.floor(limits.dilateShare * Math.max(width, height)) | 1)
  const covered = dilate(figure, width, height, size)

  // grey integral images for the 7 x 7 local standard deviation
  const W = width + 1
  const sum = new Float64Array(W * (height + 1))
  const sq = new Float64Array(W * (height + 1))
  for (let y = 0; y < height; y += 1) {
    let row = 0
    let rowSq = 0
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3
      const grey = (rgb[i] + rgb[i + 1] + rgb[i + 2]) / 3
      row += grey
      rowSq += grey * grey
      sum[(y + 1) * W + x + 1] = sum[y * W + x + 1] + row
      sq[(y + 1) * W + x + 1] = sq[y * W + x + 1] + rowSq
    }
  }
  const bins = new Map()
  let outside = 0
  for (let i = 0; i < n; i += 1) {
    if (covered[i]) continue
    outside += 1
    const key = (rgb[i * 3] >> 3) * 1024 + (rgb[i * 3 + 1] >> 3) * 32 + (rgb[i * 3 + 2] >> 3)
    bins.set(key, (bins.get(key) ?? 0) + 1)
  }
  if (outside < limits.minOutsideShare * n) return { outside: outside / n, offColour: 0, textured: 0 }
  let dominant = -1
  let best = 0
  for (const [key, count] of bins) if (count > best) { best = count; dominant = key }
  let r = 0, g = 0, b = 0, m = 0
  for (let i = 0; i < n; i += 1) {
    if (covered[i]) continue
    const key = (rgb[i * 3] >> 3) * 1024 + (rgb[i * 3 + 1] >> 3) * 32 + (rgb[i * 3 + 2] >> 3)
    if (key !== dominant) continue
    r += rgb[i * 3]; g += rgb[i * 3 + 1]; b += rgb[i * 3 + 2]; m += 1
  }
  const bg = [r / m, g / m, b / m]
  let off = 0
  let textured = 0
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.max(0, y - 3), y1 = Math.min(height, y + 4)
    for (let x = 0; x < width; x += 1) {
      const i = y * width + x
      if (covered[i]) continue
      if (Math.max(Math.abs(rgb[i * 3] - bg[0]), Math.abs(rgb[i * 3 + 1] - bg[1]), Math.abs(rgb[i * 3 + 2] - bg[2])) > limits.colourDelta) off += 1
      const x0 = Math.max(0, x - 3), x1 = Math.min(width, x + 4)
      const area = (x1 - x0) * (y1 - y0)
      const s = sum[y1 * W + x1] - sum[y0 * W + x1] - sum[y1 * W + x0] + sum[y0 * W + x0]
      const s2 = sq[y1 * W + x1] - sq[y0 * W + x1] - sq[y1 * W + x0] + sq[y0 * W + x0]
      const mean = s / area
      if (Math.sqrt(Math.max(0, s2 / area - mean * mean)) > limits.textureStd) textured += 1
    }
  }
  return { outside: outside / n, offColour: off / outside, textured: textured / outside }
}

/** True when the background left outside the cutout is not plain. */
export function isBusyBackgroundResidual(features) {
  const limits = PORTRAIT_BACKGROUND_RESIDUAL_LIMITS
  return features.offColour > limits.maxOffColour || features.textured > limits.maxTextured
}
