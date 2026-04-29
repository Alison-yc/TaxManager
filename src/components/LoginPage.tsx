import type { CSSProperties } from 'react'
import { useState } from 'react'
import { ETAX_PUBLIC } from '../constants/assetBase'
import { loginAccountToAuthEmail } from '../lib/authAccount'
import { supabase } from '../lib/supabase'

type LoginTab = 'enterprise' | 'person' | 'agent'

const loginTabs: Array<{ id: LoginTab; label: string }> = [
  { id: 'enterprise', label: '企业业务' },
  { id: 'person', label: '自然人业务' },
  { id: 'agent', label: '代理业务' },
]

const loginAsset = `${ETAX_PUBLIC}login/`

type LoginField = {
  id: 'taxId' | 'account' | 'password'
  label: string
  placeholder: string
  type?: 'text' | 'password'
  icon: string
  autoComplete?: string
}

const loginFieldsByTab: Record<LoginTab, LoginField[]> = {
  enterprise: [
    {
      id: 'taxId',
      label: '统一社会信用代码 / 纳税人识别号',
      placeholder: '统一社会信用代码/纳税人识别号',
      icon: `${loginAsset}icon-tax-id.png`,
      autoComplete: 'off',
    },
    {
      id: 'account',
      label: '居民身份证号码 / 手机号码 / 用户名',
      placeholder: '居民身份证号码/手机号码/用户名',
      icon: `${loginAsset}icon-user.png`,
      autoComplete: 'username',
    },
    {
      id: 'password',
      label: '个人用户密码',
      placeholder: '个人用户密码',
      type: 'password',
      icon: `${loginAsset}icon-password.png`,
      autoComplete: 'current-password',
    },
  ],
  person: [
    {
      id: 'account',
      label: '居民身份证号码 / 手机号码 / 用户名',
      placeholder: '居民身份证号码/手机号码/用户名',
      icon: `${loginAsset}icon-user.png`,
      autoComplete: 'username',
    },
    {
      id: 'password',
      label: '个人用户密码',
      placeholder: '个人用户密码',
      type: 'password',
      icon: `${loginAsset}icon-password.png`,
      autoComplete: 'current-password',
    },
  ],
  agent: [
    {
      id: 'taxId',
      label: '代理机构统一社会信用代码 / 纳税人识别号',
      placeholder: '代理机构统一社会信用代码/纳税人识别号',
      icon: `${loginAsset}icon-tax-id.png`,
      autoComplete: 'off',
    },
    {
      id: 'account',
      label: '居民身份证号码 / 手机号码 / 用户名',
      placeholder: '居民身份证号码/手机号码/用户名',
      icon: `${loginAsset}icon-user.png`,
      autoComplete: 'username',
    },
    {
      id: 'password',
      label: '个人用户密码',
      placeholder: '个人用户密码',
      type: 'password',
      icon: `${loginAsset}icon-password.png`,
      autoComplete: 'current-password',
    },
  ],
}

