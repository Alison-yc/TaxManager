import { useState } from 'react'
import { loginAccountToAuthEmail } from '../lib/authAccount'
import { supabase } from '../lib/supabase'

/** 第一项为版式占位，不参与登录、不下发接口 */
export function LoginPage() {
  const [decorTaxId, setDecorTaxId] = useState('')
  const [loginAccount, setLoginAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      const authEmail = loginAccountToAuthEmail(loginAccount)
      const { error: err } = await supabase.auth.signInWithPassword({
        email: authEmail,
        password,
      })
      if (err) setError(err.message)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
    setLoading(false)
  }

  return (
    <div className="etax-login-wrap">
      <div className="etax-login-card">
        <div className="etax-login-visual" aria-hidden>
          <div className="etax-login-visual-bg" />
          <div className="etax-login-visual-content">
            <div className="etax-login-mark">税</div>
            <p className="etax-login-brand">国家税务总局</p>
            <p className="etax-login-slogan">
              全国统一规范
              <br />
              <span>电子税务局</span>
            </p>
            <ul className="etax-login-bullets">
              <li>安全 · 便捷 · 掌上办</li>
              <li>本页为原型，非生产系统</li>
            </ul>
          </div>
        </div>

        <div className="etax-login-form-col">
          <h1 className="title etax-login-title">用户登录</h1>
          <p className="etax-login-hint muted">
            账号将按项目规则自动拼接邮箱后缀；仅账号与密码参与认证。
          </p>
          <form className="form etax-login-form" onSubmit={handleSubmit}>
            <label className="label">
              统一社会信用代码 / 纳税人识别号（展示用）
              <input
                className="input"
                type="text"
                inputMode="numeric"
                autoComplete="off"
                name="decor-tax-id"
                placeholder="可输入任意数字，仅用于还原版式"
                value={decorTaxId}
                onChange={(e) => setDecorTaxId(e.target.value)}
              />
              <span className="etax-decor-hint">此字段不提交、不调接口</span>
            </label>
            <label className="label">
              账号
              <input
                className="input"
                type="text"
                autoComplete="username"
                name="login-account"
                placeholder="请输入账号"
                value={loginAccount}
                onChange={(e) => setLoginAccount(e.target.value)}
                required
              />
            </label>
            <label className="label">
              密码
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                placeholder="请输入密码"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </label>
            {error && <p className="err">{error}</p>}
            <button className="btn primary etax-login-submit" type="submit" disabled={loading}>
              {loading ? '登录中…' : '登录'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
