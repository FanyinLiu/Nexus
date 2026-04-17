/**
 * Sherpa-onnx keyword spotter (KWS) service for always-on wake word detection.
 *
 * The app can now switch between:
 * - English built-in keywords via the GigaSpeech KWS model
 * - Dynamic Chinese wake words via the WenetSpeech KWS model
 */

import path from 'node:path'
import fs from 'node:fs'
import { app } from 'electron'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

let sherpa = null
try {
  sherpa = require('sherpa-onnx-node')
} catch {
  console.warn('[SherpaKWS] sherpa-onnx-node is not installed or failed to load.')
}

let toPinyin = null
try {
  ;({ pinyin: toPinyin } = require('pinyin-pro'))
} catch {
  console.warn('[SherpaKWS] pinyin-pro is not installed or failed to load.')
}

const SAMPLE_RATE = 16000
const ENGLISH_KWS_DIRNAME = 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01'
const CHINESE_KWS_DIRNAME = 'sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01'
const ENGLISH_CUSTOM_KEYWORDS_FILE = 'keywords.nexus-en.txt'
const CHINESE_CUSTOM_KEYWORDS_FILE = 'keywords.nexus-zh.txt'
const CJK_CHAR_REGEX = /[\u3400-\u9fff]/
const SPACE_REGEX = /\s+/g

function getModelsDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'sherpa-models')
    : path.join(app.getAppPath(), 'sherpa-models')
}

function normalizeWakeWord(value) {
  return String(value ?? '').trim()
}

function containsCjkCharacters(value) {
  return CJK_CHAR_REGEX.test(value)
}

