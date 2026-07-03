import type { SVGProps } from 'react'

export type PetControlIconName =
  | 'chat'
  | 'clipboard'
  | 'calendar-clock'
  | 'settings'
  | 'tuning'
  | 'menu'
  | 'back'
  | 'expand'
  | 'collapse'
  | 'chevron-down'
  | 'close'
  | 'pin'
  | 'pointer'
  | 'plus'
  | 'image'
  | 'mic'
  | 'send'
  | 'skip-back'
  | 'skip-forward'
  | 'play'
  | 'pause'
  | 'speaker'
  | 'sparkles'
  | 'leaf'
  | 'thought'
  | 'continuous'
  | 'single-shot'
  | 'trash'
  | 'external-link'

type PetControlIconProps = SVGProps<SVGSVGElement> & {
  name: PetControlIconName
}

export function PetControlIcon({ name, ...props }: PetControlIconProps) {
  switch (name) {
    case 'chat':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M6.5 5A3.5 3.5 0 0 0 3 8.5v5A3.5 3.5 0 0 0 6.5 17H8v3.25a.75.75 0 0 0 1.2.6L13 17h4.5a3.5 3.5 0 0 0 3.5-3.5v-5A3.5 3.5 0 0 0 17.5 5h-11ZM8.5 11a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm3.5 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Zm3.5 0a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z" />
        </svg>
      )
    case 'clipboard':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="M9 5.5h6" />
          <path d="M9.5 3.5h5a2 2 0 0 1 2 2v1h-9v-1a2 2 0 0 1 2-2Z" />
          <path d="M7.5 6.5H6a2 2 0 0 0-2 2v10A2.5 2.5 0 0 0 6.5 21h11A2.5 2.5 0 0 0 20 18.5v-10a2 2 0 0 0-2-2h-1.5" />
          <path d="M8 12h8M8 16h5" />
        </svg>
      )
    case 'calendar-clock':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="M7 3v4M17 3v4" />
          <path d="M4.5 9h15" />
          <path d="M6.5 5h11A2.5 2.5 0 0 1 20 7.5v8A4.5 4.5 0 0 1 15.5 20h-9A2.5 2.5 0 0 1 4 17.5v-10A2.5 2.5 0 0 1 6.5 5Z" />
          <circle cx="16" cy="16" r="3.2" />
          <path d="M16 14.4V16l1.2 1" />
        </svg>
      )
    case 'settings':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.05.05a2 2 0 0 1-2.83 2.83l-.05-.05A1.65 1.65 0 0 0 15.08 19a1.65 1.65 0 0 0-1 .6l-.04.05a2 2 0 0 1-4.08 0l-.04-.05A1.65 1.65 0 0 0 8.92 19a1.65 1.65 0 0 0-1.82.65l-.05.05a2 2 0 1 1-2.83-2.83l.05-.05A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1-.99h-.07a2 2 0 0 1 0-4.02h.07a1.65 1.65 0 0 0 1-.99 1.65 1.65 0 0 0-.33-1.82l-.05-.05A2 2 0 1 1 7.05 4.3l.05.05A1.65 1.65 0 0 0 8.92 5a1.65 1.65 0 0 0 1-.6l.04-.05a2 2 0 0 1 4.08 0l.04.05a1.65 1.65 0 0 0 1 .6 1.65 1.65 0 0 0 1.82-.65l.05-.05a2 2 0 1 1 2.83 2.83l-.05.05A1.65 1.65 0 0 0 19.4 9c.15.45.51.81.99.99h.07a2 2 0 0 1 0 4.02h-.07a1.65 1.65 0 0 0-.99.99Z" />
        </svg>
      )
    case 'tuning':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" fillRule="evenodd" d="M7 2a1 1 0 0 1 1 1v3.17a3.001 3.001 0 0 1 0 5.66V21a1 1 0 1 1-2 0v-9.17a3.001 3.001 0 0 1 0-5.66V3a1 1 0 0 1 1-1Zm10 0a1 1 0 0 1 1 1v9.17a3.001 3.001 0 0 1 0 5.66V21a1 1 0 1 1-2 0v-3.17a3.001 3.001 0 0 1 0-5.66V3a1 1 0 0 1 1-1Z" />
        </svg>
      )
    case 'menu':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13a1.5 1.5 0 0 1 0 3h-13A1.5 1.5 0 0 1 4 6.5Zm0 5A1.5 1.5 0 0 1 5.5 10h13a1.5 1.5 0 0 1 0 3h-13A1.5 1.5 0 0 1 4 11.5Zm0 5A1.5 1.5 0 0 1 5.5 15h13a1.5 1.5 0 0 1 0 3h-13A1.5 1.5 0 0 1 4 16.5Z" />
        </svg>
      )
    case 'back':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M10.7 5.3a1 1 0 0 1 0 1.4L6.41 11H19a1 1 0 1 1 0 2H6.41l4.3 4.3a1 1 0 0 1-1.42 1.4l-6-6a1 1 0 0 1 0-1.4l6-6a1 1 0 0 1 1.42 0Z" />
        </svg>
      )
    case 'expand':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M5 4h5a1 1 0 1 1 0 2H7.41l3.3 3.29a1 1 0 0 1-1.42 1.42L6 7.4V10a1 1 0 1 1-2 0V5a1 1 0 0 1 1-1Zm9 0h5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V7.41l-3.29 3.3a1 1 0 0 1-1.42-1.42L16.6 6H14a1 1 0 1 1 0-2ZM4 14a1 1 0 1 1 2 0v2.59l3.29-3.3a1 1 0 1 1 1.42 1.42L7.4 18H10a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1v-5Zm15-1a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-5a1 1 0 1 1 0-2h2.59l-3.3-3.29a1 1 0 0 1 1.42-1.42L18 16.6V14a1 1 0 0 1 1-1Z" />
        </svg>
      )
    case 'collapse':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M6 12a1.2 1.2 0 0 1 1.2-1.2h9.6a1.2 1.2 0 1 1 0 2.4H7.2A1.2 1.2 0 0 1 6 12Z" />
        </svg>
      )
    case 'chevron-down':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      )
    case 'close':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M6.22 4.81a1 1 0 0 0-1.41 1.41L10.59 12l-5.78 5.78a1 1 0 1 0 1.41 1.41L12 13.41l5.78 5.78a1 1 0 0 0 1.41-1.41L13.41 12l5.78-5.78a1 1 0 0 0-1.41-1.41L12 10.59 6.22 4.81Z" />
        </svg>
      )
    case 'pin':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M16.5 3.5a1 1 0 0 0-1.6-.5L10 7.2 7.3 6a1 1 0 0 0-1.1.2l-1 1a1 1 0 0 0 0 1.4l3.2 3.2-5 5a1 1 0 1 0 1.4 1.4l5-5 3.2 3.2a1 1 0 0 0 1.4 0l1-1a1 1 0 0 0 .2-1.1L14.3 11l4.2-4.9a1 1 0 0 0-.5-1.6l-1.5-1Z" />
        </svg>
      )
    case 'pointer':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M5.7 3.1a1 1 0 0 1 1.05-.12l13 7a1 1 0 0 1-.04 1.79l-5 2.2 1.9 5.5a1 1 0 0 1-1.6 1.1L11 16.5l-2.4 4.9a1 1 0 0 1-1.85-.2l-2-14a1 1 0 0 1 .95-1.1Z" />
        </svg>
      )
    case 'plus':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      )
    case 'image':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M5.5 4h13A3.5 3.5 0 0 1 22 7.5v9a3.5 3.5 0 0 1-3.5 3.5h-13A3.5 3.5 0 0 1 2 16.5v-9A3.5 3.5 0 0 1 5.5 4Zm0 2A1.5 1.5 0 0 0 4 7.5v7.4l3.16-3.16a2 2 0 0 1 2.82 0l1.27 1.26 2.77-2.76a2 2 0 0 1 2.82 0L20 13.4V7.5A1.5 1.5 0 0 0 18.5 6h-13Zm0 12h13A1.5 1.5 0 0 0 20 16.5v-.27l-4.57-4.58-3.47 3.47a1 1 0 0 1-1.42 0l-1.97-1.97L4 17.72c.28.18.61.28 1.5.28ZM8 8.25a1.75 1.75 0 1 1 0 3.5 1.75 1.75 0 0 1 0-3.5Z" />
        </svg>
      )
    case 'send':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M20.72 3.28a1.35 1.35 0 0 1 .33 1.39l-5.72 16.24a1.35 1.35 0 0 1-2.5.1l-3.2-6.4-6.4-3.2a1.35 1.35 0 0 1 .1-2.5L19.57 3.2a1.35 1.35 0 0 1 1.15.08ZM6.03 10.28l4.45 2.23a1 1 0 0 1 .45.45l2.23 4.45 4.06-11.53-11.19 4.4Z" />
        </svg>
      )
    case 'skip-back':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M6 5a1 1 0 0 1 1 1v4.11l8.35-5.18A1.75 1.75 0 0 1 18 6.42v11.16a1.75 1.75 0 0 1-2.65 1.49L7 13.89V18a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1Z" />
        </svg>
      )
    case 'skip-forward':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M18 5a1 1 0 0 0-1 1v4.11L8.65 4.93A1.75 1.75 0 0 0 6 6.42v11.16a1.75 1.75 0 0 0 2.65 1.49L17 13.89V18a1 1 0 1 0 2 0V6a1 1 0 0 0-1-1Z" />
        </svg>
      )
    case 'play':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M8 5.67a1.8 1.8 0 0 1 2.72-1.54l8.14 4.83a1.8 1.8 0 0 1 0 3.08l-8.14 4.83A1.8 1.8 0 0 1 8 15.33V5.67Z" />
        </svg>
      )
    case 'pause':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M8.5 5A1.5 1.5 0 0 0 7 6.5v11a1.5 1.5 0 0 0 3 0v-11A1.5 1.5 0 0 0 8.5 5Zm7 0A1.5 1.5 0 0 0 14 6.5v11a1.5 1.5 0 0 0 3 0v-11A1.5 1.5 0 0 0 15.5 5Z" />
        </svg>
      )
    case 'speaker':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M13 4.06c0-1.12-1.3-1.72-2.16-.99L7.2 6.3H4a2 2 0 0 0-2 2v7.4a2 2 0 0 0 2 2h3.2l3.64 3.23c.86.73 2.16.13 2.16-.99V4.06Z" />
          <path fill="currentColor" d="M16 9.5a3.5 3.5 0 0 1 0 5M18.5 7a7 7 0 0 1 0 10" opacity=".5" />
        </svg>
      )
    case 'sparkles':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M12 2c.4 0 .7.24.84.6l1.68 4.38 4.38 1.68a.9.9 0 0 1 0 1.68l-4.38 1.68-1.68 4.38a.9.9 0 0 1-1.68 0L9.48 12.02 5.1 10.34a.9.9 0 0 1 0-1.68l4.38-1.68L11.16 2.6A.9.9 0 0 1 12 2Z" />
          <path fill="currentColor" d="M18 14c.3 0 .56.2.68.48l.82 2.02 2.02.82a.72.72 0 0 1 0 1.36l-2.02.82-.82 2.02a.72.72 0 0 1-1.36 0l-.82-2.02-2.02-.82a.72.72 0 0 1 0-1.36l2.02-.82.82-2.02A.72.72 0 0 1 18 14Z" opacity=".6" />
        </svg>
      )
    case 'leaf':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" {...props}>
          <path d="M20 4.5c-6.8.2-11.8 2.5-14 6.4-1.6 2.9-.8 5.6 1.1 7.2 2.2 1.8 5.6 1.3 7.9-1.4 2.6-3 3.2-7.5 5-12.2Z" />
          <path d="M6.7 17.7c2.2-4 5.3-6.4 9.4-7.7" />
        </svg>
      )
    case 'thought':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M8.75 5.5h6.5A4.75 4.75 0 0 1 20 10.25v.5a4.75 4.75 0 0 1-4.75 4.75h-3.3l-3.18 2.72A1.1 1.1 0 0 1 7 17.38V15.3a4.75 4.75 0 0 1 1.75-9.8Zm.2 7.72a1 1 0 0 1 .05.28v1.72l1.9-1.62a1 1 0 0 1 .65-.24h3.7A2.75 2.75 0 0 0 18 10.61v-.5a2.75 2.75 0 0 0-2.75-2.75h-6.5A2.75 2.75 0 0 0 6 10.11v.5a2.75 2.75 0 0 0 2.95 2.61Z" />
          <path fill="currentColor" d="M7.75 20.25a1.25 1.25 0 1 1-2.5 0 1.25 1.25 0 0 1 2.5 0Zm-3.5-2.75a1 1 0 1 1-2 0 1 1 0 0 1 2 0Z" opacity=".55" />
        </svg>
      )
    case 'continuous':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M12 4a8 8 0 0 1 6.93 4H17a1 1 0 1 0 0 2h4a1 1 0 0 0 1-1V5a1 1 0 1 0-2 0v1.34A10 10 0 0 0 2 12a1 1 0 1 0 2 0 8 8 0 0 1 8-8ZM3 13a1 1 0 0 1 1 1 8 8 0 0 0 13.93 4H16a1 1 0 1 1 0-2h4a1 1 0 0 1 1 1v4a1 1 0 1 1-2 0v-1.34A10 10 0 0 1 2 12a1 1 0 0 1 1-1Z" />
        </svg>
      )
    case 'single-shot':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" fillRule="evenodd" d="M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16ZM2 12C2 6.48 6.48 2 12 2s10 4.48 10 10-4.48 10-10 10S2 17.52 2 12Z" />
          <circle fill="currentColor" cx="12" cy="12" r="3.5" />
        </svg>
      )
    case 'trash':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M9 3a2 2 0 0 0-2 2v1H4.5a1 1 0 1 0 0 2h15a1 1 0 1 0 0-2H17V5a2 2 0 0 0-2-2H9Zm0 3V5h6v1H9Zm-2.5 4a1 1 0 0 1 1 1l.52 7.33A2.5 2.5 0 0 0 10.51 20h2.98a2.5 2.5 0 0 0 2.49-1.67L16.5 11a1 1 0 1 1 2 .14l-.52 7.33A4.5 4.5 0 0 1 13.49 22h-2.98a4.5 4.5 0 0 1-4.49-3.53L5.5 11.14A1 1 0 0 1 6.5 10Zm4 1.5a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0v-5a1 1 0 0 1 1-1Zm3 0a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0v-5a1 1 0 0 1 1-1Z" />
        </svg>
      )
    case 'external-link':
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <path fill="currentColor" d="M14 5a1 1 0 1 1 0-2h6a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0V6.41l-7.3 7.3a1 1 0 0 1-1.4-1.42L17.59 5H14ZM6.5 6A2.5 2.5 0 0 0 4 8.5v9A2.5 2.5 0 0 0 6.5 20h9a2.5 2.5 0 0 0 2.5-2.5V14a1 1 0 1 0-2 0v3.5a.5.5 0 0 1-.5.5h-9a.5.5 0 0 1-.5-.5v-9a.5.5 0 0 1 .5-.5H10a1 1 0 1 0 0-2H6.5Z" />
        </svg>
      )
    case 'mic':
    default:
      return (
        <svg viewBox="0 0 24 24" aria-hidden="true" {...props}>
          <rect fill="currentColor" x="8.5" y="3" width="7" height="11" rx="3.5" />
          <path fill="currentColor" d="M5 12a1 1 0 0 1 2 0 5 5 0 0 0 10 0 1 1 0 1 1 2 0 7 7 0 0 1-6 6.93V20.5h2.5a1 1 0 1 1 0 2h-7a1 1 0 1 1 0-2H11v-1.57A7 7 0 0 1 5 12Z" />
        </svg>
      )
  }
}
