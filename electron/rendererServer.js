import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { isLoopbackHostHeader } from './services/localServiceSecurity.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const rendererServerHost = '127.0.0.1'
const rendererServerPreferredPort = 47822

let rendererServer = null
let rendererServerUrl = null
let rendererServerStartupPromise = null

let _isDev = false
let _useDevServer = false
let _devServerUrl = 'http://127.0.0.1:47821'
let _getImportedPetModelsRoot = () => ''
let _isPathInsideRoot = () => false
let _importedPetModelsRoute = '/__imported_live2d__'

export function initRendererServer({
  isDev,
  useDevServer,
  devServerUrl,
  getPanelSection,
  getImportedPetModelsRoot,
  isPathInsideRoot,
  importedPetModelsRoute,
}) {
  _isDev = isDev
  _useDevServer = useDevServer
  _devServerUrl = devServerUrl
  _getPanelSection = getPanelSection
  _getImportedPetModelsRoot = getImportedPetModelsRoot
  _isPathInsideRoot = isPathInsideRoot
  _importedPetModelsRoute = importedPetModelsRoute
}

let _getPanelSection = () => 'chat'

export function getPreloadPath() {
  return path.join(__dirname, 'preload.js')
}

function getRendererUrl() {
  if (_isDev && _useDevServer) {
    return _devServerUrl
  }

  return rendererServerUrl ?? `file://${path.join(__dirname, '..', 'dist', 'index.html')}`
}

export function getRendererEntry(view) {
  const url = new URL(getRendererUrl())
  url.searchParams.set('view', view)

  if (view === 'panel') {
    url.searchParams.set('section', _getPanelSection())
  }

  return url.toString()
}

function getRendererContentType(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
    case '.mjs':
    case '.cjs':
      return 'application/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.gif':
      return 'image/gif'
    case '.json':
    case '.map':
      return 'application/json; charset=utf-8'
    case '.png':
      return 'image/png'
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg'
    case '.svg':
      return 'image/svg+xml'
    case '.webp':
      return 'image/webp'
    case '.wasm':
      return 'application/wasm'
    case '.onnx':
      return 'application/octet-stream'
    case '.txt':
      return 'text/plain; charset=utf-8'
    case '.moc3':
      return 'application/octet-stream'
    default:
      return 'application/octet-stream'
  }
}

function getAssetAccessControlOrigin(request) {
  const requestOrigin = String(request.headers.origin ?? '').trim()
  const allowedOrigins = new Set([
    rendererServerUrl,
    ...(_isDev && _useDevServer ? [new URL(_devServerUrl).origin] : []),
  ].filter(Boolean))
  return allowedOrigins.has(requestOrigin)
    ? requestOrigin
    : rendererServerUrl || `http://${rendererServerHost}:${rendererServerPreferredPort}`
}

/** The port the asset listener actually owns, for the Host-header check. */
function getRendererServerPort() {
  if (rendererServerUrl) {
    try {
      const port = Number(new URL(rendererServerUrl).port)
      if (Number.isInteger(port) && port > 0) return port
    } catch {
      // silent-catch-ok: fall back to the live server address below
    }
  }
  const address = rendererServer?.address?.()
  return address && typeof address === 'object' ? address.port : null
}