function pickModelFile(kwsDir, prefix) {
  if (!fs.existsSync(kwsDir)) return null

  const preferredNames = [
    `${prefix}-epoch-12-avg-2-chunk-16-left-64.onnx`,
    `${prefix}-epoch-99-avg-1-chunk-16-left-64.onnx`,
  ]

  for (const name of preferredNames) {
    const candidate = path.join(kwsDir, name)
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  const matches = fs.readdirSync(kwsDir)
    .filter((name) => (
      name.startsWith(`${prefix}-`)
      && name.endsWith('.onnx')
      && !name.endsWith('.int8.onnx')
    ))
    .sort((left, right) => right.localeCompare(left))

  if (!matches.length) return null

  return path.join(kwsDir, matches[0])
}

function resolveModelFiles(kwsDir) {
  const encoder = pickModelFile(kwsDir, 'encoder')
  const decoder = pickModelFile(kwsDir, 'decoder')
  const joiner = pickModelFile(kwsDir, 'joiner')
  const tokens = path.join(kwsDir, 'tokens.txt')

  if (!encoder || !decoder || !joiner || !fs.existsSync(tokens)) {
    return null
  }

  return { encoder, decoder, joiner, tokens }
}

function buildEnglishKeywordMap(kwsDir) {
  const rawFile = path.join(kwsDir, 'keywords_raw.txt')
  const encodedFile = path.join(kwsDir, 'keywords.txt')
  if (!fs.existsSync(rawFile) || !fs.existsSync(encodedFile)) return null

  const rawLines = fs.readFileSync(rawFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const encodedLines = fs.readFileSync(encodedFile, 'utf8')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const entries = new Map()
  const count = Math.min(rawLines.length, encodedLines.length)

  for (let index = 0; index < count; index += 1) {
    const raw = rawLines[index]
    const encoded = encodedLines[index]
    entries.set(raw.replace(SPACE_REGEX, ' ').toUpperCase(), { raw, encoded })
  }

  return entries
}

function ensureEnglishKeywordsFileAllowlist(kwsDir, wakeWord) {
  const normalized = normalizeWakeWord(wakeWord).replace(SPACE_REGEX, ' ').toUpperCase()
  const keywords = buildEnglishKeywordMap(kwsDir)
  const matched = keywords?.get(normalized)
  if (!matched) return null

  const targetFile = path.join(kwsDir, ENGLISH_CUSTOM_KEYWORDS_FILE)
  fs.writeFileSync(targetFile, `${matched.encoded} @${normalizeWakeWord(wakeWord)}\n`, 'utf8')

  return {
    keywordsFile: targetFile,
    label: normalizeWakeWord(wakeWord),
  }
}

let _lastEnglishRawKeywordFileContent = ''

// Write a raw-text English keywords file and let sherpa-onnx's C++ BPE
// encoder tokenize at load time via modelingUnit='bpe' + bpeVocab. This
// unlocks arbitrary custom English wake words (e.g. "HEY NEXUS") instead
// of the fixed 9-keyword allowlist baked into keywords_raw.txt.
function ensureEnglishRawKeywordsFile(kwsDir, wakeWord) {
  const label = normalizeWakeWord(wakeWord)
  const normalized = label.replace(SPACE_REGEX, ' ').toUpperCase()
  if (!normalized) return null

  const targetFile = path.join(kwsDir, ENGLISH_CUSTOM_KEYWORDS_FILE)
  const content = `${normalized} @${label}\n`

  if (content !== _lastEnglishRawKeywordFileContent) {
    fs.writeFileSync(targetFile, content, 'utf8')
    _lastEnglishRawKeywordFileContent = content
  }

  return {
    keywordsFile: targetFile,
    label,
  }
}

function extractChineseCharacters(value) {
  return Array.from(normalizeWakeWord(value)).filter((char) => CJK_CHAR_REGEX.test(char)).join('')
}

/**
 * Load the token vocabulary from a model's tokens.txt file.
 * Returns a Set of valid token strings.
 */
let _cachedTokenVocab = null
let _cachedTokenVocabPath = ''

function loadTokenVocabulary(tokensFile) {
  if (_cachedTokenVocab && _cachedTokenVocabPath === tokensFile) {
    return _cachedTokenVocab
  }

  try {
    const content = fs.readFileSync(tokensFile, 'utf8')
    const vocab = new Set()
    for (const line of content.split(/\r?\n/)) {
      const token = line.replace(/\s+\d+\s*$/, '').trim()
      if (token && !token.startsWith('<') && !token.startsWith('#')) {
        vocab.add(token)
      }
    }
    _cachedTokenVocab = vocab
    _cachedTokenVocabPath = tokensFile
    return vocab
  } catch {
    return null
  }
}

/**
 * Normalize a pinyin token to match the model's vocabulary.
 * pinyin-pro may produce ü-based tokens (e.g. üé) while the model expects
 * u-based tokens (e.g. ué), or vice versa.
 */
function normalizeTokenForVocab(token, vocab) {
  if (!vocab || vocab.has(token)) return token

  // Try swapping ü ↔ u variants
  const withU = token.replace(/ü/g, 'u')
  if (withU !== token && vocab.has(withU)) return withU

  const withUmlaut = token.replace(/u/g, 'ü')
  if (withUmlaut !== token && vocab.has(withUmlaut)) return withUmlaut

  // Token not found in vocabulary — return as-is and let sherpa handle it
  console.warn(`[SherpaKWS] Token "${token}" not found in model vocabulary`)
  return token
}

function buildChineseKeywordTokenString(wakeWord, tokensFile) {
  if (!toPinyin) return null

  const characters = extractChineseCharacters(wakeWord)
  if (!characters) return null

  const initials = toPinyin(characters, {
    toneType: 'none',
    pattern: 'initial',
    type: 'array',
  })
  const finals = toPinyin(characters, {
    toneType: 'symbol',
    pattern: 'final',
    type: 'array',
  })

  if (!Array.isArray(initials) || !Array.isArray(finals) || initials.length !== finals.length) {
    return null
  }

  const vocab = tokensFile ? loadTokenVocabulary(tokensFile) : null

  const tokens = []
  for (let index = 0; index < initials.length; index += 1) {
    const initial = String(initials[index] ?? '').trim()
    const final = String(finals[index] ?? '').trim()

    if (initial) tokens.push(normalizeTokenForVocab(initial, vocab))
    if (final) {
      tokens.push(normalizeTokenForVocab(final, vocab))
      continue
    }

    return null
  }

  return tokens.join(' ')
}

let _lastKeywordFileContent = ''

function ensureChineseKeywordsFile(kwsDir, wakeWord) {
  const label = normalizeWakeWord(wakeWord)
  const tokensFile = path.join(kwsDir, 'tokens.txt')
  const tokenString = buildChineseKeywordTokenString(label, tokensFile)
  if (!tokenString) return null

  const targetFile = path.join(kwsDir, CHINESE_CUSTOM_KEYWORDS_FILE)
  const content = `${tokenString} @${label}\n`

  if (content !== _lastKeywordFileContent) {
    fs.writeFileSync(targetFile, content, 'utf8')
    _lastKeywordFileContent = content
  }

  return {
    keywordsFile: targetFile,
    label,
  }
}

function resolveKwsRuntime(options = {}) {
  const wakeWord = normalizeWakeWord(options.wakeWord)
  if (!wakeWord) {
    return {
      config: null,
      reason: '未设置唤醒词。',
      modelKind: null,
    }
  }

  const modelsDir = getModelsDir()
  if (containsCjkCharacters(wakeWord)) {
    const kwsDir = path.join(modelsDir, CHINESE_KWS_DIRNAME)
    const modelFiles = resolveModelFiles(kwsDir)
    if (!modelFiles) {
      return {
        config: null,
        reason: `未找到中文唤醒词模型目录：${kwsDir}`,
        modelKind: 'zh',
      }
    }

    const keywordConfig = ensureChineseKeywordsFile(kwsDir, wakeWord)
    if (!keywordConfig) {
      return {
        config: null,
        reason: '中文唤醒词转换失败，请改成纯中文词语，例如“星绘”或“小爱同学”。',
        modelKind: 'zh',
      }
    }

    return {
      config: {
        ...modelFiles,
        keywordsFile: keywordConfig.keywordsFile,
        cacheKey: `zh:${extractChineseCharacters(wakeWord)}`,
        modelKind: 'zh',
        wakeWord: keywordConfig.label,
      },
      reason: '',
      modelKind: 'zh',
    }
  }

  const kwsDir = path.join(modelsDir, ENGLISH_KWS_DIRNAME)
  const modelFiles = resolveModelFiles(kwsDir)
  if (!modelFiles) {
    return {
      config: null,
      reason: `未找到英文唤醒词模型目录：${kwsDir}。请把唤醒词改成中文（例如「星绘」「小爱同学」）。`,
      modelKind: 'en',
    }
  }

  // Prefer runtime BPE encoding when bpe.model ships with the KWS model —
  // that lets any English wake word work, not just the 9 allowlist entries.
  const bpeVocab = path.join(kwsDir, 'bpe.model')
  const useRuntimeBpe = fs.existsSync(bpeVocab)

  const keywordConfig = useRuntimeBpe
    ? ensureEnglishRawKeywordsFile(kwsDir, wakeWord)
    : ensureEnglishKeywordsFileAllowlist(kwsDir, wakeWord)

  if (!keywordConfig) {
    return {
      config: null,
      reason: useRuntimeBpe
        ? '英文唤醒词解析失败，请检查是否包含 BPE 词表无法识别的字符。'
        : '自定义英文唤醒词暂不支持。请改成中文唤醒词，或使用内置词：HELLO WORLD / HI GOOGLE / HEY SIRI / ALEXA / LOVE AND PEACE / PLAY MUSIC / GO HOME / HAPPY NEW YEAR / MERRY CHRISTMAS。',
      modelKind: 'en',
    }
  }

  return {
    config: {
      ...modelFiles,
      keywordsFile: keywordConfig.keywordsFile,
      bpeVocab: useRuntimeBpe ? bpeVocab : '',
      modelingUnit: useRuntimeBpe ? 'bpe' : '',
      cacheKey: `en${useRuntimeBpe ? '-bpe' : ''}:${wakeWord.replace(SPACE_REGEX, ' ').toUpperCase()}`,
      modelKind: 'en',
      wakeWord: keywordConfig.label,
    },
    reason: '',
    modelKind: 'en',
  }
}

class SherpaKwsService {
  constructor() {
    this.spotter = null
    this.stream = null
    this.initialized = false
    this.active = false
    this.runtimeCacheKey = ''
    this.runtimeConfig = null
    this._feedCallCount = 0
    this._feedRmsAccum = 0
    this._feedPeakAccum = 0
  }

  isAvailable(options = {}) {
    return sherpa !== null && resolveKwsRuntime(options).config !== null
  }

  getStatus(options = {}) {
    const runtime = resolveKwsRuntime(options)
    return {
      installed: sherpa !== null,
      modelFound: runtime.config !== null,
      modelsDir: getModelsDir(),
      active: this.active,
      reason: runtime.reason,
      modelKind: runtime.modelKind,
    }
  }

  init(options = {}) {
    if (!sherpa || !sherpa.KeywordSpotter) {
      console.error('[SherpaKWS] sherpa-onnx-node KeywordSpotter not available')
      return false
    }

    const runtime = resolveKwsRuntime(options)
    const modelConfig = runtime.config
    if (!modelConfig) {
      console.error('[SherpaKWS] Unable to resolve KWS runtime config:', runtime.reason)
      return false
    }

    if (this.initialized && this.runtimeCacheKey === modelConfig.cacheKey && this.spotter) {
      return true
    }

    this.destroy()

    try {
      const modelConfigPayload = {
        transducer: {
          encoder: modelConfig.encoder,
          decoder: modelConfig.decoder,
          joiner: modelConfig.joiner,
        },
        tokens: modelConfig.tokens,
        provider: 'cpu',
        numThreads: 1,
      }

      // Only pass modelingUnit/bpeVocab when runtime BPE encoding is active
      // (custom English wake words). Passing them as empty strings in the
      // Chinese path breaks sherpa-onnx init — it treats them as "BPE requested
      // but vocab missing" and the spotter fails to load.
      if (modelConfig.modelingUnit && modelConfig.bpeVocab) {
        modelConfigPayload.modelingUnit = modelConfig.modelingUnit
        modelConfigPayload.bpeVocab = modelConfig.bpeVocab
      }

      // Threshold/score tuned for short Chinese wake words (2 chars): the
      // default 0.25/1.0 is too strict for "星绘" and similar — acoustic
      // evidence is thin, so loosen the threshold and boost the keyword path.
      this.spotter = new sherpa.KeywordSpotter({
        featConfig: {
          sampleRate: SAMPLE_RATE,
          featureDim: 80,
        },
        modelConfig: modelConfigPayload,
        keywordsFile: modelConfig.keywordsFile,
        keywordsThreshold: 0.15,
        keywordsScore: 2.0,
        maxActivePaths: 4,
        numTrailingBlanks: 2,
      })

      this.initialized = true
      this.runtimeCacheKey = modelConfig.cacheKey
      this.runtimeConfig = modelConfig
      console.info('[SherpaKWS] KeywordSpotter initialized', {
        modelKind: modelConfig.modelKind,
        wakeWord: modelConfig.wakeWord,
      })
      return true
    } catch (error) {
      console.error('[SherpaKWS] Failed to initialize:', error)
      return false
    }
  }

  start(options = {}) {
    if (!this.init(options)) return false

    this.stream = this.spotter.createStream()
    this.active = true
    console.info('[SherpaKWS] Listening started', {
      modelKind: this.runtimeConfig?.modelKind,
      wakeWord: this.runtimeConfig?.wakeWord,
    })
    return true
  }

  /**
   * Feed audio samples and check for keyword detection.
   * @returns {{ keyword: string | null }}
   */
  feed(samples, sampleRate = SAMPLE_RATE) {
    if (!this.stream || !this.spotter || !this.active) return { keyword: null }

    // Sanity log: compute RMS/peak across the chunk and emit a rolling
    // summary roughly every ~6 seconds (50 chunks @ 2048/16000Hz). Lets us
    // tell whether audio is actually arriving when the listener fails silently.
    let sumSquares = 0
    let peak = 0
    for (let i = 0; i < samples.length; i += 1) {
      const value = samples[i]
      sumSquares += value * value
      const absValue = value < 0 ? -value : value
      if (absValue > peak) peak = absValue
    }
    const rms = samples.length ? Math.sqrt(sumSquares / samples.length) : 0
    this._feedRmsAccum += rms
    if (peak > this._feedPeakAccum) this._feedPeakAccum = peak
    this._feedCallCount += 1
    if (this._feedCallCount >= 50) {
      const avgRms = this._feedRmsAccum / this._feedCallCount
      const peakAccum = this._feedPeakAccum
      const roundedAvgRms = Number(avgRms.toFixed(4))
      const roundedPeak = Number(peakAccum.toFixed(4))
      console.info('[SherpaKWS] Audio flowing', {
        chunks: this._feedCallCount,
        avgRms: roundedAvgRms,
        peak: roundedPeak,
        wakeWord: this.runtimeConfig?.wakeWord,
      })
      // Typical normal speech: peak ~0.1–0.5. Peaks consistently below 0.02
      // mean the wake-engine effectively hears static — the Zipformer can't
      // recover acoustic evidence for the keyword and the user ends up
      // shouting "星绘" repeatedly before one loud-enough pass trips the
      // threshold. Warn loudly so it's obvious this is a mic-gain issue,
      // not a model/threshold bug.
      if (peakAccum < 0.02) {
        this._lowVolumeStreak = (this._lowVolumeStreak || 0) + 1
      } else {
        this._lowVolumeStreak = 0
      }
      if (this._lowVolumeStreak >= 2) {
        console.warn(
          '[SherpaKWS] mic volume too low — wake word may need to be shouted to trigger. '
          + 'Raise the microphone level in Windows Sound settings, move closer to the mic, '
          + 'or enable mic boost on the device.',
          { avgRms: roundedAvgRms, peak: roundedPeak, lowVolumeStreak: this._lowVolumeStreak },
        )
      }
      this._feedCallCount = 0
      this._feedRmsAccum = 0
      this._feedPeakAccum = 0
    }

    this.stream.acceptWaveform({ samples, sampleRate })

    while (this.spotter.isReady(this.stream)) {
      this.spotter.decode(this.stream)
    }

    const result = this.spotter.getResult(this.stream)
    if (result && result.keyword) {
      const keyword = result.keyword.trim().replace(/^\//, '')
      console.info('[SherpaKWS] Keyword detected:', keyword)
      // Rebuild the stream instead of just resetting — spotter.reset()
      // clears the decoder hypothesis but leaves the Zipformer encoder
      // hidden state damaged, which tanks detection sensitivity on the
      // next utterance. Creating a fresh stream restores full sensitivity.
      this.spotter.reset(this.stream)
      this.stream = this.spotter.createStream()
      return { keyword }
    }

    return { keyword: null }
  }

  stop() {
    this.active = false
    this.stream = null
    console.info('[SherpaKWS] Listening stopped')
  }

  destroy() {
    this.stop()
    this.spotter = null
    this.initialized = false
    this.runtimeCacheKey = ''
    this.runtimeConfig = null
  }
}

const sherpaKwsService = new SherpaKwsService()

export default sherpaKwsService
