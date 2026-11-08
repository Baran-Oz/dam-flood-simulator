import { Component } from 'react'
import styles from './ErrorBoundary.module.css'

/**
 * Last line of defence: if rendering throws, show what happened and a way out
 * instead of a blank page.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    console.error('Dam Flood Simulator crashed', error, info?.componentStack)
  }

  reload = () => window.location.reload()

  resetSettings = () => {
    // Keep API keys; clear everything else this app stores
    try {
      for (const k of Object.keys(localStorage)) {
        if (k.startsWith('baraj.') && k !== 'baraj.apiKeys') localStorage.removeItem(k)
      }
    } catch { /* storage unavailable */ }
    const url = new URL(window.location.href)
    url.search = ''
    url.hash = ''
    window.location.replace(url.toString())
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className={styles.wrap} role="alert">
        <div className={styles.card}>
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.text}>
            The simulator hit an unexpected error and stopped. Your API keys are safe. Reloading
            usually fixes it; if the same thing happens again, reset the app.
          </p>
          <pre className={styles.detail}>{String(this.state.error?.message || this.state.error)}</pre>
          <div className={styles.actions}>
            <button className={styles.primary} onClick={this.reload}>Reload</button>
            <button className={styles.secondary} onClick={this.resetSettings}>Reset app</button>
          </div>
        </div>
      </div>
    )
  }
}
