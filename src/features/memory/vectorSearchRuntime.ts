type FeatureExtractor = (input: string, options?: Record<string, unknown>) => Promise<unknown>

/**
 * Object shape transformers.js accepts for `env.backends.onnx.wasm.wasmPaths`.
 * It uses the asyncify build on Chromium/Electron and the plain build on
 * Safari, so the two files must be selected together.
 */
export type LocalOnnxWasmPaths = {
  mjs: string
  wasm: string
}

type TransformersEnvLike = {
  backends?: {
    onnx?: {
      wasm?: {
        wasmPaths?: LocalOnnxWasmPaths | string
      }
    }
  }
}

let activeModel = ''
let featureExtractorPromise: Promise<FeatureExtractor> | null = null

/**
 * Build the local ORT WASM paths served from `public/vendor/ort`.
 * transformers.js defaults `wasmPaths` to the jsDelivr CDN; the packaged app
 * must load the runtime from its own origin so memory embeddings work offline.
 */
export function resolveLocalOnnxWasmPaths(baseUrl: string, isSafari = false): LocalOnnxWasmPaths {
  const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
  const variant = isSafari
    ? 'ort-wasm-simd-threaded'
    : 'ort-wasm-simd-threaded.asyncify'
  return {
    mjs: `${normalizedBase}vendor/ort/${variant}.mjs`,
    wasm: `${normalizedBase}vendor/ort/${variant}.wasm`,
  }
}

/** Resolve the app's public base URL (works in the renderer and in tests). */
function resolvePublicBaseUrl() {
  const basePath = import.meta.env?.BASE_URL ?? '/'
  const currentHref = typeof window !== 'undefined'
    ? window.location.href
    : 'http://localhost/'
  return new URL(basePath, currentHref).toString()
}

function isSafariUserAgent(userAgent: string) {
  return /safari/i.test(userAgent) && !/chrome|chromium|crios|fxios|edgios/i.test(userAgent)
}

/**
 * Point transformers.js at the vendored ORT runtime before any pipeline
 * session is created. Returns false when the expected env shape is absent so
 * callers can keep working with the library default instead of crashing.
 */
export function configureLocalTransformersOnnxRuntime(
  env: unknown,
  baseUrl: string,
  userAgent = typeof navigator !== 'undefined' ? navigator.userAgent : '',
) {
  const wasm = (env as TransformersEnvLike | null | undefined)?.backends?.onnx?.wasm
  if (!wasm) return false
  wasm.wasmPaths = resolveLocalOnnxWasmPaths(baseUrl, isSafariUserAgent(userAgent))
  return true
}

function normalizeVector(values: ArrayLike<number>) {
  const raw = Array.from(values, (value) => Number(value) || 0)
  const magnitude = Math.hypot(...raw)

  if (!magnitude) {
    return raw
  }

  return raw.map((value) => value / magnitude)
}

function extractTensorData(output: unknown): number[] {
  if (Array.isArray(output)) {
    const flattened = output.flat(Number.POSITIVE_INFINITY) as Array<unknown>
    return normalizeVector(flattened.map((value) => Number(value) || 0))
  }

  if (
    output
    && typeof output === 'object'
    && 'data' in output
    && output.data
    && typeof output.data === 'object'
    && 'length' in output.data
  ) {
    return normalizeVector(output.data as ArrayLike<number>)
  }

  return []
}

async function getFeatureExtractor(model: string) {
  if (!featureExtractorPromise || activeModel !== model) {
    activeModel = model
    featureExtractorPromise = import('@huggingface/transformers')
      .then((module) => {
        configureLocalTransformersOnnxRuntime(module.env, resolvePublicBaseUrl())
        const createPipeline = module.pipeline as unknown as (
          task: string,
          requestedModel: string,
        ) => Promise<FeatureExtractor>

        return createPipeline('feature-extraction', model)
      })
  }

  return featureExtractorPromise
}

export async function warmupRemoteMemoryVectorModel(model: string) {
  await getFeatureExtractor(model)
}

export async function embedRemoteMemorySearchText(text: string, model: string) {
  const extractor = await getFeatureExtractor(model)
  const output = await extractor(text, {
    pooling: 'mean',
    normalize: true,
  })

  return extractTensorData(output)
}
