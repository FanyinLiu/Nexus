/**
 * Barge-in level through the owner voice lock.
 *
 * The interrupt monitor decides "the user is talking over her" from the RMS
 * of the microphone. With the owner voice lock on, that RMS should be the
 * owner's voice alone, so a TV or a second person cannot cut her off. The
 * isolation runs in the main process; this probe ships each mic frame there
 * in order and reports the level that comes back.
 *
 * The isolator is a streaming model, so frames must arrive in order and
 * without gaps. When the main process falls behind, the probe drops the
 * backlog and starts a fresh stream instead of feeding it a hole.
 */

export type OwnerVoiceLevelApi = (payload: {
  samples: Float32Array
  reset?: boolean
}) => Promise<{ rms: number; isolated: boolean }>

export type OwnerVoiceLevelProbe = {
  push: (samples: Float32Array) => void
  dispose: () => void
}

/** Frames allowed in flight before the probe drops them and resets. */
export const OWNER_VOICE_LEVEL_MAX_BACKLOG = 4

export function rawRms(samples: Float32Array): number {
  if (!samples.length) return 0
  let energy = 0
  for (let i = 0; i < samples.length; i += 1) energy += samples[i] * samples[i]
  return Math.sqrt(energy / samples.length)
}

/**
 * @param api `window.desktopPet.ownerVoiceLevel`
 * @param onLevel receives the owner's RMS, or the raw RMS for a frame the
 *   main process passed through (lock off, model missing, not enrolled)
 */
export function createOwnerVoiceLevelProbe(
  api: OwnerVoiceLevelApi,
  onLevel: (rms: number) => void,
): OwnerVoiceLevelProbe {
  let disposed = false
  let inFlight = 0
  let resetNext = true
  let chain: Promise<void> = Promise.resolve()

  return {
    push(samples) {
      if (disposed || !samples.length) return
      if (inFlight >= OWNER_VOICE_LEVEL_MAX_BACKLOG) {
        resetNext = true
        return
      }
      const frame = new Float32Array(samples)
      const reset = resetNext
      resetNext = false
      inFlight += 1
      chain = chain.then(async () => {
        try {
          if (disposed) return
          const result = await api({ samples: frame, reset })
          if (disposed) return
          onLevel(result?.isolated ? result.rms : rawRms(frame))
        } catch {
          // silent-catch-ok: a failed probe falls back to the raw level for this frame
          if (!disposed) onLevel(rawRms(frame))
        } finally {
          inFlight -= 1
        }
      })
    },
    dispose() {
      disposed = true
    },
  }
}
