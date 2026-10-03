/**
 * Anime face detector (YOLOv3) + 28-point face landmarks (HRNetV2, flip test
 * baked into the graph): the pre- and post-processing around the two ONNX
 * models, ported from the v0.5 spike's numpy pipeline (round-2 export, matched
 * PyTorch within 0.03 px; round-4 `onnx_pipeline.py` + `afd_np`).
 *
 * Pure functions over an RGB Uint8 raster. The ONNX runtime is injected: a
 * session is anything with `run(feeds) -> Promise<Record<string, Tensor>>`,
 * where a Tensor is `{ data: Float32Array, dims: number[] }`. Model files and
 * lazy loading live in `landmarkModels.js`.
 *
 * Landmark index layout: contour 0-4, brows 5-10, eyes 11-16 / 17-22,
 * nose 23, mouth 24-27. Each keypoint is `[x, y, heatmapConfidence]`.
 */

export const ANIME_FACE_MODEL_SPEC = Object.freeze({
  detectorInputName: 'image',
  detectorOutputNames: ['p32', 'p16', 'p8'],
  detectorSide: 608,
  landmarkInputName: 'crops',
  landmarkOutputName: 'heatmaps',
  landmarkSide: 256,
  keypointCount: 28,
  /** Box enlargement before landmarks (LandmarkDetector._update_pred_box). */
  boxScaleFactor: 1.1,
  /** Crop padding around the (square) face box (bbox_xywh2cs padding). */
  cropPadding: 1.25,
  nmsIou: 0.45,
  maxDetections: 100,
  minObjectness: 0.005,
  minClassScore: 0.05,
  /** DARK ("unbiased") heatmap decoding kernel. */
  heatmapBlurKernel: 11,
})

const ANCHORS = [
  [[116, 90], [156, 198], [373, 326]],
  [[30, 61], [62, 45], [59, 119]],
  [[10, 13], [16, 30], [33, 23]],
]
const STRIDES = [32, 16, 8]
const MEAN = [0.485, 0.456, 0.406]
const STD = [0.229, 0.224, 0.225]

const sigmoid = (value) => 1 / (1 + Math.exp(-value))

/**
 * Bilinear resize of an interleaved Uint8 RGB raster with OpenCV
 * INTER_LINEAR's half-pixel convention (no antialiasing).
 * @returns {Uint8Array}
 */
export function resizeRgbBilinear(rgb, width, height, outWidth, outHeight) {
  const out = new Uint8Array(outWidth * outHeight * 3)
  const scaleX = width / outWidth
  const scaleY = height / outHeight
  for (let y = 0; y < outHeight; y += 1) {
    let sy = (y + 0.5) * scaleY - 0.5
    if (sy < 0) sy = 0
    const y0 = Math.min(Math.floor(sy), height - 1)
    const y1 = Math.min(y0 + 1, height - 1)
    const fy = sy - y0
    for (let x = 0; x < outWidth; x += 1) {
      let sx = (x + 0.5) * scaleX - 0.5
      if (sx < 0) sx = 0
      const x0 = Math.min(Math.floor(sx), width - 1)
      const x1 = Math.min(x0 + 1, width - 1)
      const fx = sx - x0
      for (let c = 0; c < 3; c += 1) {
        const top = rgb[(y0 * width + x0) * 3 + c] * (1 - fx) + rgb[(y0 * width + x1) * 3 + c] * fx
        const bottom = rgb[(y1 * width + x0) * 3 + c] * (1 - fx) + rgb[(y1 * width + x1) * 3 + c] * fx
        out[(y * outWidth + x) * 3 + c] = Math.round(top * (1 - fy) + bottom * fy)
      }
    }
  }
  return out
}

