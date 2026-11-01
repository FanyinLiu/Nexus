import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const SIDECARS = [
  'scripts/qwen3_tts_server.py',
  'scripts/glm_asr_server.py',
  'scripts/omnivoice_server.py',
  'scripts/voice_emotion_bench.py',
]

const COMPILE_SCRIPT = [
  'import py_compile, sys, tempfile',
  'from pathlib import Path',
  'with tempfile.TemporaryDirectory() as directory:',
  '    for index, file_name in enumerate(sys.argv[1:]):',
  '        py_compile.compile(file_name, cfile=str(Path(directory) / f"sidecar-{index}.pyc"), doraise=True)',
].join('\n')

test('changed Python sidecars compile', (t) => {
  const result = spawnSync(
    'python3',
    ['-c', COMPILE_SCRIPT, ...SIDECARS.map((file) => join(ROOT, file))],
    { encoding: 'utf8' },
  )

  if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
    t.skip('python3 is not installed on this machine')
    return
  }

  assert.equal(
    result.status,
    0,
    `py_compile failed:\n${result.stdout ?? ''}\n${result.stderr ?? ''}`,
  )
})
