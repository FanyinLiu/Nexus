import { pickTranslatedUiText } from '../lib/uiLanguage'
import type { MediaSessionControlRequest, MediaSessionSnapshot, UiLanguage } from '../types'
import { PetControlIcon } from './PetControlIcon'

type MusicPopupCardProps = {
  session: MediaSessionSnapshot
  uiLanguage: UiLanguage
  busy?: boolean
  onControl: (action: MediaSessionControlRequest['action']) => void
  onDismiss: () => void
}

function resolveSourceLabel(sourceAppUserModelId: string | undefined, systemMediaLabel: string) {
  const normalized = String(sourceAppUserModelId ?? '').toLowerCase()
  if (!normalized) return systemMediaLabel
  if (normalized.includes('qqmusic')) return 'QQ Music'
  if (normalized.includes('cloudmusic')) return 'NetEase Music'
  if (normalized.includes('spotify')) return 'Spotify'
  if (normalized.includes('chrome')) return 'Chrome'
  if (normalized.includes('msedge')) return 'Edge'
  if (normalized.includes('firefox')) return 'Firefox'
  if (normalized.includes('potplayer')) return 'PotPlayer'
  if (normalized.includes('foobar')) return 'foobar2000'
  if (normalized.includes('musicbee')) return 'MusicBee'
  if (normalized.includes('vlc')) return 'VLC'
  return systemMediaLabel
}

function formatSeconds(value?: number) {
  const totalSeconds = Math.max(0, Math.floor(Number(value) || 0))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = String(totalSeconds % 60).padStart(2, '0')
  return `${minutes}:${seconds}`
}

function getProgressPercent(session: MediaSessionSnapshot) {
  const duration = Number(session.durationSeconds) || 0
  const position = Number(session.positionSeconds) || 0
  if (!duration || duration <= 0) {
    return 0
  }

  return Math.max(0, Math.min(100, (position / duration) * 100))
}

export function MusicPopupCard({
  session,
  uiLanguage,
  busy = false,
  onControl,
  onDismiss,
}: MusicPopupCardProps) {
  const ti = (key: Parameters<typeof pickTranslatedUiText>[1]) => pickTranslatedUiText(uiLanguage, key)
  const title = session.title?.trim() || ti('music_popup.now_playing')
  const artist = session.artist?.trim() || session.albumTitle?.trim() || ti('music_popup.unknown_artist')
  const sourceLabel = resolveSourceLabel(session.sourceAppUserModelId, ti('music_popup.source.system'))
  const progressPercent = getProgressPercent(session)
  const playbackActionLabel = session.isPlaying ? ti('music_popup.pause_action') : ti('music_popup.resume_action')

  return (
    <aside className="music-popup-card" aria-label={ti('music_popup.aria_label')}>
      <button
        type="button"
        className="music-popup-card__dismiss"
        onClick={onDismiss}
        aria-label={ti('music_popup.close')}
        title={ti('music_popup.close')}
      >
        <PetControlIcon name="close" className="music-popup-card__dismissIcon" />
      </button>

      <div className="music-popup-card__coverShell">
        {session.artworkDataUrl ? (
          <img
            className="music-popup-card__cover"
            src={session.artworkDataUrl}
            alt={title}
          />
        ) : (
          <div className="music-popup-card__cover music-popup-card__cover--placeholder">
            <div className="music-popup-card__coverGlow" aria-hidden="true" />
            <span className="music-popup-card__coverTag">{ti('music_popup.tag')}</span>
            <strong>{title.slice(0, 18)}</strong>
          </div>
        )}

        <div className="music-popup-card__coverShade" aria-hidden="true" />
      </div>

      <div className="music-popup-card__body">
        <div className="music-popup-card__eyebrow">
          <span className="music-popup-card__source">{sourceLabel}</span>
          <span className={`music-popup-card__state ${session.isPlaying ? 'is-playing' : ''}`}>
            {session.isPlaying ? ti('music_popup.state.playing') : ti('music_popup.state.paused')}
          </span>
        </div>

        <div className="music-popup-card__meta">
          <strong className="music-popup-card__title">{title}</strong>
          <p className="music-popup-card__artist">{artist}</p>
        </div>

        <div className="music-popup-card__progress">
          <progress
            className="music-popup-card__progressBar"
            value={progressPercent}
            max={100}
            aria-label={ti('music_popup.progress')}
          />
          <div className="music-popup-card__progressMeta">
            <span>{formatSeconds(session.positionSeconds)}</span>
            <span>{formatSeconds(session.durationSeconds)}</span>
          </div>
        </div>

        <div className="music-popup-card__controls">
          <button
            type="button"
            className="music-popup-card__control"
            onClick={() => onControl('previous')}
            disabled={busy || !session.supports?.previous}
            aria-label={ti('music_popup.previous')}
            title={ti('music_popup.previous')}
          >
            <PetControlIcon name="skip-back" className="music-popup-card__controlIcon" />
          </button>
          <button
            type="button"
            className="music-popup-card__control music-popup-card__control--primary"
            onClick={() => onControl('toggle')}
            disabled={busy || !session.supports?.toggle}
            aria-label={playbackActionLabel}
            title={playbackActionLabel}
          >
            <PetControlIcon
              name={session.isPlaying ? 'pause' : 'play'}
              className="music-popup-card__controlIcon"
            />
          </button>
          <button
            type="button"
            className="music-popup-card__control"
            onClick={() => onControl('next')}
            disabled={busy || !session.supports?.next}
            aria-label={ti('music_popup.next')}
            title={ti('music_popup.next')}
          >
            <PetControlIcon name="skip-forward" className="music-popup-card__controlIcon" />
          </button>
        </div>
      </div>
    </aside>
  )
}