/** Detector input: resize so the long side is 608, scale to [0,1], zero-pad to /32, CHW. */
export function prepareDetectorInput(rgb, width, height) {
  const side = ANIME_FACE_MODEL_SPEC.detectorSide
  const scale = Math.min(side / Math.max(width, height), side / Math.min(width, height))
  const resizedWidth = Math.max(1, Math.floor(width * scale + 0.5))
  const resizedHeight = Math.max(1, Math.floor(height * scale + 0.5))
  const resized = resizeRgbBilinear(rgb, width, height, resizedWidth, resizedHeight)
  const paddedWidth = Math.ceil(resizedWidth / 32) * 32
  const paddedHeight = Math.ceil(resizedHeight / 32) * 32
  const plane = paddedWidth * paddedHeight
  const data = new Float32Array(3 * plane)
  for (let y = 0; y < resizedHeight; y += 1) {
    for (let x = 0; x < resizedWidth; x += 1) {
      const source = (y * resizedWidth + x) * 3
      const target = y * paddedWidth + x
      for (let c = 0; c < 3; c += 1) data[c * plane + target] = resized[source + c] / 255
    }
  }
  return {
    tensor: { data, dims: [1, 3, paddedHeight, paddedWidth] },
    scaleX: resizedWidth / width,
    scaleY: resizedHeight / height,
  }
}

function iou(a, b) {
  const w = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0]))
  const h = Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]))
  const inter = w * h
  const areaA = (a[2] - a[0]) * (a[3] - a[1])
  const areaB = (b[2] - b[0]) * (b[3] - b[1])
  return inter / (areaA + areaB - inter + 1e-9)
}

/** Greedy NMS on `[x0, y0, x1, y1, score]` boxes, highest score first. */
export function nonMaxSuppression(boxes, iouThreshold, maxKeep) {
  const order = boxes.map((_, index) => index).sort((a, b) => boxes[b][4] - boxes[a][4])
  const keep = []
  const removed = new Uint8Array(boxes.length)
  for (const index of order) {
    if (removed[index]) continue
    keep.push(boxes[index])
    if (keep.length >= maxKeep) break
    for (const other of order) {
      if (!removed[other] && other !== index && iou(boxes[index], boxes[other]) > iouThreshold) removed[other] = 1
    }
    removed[index] = 1
  }
  return keep
}

/**
 * Decode the three YOLOv3 heads (strides 32/16/8; 3 anchors x [x, y, w, h,
 * obj, cls]) into image-space boxes, then NMS.
 * @param {Array<{ data: Float32Array, dims: number[] }>} outputs in stride order 32, 16, 8
 */
export function decodeDetections(outputs, scaleX, scaleY) {
  const spec = ANIME_FACE_MODEL_SPEC
  const boxes = []
  outputs.forEach((output, level) => {
    const [, , gridH, gridW] = output.dims
    const plane = gridH * gridW
    const stride = STRIDES[level]
    for (let anchor = 0; anchor < 3; anchor += 1) {
      const [anchorW, anchorH] = ANCHORS[level][anchor]
      for (let gy = 0; gy < gridH; gy += 1) {
        for (let gx = 0; gx < gridW; gx += 1) {
          const at = (channel) => output.data[(anchor * 6 + channel) * plane + gy * gridW + gx]
          const objectness = sigmoid(at(4))
          const classScore = sigmoid(at(5))
          if (objectness < spec.minObjectness || classScore <= spec.minClassScore) continue
          const cx = gx * stride + stride / 2 + (sigmoid(at(0)) - 0.5) * stride
          const cy = gy * stride + stride / 2 + (sigmoid(at(1)) - 0.5) * stride
          const halfW = anchorW * 0.5 * Math.exp(at(2))
          const halfH = anchorH * 0.5 * Math.exp(at(3))
          boxes.push([
            (cx - halfW) / scaleX, (cy - halfH) / scaleY,
            (cx + halfW) / scaleX, (cy + halfH) / scaleY,
            classScore * objectness,
          ])
        }
      }
    }
  })
  return nonMaxSuppression(boxes, spec.nmsIou, spec.maxDetections)
}

/** Enlarge a detector box by the landmark stage's box scale factor (score kept). */
export function enlargeBox(box) {
  const factor = ANIME_FACE_MODEL_SPEC.boxScaleFactor
  const width = (box[2] - box[0] + 1) * factor
  const height = (box[3] - box[1] + 1) * factor
  const cx = (box[0] + box[2]) / 2
  const cy = (box[1] + box[3]) / 2
  return [cx - width / 2, cy - height / 2, cx + width / 2, cy + height / 2, box[4]]
}

