export const MAX_CONTINUOUS_NO_SPEECH_RESTARTS = 5
export const API_RECORDING_MAX_DURATION_MS = 8_000
// How long a freshly-opened VAD session waits for the user to start
// speaking before the no-speech timer tears it down. Lowered from 4.8 s
// to 3 s based on user feedback: after the companion finishes TTS the
// assistantReply path auto-restarts VAD once (shouldResumeContinuousVoice
// is true for every voice turn, see useChat.ts), which gives the user a
// follow-up window without having to re-say the wake word. 3 s matches
// the explicit ask "TTS 播完就完了，自动重开 3 秒没有 stt 就关闭"; in
// wake-word-only mode (continuousVoiceModeEnabled = false) the policy
// returns CONTINUOUS_DISABLED on the first destroy so no retry loop runs
// — exactly "one 3-second grace window, then back to wake-word".
export const API_RECORDING_MAX_IDLE_MS = 3_000
export const API_RECORDING_SILENCE_MS = 1_150
export const API_RECORDING_RMS_THRESHOLD = 0.0042
export const SHERPA_STREAM_MAX_IDLE_MS = 9_000
export const SHERPA_STREAM_ACTIVITY_RMS_THRESHOLD = 0.0038
export const SHERPA_STREAM_SILENCE_FINISH_MS = 1_800
export const SHERPA_STREAM_ENDPOINT_FINALIZE_MS = 800
export const SHERPA_STREAM_RISKY_ENDPOINT_FINALIZE_MS = 1200
export const VOICE_TRANSCRIPT_DEDUP_WINDOW_MS = 6_000
export const SPEECH_INTERRUPT_GRACE_MS = 500
export const SPEECH_INTERRUPT_MIN_SPEECH_MS = 320
export const SPEECH_INTERRUPT_RMS_THRESHOLD = 0.05
/**
 * How aggressively the dynamic interrupt threshold scales with the current
 * TTS playback level (0-1 normalized). Threshold = baseline + tts * gain.
 * 0.10 means at peak TTS volume the threshold rises to ~0.15 — comfortably
 * above any residual echo leak after WebRTC AEC, while still letting normal
 * user speech (RMS ~0.10-0.20 from a 30cm mic) trigger an interrupt.
 */
export const SPEECH_INTERRUPT_TTS_LEVEL_GAIN = 0.10
export const SPEECH_INTERRUPT_ANALYSER_FFT_SIZE = 1024
export const MAX_VOICE_TRACE_ENTRIES = 8
export const BROWSER_TTS_LIPSYNC_INTERVAL_MS = 88
export const AUDIO_TTS_ANALYSER_FFT_SIZE = 512
