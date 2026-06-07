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
 *   sizeLabel     human-readable size estimate ("~230 MB")
 *   required      true → app features depend on this model
 *   kind          'archive' (tar.bz2) | 'files' (hf resolve/main) | 'standalone'
 *   directory     subdir name under sherpa-models/ (archive / files)
 *   checkFile     path (relative to directory) whose presence means "installed"
 *   githubArchive tar.bz2 URL (kind === 'archive')
 *   hfRepo / files hf "<owner>/<repo>" + file list (kind === 'files')
 *   standalone    { dest, urls[] } (kind === 'standalone')
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
    purpose: '让你用 "星绘"、"小爱同学" 等中文短语唤醒助手',
  },
  {
    id: 'sensevoice',
    label: 'SenseVoice 离线语音识别',
    sizeLabel: '~230 MB',
    required: true,
    kind: 'archive',
    directory: 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17',
    checkFile: 'model.int8.onnx',
    githubArchive: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17.tar.bz2',
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
        'https://github.com/snakers4/silero-vad/raw/master/src/silero_vad/data/silero_vad.onnx',
        'https://huggingface.co/onnx-community/silero-vad/resolve/main/onnx/model.onnx',
      ],
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
    files: ['encoder.int8.onnx', 'decoder.int8.onnx', 'tokens.txt'],
    purpose: '边说边出字幕的流式 ASR；不装也能用默认的 SenseVoice',
  },
]

export const REQUIRED_MODEL_IDS = MODEL_CATALOG.filter(m => m.required).map(m => m.id)
