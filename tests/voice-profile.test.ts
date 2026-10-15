import assert from 'node:assert/strict'
import { test } from 'node:test'

import { collectHardwareFacts } from '../electron/services/hardwareProbe.js'
import { runVoiceBenchmark } from '../electron/services/voiceBenchmark.js'
import {
  applyVoiceSuggestion,
  shouldAlignStockVoiceLanguage,
} from '../src/features/voiceProfile/applyVoiceSuggestion.ts'
import { mapVoiceTier } from '../src/features/voiceProfile/hardwareTier.ts'
import {
  KOKORO_CATALOG_ID,
  KOKORO_TTS_PROVIDER_ID,
  MELO_CATALOG_ID,
  selectVoiceProfile,
} from '../src/features/voiceProfile/selectVoiceProfile.ts'
import {
  migrateVoiceLanguageValue,
  VOICE_LANGUAGES,
} from '../src/features/voiceProfile/voiceLanguages.ts'
import { CURRENT_SETTINGS_SCHEMA_VERSION, migrateSettings } from '../src/lib/settingsMigrations.ts'
import { loadSettings, SETTINGS_STORAGE_KEY } from '../src/lib/storage.ts'
import {
  clampVoiceBudget,
  MAX_VOICE_BENCHMARK_MS,
  normalizeBenchmarkStatus,
  runWithBudget,
} from '../shared/voiceProfileBudget.js'

const GIBIBYTE = 1024 ** 3

const HIGH_HARDWARE = {
  logicalCores: 8,
  totalMemBytes: 16 * GIBIBYTE,
  freeDiskBytes: 4 * GIBIBYTE,
}

const EDGE_VOICE = {
  'zh-CN': 'zh-CN-XiaoxiaoNeural',
  'zh-TW': 'zh-TW-HsiaoChenNeural',
  'en-US': 'en-US-JennyNeural',
  ja: 'ja-JP-NanamiNeural',
  ko: 'ko-KR-SunHiNeural',
} as const

function installStorage(raw: unknown, languages?: string[]) {
  const initial = raw == null
    ? {}
    : { [SETTINGS_STORAGE_KEY]: JSON.stringify(raw) }
  const store = new Map(Object.entries(initial))
  Object.defineProperty(globalThis, 'window', {
    value: {
      localStorage: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, value: string) => { store.set(key, String(value)) },
        removeItem: (key: string) => { store.delete(key) },
        clear: () => { store.clear() },
      },
    },
    configurable: true,
    writable: true,
  })
  Object.defineProperty(globalThis, 'navigator', {
    value: languages ? { languages, language: languages[0] } : undefined,
    configurable: true,
    writable: true,
  })
}

test('voice tier reaches high only when ram, cores, disk, and RTF all qualify', () => {
  assert.equal(mapVoiceTier(HIGH_HARDWARE, { status: 'ok', sttRtf: 0.08 }).tier, 'high')
  assert.equal(mapVoiceTier(HIGH_HARDWARE, { status: 'ok', sttRtf: 0.08 }).threads, 4)
  assert.equal(mapVoiceTier(
    { ...HIGH_HARDWARE, totalMemBytes: 15 * GIBIBYTE },
    { status: 'ok', sttRtf: 0.05 },
  ).tier, 'mid')
  assert.equal(mapVoiceTier(
    { ...HIGH_HARDWARE, freeDiskBytes: 1 * GIBIBYTE },
    { status: 'ok', sttRtf: 0.05 },
  ).tier, 'low')
  assert.equal(mapVoiceTier(
    { ...HIGH_HARDWARE, freeDiskBytes: null },
    { status: 'ok', sttRtf: 0.05 },
  ).tier, 'high')
})

