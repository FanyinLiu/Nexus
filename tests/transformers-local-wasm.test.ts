import assert from 'node:assert/strict'
import test from 'node:test'

import {
  configureLocalTransformersOnnxRuntime,
  resolveLocalOnnxWasmPaths,
} from '../src/features/memory/vectorSearchRuntime.ts'

test('transformers ORT wasm paths point at the local vendor directory', () => {
  const paths = resolveLocalOnnxWasmPaths('http://127.0.0.1:47822/')
  assert.deepEqual(paths, {
    mjs: 'http://127.0.0.1:47822/vendor/ort/ort-wasm-simd-threaded.asyncify.mjs',
    wasm: 'http://127.0.0.1:47822/vendor/ort/ort-wasm-simd-threaded.asyncify.wasm',
  })
  assert.ok(paths.mjs.includes('/vendor/ort/'))
  assert.ok(!paths.mjs.includes('cdn.jsdelivr.net'))
  assert.ok(!paths.wasm.includes('cdn.jsdelivr.net'))
})

test('Safari uses the non-asyncify vendored pair', () => {
  const paths = resolveLocalOnnxWasmPaths('https://example.test/app/', true)
  assert.deepEqual(paths, {
    mjs: 'https://example.test/app/vendor/ort/ort-wasm-simd-threaded.mjs',
    wasm: 'https://example.test/app/vendor/ort/ort-wasm-simd-threaded.wasm',
  })
})

test('configureLocalTransformersOnnxRuntime overrides the CDN wasmPaths', () => {
  const env = {
    backends: {
      onnx: {
        wasm: {
          wasmPaths: 'https://cdn.jsdelivr.net/npm/onnxruntime-web/dist/',
        },
      },
    },
  }

  assert.equal(
    configureLocalTransformersOnnxRuntime(env, 'http://localhost:5173/', 'Mozilla/5.0 Chrome/120'),
    true,
  )
  assert.deepEqual(env.backends.onnx.wasm.wasmPaths, {
    mjs: 'http://localhost:5173/vendor/ort/ort-wasm-simd-threaded.asyncify.mjs',
    wasm: 'http://localhost:5173/vendor/ort/ort-wasm-simd-threaded.asyncify.wasm',
  })
})

test('configureLocalTransformersOnnxRuntime reports an unsupported env shape', () => {
  assert.equal(configureLocalTransformersOnnxRuntime({}, 'http://localhost/'), false)
})
