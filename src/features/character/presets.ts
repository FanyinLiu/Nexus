import type { PetMood, VoiceState } from '../../types'
import type { TranslationKey } from '../../types/i18n.ts'

interface CharacterPreset {
  id: string
  themeClassName: string
  heroEyebrow: TranslationKey
  dialogueEyebrow: TranslationKey
  heroTags: TranslationKey[]
  moodLabels: Record<PetMood, TranslationKey>
  voiceStateDescriptors: Record<VoiceState, TranslationKey>
  dockIdleHint: TranslationKey
  dockActiveHint: TranslationKey
  stageAmbientHint: TranslationKey
  portraitTitle: TranslationKey
  portraitDetail: TranslationKey
  motionLabel: TranslationKey
}

const MAO_COMPANION_PRESET: CharacterPreset = {
  id: 'mao-live2d',
  themeClassName: 'desktop-pet-root--theme-nexus',
  heroEyebrow: 'character.preset.mao.hero_eyebrow',
  dialogueEyebrow: 'character.preset.mao.dialogue_eyebrow',
  heroTags: [
    'character.preset.mao.tag.0',
    'character.preset.mao.tag.1',
    'character.preset.mao.tag.2',
  ],
  moodLabels: {
    idle: 'character.preset.mao.mood.idle',
    thinking: 'character.preset.mao.mood.thinking',
    happy: 'character.preset.mao.mood.happy',
    sleepy: 'character.preset.mao.mood.sleepy',
    surprised: 'character.preset.mao.mood.surprised',
    confused: 'character.preset.mao.mood.confused',
    embarrassed: 'character.preset.mao.mood.embarrassed',
    excited: 'character.preset.mao.mood.excited',
    affectionate: 'character.preset.mao.mood.affectionate',
    proud: 'character.preset.mao.mood.proud',
    curious: 'character.preset.mao.mood.curious',
    worried: 'character.preset.mao.mood.worried',
    playful: 'character.preset.mao.mood.playful',
  },
  voiceStateDescriptors: {
    idle: 'character.preset.mao.voice_state.idle',
    listening: 'character.preset.mao.voice_state.listening',
    processing: 'character.preset.mao.voice_state.processing',
    speaking: 'character.preset.mao.voice_state.speaking',
  },
  dockIdleHint: 'character.preset.mao.dock_idle_hint',
  dockActiveHint: 'character.preset.mao.dock_active_hint',
  stageAmbientHint: 'character.preset.mao.stage_ambient_hint',
  portraitTitle: 'character.preset.mao.portrait_title',
  portraitDetail: 'character.preset.mao.portrait_detail',
  motionLabel: 'character.preset.mao.motion_label',
}

export function resolveCharacterPreset() {
  return MAO_COMPANION_PRESET
}
