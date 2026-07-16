export const LIVE2D_SMOKE_MODEL_IDS = ['mao', 'haru', 'hiyori']
export const LIVE2D_SMOKE_SWITCH_SEQUENCE = ['mao', 'haru', 'hiyori', 'mao']
export const LIVE2D_SMOKE_MAX_FIRST_FRAME_MS = 45_000

export function parseRgbChannels(color) {
  const channels = String(color ?? '').match(/[\d.]+/g)?.slice(0, 3).map(Number)
  return channels?.length === 3 && channels.every(Number.isFinite) ? channels : null
}

function clampByte(value) {
  return Math.max(0, Math.min(255, Math.round(value)))
}

export function parseCssBackgroundColor(color) {
  const cssColor = String(color ?? '').trim()
  if (cssColor.toLowerCase() === 'transparent') {
    return {
      cssColor,
      mode: 'transparent',
      rgba: [0, 0, 0, 0],
      alpha: 0,
    }
  }

  const match = cssColor.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i)
  if (!match) return null

  const channels = match.slice(1, 4).map(Number)
  const alphaValue = match[4] === undefined ? 1 : Number(match[4])
  if (
    channels.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > 255)
    || !Number.isFinite(alphaValue)
    || alphaValue < 0
    || alphaValue > 1
  ) return null

  const alpha = clampByte(alphaValue * 255)
  return {
    cssColor,
    mode: alpha === 0 ? 'transparent' : 'opaque',
    rgba: [...channels.map(clampByte), alpha],
    alpha,
  }
}

export function live2dScreenshotEdgePoints(width, height) {
  return [
    [2, 2],
    [Math.floor(width / 2), 2],
    [width - 3, 2],
    [2, Math.floor(height / 2)],
    [width - 3, Math.floor(height / 2)],
    [2, height - 3],
    [Math.floor(width / 2), height - 3],
    [width - 3, height - 3],
  ]
}

export function evaluateScreenshotEdgeBackground(samples, expectedBackground, tolerance = 24) {
  const legacyRgbOnly = Array.isArray(expectedBackground) && expectedBackground.length === 3
  const parsedExpected = legacyRgbOnly
    ? {
        cssColor: null,
        mode: 'opaque',
        rgba: [...expectedBackground.map(Number), 255],
        alpha: 255,
      }
    : expectedBackground?.mode && Array.isArray(expectedBackground?.rgba)
      ? expectedBackground
      : parseCssBackgroundColor(expectedBackground)
  const normalizedExpected = parsedExpected?.rgba?.slice(0, 3) ?? null
  const normalizedSamples = Array.isArray(samples) ? samples : []
  const invalidExpected = !parsedExpected
    || !normalizedExpected
    || normalizedExpected.some((channel) => !Number.isFinite(channel))
    || !Number.isFinite(parsedExpected.alpha)
  const alphaTolerance = parsedExpected?.mode === 'transparent' ? 2 : 8
  const mismatches = invalidExpected
    ? normalizedSamples.map((sample) => ({ ...sample, reason: 'invalid_expected_background' }))
    : normalizedSamples.flatMap((sample) => {
      const rgb = Array.isArray(sample?.rgb)
        ? sample.rgb
        : Array.isArray(sample?.rgba) ? sample.rgba.slice(0, 3) : null
      const alpha = Number.isFinite(sample?.alpha)
        ? sample.alpha
        : Array.isArray(sample?.rgba) ? sample.rgba[3] : null
      if (!rgb || rgb.length !== 3 || rgb.some((channel) => !Number.isFinite(channel))) {
        return [{ ...sample, reason: 'missing_rgb' }]
      }
      if (!Number.isFinite(alpha) && !legacyRgbOnly) {
        return [{ ...sample, reason: 'missing_alpha' }]
      }
      if (
        Number.isFinite(alpha)
        && Math.abs(alpha - parsedExpected.alpha) > alphaTolerance
      ) {
        return [{
          ...sample,
          reason: parsedExpected.mode === 'transparent'
            ? `transparent_alpha=${alpha}`
          : `opaque_alpha=${alpha}`,
        }]
      }
      if (parsedExpected.mode === 'transparent') return []
      if (rgb.some((channel, index) => (
        !Number.isFinite(channel)
        || Math.abs(channel - normalizedExpected[index]) > tolerance
      ))) {
        return [{ ...sample, reason: 'rgb_mismatch' }]
      }
      return []
    })

  return {
    ok: !invalidExpected && normalizedSamples.length >= 8 && mismatches.length === 0,
    mode: parsedExpected?.mode ?? null,
    expectedRgba: parsedExpected?.rgba ?? null,
    expectedAlpha: parsedExpected?.alpha ?? null,
    expectedRgb: normalizedExpected,
    tolerance,
    alphaTolerance,
    sampleCount: normalizedSamples.length,
    mismatches,
  }
}

function finiteNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string' || !value.trim()) return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export function evaluateLive2DSnapshot(
  snapshot,
  expectedModelId,
  maxFirstFrameMs = LIVE2D_SMOKE_MAX_FIRST_FRAME_MS,
) {
  const errors = []
  const readyMs = finiteNumber(snapshot?.readyMs)
  const firstFrameMs = finiteNumber(snapshot?.firstFrameMs)

  if (snapshot?.phase !== 'first-frame') errors.push(`phase=${snapshot?.phase ?? 'missing'}`)
  if (snapshot?.debugPhase !== 'first-frame') errors.push(`debugPhase=${snapshot?.debugPhase ?? 'missing'}`)
  if (snapshot?.modelId !== expectedModelId) errors.push(`modelId=${snapshot?.modelId ?? 'missing'}`)
  if (snapshot?.shellCount !== 1) errors.push(`shellCount=${snapshot?.shellCount ?? 'missing'}`)
  if (snapshot?.canvasCount !== 1) errors.push(`canvasCount=${snapshot?.canvasCount ?? 'missing'}`)
  if (snapshot?.error !== '0') errors.push(`error=${snapshot?.error ?? 'missing'}`)
  if ((snapshot?.fallbackCount ?? 0) !== 0) errors.push(`fallbackCount=${snapshot?.fallbackCount}`)
  if ((snapshot?.appErrorFallbackCount ?? 0) !== 0) {
    errors.push(`appErrorFallbackCount=${snapshot?.appErrorFallbackCount}`)
  }
  if (!snapshot?.hasDebugApp) errors.push('debugApp=missing')
  if (!snapshot?.hasDebugModel) errors.push('debugModel=missing')
  if ((snapshot?.canvasWidth ?? 0) <= 0 || (snapshot?.canvasHeight ?? 0) <= 0) {
    errors.push(`canvasSize=${snapshot?.canvasWidth ?? 0}x${snapshot?.canvasHeight ?? 0}`)
  }
  if (readyMs === null || readyMs <= 0) errors.push(`readyMs=${snapshot?.readyMs ?? 'missing'}`)
  if (firstFrameMs === null || firstFrameMs <= 0) {
    errors.push(`firstFrameMs=${snapshot?.firstFrameMs ?? 'missing'}`)
  }
  if (readyMs !== null && firstFrameMs !== null && readyMs > firstFrameMs) {
    errors.push(`readyMs>${firstFrameMs}`)
  }
  if (firstFrameMs !== null && firstFrameMs > maxFirstFrameMs) {
    errors.push(`firstFrameMs>${maxFirstFrameMs}`)
  }

  return {
    ok: errors.length === 0,
    errors,
    readyMs,
    firstFrameMs,
  }
}

export function evaluateScreenshotEvidence(evidence, minimumColorBuckets = 8) {
  const errors = []
  if ((evidence?.byteLength ?? 0) <= 1024) errors.push(`byteLength=${evidence?.byteLength ?? 0}`)
  if ((evidence?.width ?? 0) <= 0 || (evidence?.height ?? 0) <= 0) {
    errors.push(`size=${evidence?.width ?? 0}x${evidence?.height ?? 0}`)
  }
  if ((evidence?.live2dWidth ?? 0) <= 0 || (evidence?.live2dHeight ?? 0) <= 0) {
    errors.push(`live2dSize=${evidence?.live2dWidth ?? 0}x${evidence?.live2dHeight ?? 0}`)
  }
  if ((evidence?.colorBucketCount ?? 0) < minimumColorBuckets) {
    errors.push(`colorBucketCount=${evidence?.colorBucketCount ?? 0}`)
  }
  if (!/^[a-f0-9]{64}$/.test(evidence?.sha256 ?? '')) errors.push('sha256=missing')
  if (!/^[a-f0-9]{64}$/.test(evidence?.live2dSha256 ?? '')) errors.push('live2dSha256=missing')

  return { ok: errors.length === 0, errors }
}

export function evaluateModelHashTransitions(records) {
  const errors = []
  for (let index = 1; index < records.length; index += 1) {
    const previous = records[index - 1]
    const current = records[index]
    if (
      previous?.modelId !== current?.modelId
      && previous?.live2dSha256
      && previous.live2dSha256 === current?.live2dSha256
    ) {
      errors.push(`${previous.modelId}->${current.modelId}: identical live2d hash`)
    }
  }
  return { ok: errors.length === 0, errors }
}

export function evaluateBrowserFailureGate(failures) {
  const errors = []
  if (failures?.consoleErrors?.length) errors.push(`consoleErrors=${failures.consoleErrors.length}`)
  if (failures?.pageErrors?.length) errors.push(`pageErrors=${failures.pageErrors.length}`)
  if (failures?.requestFailures?.length) errors.push(`requestFailures=${failures.requestFailures.length}`)
  return { ok: errors.length === 0, errors }
}
