import { useState, type InputHTMLAttributes } from 'react'
import { pickTranslatedUiText } from '../../lib/uiLanguage'
import type { UiLanguage } from '../../types'

const URL_PROTOCOL_RE = /^https?:\/\//i

type UrlInputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'style'> & {
  uiLanguage: UiLanguage
}

/**
 * Drop-in replacement for `<input>` that shows a red border when the value
 * is non-empty and does not start with `http://` or `https://`.
 * Does not block saving — visual feedback only.
 */
export function UrlInput(props: UrlInputProps) {
  const { value, onBlur, className, uiLanguage, ...rest } = props
  const [touched, setTouched] = useState(false)

  const strValue = typeof value === 'string' ? value : String(value ?? '')
  const invalid = touched && strValue.length > 0 && !URL_PROTOCOL_RE.test(strValue)
  const invalidTitle = pickTranslatedUiText(uiLanguage, 'settings.autonomy.notifications.url_invalid')

  return (
    <input
      {...rest}
      value={value}
      aria-label={rest['aria-label']}
      aria-invalid={invalid || undefined}
      className={[
        'settings-url-input',
        invalid ? 'settings-url-input--invalid' : '',
        className ?? '',
      ].filter(Boolean).join(' ')}
      title={invalid ? invalidTitle : undefined}
      onBlur={(e) => {
        setTouched(true)
        onBlur?.(e)
      }}
    />
  )
}
