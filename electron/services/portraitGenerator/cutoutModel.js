/**
 * isnet-anime (SkyTNT anime-segmentation, `isnetis.onnx`) cutout core, free
 * of sharp and Electron so it runs inside the worker thread and in tests.
 *
 * Pre/post-processing follows the v0.5 spike (`cutout.py`) exactly:
 * - input: the RGB image squashed to 1024x1024 with Pillow's Lanczos,
 *   divided by its own maximum value, minus the ImageNet mean, std 1, NCHW;
 * - output: the first output's single channel, min-max normalised to 0..1,
 *   truncated to 0..255, and resized back with Pillow's Lanczos.
 */

export const ISNET_INPUT_SIZE = 1024
const MEAN = [0.485, 0.456, 0.406]

// ------------------------------------------------------------ PIL-exact Lanczos

const PRECISION_BITS = 32 - 8 - 2
const LANCZOS_SUPPORT = 3
const sinc = (x) => (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x))
const lanczos = (x) => (x >= -LANCZOS_SUPPORT && x < LANCZOS_SUPPORT ? sinc(x) * sinc(x / LANCZOS_SUPPORT) : 0)

/** Per-output-pixel tap ranges and fixed-point weights (Pillow `precompute_coeffs` + `normalize_coeffs_8bpc`). */
function lanczosCoefficients(inSize, outSize) {
  const scale = inSize / outSize
  const filterScale = Math.max(scale, 1)
  const support = LANCZOS_SUPPORT * filterScale
  const kSize = Math.ceil(support) * 2 + 1
  const bounds = new Int32Array(outSize * 2)
  const weights = new Int32Array(outSize * kSize)
  const pre = new Float64Array(kSize)
  for (let xx = 0; xx < outSize; xx += 1) {
    const center = (xx + 0.5) * scale
    const xmin = Math.max(Math.trunc(center - support + 0.5), 0)
    const count = Math.min(Math.trunc(center + support + 0.5), inSize) - xmin
    let total = 0
    for (let x = 0; x < count; x += 1) {
      const w = lanczos((x + xmin - center + 0.5) / filterScale)
      pre[x] = w
      total += w
    }
    for (let x = 0; x < count; x += 1) {
      const w = total === 0 ? pre[x] : pre[x] / total
      weights[xx * kSize + x] = w < 0 ? Math.trunc(-0.5 + w * (1 << PRECISION_BITS)) : Math.trunc(0.5 + w * (1 << PRECISION_BITS))
    }
    bounds[xx * 2] = xmin
    bounds[xx * 2 + 1] = count
  }
  return { bounds, weights, kSize }
}

const clip8 = (sum) => {
  const v = Math.floor(sum / (1 << PRECISION_BITS))
  return v < 0 ? 0 : v > 255 ? 255 : v
}

/**
 * Resize an interleaved 8-bit raster exactly like Pillow's
 * `Image.resize(size, Image.LANCZOS)`: separable Lanczos-3, horizontal pass
 * then vertical, 22-bit fixed-point weights, uint8 between the passes. The
 * spike's isnet results were produced this way, and isnet is sensitive to the
 * resampler on ambiguous images, so the app uses the same arithmetic.
 *
 * @param {Uint8Array} src
 * @param {number} width
 * @param {number} height
 * @param {number} channels
 * @param {number} outWidth
 * @param {number} outHeight
 */
