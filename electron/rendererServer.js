import http from 'node:http'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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
let _panelSection = 'chat'
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
  _panelSection = null
  _getPanelSection = getPanelSection
  _getImportedPetModelsRoot = getImportedPetModelsRoot
  _isPathInsideRoot = isPathInsideRoot
  _importedPetModelsRoute = importedPetModelsRoute
}

let _getPanelSection = () => 'chat'

export function getPreloadPath() {
  return path.join(__dirname, 'preload.js')
}

export function getRendererUrl() {
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
        const requestUrl = new URL(request.url ?? '/', `http://${rendererServerHost}`)
        let filePath = ''

        if (requestUrl.pathname.startsWith(`${_importedPetModelsRoute}/`)) {
          const rawImportedPath = decodeURIComponent(
            requestUrl.pathname.slice(_importedPetModelsRoute.length + 1),
          )
          const normalizedImportedPath = path.normalize(rawImportedPath).replace(/^(\.\.(\/|\\|$))+/, '')
          filePath = path.resolve(importedRoot, normalizedImportedPath)

          if (!_isPathInsideRoot(importedRoot, filePath)) {
            response.writeHead(403)
            response.end('Forbidden')
            return
          }
        } else {
          const rawPath = decodeURIComponent(requestUrl.pathname === '/' ? '/index.html' : requestUrl.pathname)
          const normalizedPath = path.normalize(rawPath).replace(/^(\.\.(\/|\\|$))+/, '')
          filePath = path.resolve(rendererRoot, `.${normalizedPath}`)

          if (!_isPathInsideRoot(rendererRoot, filePath)) {
            response.writeHead(403)
            response.end('Forbidden')
            return
          }
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
          filePath = path.join(filePath, 'index.html')
        }

        const content = await fs.readFile(filePath)
        const isHashedAsset = /[-_.][a-zA-Z0-9]{7,}\.(js|css|wasm)$/.test(filePath)
        response.writeHead(200, {
          'Access-Control-Allow-Origin': rendererServerUrl || `http://${rendererServerHost}:${rendererServerPreferredPort}`,
          'Cache-Control': isHashedAsset ? 'max-age=31536000, immutable' : 'no-store',
          'Content-Type': getRendererContentType(filePath),
        })
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
