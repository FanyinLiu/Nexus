import type { PetSceneLocation } from '../../types'
import cityImage from './scenes/city.jpg'
import countrysideImage from './scenes/countryside.jpg'
import seasideImage from './scenes/seaside.jpg'
import fieldsImage from './scenes/fields.jpg'
import mountainImage from './scenes/mountain.jpg'

type SceneBackdropProps = {
  location: PetSceneLocation
}

const SCENE_IMAGES: Record<Exclude<PetSceneLocation, 'off'>, string> = {
  city: cityImage,
  countryside: countrysideImage,
  seaside: seasideImage,
  fields: fieldsImage,
  mountain: mountainImage,
}

/**
 * Bottom layer of the 3-layer pet stage — a static anime-style painting
 * picked by the user. Images are hand-prompted Flux/SD outputs bundled
 * with the app so there's zero runtime fetch + zero ugly geometric
 * placeholder fallback.
 *
 * Layered above this (via SunlightTint parent): the animated weather
 * particles and the 14-state time-of-day color wash. The scene image
 * itself is neutral enough that the sunlight tint shifts the feel
 * across the day without fighting baked-in lighting.
 */
export function SceneBackdrop({ location }: SceneBackdropProps) {
  if (location === 'off') return null
  const src = SCENE_IMAGES[location]

  return (
    <div className={`scene-backdrop scene-backdrop--${location}`} aria-hidden="true">
      <img className="scene-backdrop__art" src={src} alt="" draggable={false} />
    </div>
  )
}