export function resizeLanczosLikePillow(src, width, height, channels, outWidth, outHeight) {
  const half = 1 << (PRECISION_BITS - 1)
  let current = src
  let curWidth = width
  if (outWidth !== width) {
    const { bounds, weights, kSize } = lanczosCoefficients(width, outWidth)
    const out = new Uint8Array(outWidth * height * channels)
    for (let y = 0; y < height; y += 1) {
      const row = y * width * channels
      for (let xx = 0; xx < outWidth; xx += 1) {
        const xmin = bounds[xx * 2]
        const count = bounds[xx * 2 + 1]
        const k = xx * kSize
        for (let c = 0; c < channels; c += 1) {
          let sum = half
          for (let x = 0; x < count; x += 1) sum += src[row + (x + xmin) * channels + c] * weights[k + x]
          out[(y * outWidth + xx) * channels + c] = clip8(sum)
        }
      }
    }
    current = out
    curWidth = outWidth
  }
  if (outHeight === height) return current === src ? src.slice() : current
  const { bounds, weights, kSize } = lanczosCoefficients(height, outHeight)
  const out = new Uint8Array(curWidth * outHeight * channels)
  const stride = curWidth * channels
  for (let yy = 0; yy < outHeight; yy += 1) {
    const ymin = bounds[yy * 2]
    const count = bounds[yy * 2 + 1]
    const k = yy * kSize
    for (let i = 0; i < stride; i += 1) {
      let sum = half
      for (let y = 0; y < count; y += 1) sum += current[(y + ymin) * stride + i] * weights[k + y]
      out[yy * stride + i] = clip8(sum)
    }
  }
  return out
}

/**
 * @param {Uint8Array} rgb ISNET_INPUT_SIZE^2 interleaved RGB
 * @returns {Float32Array} 1x3xHxW
 */
export function isnetInputTensor(rgb, size = ISNET_INPUT_SIZE) {
  const n = size * size
  if (rgb.length !== n * 3) throw new Error('isnet input must be a square RGB raster of the model size')
  let max = 0
  for (let i = 0; i < rgb.length; i += 1) if (rgb[i] > max) max = rgb[i]
  const scale = 1 / Math.max(max, 1e-6)
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i += 1) {
    for (let c = 0; c < 3; c += 1) out[c * n + i] = rgb[i * 3 + c] * scale - MEAN[c]
  }
  return out
}

/**
 * @param {ArrayLike<number>} data the model's first output (1x1xHxW)
 * @returns {Uint8Array} HxW mask, 0..255
 */
export function isnetMaskFromOutput(data) {
  let min = Infinity
  let max = -Infinity
  for (let i = 0; i < data.length; i += 1) {
    if (data[i] < min) min = data[i]
    if (data[i] > max) max = data[i]
  }
  const range = max - min + 1e-8
  const mask = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i += 1) mask[i] = Math.trunc(((data[i] - min) / range) * 255)
  return mask
}

/**
 * Full cutout as in the spike: squash the RGB image to 1024x1024 (Pillow
 * Lanczos), run isnet, normalise, and resize the mask to `output` (Pillow
 * Lanczos).
 *
 * @param {{ rgb: Uint8Array, width: number, height: number }} image interleaved RGB
 * @param {{ width: number, height: number }} output mask size
 * @param {{ inputNames: readonly string[], outputNames: readonly string[], run: (feeds: object) => Promise<Record<string, { data: Float32Array }>> }} session
 * @param {{ Tensor: new (type: string, data: Float32Array, dims: number[]) => object }} ort
 * @returns {Promise<Uint8Array>} output.width x output.height mask, 0..255
 */
export async function runIsnetCutout(image, output, session, ort) {
  if (image.rgb.length !== image.width * image.height * 3) throw new Error('isnet input must be interleaved RGB')
  const square = resizeLanczosLikePillow(image.rgb, image.width, image.height, 3, ISNET_INPUT_SIZE, ISNET_INPUT_SIZE)
  const input = new ort.Tensor('float32', isnetInputTensor(square), [1, 3, ISNET_INPUT_SIZE, ISNET_INPUT_SIZE])
  const outputs = await session.run({ [session.inputNames[0]]: input })
  const first = outputs[session.outputNames[0]]
  if (!first || first.data.length !== ISNET_INPUT_SIZE * ISNET_INPUT_SIZE) throw new Error('unexpected isnet output')
  const mask = isnetMaskFromOutput(first.data)
  return resizeLanczosLikePillow(mask, ISNET_INPUT_SIZE, ISNET_INPUT_SIZE, 1, output.width, output.height)
}
