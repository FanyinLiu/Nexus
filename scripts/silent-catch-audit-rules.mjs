#!/usr/bin/env node

// Scope for the silent-catch audit. Keep this list explicit: the audit is a
// review gate for the voice, model-download, and update pipelines, not a
// repository-wide style checker. Directories are walked recursively for
// .ts/.tsx/.js/.mjs sources; single files cover modules that live outside
// those directories.

export const SCOPED_SECTIONS = [
  {
    id: 'voice',
    label: 'Voice capture, ASR/STT, TTS, VAD, wake word, backchannel, and audio IPC',
    directories: [
      'src/features/voice',
      'src/features/hearing',
      'src/features/voiceProfile',
      'src/hooks/voice',
    ],
    files: [
      'src/hooks/useVoice.ts',
      'src/hooks/useVoiceProfileProbe.ts',
      'electron/services/sttService.js',
      'electron/services/tencentAsr.js',
      'electron/services/sherpaSenseVoice.js',
      'electron/services/sherpaParaformer.js',
      'electron/services/sherpaVad.js',
      'electron/services/voiceSidecarHost.js',
      'electron/services/voiceSidecarService.js',
      'electron/services/qwen3TtsPayload.js',
      'electron/services/qwen3TtsRuntime.js',
      'electron/services/localTts.js',
      'electron/services/edgeTts.js',
      'electron/services/ttsService.js',
      'electron/services/ttsProviders.js',
      'electron/services/ttsHelpers.js',
      'electron/services/ttsSeed.js',
      'electron/services/ttsStreamService.js',
      'electron/services/ttsStreamTiming.js',
      'electron/services/ttsVolcengine.js',
      'electron/services/voiceBenchmark.js',
      'electron/services/voiceBenchmarkWorker.js',
      'electron/services/audioPostprocess.js',
      'electron/services/audioEncoding.js',
      'electron/ipc/audioIpc.js',
      'electron/ipc/ttsStreamIpc.js',
      'electron/ipc/voicePayloadSchemas.js',
      'electron/ipc/voiceProfileIpc.js',
      'electron/ipc/voiceRuntimeIpc.js',
    ],
  },
  {
    id: 'model-download',
    label: 'Model downloader, manager, setup, download security, and renderer download UI',
    directories: [
      'src/features/setup',
    ],
    files: [
      'electron/services/modelDownloader.js',
      'electron/services/modelManager.js',
      'electron/services/modelDownloadSecurity.js',
      'electron/services/modelDefinitions.js',
      'electron/services/modelPaths.js',
      'electron/services/modelSetupDeferralStore.js',
      'electron/services/modelSetupRequestGate.js',
      'src/components/SenseVoiceDownloadOffer.tsx',
      'src/components/settingsDrawerHooks/useSpeechVoiceManagement.ts',
      'src/features/settingsV3/LocalVoiceModelsPanel.tsx',
      'src/features/onboarding/components/guideSteps/VoiceStep.tsx',
      'src/features/onboarding/voiceModelReadiness.ts',
      'src/lib/modelSetupBridge.ts',
    ],
  },
  {
    id: 'updater',
    label: 'Updater service, install preparation, update policy, and renderer update hooks',
    directories: [
      'src/features/updater',
    ],
    files: [
      'electron/services/updaterService.js',
      'electron/services/updateInstallPrep.js',
      'electron/services/updatePolicy.js',
      'electron/services/updateInstallQuitFlag.js',
      'electron/ipc/updaterIpc.js',
      'src/components/settingsSimple/AboutSimplePage.tsx',
      'src/features/settingsV3/AboutPanel.tsx',
      'src/features/settingsV3/ConsoleSectionV3.tsx',
    ],
  },
]
