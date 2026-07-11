/**
 * Shared model catalog for Nexus.
 *
 * Consumed by:
 *  - electron/services/modelManager.js  (runtime in-app downloader)
 *  - electron/services/modelPaths.js    (runtime path resolution)
 *  - scripts/download-models.mjs        (dev-time CLI downloader)
 *
 * This file has no Electron / Node-only imports beyond what works in both
 * contexts so it can be loaded from renderer-side code too if needed later.
 *
 * Fields:
 *   id            stable identifier used by UI / IPC
 *   label         user-visible name (Chinese ok)
 *   sizeLabel     human-readable download size estimate
 *   required      true → app features depend on this model
 *   kind          'archive' (tar.bz2) | 'files' (hf resolve/main) | 'standalone'
 *   directory     subdir name under sherpa-models/ (archive / files)
 *   checkFile     path (relative to directory) whose presence means "installed"
 *   githubArchive tar.bz2 URL (kind === 'archive')
 *   hfRepo / revision / files pinned Hugging Face source (kind === 'files')
 *   integrity     exact byte size + SHA-256 for every remote archive/file
 *   standalone    { dest, urls[], integrity } (kind === 'standalone')
 *   purpose       short one-line description for UI
 */

export const MODEL_CATALOG = [
  {
    id: 'kws-en',
    label: '英文唤醒词模型',
    sizeLabel: '~15 MB',
    required: true,
    kind: 'archive',
    directory: 'sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01',
    checkFile: 'encoder-epoch-12-avg-2-chunk-16-left-64.onnx',
    githubArchive: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2',
    integrity: {
      archive: {
        sizeBytes: 17626723,
        sha256: 'f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a',
      },
    },
    purpose: '让你用 "Hey Nexus" 等英文短语唤醒助手',
  },
  {
    id: 'kws-zh',
    label: '中文唤醒词模型',
    sizeLabel: '~32 MB',
    required: true,
    kind: 'archive',
    directory: 'sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01',
    checkFile: 'encoder-epoch-99-avg-1-chunk-16-left-64.onnx',
    githubArchive: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-wenetspeech-3.3M-2024-01-01.tar.bz2',
    integrity: {
      archive: {
        sizeBytes: 32654866,
        sha256: 'b2f7c89690dc8ce4c6ed6afeab7cd800c36ad1421fb6b6302b4a4b194cf7f35f',
      },
    },
    purpose: '让你用 "星绘"、"小爱同学" 等中文短语唤醒助手',
  },
  {
    id: 'sensevoice',
    label: 'SenseVoice 离线语音识别',
    sizeLabel: '~1.0 GB',
    required: true,
    kind: 'archive',
    directory: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
    checkFile: 'model.int8.onnx',
    githubArchive: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2',
    integrity: {
      archive: {
        sizeBytes: 1047870769,
        sha256: 'f6b2a72ebcb1ac7a764d4cfccd886e6bcb2a95c4657c2199d0ba95ed4b9ea71a',
      },
    },
    purpose: '多语言语音转文字，默认 STT 引擎',
  },
  {
    id: 'vad',
    label: 'Silero VAD v5（语音端点检测）',
    sizeLabel: '~2 MB',
    required: true,
    kind: 'standalone',
    checkFile: 'silero_vad_v5.onnx',
    standalone: {
      // In-app downloads land under userData/sherpa-models/.
      // Runtime code also probes legacy bundled locations via modelPaths.js.
      dest: 'silero_vad_v5.onnx',
      urls: [
        'https://huggingface.co/onnx-community/silero-vad/resolve/e71cae966052b992a7eca6b17738916ce0eca4ec/onnx/model.onnx',
      ],
      integrity: {
        sizeBytes: 2243022,
        sha256: 'a4a068cd6cf1ea8355b84327595838ca748ec29a25bc91fc82e6c299ccdc5808',
      },
    },
    purpose: '判断用户开始/结束说话，给 SenseVoice 切段',
  },
  {
    id: 'paraformer-zh-en',
    label: 'Paraformer 流式中英识别（可选）',
    sizeLabel: '~240 MB',
    required: false,
    kind: 'files',
    directory: 'sherpa-onnx-streaming-paraformer-bilingual-zh-en',
    checkFile: 'encoder.int8.onnx',
    hfRepo: 'csukuangfj/sherpa-onnx-streaming-paraformer-bilingual-zh-en',
    revision: '8e40c43232a1c5c66c82111efc5820d3accca11b',
    files: ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt'],
    integrity: {
      files: {
        'encoder.int8.onnx': {
          sizeBytes: 165462184,
          sha256: '81a70226a8934e6ed92aa1d4fc486b428b5398e2f2619ed4897b7294cab90e9a',
        },
        'decoder.int8.onnx': {
          sizeBytes: 71664561,
          sha256: 'f3cca9f77bb9d93c8fcbfb63ae617b6b1ee96818df3aa3b151c40658fe38594f',
        },
        'tokens.txt': {
          sizeBytes: 75756,
          sha256: '59aba8873a2ed1e122c25fee421e25f283b63290efbde85c1f01a853d83cb6e6',
        },
      },
    },
    purpose: '边说边出字幕的流式 ASR；不装也能用默认的 SenseVoice',
  },
  {
    id: 'tts-melo-zh-en',
    label: '本地语音合成 MeloTTS 中英（可选）',
    sizeLabel: '~165 MB',
    required: false,
    kind: 'archive',
    directory: 'vits-melo-tts-zh_en',
    checkFile: 'model.onnx',
    githubArchive: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-melo-tts-zh_en.tar.bz2',
    integrity: {
      archive: {
        sizeBytes: 167006755,
        sha256: 'e58351ed7149f290a54534538badd4077cdbe6fddc964b24d0bee870415d1514',
      },
    },
    purpose: '免费离线语音合成（语音输出选「本地 TTS」时使用），无需 API Key',
  },
]

export const REQUIRED_MODEL_IDS = MODEL_CATALOG.filter(m => m.required).map(m => m.id)