test('voice tier uses mid for enough hardware and caps high when the benchmark was skipped', () => {
  const mid = mapVoiceTier(
    { logicalCores: 4, totalMemBytes: 8 * GIBIBYTE, freeDiskBytes: 1.5 * GIBIBYTE },
    { status: 'ok', sttRtf: 0.25 },
  )
  assert.equal(mid.tier, 'mid')
  assert.equal(mid.threads, 2)
  assert.equal(mapVoiceTier(
    { logicalCores: 8, totalMemBytes: 8 * GIBIBYTE, freeDiskBytes: 2 * GIBIBYTE },
    { status: 'ok', sttRtf: 0.2 },
  ).threads, 4)
  assert.equal(mapVoiceTier(HIGH_HARDWARE, { status: 'skipped', sttRtf: null }).tier, 'mid')
  assert.equal(mapVoiceTier(
    { logicalCores: 3, totalMemBytes: 32 * GIBIBYTE, freeDiskBytes: 10 * GIBIBYTE },
    { status: 'ok', sttRtf: 0.01 },
  ).tier, 'low')
  assert.equal(mapVoiceTier(
    HIGH_HARDWARE,
    { status: 'ok', sttRtf: 0.26 },
  ).tier, 'low')
})

test('a timed-out or failed benchmark forces the low tier', () => {
  assert.equal(mapVoiceTier(HIGH_HARDWARE, { status: 'timeout', sttRtf: null }).tier, 'low')
  assert.equal(mapVoiceTier(HIGH_HARDWARE, { status: 'error', sttRtf: null }).tier, 'low')
  assert.deepEqual(normalizeBenchmarkStatus({ timedOut: true, ok: false, value: null }), {
    status: 'timeout',
    sttRtf: null,
  })
  assert.deepEqual(normalizeBenchmarkStatus({ ok: true, value: { status: 'skipped' } }), {
    status: 'skipped',
    sttRtf: null,
  })
})

test('every supported language gets SenseVoice, with Kokoro or Edge as the speech pick', () => {
  assert.equal(KOKORO_TTS_PROVIDER_ID, null)
  for (const tier of ['low', 'mid', 'high'] as const) {
    const profile = selectVoiceProfile({
      tier,
      threads: tier === 'high' ? 4 : 2,
      reasons: [tier],
      configuredLanguages: [...VOICE_LANGUAGES],
      catalogIds: [KOKORO_CATALOG_ID, 'sensevoice', MELO_CATALOG_ID],
    })
    assert.deepEqual(profile.downloads.map((item) => item.catalogId), ['sensevoice'])
    for (const plan of profile.languages) {
      assert.equal(plan.applied.sttProviderId, 'local-sensevoice')
      assert.equal(plan.applied.sttModel, 'sensevoice-zh-en')
      assert.equal(plan.applied.ttsVoice, EDGE_VOICE[plan.language])
      assert.notEqual(plan.applied.ttsProviderId, 'local-kokoro')
      assert.equal(plan.configured, true)
    }
    const zhTw = profile.languages.find((plan) => plan.language === 'zh-TW')
    const ja = profile.languages.find((plan) => plan.language === 'ja')
    const ko = profile.languages.find((plan) => plan.language === 'ko')
    const zhCn = profile.languages.find((plan) => plan.language === 'zh-CN')
    const en = profile.languages.find((plan) => plan.language === 'en-US')
    assert.equal(zhTw?.preferredTts, 'edge')
    assert.equal(zhTw?.laterEngine, null)
    assert.equal(ja?.preferredTts, 'supertonic')
    assert.equal(ja?.preferredRunnable, false)
    assert.equal(ja?.laterEngine, 'supertonic')
    assert.equal(ja?.applied.ttsProviderId, 'edge-tts')
    assert.equal(ko?.applied.ttsProviderId, 'edge-tts')
    assert.equal(ko?.laterEngine, 'supertonic')
    assert.equal(zhCn?.preferredTts, 'kokoro')
    assert.equal(en?.preferredTts, 'kokoro')
    assert.equal(zhCn?.preferredRunnable, false)
    assert.equal(zhCn?.cloudFallback, tier === 'low')
    assert.equal(en?.cloudFallback, tier === 'low')
    assert.equal(zhCn?.offlineAlternative?.catalogId, tier === 'low' ? undefined : MELO_CATALOG_ID)
    assert.equal(zhCn?.reasons.includes(tier === 'low' ? 'cloud-fallback-local-too-heavy' : 'kokoro-not-wired'), true)
  }
})

