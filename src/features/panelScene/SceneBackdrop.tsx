import type { PetSceneLocation } from '../../types'
import type { TimeOfDayBand, TimeOfDayBlend } from './weatherCondition.ts'
import cityDay from './scenes/city.day.jpg'
import cityDusk from './scenes/city.dusk.jpg'
import cityNight from './scenes/city.night.jpg'
import countrysideDay from './scenes/countryside.day.jpg'
import countrysideDusk from './scenes/countryside.dusk.jpg'
import countrysideNight from './scenes/countryside.night.jpg'
import seasideDay from './scenes/seaside.day.jpg'
import seasideDusk from './scenes/seaside.dusk.jpg'
import seasideNight from './scenes/seaside.night.jpg'
import fieldsDay from './scenes/fields.day.jpg'
import fieldsDusk from './scenes/fields.dusk.jpg'
import fieldsNight from './scenes/fields.night.jpg'
import mountainDay from './scenes/mountain.day.jpg'
import mountainDusk from './scenes/mountain.dusk.jpg'
import mountainNight from './scenes/mountain.night.jpg'

type SceneBackdropProps = {
  location: PetSceneLocation
  timeBand: TimeOfDayBand
  /** Optional continuous weights. When provided, all three variants paint
   *  at their respective opacities so transition windows blend smoothly
   *  (e.g. dawn shows night + day mixed). Falls back to discrete `timeBand`
   *  if not provided — back-compat for any caller still on the old API. */
  timeBlend?: TimeOfDayBlend
}

type SceneVariants = Record<TimeOfDayBand, string>

const SCENE_IMAGES: Record<Exclude<PetSceneLocation, 'off'>, SceneVariants> = {
  city: { day: cityDay, dusk: cityDusk, night: cityNight },
  countryside: { day: countrysideDay, dusk: countrysideDusk, night: countrysideNight },
  seaside: { day: seasideDay, dusk: seasideDusk, night: seasideNight },
  fields: { day: fieldsDay, dusk: fieldsDusk, night: fieldsNight },
  mountain: { day: mountainDay, dusk: mountainDusk, night: mountainNight },
}

function getClampedOpacity(opacity: number) {
  return Math.min(1, Math.max(0, opacity))
}

/**
 * Bottom layer of the 3-layer pet stage. Each scene ships three
 * hand-prompted variants — day / dusk / night — and we swap between
 * them as the clock moves across bands. Within a band, the SunlightTint
 * filter does the per-minute fine-tuning (brightness/saturation/hue).
 *
 * Renders both the active variant and a ghost of the other two stacked
 * behind it so CSS transitions (opacity) can crossfade between them
 * instead of flicker-cutting when the time band flips.
 */
export function SceneBackdrop({ location, timeBand, timeBlend }: SceneBackdropProps) {
  if (location === 'off') return null
  const variants = SCENE_IMAGES[location]

  // When blend weights are provided, paint all three variants at their
  // respective opacities so transition windows mix the artwork rather
  // than stepping from one variant to the next.
  const opacities = timeBlend ?? {
    day: timeBand === 'day' ? 1 : 0,
    dusk: timeBand === 'dusk' ? 1 : 0,
    night: timeBand === 'night' ? 1 : 0,
  }

  return (
    <div className={`scene-backdrop scene-backdrop--${location}`} aria-hidden="true">
      <img
        className="scene-backdrop__art scene-backdrop__art--day"
        src={variants.day}
        alt=""
        draggable={false}
        style={{ opacity: getClampedOpacity(opacities.day) }}
      />
      <img
        className="scene-backdrop__art scene-backdrop__art--dusk"
        src={variants.dusk}
        alt=""
        draggable={false}
        style={{ opacity: getClampedOpacity(opacities.dusk) }}
      />
      <img
        className="scene-backdrop__art scene-backdrop__art--night"
        src={variants.night}
        alt=""
        draggable={false}
        style={{ opacity: getClampedOpacity(opacities.night) }}
      />
    </div>
  )
}
