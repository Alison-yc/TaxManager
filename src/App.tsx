import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { FormDataCRUD } from './components/FormDataCRUD'
import { LoginPage } from './components/LoginPage'
import { isSupabaseConfigured, supabase } from './lib/supabase'
import './App.css'

function App() {
  const configured = isSupabaseConfigured()
  const [session, setSession] = useState<Session | null | undefined>(() =>
    configured ? undefined : null,
  )

  useEffect(() => {
    if (!configured) return
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s ?? null)
    })
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
    })
    return () => subscription.unsubscribe()
  }, [configured])

  async function handleSignOut() {
    await supabase.auth.signOut()
  }

  if (!isSupabaseConfigured()) {
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
      <div className="shell">
        <p className="muted">加载中…</p>
      </div>
    )
  }

  if (!session) {
    return (
      <div className="shell">
        <LoginPage />
      </div>
    )
  }

  return (
    <FormDataCRUD
      userEmail={session.user.email ?? null}
      onSignOut={() => void handleSignOut()}
    />
  )
}

export default App
