import {
  isSpritePetAnimationState,
  type SpritePetAnimationState,
} from './spriteAtlas.ts'

export const SPRITE_PET_DEBUG_STATE_QUERY_PARAMS = [
  'spritePetState',
  'spriteState',
] as const

export const SPRITE_PET_DEBUG_IMAGE_QUERY_PARAMS = [
  'spritePetImage',
  'spriteImage',
] as const

export function getSpritePetDebugStateFromSearch(search: string): SpritePetAnimationState | null {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)

  for (const key of SPRITE_PET_DEBUG_STATE_QUERY_PARAMS) {
    const value = params.get(key)
    if (isSpritePetAnimationState(value)) {
      return value.trim() as SpritePetAnimationState
    }
  }

  return null
}

export function getSpritePetDebugImagePathFromSearch(search: string): string | null {
  const params = new URLSearchParams(search.startsWith('?') ? search : `?${search}`)

  for (const key of SPRITE_PET_DEBUG_IMAGE_QUERY_PARAMS) {
    const value = params.get(key)?.trim()
    if (!value) {
      continue
    }

    const normalizedValue = value.replace(/^\/+/, '').replace(/\\/g, '/')
    if (!normalizedValue.startsWith('pets/') || normalizedValue.includes('..')) {
      continue
    }

    return `./${normalizedValue}`
  }

  return null
}
