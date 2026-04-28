import { NavLink, Outlet } from 'react-router-dom'

type Props = {
  userEmail: string | null
  onSignOut: () => void
}

function UserIcon() {
  return (
    <svg className="topbar-user-svg" width="22" height="22" viewBox="0 0 24 24" aria-hidden>
      <circle cx="12" cy="9" r="4" fill="currentColor" opacity="0.85" />
      <path
        fill="currentColor"
        opacity="0.55"
        d="M5 20c.7-3.2 4-5 7-5s6.3 1.8 7 5"
      />
    </svg>
  )
}

/**
 * 顶栏：仅「首页」「申报信息查询」为真实路由；其余保持悬停高亮、无跳转。
 * 顶条与徽标用 CSS/SVG 还原风格，不嵌整页设计截图。
 */
export function AppShell({ userEmail, onSignOut }: Props) {
  return (
    <div className="app-layout etax-shell">
      <div className="etax-top-strip" aria-hidden />
      <header className="topbar" aria-label="主导航">
        <div className="topbar-brand-row">
          <span className="etax-brand-mark" aria-hidden>
            税
          </span>
          <div className="topbar-brand">全国统一规范电子税务局（模拟）</div>
        </div>
        <nav className="topbar-nav">
          <NavLink
            to="/"
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            end
          >
            首页
          </NavLink>
          <NavLink
            to="/query"
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
          >
            申报信息查询
          </NavLink>
          <span className="nav-item fake" title="本期仅占位">
            办税服务厅
          </span>
          <span className="nav-item fake" title="本期仅占位">
            互动中心
          </span>
          <span className="nav-item fake" title="本期仅占位">
            公众服务
          </span>
        </nav>
        <div className="topbar-user muted small">
          <UserIcon />
          {userEmail ? <span className="topbar-email">{userEmail}</span> : null}
          <button type="button" className="btn ghost sm" onClick={onSignOut}>
            退出
          </button>
        </div>
      </header>
      <main className="main-panel">
        <Outlet />
      </main>
    </div>
  )
}