/** 第一项为版式占位，不参与登录、不下发接口 */
export function LoginPage() {
  const [activeTab, setActiveTab] = useState<LoginTab>('enterprise')
  const [decorTaxId, setDecorTaxId] = useState('911305316610547945')
  const [loginAccount, setLoginAccount] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const activeFields = loginFieldsByTab[activeTab]

  const loginWrapStyle = {
    '--etax-login-bg': `url(${ETAX_PUBLIC}login-bg.png)`,
  } as CSSProperties

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (activeTab !== 'enterprise') {
      setError('当前入口暂未开放，请使用企业业务登录')
      return
    }

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

  function valueOf(fieldId: LoginField['id']): string {
    if (fieldId === 'taxId') return decorTaxId
    if (fieldId === 'account') return loginAccount
    return password
  }

  function updateField(fieldId: LoginField['id'], value: string) {
    if (fieldId === 'taxId') {
      setDecorTaxId(value)
      return
    }
    if (fieldId === 'account') {
      setLoginAccount(value)
      return
    }
    setPassword(value)
  }

  return (
    <div className="etax-login-wrap" style={loginWrapStyle}>
      <header className="etax-login-topbar" aria-label="登录页顶部">
        <div className="etax-login-topbar-inner">
          <div className="etax-login-logo-area">
            <img
              className="etax-login-emblem"
              src={`${loginAsset}china-tax-logo.png`}
              alt=""
              aria-hidden
            />
            <span className="etax-login-system-name">全国统一规范电子税务局</span>
            <span className="etax-login-region">
              <img src={`${loginAsset}icon-location.png`} alt="" aria-hidden />
              河北
            </span>
          </div>
          <div className="etax-login-toplinks" aria-label="辅助链接">
            <button type="button" className="etax-toplink fake">
              “多合一”登录
            </button>
            <button type="button" className="etax-toplink etax-toplink-en fake">
              <svg className="etax-toplink-globe" width="14" height="14" viewBox="0 0 24 24" aria-hidden>
                <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.6" />
                <path
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  d="M3 12h18M12 3c2.8 3.5 2.8 14.5 0 18M12 3c-2.8 3.5-2.8 14.5 0 18"
                />
              </svg>
              English
            </button>
            <button type="button" className="etax-toplink fake">
              返回首页
            </button>
          </div>
        </div>
      </header>

      <main className="etax-login-main">
        <div className="etax-login-card" aria-label="登录面板">
          <section className="etax-login-scan" aria-label="电子税务局 APP 扫码">
            <p className="etax-scan-title">
              打开<span>电子税务局APP</span>扫一扫
            </p>
            <div className="etax-qr-wrap" aria-hidden>
              <img className="etax-qr-img" src={`${loginAsset}qr-code.png`} alt="" />
              <img className="etax-qr-center-img" src={`${loginAsset}tax-character.png`} alt="" />
            </div>
            <button type="button" className="etax-app-btn fake">
              电子税务局APP
            </button>
          </section>

          <section className="etax-login-panel" aria-label="账号密码登录">
            <div className="etax-login-tabs" role="tablist" aria-label="登录入口">
              {loginTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  className={`etax-login-tab${activeTab === tab.id ? ' active' : ''}`}
                  onClick={() => {
                    setActiveTab(tab.id)
                    setError(null)
                  }}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <form className="etax-login-form" onSubmit={handleSubmit}>
              {activeFields.map((field) => (
                <label className="etax-field" key={`${activeTab}-${field.id}`}>
                  <span className="sr-only">{field.label}</span>
                  <img className="etax-field-icon" src={field.icon} alt="" aria-hidden />
                  <input
                    className="etax-login-input"
                    type={field.type ?? 'text'}
                    autoComplete={field.autoComplete}
                    name={`${activeTab}-${field.id}`}
                    placeholder={field.placeholder}
                    value={valueOf(field.id)}
                    onChange={(ev) => updateField(field.id, ev.target.value)}
                    required={activeTab === 'enterprise'}
                  />
                </label>
              ))}

              <button className="etax-login-submit" type="submit" disabled={loading}>
                {loading ? '登录中…' : '登录'}
              </button>

              <div className="etax-form-links">
                <button type="button" className="etax-form-link fake">
                  忘记密码
                </button>
              </div>

              {error && <p className="err etax-login-error">{error}</p>}

              <div className="etax-other-login">
                <span>其他登录</span>
              </div>
              <div className="etax-other-links">
                <button type="button" className="etax-other-link fake">
                  特定主体登录
                </button>
                <button type="button" className="etax-other-link fake">
                  非居民企业登录
                </button>
              </div>
            </form>
          </section>
        </div>
      </main>

      <footer className="etax-login-footer">
        <div className="etax-login-footer-inner">
          <img className="etax-footer-badge" src={`${loginAsset}footer-gov.png`} alt="" aria-hidden />
          <div className="etax-login-footer-copy">
            <div className="etax-login-footer-line1">
              <span>版权所有：国家税务总局</span>
              <span className="etax-footer-divider" aria-hidden>
                |
              </span>
              <span>链接：用户指南 | 常见问题</span>
              <span className="etax-footer-divider" aria-hidden>
                |
              </span>
              <span>服务热线：12366</span>
            </div>
            <p className="etax-login-footer-note">
              建议您使用IE10及以上版本、Edge、Chrome、Firefox和360等主流浏览器浏览本网站
            </p>
          </div>
        </div>
      </footer>
    </div>
  )
}
