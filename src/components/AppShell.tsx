import { Link, Outlet, useLocation } from 'react-router-dom'
import { ETAX_PUBLIC } from '../constants/assetBase'
import { PortalNavMegaMenus } from './PortalNavMegaMenus'
import { UserExcelImportMenuItem } from './UserExcelImportMenuItem'

type Props = {
  userEmail: string | null
  onSignOut: () => void
}

/**
 * 门户顶栏：「首页」回根路径；「我要办税 / 我要查询」为悬浮大菜单；Excel 导入在用户菜单「账户中心」；
 * 「申报信息查询」列表页 `/query` 收敛为示意税局明细页——隐藏中间菜单与示意搜索框，仅保留品牌与用户区。
 */
export function AppShell({ userEmail, onSignOut }: Props) {
  const location = useLocation()
  const queryListCompactHeader =
    location.pathname === '/query' || location.pathname.endsWith('/query')

  return (
    <div className="app-layout etax-portal-layout">
      <header
        className={`etax-portal-header${queryListCompactHeader ? ' etax-portal-header--querylist' : ''}`}
        aria-label="门户主导航"
      >
        <div
          className={`etax-portal-header-inner${queryListCompactHeader ? ' etax-portal-header-inner--querylist' : ''}`}
        >
          <div className="etax-portal-brand">
            <img
              className="etax-portal-brand-image"
              src={`${ETAX_PUBLIC}banner-top-left.png`}
              alt="全国统一规范电子税务局 河北"
              width={471}
              height={65}
            />
          </div>

          <div
            className={`etax-portal-center${queryListCompactHeader ? ' etax-portal-center--compact etax-portal-center--hide' : ''}`}
          >
            <nav className="etax-portal-nav" aria-label="主导航菜单">
              <Link to="/" className="etax-portal-nav-item">
                首页
              </Link>
              <PortalNavMegaMenus />
              <span className="etax-portal-nav-item fake">公众服务</span>
              <span className="etax-portal-nav-item fake">地方特色</span>
            </nav>

            <div className="etax-portal-search" role="search">
              <input
                className="etax-portal-search-input"
                type="search"
                placeholder="请输入关键词"
                title="示意搜索框"
                aria-label="搜索（示意）"
              />
              <button type="button" className="etax-portal-search-btn fake" aria-label="搜索">
                <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden>
                  <circle cx="10" cy="10" r="6.5" fill="none" stroke="#fff" strokeWidth="2" />
                  <path d="M15 15l5 5" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          <div className="etax-portal-user etax-portal-user-dropdown" aria-haspopup="true">
            <span className="etax-portal-avatar-wrap" aria-hidden>
              <img
                className="etax-portal-avatar"
                src={`${ETAX_PUBLIC}user-icon.png`}
                alt=""
                width={32}
                height={32}
              />
            </span>
            <div className="etax-portal-user-trigger">
              <span className="etax-portal-user-name">张*超</span>
              <span className="etax-portal-caret" aria-hidden>
                <img
                  className="etax-portal-caret-img"
                  src={`${ETAX_PUBLIC}nav-chevron-down.png`}
                  alt=""
                  aria-hidden
                />
              </span>
            </div>
            {userEmail ? <span className="sr-only">{userEmail}</span> : null}
            <div className="etax-portal-user-menu" role="menu" aria-label="用户菜单">
              <p className="etax-portal-user-menu-greet">欢迎您，张*超</p>
              <div className="etax-portal-user-menu-sep" role="separator" />
              <div className="etax-portal-user-menu-actions">
                <UserExcelImportMenuItem />
                <button type="button" className="etax-portal-user-menu-action" role="menuitem" onClick={onSignOut}>
                  <span className="etax-portal-user-menu-action-ic" aria-hidden>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
                      <path
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                      />
                    </svg>
                  </span>
                  <span>退出登录</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </header>
      <main
        className={`main-panel etax-portal-main${queryListCompactHeader ? ' etax-portal-main--querylist' : ''}`}
      >
        <Outlet />
      </main>
    </div>
  )
}