/** Square crop centre + scale (in units of 200 px) for a face box (bbox_xywh2cs, aspect 1). */
export function boxToCenterScale(box) {
  const [x0, y0, x1, y1] = box
  let width = x1 - x0
  let height = y1 - y0
  const center = [x0 + width * 0.5, y0 + height * 0.5]
  if (width > height) height = width
  else if (width < height) width = height
  const padding = ANIME_FACE_MODEL_SPEC.cropPadding
  return { center, scale: [(width / 200) * padding, (height / 200) * padding] }
}

/**
 * Landmark input for one face: an axis-aligned affine crop (rotation 0, so
 * a uniform scale + translation, like cv2.warpAffine with a zero border) to
 * 256x256, ImageNet-normalised, CHW. Returns the planes for one batch item.
 */
export function prepareLandmarkCrop(rgb, width, height, center, scale) {
  const side = ANIME_FACE_MODEL_SPEC.landmarkSide
  const pixelsPerUnit = side / (scale[0] * 200)
  const plane = side * side
  const data = new Float32Array(3 * plane)
  for (let v = 0; v < side; v += 1) {
    const sy = (v - side / 2) / pixelsPerUnit + center[1]
    const y0 = Math.floor(sy)
    const fy = sy - y0
    for (let u = 0; u < side; u += 1) {
      const sx = (u - side / 2) / pixelsPerUnit + center[0]
      const x0 = Math.floor(sx)
      const fx = sx - x0
      for (let c = 0; c < 3; c += 1) {
        const sample = (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : rgb[(y * width + x) * 3 + c])
        const value = (sample(x0, y0) * (1 - fx) + sample(x0 + 1, y0) * fx) * (1 - fy)
          + (sample(x0, y0 + 1) * (1 - fx) + sample(x0 + 1, y0 + 1) * fx) * fy
        data[c * plane + v * side + u] = (value / 255 - MEAN[c]) / STD[c]
      }
    }
  }
  return data
}

function gaussianKernel(size) {
  const sigma = 0.3 * ((size - 1) * 0.5 - 1) + 0.8
  const half = (size - 1) / 2
  const kernel = []
  let sum = 0
  for (let i = 0; i < size; i += 1) {
    const value = Math.exp(-((i - half) ** 2) / (2 * sigma * sigma))
    kernel.push(value)
    sum += value
  }
  return kernel.map((value) => value / sum)
}

/** Zero-padded separable Gaussian blur of one heatmap, rescaled to keep its maximum (DARK modulation). */
export function modulateHeatmap(heatmap, width, height, kernelSize) {
  const kernel = gaussianKernel(kernelSize)
  const half = (kernelSize - 1) / 2
  const temp = new Float32Array(width * height)
  const out = new Float32Array(width * height)
  let originalMax = -Infinity
  for (const value of heatmap) if (value > originalMax) originalMax = value
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let acc = 0
      for (let k = -half; k <= half; k += 1) {
        const xx = x + k
        if (xx >= 0 && xx < width) acc += heatmap[y * width + xx] * kernel[k + half]
      }
      temp[y * width + x] = acc
    }
  }
  let blurredMax = -Infinity
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let acc = 0
      for (let k = -half; k <= half; k += 1) {
        const yy = y + k
        if (yy >= 0 && yy < height) acc += temp[yy * width + x] * kernel[k + half]
      }
      out[y * width + x] = acc
      if (acc > blurredMax) blurredMax = acc
    }
  }
  const ratio = blurredMax !== 0 ? originalMax / blurredMax : 0
  for (let i = 0; i < out.length; i += 1) out[i] *= ratio
  return out
}

/**
 * Heatmaps -> image-space keypoints: argmax, DARK sub-pixel refinement
 * (log of the modulated heatmap + second-order Taylor step), then back
 * through the crop transform.
 * @returns {number[][]} `[x, y, confidence]` per keypoint
 */
