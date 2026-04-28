import { NavLink, Outlet } from 'react-router-dom'

type Props = {
  userEmail: string | null
  onSignOut: () => void
}

export function AppShell({ userEmail, onSignOut }: Props) {
  return (
    <div className="app-layout">
      <header className="topbar" aria-label="主导航">
        <div className="topbar-brand">税务表单管理</div>
        <nav className="topbar-nav">
          <NavLink
            to="/"
            className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`}
            end
          >
            数据列表
          </NavLink>
          <span className="nav-item disabled" title="本期未启用">
            统计分析
          </span>
          <span className="nav-item disabled" title="本期未启用">
            系统配置
          </span>
          <span className="nav-item disabled" title="本期未启用">
            账号与权限
          </span>
        </nav>
        <div className="topbar-user muted small">
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
