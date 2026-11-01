/**
 * Remove cleared memory text from Chromium's on-disk storage logs.
 *
 * localStorage and IndexedDB are LevelDB. A later write does not erase the
 * previous value: it stays in the append-only `.log` (and sometimes a table
 * file) until compaction. Scanning those files is the only way a clear can
 * promise the original text is gone.
 *
 * Valid logs are rewritten record-by-record so checksums still match and
 * unrelated records stay readable. Anything that is not a LevelDB log is
 * wiped in place, byte for byte, so the text is not left in a table file.
 */

import { readdir, readFile, rename, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { expandMemoryResidueNeedles } from '../../shared/memoryResidue.js'

const BLOCK_SIZE = 32_768
const HEADER_SIZE = 7
const MAX_SCRUB_BYTES = 80 * 1024 * 1024
const STORAGE_DIR = /\/(?:Local Storage|IndexedDB|Session Storage|WebStorage)\//

const CRC32C_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let crc = n
    for (let k = 0; k < 8; k += 1) {
      crc = (crc & 1) ? (0x82f63b78 ^ (crc >>> 1)) : (crc >>> 1)
    }
    table[n] = crc >>> 0
  }
  return table
})()

/**
 * Castagnoli CRC32C of `bytes`. The check value for "123456789" is 0xe3069283.
 * @param {Uint8Array} bytes
 * @returns {number}
 */
export function crc32cChecksum(bytes) {
  return crc32cExtend(0, bytes)
}

/**
 * @param {number} crc
 * @param {Uint8Array} bytes
 * @returns {number}
 */
function crc32cExtend(crc, bytes) {
  let next = (crc ^ 0xffffffff) >>> 0
  for (let i = 0; i < bytes.length; i += 1) {
    next = CRC32C_TABLE[(next ^ bytes[i]) & 0xff] ^ (next >>> 8)
  }
  return (next ^ 0xffffffff) >>> 0
}

/**
 * LevelDB masks the record checksum so a run of zero bytes is not a valid header.
 * @param {number} crc
 * @returns {number}
 */
function maskCrc(crc) {
  return ((((crc >>> 15) | (crc << 17)) >>> 0) + 0xa282ead8) >>> 0
}

/**
 * @param {number} type
 * @param {Uint8Array} payload
 * @returns {number}
 */
function recordCrc(type, payload) {
  return crc32cExtend(crc32cExtend(0, Buffer.from([type])), payload)
}

/**
 * @param {readonly Buffer[]} payloads
 * @returns {Buffer}
 */
export function encodeLevelDbLog(payloads) {
  /** @type {Buffer[]} */
  const pieces = []
  let cursor = 0
  const append = (/** @type {Buffer} */ buf) => {
    pieces.push(buf)
    cursor += buf.length
  }
  for (const payload of payloads) {
    if (!payload?.length) continue
    let pos = 0
    let begin = true
    while (pos < payload.length) {
      const leftover = BLOCK_SIZE - (cursor % BLOCK_SIZE)
      if (leftover < HEADER_SIZE) append(Buffer.alloc(leftover))
      const avail = BLOCK_SIZE - (cursor % BLOCK_SIZE) - HEADER_SIZE
      const length = Math.min(avail, payload.length - pos)
      const end = pos + length >= payload.length
      const type = begin && end ? 1 : begin ? 2 : end ? 4 : 3
      const slice = payload.subarray(pos, pos + length)
      const header = Buffer.alloc(HEADER_SIZE)
      header.writeUInt32LE(maskCrc(recordCrc(type, slice)), 0)
      header.writeUInt16LE(length, 4)
      header[6] = type
      append(header)
      append(Buffer.from(slice))
      pos += length
      begin = false
    }
  }
  return pieces.length ? Buffer.concat(pieces) : Buffer.alloc(0)
}

/**
 * Logical record payloads from a LevelDB write-ahead log.
 * Returns null when `buffer` is not a log (the caller wipes bytes instead).
 * @param {Buffer} buffer
 * @returns {Buffer[] | null}
 */
