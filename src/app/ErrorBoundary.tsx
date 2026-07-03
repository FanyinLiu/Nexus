import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { t as translate } from '../i18n/runtime.ts'
import { formatComponentStackForLog, formatErrorBoundaryDetail } from './errorBoundarySupport.ts'

type Props = {
  children: ReactNode
}

type State = {
  hasError: boolean
  error: Error | null
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      '[ErrorBoundary] Uncaught render error:',
      formatErrorBoundaryDetail(error, translate('app.error_boundary.unknown_detail')),
      formatComponentStackForLog(info.componentStack),
    )
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="app-error-fallback" role="alert">
          <div className="app-error-fallback__card">
            <span className="app-error-fallback__eyebrow">Nexus</span>
            <h1>{translate('app.error_boundary.title')}</h1>
            <p>{translate('app.error_boundary.body')}</p>
            <pre className="app-error-fallback__detail">
              {formatErrorBoundaryDetail(this.state.error, translate('app.error_boundary.unknown_detail'))}
            </pre>
            <button
              type="button"
              className="app-error-fallback__button"
              onClick={this.handleReload}
            >
              {translate('app.error_boundary.reload')}
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
