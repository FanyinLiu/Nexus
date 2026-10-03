/**
 * Bounded, path-free preview transport shared by generation and settings.
 * Only a static PNG data URL is accepted: base64, PNG framing and intrinsic
 * dimensions are checked before handing pixels to the image decoder. This
 * never fetches a URL or reads a filesystem path.
 */
export const PORTRAIT_PREVIEW_MAX_BASE64_BYTES = 4 * 1024 * 1024
const PREFIX = 'data:image/png;base64,'
const SIGNATURE = '\x89PNG\r\n\x1a\n'
const BIT_DEPTHS = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }

function readUint32(binary, offset) {
  return (binary.charCodeAt(offset) * 0x1000000 + (binary.charCodeAt(offset + 1) << 16) + (binary.charCodeAt(offset + 2) << 8) + binary.charCodeAt(offset + 3)) >>> 0
}

function hasPngFraming(binary, width, height) {
  if (!binary.startsWith(SIGNATURE) || binary.length < 57) return false
  let offset = 8
  let imageData = false
  let finishedData = false
  let palette = false
  let colourType = null
  while (offset + 12 <= binary.length) {
    const length = readUint32(binary, offset)
    const type = binary.slice(offset + 4, offset + 8)
    const end = offset + 12 + length
    if (end > binary.length || !/^[A-Za-z]{4}$/.test(type)) return false
    if (offset === 8) {
      if (type !== 'IHDR' || length !== 13 || readUint32(binary, 16) !== width || readUint32(binary, 20) !== height) return false
      colourType = binary.charCodeAt(25)
      if (!BIT_DEPTHS[colourType]?.includes(binary.charCodeAt(24)) || binary.charCodeAt(26) !== 0 || binary.charCodeAt(27) !== 0 || binary.charCodeAt(28) > 1) return false
    } else if (type === 'IHDR' || ['acTL', 'fcTL', 'fdAT'].includes(type)) return false
    else if (type === 'PLTE') {
      if (palette || imageData || length < 3 || length > 768 || length % 3) return false
      palette = true
    } else if (type === 'IDAT') {
      if (finishedData || (colourType === 3 && !palette)) return false
      if (length > 0) imageData = true
    } else if (type === 'IEND') return imageData && length === 0 && end === binary.length
    else {
      if (type[0] === type[0].toUpperCase()) return false
      if (imageData) finishedData = true
    }
    offset = end
  }
  return false
}

/** Return only a bounded PNG payload and its verified dimensions, or null. */
export function normalizePortraitPreview(value) {
  try {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const { dataUrl, width, height } = value
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 768 || height > 768) return null
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(PREFIX) || dataUrl.length > PREFIX.length + PORTRAIT_PREVIEW_MAX_BASE64_BYTES) return null
    const encoded = dataUrl.slice(PREFIX.length)
    if (!encoded || encoded.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null
    const binary = atob(encoded)
    if (btoa(binary) !== encoded || !hasPngFraming(binary, width, height)) return null
    return { dataUrl, width, height }
  } catch {
    return null
  }
}