export function readLevelDbLogPayloads(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return []
  /** @type {Buffer[]} */
  const logical = []
  /** @type {Buffer[]} */
  let fragments = []
  let offset = 0
  let sawRecord = false
  while (offset + HEADER_SIZE <= buffer.length) {
    const leftover = BLOCK_SIZE - (offset % BLOCK_SIZE)
    if (leftover < HEADER_SIZE) {
      offset += leftover
      continue
    }
    const length = buffer.readUInt16LE(offset + 4)
    const type = buffer[offset + 6]
    if (length === 0 && type === 0 && buffer.readUInt32LE(offset) === 0) {
      offset += leftover
      continue
    }
    if (type < 1 || type > 4 || offset + HEADER_SIZE + length > buffer.length) {
      return sawRecord ? logical : null
    }
    const payload = buffer.subarray(offset + HEADER_SIZE, offset + HEADER_SIZE + length)
    const actual = buffer.readUInt32LE(offset)
    if (actual !== maskCrc(recordCrc(type, payload))) return sawRecord ? logical : null
    sawRecord = true
    if (type === 1) {
      fragments = []
      logical.push(Buffer.from(payload))
    } else if (type === 2) {
      fragments = [Buffer.from(payload)]
    } else if (type === 3 || type === 4) {
      if (!fragments.length) return sawRecord ? logical : null
      fragments.push(Buffer.from(payload))
      if (type === 4) {
        logical.push(Buffer.concat(fragments))
        fragments = []
      }
    }
    offset += HEADER_SIZE + length
  }
  return sawRecord ? logical : null
}

/**
 * @param {Buffer} buffer
 * @param {readonly Buffer[]} needles
 * @returns {boolean}
 */
function containsAny(buffer, needles) {
  return needles.some((needle) => needle.length > 0 && buffer.includes(needle))
}

/**
 * @param {readonly string[]} needles
 * @returns {Buffer[]}
 */
function needleBytes(needles) {
  /** @type {Buffer[]} */
  const out = []
  for (const needle of needles) {
    const utf8 = Buffer.from(needle, 'utf8')
    const utf16 = Buffer.from(needle, 'utf16le')
    if (utf8.length) out.push(utf8)
    if (utf16.length && !utf16.equals(utf8)) out.push(utf16)
  }
  return out
}

/**
 * @param {Buffer} buffer
 * @param {readonly Buffer[]} needles
 * @returns {Buffer}
 */
function wipeNeedles(buffer, needles) {
  const next = Buffer.from(buffer)
  for (const needle of needles) {
    let index = next.indexOf(needle)
    while (index !== -1) {
      next.fill(0, index, index + needle.length)
      index = next.indexOf(needle, index + needle.length)
    }
  }
  return next
}

/**
 * @param {Buffer} buffer
 * @param {readonly Buffer[]} needles
 * @returns {Buffer}
 */
function scrubBuffer(buffer, needles) {
  if (!containsAny(buffer, needles)) return buffer
  const payloads = readLevelDbLogPayloads(buffer)
  if (!payloads) return wipeNeedles(buffer, needles)
  const kept = payloads.filter((payload) => !containsAny(payload, needles))
  const rewritten = encodeLevelDbLog(kept)
  return containsAny(rewritten, needles) ? wipeNeedles(rewritten, needles) : rewritten
}

/**
 * @param {string} file
 * @returns {boolean}
 */
function isChromiumStorageLog(file) {
  const normalized = `/${file.split(path.sep).join('/')}/`
  if (!STORAGE_DIR.test(normalized)) return false
  const base = path.basename(file)
  return base.endsWith('.log') || base.endsWith('.ldb') || base === 'LOG' || base === 'LOG.old'
}

/**
 * @param {string} dir
 * @param {string[]} out
 */
async function collectFiles(dir, out) {
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) await collectFiles(full, out)
    else if (entry.isFile()) out.push(full)
  }
}

/**
 * Rewrite Chromium storage logs under `userDataPath` so none of `needles`
 * remain. Missing directories are a no-op. One unreadable file does not
 * stop the rest.
 * @param {string} userDataPath
 * @param {readonly string[]} needles
 * @returns {Promise<{ filesRewritten: number }>}
 */
export async function scrubChromiumStorageResidue(userDataPath, needles) {
  const phrases = expandMemoryResidueNeedles(needles)
  const encoded = needleBytes(phrases)
  if (!userDataPath || !encoded.length) return { filesRewritten: 0 }
  /** @type {string[]} */
  const files = []
  await collectFiles(userDataPath, files)
  let filesRewritten = 0
  for (const file of files) {
    if (!isChromiumStorageLog(file)) continue
    try {
      const info = await stat(file)
      if (!info.isFile() || info.size === 0 || info.size > MAX_SCRUB_BYTES) continue
      const original = await readFile(file)
      const next = scrubBuffer(original, encoded)
      if (next.equals(original)) continue
      const temporary = `${file}.scrubbing`
      await writeFile(temporary, next)
      await rename(temporary, file)
      filesRewritten += 1
    } catch {
      // A locked or unreadable log is left for the next clear. The live
      // store was already emptied by the caller.
    }
  }
  return { filesRewritten }
}
