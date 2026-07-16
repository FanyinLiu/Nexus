// Live2D vendor script loader.  Loads PIXI, Cubism Core, and the
// pixi-live2d-display plugin from /vendor/ as classic <script> tags so they
// expose their globals (window.PIXI, window.Live2DCubismCore, etc.) before
// the canvas tries to instantiate a model.

import { resolveAssetPath } from './types'

type Live2DVendorScript = {
  id: string
  globalReady: () => boolean
  src: string
}

const LIVE2D_VENDOR_SCRIPT_ATTRIBUTE = 'data-nexus-live2d-script'
let live2dVendorScriptsPromise: Promise<void> | null = null

function loadClassicScript(descriptor: Live2DVendorScript) {
  if (descriptor.globalReady()) {
    return Promise.resolve()
  }

  return new Promise<void>((resolve, reject) => {
    const selector = `script[${LIVE2D_VENDOR_SCRIPT_ATTRIBUTE}="${descriptor.id}"]`
    let existingScript = document.querySelector<HTMLScriptElement>(selector)

    if (existingScript?.dataset.failed === 'true') {
      existingScript.remove()
      existingScript = null
    }

    function resolveIfReady() {
      if (!descriptor.globalReady()) {
        reject(new Error(`Live2D vendor script "${descriptor.id}" loaded without exposing the expected runtime.`))
        return
      }

      resolve()
    }

    function rejectWithLoadError(event: Event) {
      const failedScript = event.currentTarget as HTMLScriptElement | null
      if (failedScript) {
        failedScript.dataset.failed = 'true'
        failedScript.remove()
      }
      reject(new Error(`Failed to load Live2D vendor script "${descriptor.id}".`))
    }

    if (existingScript) {
      if (existingScript.dataset.loaded === 'true') {
        resolveIfReady()
        return
      }

      existingScript.addEventListener('load', resolveIfReady, { once: true })
      existingScript.addEventListener('error', rejectWithLoadError, { once: true })
      return
    }

    const script = document.createElement('script')
    script.src = descriptor.src
    script.async = false
    script.dataset.loaded = 'false'
    script.setAttribute(LIVE2D_VENDOR_SCRIPT_ATTRIBUTE, descriptor.id)
    script.addEventListener('load', () => {
      script.dataset.loaded = 'true'
      resolveIfReady()
    }, { once: true })
    script.addEventListener('error', rejectWithLoadError, { once: true })
    document.head.appendChild(script)
  })
}

export function ensureLive2DVendorScripts() {
  if (
    window.PIXI
    && window.Live2DCubismCore
    && window.PIXI.live2d?.Live2DModel
  ) {
    return Promise.resolve()
  }

  if (live2dVendorScriptsPromise) {
    return live2dVendorScriptsPromise
  }

  const descriptors: Live2DVendorScript[] = [
    {
      id: 'pixi-runtime',
      src: resolveAssetPath('vendor/pixi.min.js'),
      globalReady: () => Boolean(window.PIXI),
    },
    {
      id: 'live2d-cubism-core',
      src: resolveAssetPath('vendor/live2dcubismcore.min.js'),
      globalReady: () => Boolean(window.Live2DCubismCore),
    },
    {
      id: 'pixi-live2d-plugin',
      src: resolveAssetPath('vendor/pixi-live2d-display.cubism4.min.js'),
      globalReady: () => Boolean(window.PIXI?.live2d?.Live2DModel),
    },
  ]

  live2dVendorScriptsPromise = (async () => {
    for (const descriptor of descriptors) {
      await loadClassicScript(descriptor)
    }
  })().catch((error) => {
    live2dVendorScriptsPromise = null
    throw error
  })

  return live2dVendorScriptsPromise
}
