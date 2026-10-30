/** Smart Turn v3 Whisper log-mel front end (see smartTurnFeatures.js). */

export declare const SMART_TURN_SAMPLE_RATE: 16000
export declare const SMART_TURN_WINDOW_SECONDS: 8
export declare const SMART_TURN_SAMPLE_COUNT: 128000
export declare const SMART_TURN_MEL_BINS: 80
export declare const SMART_TURN_FRAME_COUNT: 800

/**
 * Keep the last 8 seconds of 16 kHz mono audio and zero-pad the front.
 * @param samples PCM samples in [-1, 1] at 16 kHz.
 */
export declare function prepareSmartTurnAudio(
  samples: Float32Array | number[],
): Float32Array

/**
 * Produce Whisper-Tiny input features shaped `[80, 800]` in row-major
 * `[melBin][frame]` order, including Whisper's zero-mean unit-variance
 * waveform normalisation and log-mel scaling.
 * @param samples PCM samples in [-1, 1] at 16 kHz.
 */
export declare function extractSmartTurnFeatures(
  samples: Float32Array | number[],
): Float32Array
