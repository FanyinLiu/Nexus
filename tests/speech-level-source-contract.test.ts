import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path: string) => readFile(new URL(`../${path}`, import.meta.url), 'utf8')

test('speech level data flow keeps raw frame consumers off the React parent chain', async () => {
  const [types, publisher, useVoice, continuousVoice, live2d, panel, frameless, petView, panelView] = await Promise.all([
    read('src/types/voice.ts'),
    read('src/hooks/voice/speechLevelPublishing.ts'),
    read('src/hooks/useVoice.ts'),
    read('src/hooks/voice/continuousVoice.ts'),
    read('src/features/pet/components/Live2DCanvas.tsx'),
    read('src/features/uiV2/CompanionPanelV2.tsx'),
    read('src/features/uiV2/FramelessCompanionSurface.tsx'),
    read('src/app/views/LegacyPetView.tsx'),
    read('src/app/views/LegacyPanelView.tsx'),
  ])

  assert.match(types, /export type SpeechLevelSource = \{[\s\S]*readonly current: number[\s\S]*readonly getSnapshot: \(\) => number[\s\S]*readonly subscribe:/)
  assert.match(publisher, /createSpeechLevelPublisher/)
  assert.match(publisher, /useSyncExternalStore\(source\.subscribe, source\.getSnapshot, source\.getSnapshot\)/)
  assert.match(useVoice, /createSpeechLevelPublisher\(\)/)
  assert.match(useVoice, /speechLevelSource,/)
  assert.doesNotMatch(useVoice, /const \[speechLevel,\s*setSpeechLevel\] = useState/)
  assert.doesNotMatch(useVoice, /speechLevel:\s*speechLevelSource\.getSnapshot\(\)/)
  assert.match(continuousVoice, /speechLevelSource\.current/)
  assert.match(live2d, /isSpeakingRef\.current[\s\S]*speechLevelSourceRef\.current\?\.current[\s\S]*:\s*0/)
  assert.doesNotMatch(live2d, /speechLevelSource.*useEffect[\s\S]*?boot/)

  for (const source of [panel, frameless, petView, panelView]) {
    assert.match(source, /speechLevelSource/)
    assert.doesNotMatch(source, /speechLevel=\{voice\.speechLevel\}/)
  }
})

test('explicit termination resets immediately and effect replay cannot dispose the live source', async () => {
  const [bindings, lifecycle, speechReply, runtimeLifecycle, useVoice] = await Promise.all([
    read('src/hooks/voice/voiceBindings.ts'),
    read('src/hooks/voice/voiceLifecycleControls.ts'),
    read('src/hooks/voice/speechReply.ts'),
    read('src/hooks/voice/runtimeLifecycle.ts'),
    read('src/hooks/useVoice.ts'),
  ])

  assert.match(bindings, /function resetSpeechLevel\(\)[\s\S]*speechLevelPublisher\.reset\(\)/)
  assert.match(bindings, /function stopSpeechTracking\(\)[\s\S]*resetSpeechLevel\(\)/)
  assert.match(bindings, /function handleVoiceListeningFailure[\s\S]*resetSpeechLevel\(\)/)
  assert.match(lifecycle, /resetSpeechLevel:\s*bindings\.resetSpeechLevel/)
  assert.match(speechReply, /onEnd:\s*\(\) => \{\s*options\.resetSpeechLevel\(\)/)
  assert.match(speechReply, /onError:\s*\(message: string\) => \{\s*options\.resetSpeechLevel\(\)/)
  assert.doesNotMatch(runtimeLifecycle, /speechLevelPublisher\.dispose\(\)/)
  assert.match(useVoice, /function disposeSpeechLevelPublisherAfterEffectReplay[\s\S]*generationRef\.current === disposeGeneration[\s\S]*publisher\.dispose\(\)/)
  assert.match(useVoice, /disposeSpeechLevelPublisherAfterEffectReplay\([\s\S]*speechLevelPublisherDisposeGenerationRef[\s\S]*disposeGeneration/)
})

test('visual amplitude leaves subscribe to the throttled snapshot only', async () => {
  const [sprite, petView, consoleSection, consoleV3, vts] = await Promise.all([
    read('src/features/pet/components/SpritePetCanvas.tsx'),
    read('src/app/views/LegacyPetView.tsx'),
    read('src/components/settingsSections/ConsoleSection.tsx'),
    read('src/features/settingsV3/ConsoleSectionV3.tsx'),
    read('src/features/pet/vts/useVTSBridge.ts'),
  ])

  assert.match(sprite, /useSpeechLevelSnapshot\(/)
  assert.match(sprite, /const clampedSpeechLevel = isSpeaking[\s\S]*subscribedSpeechLevel[\s\S]*:\s*0/)
  assert.match(petView, /function PetMicBars[\s\S]*useSpeechLevelSnapshot\(/)
  assert.match(consoleSection, /function ConsoleSpeechLevelMeta[\s\S]*useSpeechLevelSnapshot\(source\)/)
  assert.doesNotMatch(consoleSection.slice(consoleSection.indexOf('export const ConsoleSection')), /useSpeechLevelSnapshot\(/)
  assert.match(consoleV3, /function ConsoleSpeechLevelMeta[\s\S]*useSpeechLevelSnapshot\(source\)/)
  assert.doesNotMatch(consoleV3.slice(consoleV3.indexOf('export const ConsoleSectionV3')), /useSpeechLevelSnapshot\(/)
  assert.match(vts, /speechLevelSource\.getSnapshot\(\)/)
  assert.doesNotMatch(petView, /voice\.speechLevel(?!Source)/)
  assert.doesNotMatch(consoleSection, /speechLevel: number/)
  assert.doesNotMatch(consoleV3, /speechLevel: number/)
})

test('VAD terminal boundaries reset the UI snapshot without weakening ordinary frame throttling', async () => {
  const [vad, starters] = await Promise.all([
    read('src/hooks/voice/vadConversation.ts'),
    read('src/hooks/voice/voiceConversationStarters.ts'),
  ])

  assert.match(vad, /resetSpeechLevel: \(\) => void/)
  assert.match(vad, /const handleMisfire[\s\S]*params\.resetSpeechLevel\(\)/)
  assert.match(vad, /const handleSpeechEnd[\s\S]*params\.resetSpeechLevel\(\)/)
  assert.match(starters, /resetSpeechLevel:\s*bindings\.resetSpeechLevel/)
})
