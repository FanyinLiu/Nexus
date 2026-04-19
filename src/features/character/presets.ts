import type { PetMood, VoiceState } from '../../types'

export interface CharacterPreset {
  id: string
  themeClassName: string
  heroEyebrow: string
  dialogueEyebrow: string
  heroTags: string[]
  moodLabels: Record<PetMood, string>
  voiceStateDescriptors: Record<VoiceState, string>
  dockIdleHint: string
  dockActiveHint: string
  stageAmbientHint: string
  portraitTitle: string
  portraitDetail: string
  motionLabel: string
}

const MAO_COMPANION_PRESET: CharacterPreset = {
  id: 'mao-live2d',
  themeClassName: 'desktop-pet-root--theme-nexus',
  heroEyebrow: 'Nexus · Companion UI',
  dialogueEyebrow: '桌面陪伴',
  heroTags: ['陪伴布局', 'Live2D 桌面陪伴', 'Voice Native'],
  moodLabels: {
    idle: '轻量待命',
    thinking: '正在整理',
    happy: '温柔回应',
    sleepy: '安静放松',
    surprised: '微微吃惊',
    confused: '有些疑惑',
    embarrassed: '害羞不好意思',
    excited: '兴奋雀跃',
    affectionate: '软软亲近',
    proud: '悄悄自豪',
    curious: '认真好奇',
    worried: '有点担心',
    playful: '调皮活泼',
  },
  voiceStateDescriptors: {
    idle: '安静待命',
    listening: '认真聆听',
    processing: '整理回应',
    speaking: '正在说话',
  },
  dockIdleHint: '当前使用柔和陪伴界面，强调层次感、轻提示和即时反馈。',
  dockActiveHint: '连续语音开启后，角色的口型、表情和注视会更明显地跟随你的交流节奏。',
  stageAmbientHint: '当前使用的是 Live2D 桌面陪伴形态，界面气质偏温暖、纸感和陪伴式结构。',
  portraitTitle: 'Nexus Companion',
  portraitDetail: '主面板使用柔和的视觉层级与温和色彩，把陪伴感直接带到桌面中。',
  motionLabel: '口型 / 表情 / 注视联动',
}

export function resolveCharacterPreset() {
  return MAO_COMPANION_PRESET
}