test('voice language migration canonicalizes aliases and keeps providers', () => {
  assert.equal(migrateVoiceLanguageValue('ja-JP').value, 'ja')
  assert.equal(migrateVoiceLanguageValue('en').value, 'en-US')
  assert.equal(migrateVoiceLanguageValue('zh-HK').value, 'zh-TW')
  assert.equal(migrateVoiceLanguageValue('fr-FR').value, 'fr-FR')
  assert.equal(migrateVoiceLanguageValue('  ko-KR  ').changed, true)

  const migrated = migrateSettings({
    settingsSchemaVersion: 12,
    speechRecognitionLang: 'ja-JP',
    speechSynthesisLang: 'en',
    speechInputProviderId: 'openai-stt',
    speechOutputProviderId: 'elevenlabs-tts',
    speechOutputVoice: 'custom-voice',
    speechInputFailoverEnabled: false,
  }, 12)
  assert.equal(migrated.speechRecognitionLang, 'ja')
  assert.equal(migrated.speechSynthesisLang, 'en-US')
  assert.equal(migrated.speechInputProviderId, 'openai-stt')
  assert.equal(migrated.speechOutputProviderId, 'elevenlabs-tts')
  assert.equal(migrated.speechOutputVoice, 'custom-voice')
  assert.equal(migrated.speechInputFailoverEnabled, false)
  assert.equal(migrated.settingsSchemaVersion, CURRENT_SETTINGS_SCHEMA_VERSION)

  const unknown = migrateSettings({
    settingsSchemaVersion: 12,
    speechRecognitionLang: 'fr-FR',
  }, 12)
  assert.equal(unknown.speechRecognitionLang, 'fr-FR')
})

test('existing voice language stays put, and a fresh install follows the UI language', () => {
  installStorage({
    settingsSchemaVersion: CURRENT_SETTINGS_SCHEMA_VERSION,
    uiLanguage: 'ja',
    speechRecognitionLang: 'zh-CN',
    speechSynthesisLang: 'zh-CN',
    speechOutputProviderId: 'edge-tts',
    speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
  }, ['ja-JP'])
  const existing = loadSettings()
  assert.equal(existing.uiLanguage, 'ja')
  assert.equal(existing.speechRecognitionLang, 'zh-CN')
  assert.equal(existing.speechSynthesisLang, 'zh-CN')
  assert.equal(existing.speechOutputVoice, 'zh-CN-XiaoxiaoNeural')

  installStorage(null, ['ja-JP'])
  const fresh = loadSettings()
  assert.equal(fresh.uiLanguage, 'ja')
  assert.equal(fresh.speechRecognitionLang, 'ja')
  assert.equal(fresh.speechSynthesisLang, 'ja')
  assert.equal(fresh.speechOutputVoice, 'ja-JP-NanamiNeural')
  assert.equal(fresh.speechInputProviderId, 'local-sensevoice')
  assert.equal(fresh.speechOutputProviderId, 'edge-tts')
})

test('accepting a suggestion does not enable cloud failover', () => {
  installStorage(null, ['zh-CN'])
  const settings = {
    ...loadSettings(),
    speechInputFailoverEnabled: false,
    speechOutputFailoverEnabled: true,
    apiKey: 'keep-me',
    speechOutputProviderId: 'elevenlabs-tts',
    speechOutputVoice: 'custom-voice',
  }
  const plan = selectVoiceProfile({
    tier: 'mid',
    threads: 2,
    reasons: ['hardware-only'],
    configuredLanguages: ['ja'],
  }).languages.find((item) => item.language === 'ja')
  assert.ok(plan)
  const next = applyVoiceSuggestion(settings, plan)
  assert.equal(next.speechRecognitionLang, 'ja')
  assert.equal(next.speechSynthesisLang, 'ja')
  assert.equal(next.speechInputProviderId, 'local-sensevoice')
  assert.equal(next.speechOutputProviderId, 'edge-tts')
  assert.equal(next.speechOutputVoice, 'ja-JP-NanamiNeural')
  assert.equal(next.speechInputFailoverEnabled, false)
  assert.equal(next.speechOutputFailoverEnabled, true)
  assert.equal(next.apiKey, 'keep-me')

  const offline = selectVoiceProfile({
    tier: 'high',
    threads: 4,
    reasons: ['rtf'],
    configuredLanguages: ['zh-CN'],
  }).languages.find((item) => item.language === 'zh-CN')
  assert.ok(offline?.offlineAlternative)
  const local = applyVoiceSuggestion(settings, offline, { useOfflineAlternative: true })
  assert.equal(local.speechOutputProviderId, 'local-tts')
  assert.equal(local.speechInputFailoverEnabled, false)
})

