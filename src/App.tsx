import { Suspense, lazy, useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { LoginPage } from './components/LoginPage'
import { StartupStatus } from './components/StartupStatus'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import './App.css'
import './styles/etax.css'

const AuthenticatedRoutes = lazy(() => import('./AuthenticatedRoutes'))

function App() {
  const configured = isSupabaseConfigured()
  const [session, setSession] = useState<Session | null>()
  const [sessionFailed, setSessionFailed] = useState(false)

  useEffect(() => {
    if (!configured) return
    let active = true
    let receivedAuthEvent = false
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // getSession handles the initial read and exposes its error directly.
      if (event === 'INITIAL_SESSION') return
      receivedAuthEvent = true
      setSessionFailed(false)
      setSession(nextSession)
    })

    async function restoreSession() {
      try {
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        if (active && !receivedAuthEvent) setSession(data.session)
      } catch {
        if (active && !receivedAuthEvent) setSessionFailed(true)
      }
    }

    void restoreSession()
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [configured])

  if (!configured) {
    return (
      <div className="shell">
        <div className="panel">
          <h1 className="title">未配置 Supabase</h1>
          <p className="muted">
            请在项目根目录创建 <code>.env</code>，并设置{' '}
            <code>VITE_SUPABASE_URL</code> 与 <code>VITE_SUPABASE_ANON_KEY</code>
            （可与 Next 项目中的 URL、公钥相同；Vite 使用 <code>VITE_</code> 前缀）。
          </p>
          <p className="muted">参考 <code>.env.example</code>。</p>
        </div>
      </div>
    )
  }

  if (session === undefined) {
    return (
      <StartupStatus
        loading="正在检查登录状态…"
        failure="登录服务暂时无响应，请检查网络后重试。"
        failed={sessionFailed}
      />
    )
  }

  if (!session) return <LoginPage />

  return (
    <Suspense
      fallback={
        <StartupStatus
          loading="正在加载页面…"
          failure="页面资源加载较慢，请检查网络后重试。"
        />
      }
    >
      <AuthenticatedRoutes
        email={session.user.email ?? null}
        onSignOut={() => void supabase.auth.signOut()}
      />
    </Suspense>
  )
}

export default App
