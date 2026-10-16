/**
 * Speech tuning sliders are shown only for the controls the selected
 * provider sends. Hidden controls stay at their stored values.
 */

export type SpeechAdjustmentSupport = {
  rate: boolean
  pitch: boolean
  volume: boolean
}

export function visibleSpeechAdjustments(support: SpeechAdjustmentSupport) {
  const rate = support.rate === true
  const pitch = support.pitch === true
  const volume = support.volume === true
  return {
    rate,
    pitch,
    volume,
    any: rate || pitch || volume,
  }
}
