import { Component, useEffect, useState, type ReactNode } from 'react'

type StatusProps = {
  loading: string
  failure: string
  failed?: boolean
}

export function StartupStatus({ loading, failure, failed = false }: StatusProps) {
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    const timer = window.setTimeout(() => setSlow(true), 10000)
    return () => window.clearTimeout(timer)
  }, [])

  return (
    <main className="startup-status">
      <p role="status">{failed || slow ? failure : loading}</p>
      {(failed || slow) && <button type="button" onClick={reloadPage}>重新加载</button>}
    </main>
  )
}

function reloadPage() {
  const url = new URL(window.location.href)
  url.searchParams.set('tm-retry', String(Date.now()))
  window.location.replace(url)
}

export class StartupBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (this.state.failed) {
      return <StartupStatus loading="" failure="页面加载失败，请重新加载。" failed />
    }
    return this.props.children
  }
}
