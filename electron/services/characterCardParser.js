import { readFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_CHUNK_LENGTH = 50 * 1024 * 1024 // 50 MB — generous for embedded card data
const MAX_INFLATE_OUTPUT = 20 * 1024 * 1024 // 20 MB

/**
 * @param {Buffer} buffer
 * @returns {string | null}
 */
function extractCharaFromPng(buffer) {
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Not a valid PNG file.')
  }

  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    if (length > MAX_CHUNK_LENGTH) break
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    const dataStart = offset + 8
    const dataEnd = dataStart + length

    if (dataEnd > buffer.length) break

    if (type === 'tEXt' || type === 'zTXt') {
      const nullIndex = buffer.indexOf(0x00, dataStart, /** @type {any} */ (dataEnd))
      if (nullIndex < 0) { offset = dataEnd + 4; continue }

      const keyword = buffer.toString('ascii', dataStart, nullIndex)
      if (keyword === 'chara' || keyword === 'ccv3') {
        let textData
        if (type === 'zTXt') {
          const compressed = buffer.subarray(nullIndex + 2, dataEnd)
          textData = inflateSync(compressed, { maxOutputLength: MAX_INFLATE_OUTPUT }).toString('utf8')
        } else {
          textData = buffer.toString('utf8', nullIndex + 1, dataEnd)
        }
        return Buffer.from(textData, 'base64').toString('utf8')
      }
    }

    // next chunk: data + 4 bytes CRC
    offset = dataEnd + 4
  }

  return null
}

/**
 * @param {any} raw
 * @returns {{ spec: any, data: any }}
 */
function validateCardData(raw) {
  if (!raw || typeof raw !== 'object') {
    throw new Error('Invalid character card: not a JSON object.')
  }

  // V2/V3 cards wrap everything under `data`
  const data = raw.data ?? raw
  const name = String(data.name ?? '').trim()
  if (!name) {
    throw new Error('Invalid character card: missing character name.')
  }

  return { spec: raw.spec ?? 'chara_card_v2', data }
}

/**
 * @param {string} filePath
 * @returns {Promise<{ spec: any, data: any }>}
 */
export async function parseCharacterCard(filePath) {
  const ext = String(filePath).toLowerCase()
  let raw

  if (ext.endsWith('.png')) {
    const buffer = await readFile(filePath)
    const jsonText = extractCharaFromPng(buffer)
    if (!jsonText) {
      throw new Error('No character card data found in this PNG file.')
    }
    raw = JSON.parse(jsonText.replace(/^\uFEFF/, ''))
  } else {
    const text = await readFile(filePath, 'utf8')
    raw = JSON.parse(text.replace(/^\uFEFF/, ''))
  }

  return validateCardData(raw)
}
