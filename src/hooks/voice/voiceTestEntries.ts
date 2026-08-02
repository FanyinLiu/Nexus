// Factory that produces the audio diagnostic / smoke-test entry points used
// by the settings UI.  These wrap the lower-level diagnostics runtime helpers
// with the bound bindings + lifecycle from the runtime bag.

import {
  probeSpeechOutputPlaybackStartRuntime,
  runAudioSmokeTestRuntime,
  testSpeechInputConnectionRuntime,
  testSpeechOutputReadinessRuntime,
} from './diagnostics.ts'
import type { AppSettings } from '../../types'
import { expectHolderValue, type VoiceRuntimeBag, type VoiceTestEntries } from './voiceRuntimeBag.ts'

export function createVoiceTestEntries(bag: VoiceRuntimeBag): VoiceTestEntries {
  const { bindingsHolder, hookCallbacks } = bag
  const { ti } = hookCallbacks

  const bindings = expectHolderValue(
    bindingsHolder,
    'createVoiceTestEntries: bindings must be built first',
  )

  async function testSpeechInputConnection(draftSettings: AppSettings) {
    return testSpeechInputConnectionRuntime({
      draftSettings,
      testSpeechInputReadiness: bindings.testSpeechInputReadiness,
      ti,
    })
  }

  async function probeSpeechOutputPlaybackStart(
    draftSettings: AppSettings,
    text: string,
  ) {
    await probeSpeechOutputPlaybackStartRuntime({
      draftSettings,
      text,
      stopActiveSpeechOutput: bindings.stopActiveSpeechOutput,
      startSpeechOutput: bindings.startSpeechOutput,
      ti,
    })
  }

  async function testSpeechOutputReadiness(
    draftSettings: AppSettings,
    options?: {
      playSample?: boolean
      sampleText?: string
    },
  ) {
    return testSpeechOutputReadinessRuntime({
      draftSettings,
      options,
      probeSpeechOutputPlaybackStart,
      ti,
    })
  }

  async function runAudioSmokeTest(draftSettings: AppSettings) {
    return runAudioSmokeTestRuntime({
      draftSettings,
      testSpeechInputConnection,
      testSpeechOutputReadiness,
      ti,
    })
  }

  return {
    testSpeechInputConnection,
    probeSpeechOutputPlaybackStart,
    testSpeechOutputReadiness,
    runAudioSmokeTest,
  }
}
