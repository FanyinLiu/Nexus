/**
 * One ISNet inference per worker. Keeping preprocessing here avoids blocking
 * companion windows; terminating the worker returns the WASM allocation.
 * The parent receives only the cutout plane or a stable failure code.
 */
import fs from 'node:fs/promises'
import { parentPort } from 'node:worker_threads'

import { decodeCutoutMask, prepareCutoutInput } from './cutoutModel.js'

async function runJob(job) {
  let ort
  try {
    ort = await import('onnxruntime-web')
    ort.env.wasm.numThreads = job.threads
    ort.env.wasm.wasmPaths = job.wasmPaths
  } catch {
    return { ok: false, code: 'runtime_unavailable' }
  }
  let session
  try {
    session = await ort.InferenceSession.create(new Uint8Array(await fs.readFile(job.modelPath)))
  } catch {
    return { ok: false, code: 'load_failed' }
  }
  try {
    const input = prepareCutoutInput(job.image)
    const output = await session.run({ img: new ort.Tensor('float32', input.data, input.dims) })
    try {
      return { ok: true, alpha: decodeCutoutMask(output.mask, input) }
    } catch {
      return { ok: false, code: 'invalid_mask' }
    }
  } catch {
    return { ok: false, code: 'analysis_failed' }
  } finally {
    await session.release().catch(() => {})
  }
}

parentPort?.once('message', (job) => {
  runJob(job).then(
    (result) => parentPort.postMessage(result, result.alpha ? [result.alpha.buffer] : []),
    () => parentPort.postMessage({ ok: false, code: 'analysis_failed' }),
  )
})
