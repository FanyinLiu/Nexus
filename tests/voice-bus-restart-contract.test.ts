import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

test('voice lifecycle restart requests go through VoiceBus', async () => {
  const lifecycleSource = await readFile(
    new URL('../src/hooks/voice/voiceLifecycleControls.ts', import.meta.url),
    'utf8',
  )

  assert.equal(lifecycleSource.includes('scheduleVoiceRestart as scheduleContinuousVoiceRestart'), false)
  assert.match(lifecycleSource, /hookCallbacks\.busEmit\(\{\s*type: 'voice:restart_requested'/)
  assert.match(lifecycleSource, /statusText,/)
  assert.match(lifecycleSource, /delayMs: delay/)
})

test('VoiceBus restart effects use the shared restart timer ref', async () => {
  const useVoiceSource = await readFile(
    new URL('../src/hooks/useVoice.ts', import.meta.url),
    'utf8',
  )

  assert.match(useVoiceSource, /restartVoiceTimerRef\.current = window\.setTimeout/)
  assert.match(useVoiceSource, /restartVoiceTimerRef\.current = null/)
  assert.match(useVoiceSource, /if \(restartVoiceTimerRef\.current\)/)
  assert.match(
    useVoiceSource,
    /shouldAutoRestart\(\{\s*continuousActive: continuousVoiceActiveRef\.current/,
  )
})

test('continuousVoice no longer exports the deprecated restart scheduler', async () => {
  const continuousVoiceSource = await readFile(
    new URL('../src/hooks/voice/continuousVoice.ts', import.meta.url),
    'utf8',
  )

  assert.equal(continuousVoiceSource.includes('export function scheduleVoiceRestart'), false)
})
