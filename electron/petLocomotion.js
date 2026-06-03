// ---- Desktop pet locomotion: roam, edge-peek, spontaneous gestures ----
// A small main-process state machine walks a pet window along its current
// row and broadcasts a coarse `locomotionActivity`; the renderer maps that
// onto existing sprite rows (running-left/right, waving, …) so the pet roams
// and peeks with no new art. Yields while the user hovers/drags the pet.
//
// createPetLocomotion() builds one independent controller (its own
// phase/velocity/timer) over injected accessors (no circular import), so
// several pet windows can each roam on their own:
//   getWin()      -> this instance's pet BrowserWindow (or null)
//   getState()    -> this instance's petWindowState object
//   patchState(p) -> merge p into this instance's state and broadcast it
import { screen } from 'electron'

const PET_LOCO_TICK_MS = 45
const PET_LOCO_SPEED_PX = 4
const PET_CURSOR_TEASE_RANGE_PX = 260
const PET_GRAVITY_PX = 1.6

export function createPetLocomotion({ getWin, getState, patchState }) {
  let petLocoTimer = null
  let petLocoPhase = 'rest' // rest | gesture | walk | peekOut | peekHold | peekBack | tease | fling | climbWalk | climbUp | climbHold | walkSit
  let petLocoTargetX = 0
  let petLocoTargetY = 0
  let petLocoUntil = 0
  let petLocoTeaseCooldownUntil = 0
  let petLocoLastDragAt = 0
  let petLocoWasDragging = false
  let petLocoVelX = 0
  let petLocoVelY = 0

  function setPetLocomotionActivity(activity) {
    if (getState().locomotionActivity === activity) return
    patchState({ locomotionActivity: activity })
  }

  // Free mode = roam the whole desktop with no scene backdrop (transparent,
  // just the character). Fixed mode = stay put with the time-of-day backdrop.
  function setFreeMode(on) {
    const next = Boolean(on)
    if (getState().freeMode === next) return
    patchState({
      freeMode: next,
      locomotionActivity: next ? getState().locomotionActivity : 'idle',
    })
  }

  // windowManager's drag handler calls this so a fling carries release velocity.
  function noteDrag(delta) {
    petLocoLastDragAt = Date.now()
    petLocoVelX = delta?.x ?? 0
    petLocoVelY = delta?.y ?? 0
  }

  function petLocoFrame() {
    const bounds = getWin().getBounds()
    return { bounds, workArea: screen.getDisplayMatching(bounds).workArea }
  }

  function petLocoSetXY(x, y, allowOffscreen) {
    const { bounds, workArea } = petLocoFrame()
    const offX = allowOffscreen ? Math.round(bounds.width * 0.55) : 0
    const nx = Math.min(Math.max(Math.round(x), workArea.x - offX), workArea.x + workArea.width - bounds.width + offX)
    const ny = Math.min(Math.max(Math.round(y), workArea.y), workArea.y + workArea.height - bounds.height)
    getWin().setPosition(nx, ny)
  }

  function petLocoStartRest(now) {
    petLocoPhase = 'rest'
    petLocoUntil = now + 2500 + Math.random() * 5000
    setPetLocomotionActivity('idle')
  }

  function petLocoDecide(now) {
    const r = Math.random()
    const { bounds, workArea } = petLocoFrame()
    const maxX = workArea.x + workArea.width - bounds.width
    const floorY = workArea.y + workArea.height - bounds.height
    if (r < 0.16) {
      petLocoPhase = 'gesture'
      petLocoUntil = now + 1200
      setPetLocomotionActivity(Math.random() < 0.5 ? 'wave' : 'jump')
      return
    }
    if (r < 0.3) {
      petLocoPhase = 'peekOut'
      petLocoTargetX = Math.random() < 0.5
        ? workArea.x - Math.round(bounds.width * 0.5)
        : workArea.x + workArea.width - Math.round(bounds.width * 0.5)
      petLocoTargetY = bounds.y
      return
    }
    if (r < 0.42) {
      // Climb a side wall up to the top, hold, then drop back down.
      petLocoPhase = 'climbWalk'
      petLocoTargetX = Math.random() < 0.5 ? workArea.x : maxX
      petLocoTargetY = bounds.y
      return
    }
    if (r < 0.55) {
      // Walk to a screen edge and sit there a while.
      petLocoPhase = 'walkSit'
      const side = Math.floor(Math.random() * 4)
      if (side === 0) {
        petLocoTargetX = Math.round(workArea.x + Math.random() * (maxX - workArea.x))
        petLocoTargetY = workArea.y
      } else if (side === 1) {
        petLocoTargetX = Math.round(workArea.x + Math.random() * (maxX - workArea.x))
        petLocoTargetY = floorY
      } else if (side === 2) {
        petLocoTargetX = workArea.x
        petLocoTargetY = Math.round(workArea.y + Math.random() * (floorY - workArea.y))
      } else {
        petLocoTargetX = maxX
        petLocoTargetY = Math.round(workArea.y + Math.random() * (floorY - workArea.y))
      }
      return
    }
    // Roam anywhere on the work area (2D); the run row is picked by horizontal direction.
    petLocoPhase = 'walk'
    petLocoTargetX = Math.round(workArea.x + Math.random() * Math.max(0, workArea.width - bounds.width))
    petLocoTargetY = Math.round(workArea.y + Math.random() * Math.max(0, workArea.height - bounds.height))
  }

  function petLocoStep(allowOffscreen) {
    const { bounds } = petLocoFrame()
    const dx = petLocoTargetX - bounds.x
    const dy = petLocoTargetY - bounds.y
    const dist = Math.hypot(dx, dy) || 1
    if (Math.abs(dx) > 1) setPetLocomotionActivity(dx < 0 ? 'walk-left' : 'walk-right')
    if (dist <= PET_LOCO_SPEED_PX) {
      petLocoSetXY(petLocoTargetX, petLocoTargetY, allowOffscreen)
      return true
    }
    petLocoSetXY(
      bounds.x + (dx / dist) * PET_LOCO_SPEED_PX,
      bounds.y + (dy / dist) * PET_LOCO_SPEED_PX,
      allowOffscreen,
    )
    return false
  }

  function petLocoTick() {
    const win = getWin()
    if (!win || win.isDestroyed()) return
    const state = getState()
    if (!state.freeMode || !state.roamCapable) {
      // Fixed mode, or a non-sprite avatar (Live2D has no walk frames) — stay put.
      setPetLocomotionActivity('idle')
      return
    }
    const now = Date.now()
    // Gravity: yield while the user drags; when dropped above the floor, fall and land.
    if (now - petLocoLastDragAt < 200) {
      petLocoWasDragging = true
      return
    }
    if (petLocoWasDragging) {
      petLocoWasDragging = false
      // Fling: carry the release velocity, bounce off walls, fall, land.
      petLocoVelX = Math.max(-28, Math.min(28, petLocoVelX))
      petLocoVelY = Math.max(-28, Math.min(28, petLocoVelY))
      petLocoPhase = 'fling'
      return
    }
    if (petLocoPhase !== 'fling' && state.petHotspotActive) return // yield while hovered
    switch (petLocoPhase) {
      case 'rest': {
        // Cursor teasing (QQ-pet style): hop toward the pointer when it comes close.
        if (now >= petLocoTeaseCooldownUntil) {
          const { bounds } = petLocoFrame()
          const cursor = screen.getCursorScreenPoint()
          const cx = bounds.x + bounds.width / 2
          const cy = bounds.y + bounds.height / 2
          if (Math.hypot(cursor.x - cx, cursor.y - cy) < PET_CURSOR_TEASE_RANGE_PX) {
            petLocoTargetX = cursor.x - Math.round(bounds.width / 2)
            petLocoTargetY = cursor.y - Math.round(bounds.height / 2)
            petLocoTeaseCooldownUntil = now + 6500
            petLocoPhase = 'tease'
            setPetLocomotionActivity('jumping')
            return
          }
        }
        if (now >= petLocoUntil) petLocoDecide(now)
        return
      }
      case 'gesture':
        if (now >= petLocoUntil) petLocoStartRest(now)
        return
      case 'tease': {
        const { bounds } = petLocoFrame()
        const dx = petLocoTargetX - bounds.x
        const dy = petLocoTargetY - bounds.y
        const dist = Math.hypot(dx, dy) || 1
        setPetLocomotionActivity('jumping')
        if (dist <= PET_LOCO_SPEED_PX * 2) {
          petLocoStartRest(now)
          return
        }
        const teaseSpeed = PET_LOCO_SPEED_PX * 1.8
        petLocoSetXY(bounds.x + (dx / dist) * teaseSpeed, bounds.y + (dy / dist) * teaseSpeed, false)
        return
      }
      case 'fling': {
        const { bounds, workArea } = petLocoFrame()
        const floorY = workArea.y + workArea.height - bounds.height
        const minX = workArea.x
        const maxX = workArea.x + workArea.width - bounds.width
        petLocoVelY = Math.min(petLocoVelY + PET_GRAVITY_PX, 26)
        petLocoVelX *= 0.985
        let nx = bounds.x + petLocoVelX
        let ny = bounds.y + petLocoVelY
        if (nx <= minX) { nx = minX; petLocoVelX = Math.abs(petLocoVelX) * 0.6 }
        else if (nx >= maxX) { nx = maxX; petLocoVelX = -Math.abs(petLocoVelX) * 0.6 }
        if (ny <= workArea.y) { ny = workArea.y; petLocoVelY = Math.abs(petLocoVelY) * 0.5 }
        setPetLocomotionActivity('jumping')
        if (ny >= floorY) {
          ny = floorY
          petLocoVelY = 0
          petLocoVelX *= 0.5
          if (Math.abs(petLocoVelX) < 1.5) {
            win.setPosition(Math.round(nx), Math.round(ny))
            petLocoStartRest(now)
            return
          }
        }
        win.setPosition(Math.round(nx), Math.round(ny))
        return
      }
      case 'walk':
        if (petLocoStep(false)) petLocoStartRest(now)
        return
      case 'climbWalk':
        if (petLocoStep(false)) petLocoPhase = 'climbUp'
        return
      case 'climbUp': {
        const { bounds, workArea } = petLocoFrame()
        setPetLocomotionActivity('jumping')
        const topY = workArea.y + 6
        if (bounds.y <= topY) {
          petLocoUntil = now + 1600
          petLocoPhase = 'climbHold'
          return
        }
        win.setPosition(bounds.x, Math.max(topY, bounds.y - PET_LOCO_SPEED_PX))
        return
      }
      case 'climbHold':
        setPetLocomotionActivity('idle')
        if (now >= petLocoUntil) {
          petLocoVelX = 0
          petLocoVelY = 0
          petLocoPhase = 'fling'
        }
        return
      case 'walkSit':
        if (petLocoStep(false)) {
          petLocoPhase = 'rest'
          petLocoUntil = now + 6000 + Math.random() * 6000
          setPetLocomotionActivity('idle')
        }
        return
      case 'peekOut':
        if (petLocoStep(true)) {
          petLocoPhase = 'peekHold'
          petLocoUntil = now + 2000
          setPetLocomotionActivity('peek')
        }
        return
      case 'peekHold':
        if (now >= petLocoUntil) {
          const { bounds, workArea } = petLocoFrame()
          petLocoTargetX = bounds.x < workArea.x + workArea.width / 2
            ? workArea.x + 6
            : workArea.x + workArea.width - bounds.width - 6
          petLocoTargetY = bounds.y
          petLocoPhase = 'peekBack'
        }
        return
      case 'peekBack':
        if (petLocoStep(true)) petLocoStartRest(now)
        return
      default:
        petLocoStartRest(now)
    }
  }

  function start() {
    if (petLocoTimer || !getWin()) return
    petLocoStartRest(Date.now())
    petLocoTimer = setInterval(petLocoTick, PET_LOCO_TICK_MS)
  }

  function stop() {
    if (!petLocoTimer) return
    clearInterval(petLocoTimer)
    petLocoTimer = null
  }

  return { start, stop, setFreeMode, noteDrag }
}