export function decodeHeatmaps(heatmaps, heatmapW, heatmapH, center, scale) {
  const plane = heatmapW * heatmapH
  const keypoints = []
  const count = heatmaps.length / plane
  for (let k = 0; k < count; k += 1) {
    const raw = heatmaps.subarray(k * plane, (k + 1) * plane)
    let best = 0
    for (let i = 1; i < plane; i += 1) if (raw[i] > raw[best]) best = i
    const maxValue = raw[best]
    let px = maxValue > 0 ? best % heatmapW : -1
    let py = maxValue > 0 ? Math.floor(best / heatmapW) : -1
    const logMap = modulateHeatmap(raw, heatmapW, heatmapH, ANIME_FACE_MODEL_SPEC.heatmapBlurKernel)
    for (let i = 0; i < plane; i += 1) logMap[i] = Math.log(Math.max(logMap[i], 1e-10))
    const ix = Math.trunc(px)
    const iy = Math.trunc(py)
    if (ix > 1 && ix < heatmapW - 2 && iy > 1 && iy < heatmapH - 2) {
      const at = (x, y) => logMap[y * heatmapW + x]
      const dx = 0.5 * (at(ix + 1, iy) - at(ix - 1, iy))
      const dy = 0.5 * (at(ix, iy + 1) - at(ix, iy - 1))
      const dxx = 0.25 * (at(ix + 2, iy) - 2 * at(ix, iy) + at(ix - 2, iy))
      const dxy = 0.25 * (at(ix + 1, iy + 1) - at(ix + 1, iy - 1) - at(ix - 1, iy + 1) + at(ix - 1, iy - 1))
      const dyy = 0.25 * (at(ix, iy + 2) - 2 * at(ix, iy) + at(ix, iy - 2))
      const det = dxx * dyy - dxy * dxy
      if (det !== 0) {
        px += -(dyy * dx - dxy * dy) / det
        py += -(-dxy * dx + dxx * dy) / det
      }
    }
    const scaleW = scale[0] * 200
    const scaleH = scale[1] * 200
    keypoints.push([
      px * (scaleW / heatmapW) + center[0] - scaleW * 0.5,
      py * (scaleH / heatmapH) + center[1] - scaleH * 0.5,
      maxValue,
    ])
  }
  return keypoints
}

/**
 * Detect anime faces and their 28 landmarks.
 * @param {{ rgb: Uint8Array, width: number, height: number }} image interleaved RGB
 * @param {{ detector: { run: Function }, landmarks: { run: Function } }} sessions
 * @returns {Promise<Array<{ bbox: number[], keypoints: number[][] }>>} bbox = enlarged `[x0, y0, x1, y1, score]`
 */
export async function detectAnimeFaces(image, sessions) {
  const spec = ANIME_FACE_MODEL_SPEC
  const { rgb, width, height } = image
  const input = prepareDetectorInput(rgb, width, height)
  const outputs = await sessions.detector.run({ [spec.detectorInputName]: input.tensor })
  const heads = spec.detectorOutputNames.map((name) => outputs[name])
  const boxes = decodeDetections(heads, input.scaleX, input.scaleY).map(enlargeBox)
  if (boxes.length === 0) return []
  const side = spec.landmarkSide
  const plane = 3 * side * side
  const crops = new Float32Array(boxes.length * plane)
  const transforms = boxes.map((box, index) => {
    const transform = boxToCenterScale(box)
    crops.set(prepareLandmarkCrop(rgb, width, height, transform.center, transform.scale), index * plane)
    return transform
  })
  const landmarkOutputs = await sessions.landmarks.run({
    [spec.landmarkInputName]: { data: crops, dims: [boxes.length, 3, side, side] },
  })
  const heatmaps = landmarkOutputs[spec.landmarkOutputName]
  const [, keypointCount, heatmapH, heatmapW] = heatmaps.dims
  const perFace = keypointCount * heatmapH * heatmapW
  return boxes.map((bbox, index) => ({
    bbox,
    keypoints: decodeHeatmaps(
      heatmaps.data.subarray(index * perFace, (index + 1) * perFace),
      heatmapW, heatmapH, transforms[index].center, transforms[index].scale,
    ),
  }))
}