test('stock language alignment only fixes the untouched zh-CN default', () => {
  assert.equal(shouldAlignStockVoiceLanguage({
    uiLanguage: 'ja',
    speechRecognitionLang: 'zh-CN',
    speechSynthesisLang: 'zh-CN',
    speechInputProviderId: 'local-sensevoice',
    speechInputModel: 'sensevoice-zh-en',
    speechOutputProviderId: 'edge-tts',
    speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
  }), true)
  assert.equal(shouldAlignStockVoiceLanguage({
    uiLanguage: 'ja',
    speechRecognitionLang: 'zh-CN',
    speechSynthesisLang: 'zh-CN',
    speechInputProviderId: 'openai-stt',
    speechInputModel: 'gpt-transcribe',
    speechOutputProviderId: 'edge-tts',
    speechOutputVoice: 'zh-CN-XiaoxiaoNeural',
  }), false)
  assert.equal(shouldAlignStockVoiceLanguage({
    uiLanguage: 'ja',
    speechRecognitionLang: 'ja',
    speechSynthesisLang: 'ja',
    speechInputProviderId: 'local-sensevoice',
    speechInputModel: 'sensevoice-zh-en',
    speechOutputProviderId: 'edge-tts',
    speechOutputVoice: 'ja-JP-NanamiNeural',
  }), false)
})

test('voice probe and benchmark budgets resolve on timeout instead of hanging', async () => {
  assert.equal(clampVoiceBudget(60_000, MAX_VOICE_BENCHMARK_MS), MAX_VOICE_BENCHMARK_MS)
  assert.equal(clampVoiceBudget(0, MAX_VOICE_BENCHMARK_MS), MAX_VOICE_BENCHMARK_MS)

  const hung = await runWithBudget(() => new Promise(() => {}), 30, MAX_VOICE_BENCHMARK_MS)
  assert.equal(hung.timedOut, true)
  assert.equal(hung.ok, false)
  assert.equal(hung.errorCode, 'timeout')

  const failed = await runWithBudget(() => Promise.reject(new Error('boom')), 1000, MAX_VOICE_BENCHMARK_MS)
  assert.equal(failed.timedOut, false)
  assert.equal(failed.errorCode, 'task-failed')

  const probe = await collectHardwareFacts({
    os: {
      release: () => 'test',
      availableParallelism: () => 8,
      cpus: () => [{ model: 'Test CPU' }],
      totalmem: () => 16 * GIBIBYTE,
      freemem: () => 8 * GIBIBYTE,
    },
    readDisk: () => new Promise(() => {}),
  }, { budgetMs: 40 })
  assert.equal(probe.timedOut, true)
  assert.equal(probe.ok, false)

  const diskFailed = await collectHardwareFacts({
    os: {
      release: () => 'test',
      availableParallelism: () => 4,
      cpus: () => [{ model: 'Test CPU' }],
      totalmem: () => 8 * GIBIBYTE,
      freemem: () => GIBIBYTE,
    },
    readDisk: async () => { throw new Error('statfs') },
    readGpu: async () => { throw new Error('gpu') },
  }, { budgetMs: 1000 })
  assert.equal(diskFailed.ok, true)
  assert.equal(diskFailed.value?.freeDiskBytes, null)
  assert.equal(diskFailed.value?.logicalCores, 4)

  const benchmark = await runVoiceBenchmark({
    budgetMs: 40,
    measure: () => new Promise(() => {}),
  })
  assert.equal(benchmark.timedOut, true)
})
