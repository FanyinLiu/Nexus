interface MediaSessionPlaybackSupport {
  play: boolean
  pause: boolean
  toggle: boolean
  next: boolean
  previous: boolean
}

export interface MediaSessionSnapshot {
  ok: boolean
  hasSession: boolean
  sessionKey?: string
  sourceAppUserModelId?: string
  title?: string
  artist?: string
  albumTitle?: string
  artworkDataUrl?: string
  playbackStatus?: string
  isPlaying?: boolean
  positionSeconds?: number
  durationSeconds?: number
  supports?: MediaSessionPlaybackSupport
}

export interface MediaSessionControlRequest {
  action: 'play' | 'pause' | 'toggle' | 'next' | 'previous'
}

export interface MediaSessionControlResponse {
  ok: boolean
  hasSession: boolean
  action: MediaSessionControlRequest['action']
  message?: string
}