export async function ensureRendererServer() {
  if (rendererServerUrl) {
    return rendererServerUrl
  }

  if (rendererServerStartupPromise) {
    return rendererServerStartupPromise
  }

  const rendererRoot = path.resolve(__dirname, '..', 'dist')
  const importedRoot = _getImportedPetModelsRoot()

  function createRendererServerInstance() {
    return http.createServer(async (request, response) => {
      try {
        // DNS-rebinding pages keep their own hostname in the Host header while
        // connecting to loopback, so only our exact loopback host:port is served.
        if (!isLoopbackHostHeader(request.headers.host, getRendererServerPort())) {
          response.writeHead(403)
          response.end('Forbidden')
          return
        }

        const requestUrl = new URL(request.url ?? '/', `http://${rendererServerHost}`)
        let filePath = ''
        let servedRoot = rendererRoot

        if (requestUrl.pathname.startsWith(`${_importedPetModelsRoute}/`)) {
          const rawImportedPath = decodeURIComponent(
            requestUrl.pathname.slice(_importedPetModelsRoute.length + 1),
          )
          const normalizedImportedPath = path.normalize(rawImportedPath).replace(/^(\.\.(\/|\\|$))+/, '')
          filePath = path.resolve(importedRoot, normalizedImportedPath)
          servedRoot = importedRoot
        } else {
          const rawPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname)
          const normalizedPath = path.normalize(rawPath).replace(/^(\.\.(\/|\\|$))+/, '')
          filePath = path.resolve(rendererRoot, `.${normalizedPath}`)
          servedRoot = rendererRoot
        }

        if (!_isPathInsideRoot(servedRoot, filePath)) {
          response.writeHead(403)
          response.end('Forbidden')
          return
        }

        let realRoot = servedRoot
        try {
          realRoot = await fs.realpath(servedRoot)
          filePath = await fs.realpath(filePath)
        } catch {
          response.writeHead(404)
          response.end('Not Found')
          return
        }

        if (!_isPathInsideRoot(realRoot, filePath)) {
          response.writeHead(403)
          response.end('Forbidden')
          return
        }

        let fileStats
        try {
          fileStats = await fs.stat(filePath)
        } catch {
          response.writeHead(404)
          response.end('Not Found')
          return
        }

        if (fileStats.isDirectory()) {
          const indexPath = path.join(filePath, 'index.html')
          try {
            filePath = await fs.realpath(indexPath)
          } catch {
            response.writeHead(404)
            response.end('Not Found')
            return
          }
          if (!_isPathInsideRoot(realRoot, filePath)) {
            response.writeHead(403)
            response.end('Forbidden')
            return
          }
        }

        const content = await fs.readFile(filePath)
        const isHashedAsset = /[-_.][a-zA-Z0-9]{7,}\.(js|css|wasm)$/.test(filePath)
        const headers = {
          'Access-Control-Allow-Origin': getAssetAccessControlOrigin(request),
          'Cache-Control': isHashedAsset ? 'max-age=31536000, immutable' : 'no-store',
          'Content-Type': getRendererContentType(filePath),
          Vary: 'Origin',
        }
        if (filePath.endsWith('.html')) {
          // `'unsafe-eval'` is required by pixi.js's runtime shader path that
          // the Live2D Cubism SDK relies on. Without it the packaged dmg/exe
          // build renders an empty pet — the dev `index.html` `<meta>` CSP
          // already grants this, which is why the Vite path looked fine
          // while the packaged path silently broke. Defense layers that
          // don't depend on script-src (contextIsolation, sandbox, IPC
          // trusted-sender checks, schema allowlists) all stay in place;
          // this only relaxes script execution within the already-sandboxed
          // renderer. `wasm-unsafe-eval` is kept so the ORT WASM bundles
          // for wakeword / VAD continue to load.
          headers['Content-Security-Policy'] = [
            "default-src 'self'",
            "script-src 'self' 'unsafe-eval' 'wasm-unsafe-eval'",
            "style-src 'self' 'unsafe-inline'",
            "img-src 'self' data: blob:",
            "font-src 'self' data:",
            // PixiJS fetches a tiny data URL once to detect ImageBitmap
            // support before choosing its texture upload path. Everything else
            // is an explicit allowlist: user-configured LLM/speech/Ollama
            // endpoints are proxied through main-process IPC, while the
            // renderer itself only reaches loopback services and Hugging Face
            // model files fetched by transformers.js. The plain-browser
            // preview fallback in src/features/memory/ollamaEmbedding.ts can
            // still fetch a configured Ollama URL directly when the desktop
            // bridge is absent; packaged Electron always uses IPC. Follow-up:
            // move that fallback behind IPC or generate connect-src from the
            // saved endpoints. Keep this in sync with index.html.
            "connect-src 'self' data: blob: http://127.0.0.1:* http://localhost:* ws://127.0.0.1:* ws://localhost:* https://huggingface.co https://*.huggingface.co https://hf.co https://*.hf.co",
            "media-src 'self' blob:",
            "worker-src 'self' blob:",
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
            "frame-ancestors 'none'",
          ].join('; ')
          headers['X-Content-Type-Options'] = 'nosniff'
          headers['X-Frame-Options'] = 'DENY'
        }
        response.writeHead(200, headers)
        response.end(content)
      } catch (error) {
        console.error('[RendererServer] request error:', error)
        response.writeHead(500)
        response.end('Internal Server Error')
      }
    })
  }

  async function listenRendererServer(server, port) {
    await new Promise((resolve, reject) => {
      function handleListening() {
        cleanup()
        resolve(undefined)
      }

      function handleError(error) {
        cleanup()
        reject(error)
      }

      function cleanup() {
        server.off('listening', handleListening)
        server.off('error', handleError)
      }

      server.once('listening', handleListening)
      server.once('error', handleError)
      server.listen(port, rendererServerHost)
    })
  }

  rendererServerStartupPromise = (async () => {
    let lastError = null

    for (const port of [rendererServerPreferredPort, 0]) {
      const nextServer = createRendererServerInstance()

      try {
        await listenRendererServer(nextServer, port)
        rendererServer = nextServer

        const address = rendererServer.address()
        if (!address || typeof address === 'string') {
          throw new Error('Failed to resolve the renderer server address.')
        }

        rendererServerUrl = `http://${rendererServerHost}:${address.port}`
        if (port !== rendererServerPreferredPort) {
          console.warn(
            `[RendererServer] Preferred port ${rendererServerPreferredPort} is unavailable; using ${address.port} instead.`,
          )
        }
        return rendererServerUrl
      } catch (error) {
        lastError = error
        rendererServer = null

        if (error?.code !== 'EADDRINUSE' || port === 0) {
          throw error
        }

        console.warn(
          `[RendererServer] Port ${rendererServerPreferredPort} is already in use; retrying with an ephemeral port.`,
        )
      }
    }

    throw lastError ?? new Error('Failed to start the renderer server.')
  })().finally(() => {
    rendererServerStartupPromise = null
  })

  return rendererServerStartupPromise
}

export function getRendererServerUrl() {
  return rendererServerUrl
}

export function closeRendererServer() {
  rendererServer?.close()
  rendererServer = null
  rendererServerUrl = null
  rendererServerStartupPromise = null
}
