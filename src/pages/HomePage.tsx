import { NavLink } from 'react-router-dom'

/**
 * 首页：参考设计稿用 HTML/CSS 还原版式（不嵌入整页截图）；仅「申报信息查询」进入 /query。
 */
export function HomePage() {
  return (
    <div className="etax-home">
      <section className="etax-banner" aria-label="宣传区">
        <div className="etax-banner-pattern" aria-hidden />
        <div className="etax-banner-inner">
          <div className="etax-banner-copy">
            <span className="etax-banner-badge">通知公告</span>
            <h2 className="etax-banner-title">
              欢迎使用全国统一规范电子税务局
            </h2>
            <p className="etax-banner-lead">
              下方为高频办税与查询入口示意，版式对齐常见电子税务局门户风格。
            </p>
            <ul className="etax-banner-pills" aria-label="快捷入口（示意）">
              <li>
                <button type="button" className="etax-pill fake">
                  政策查询
                </button>
              </li>
              <li>
                <button type="button" className="etax-pill fake">
                  下载中心
                </button>
              </li>
              <li>
                <button type="button" className="etax-pill fake">
                  操作手册
                </button>
              </li>
            </ul>
          </div>
          <div className="etax-banner-art" aria-hidden>
            <div className="etax-banner-art-shape" />
            <div className="etax-banner-art-shape b" />
            <div className="etax-banner-art-shape c" />
          </div>
        </div>
      </section>

      <section className="etax-home-dual" aria-label="办税与查询">
        <div className="etax-home-block etax-home-baoshui">
          <div className="etax-section-heading">
            <span className="etax-section-marker" />
            <h2 className="etax-block-title">我要办税</h2>
          </div>
          <p className="muted small etax-muted-hint">
            以下为模拟入口，仅保留鼠标悬停效果，无实际跳转。
          </p>
          <div className="etax-fake-grid">
            <button type="button" className="etax-fake-tile">
              <span className="etax-fake-tile-ic" aria-hidden>
                报
              </span>
              <span>综合信息报告</span>
            </button>
            <button type="button" className="etax-fake-tile">
              <span className="etax-fake-tile-ic">税</span>
              <span>税费申报及缴纳</span>
            </button>
            <button type="button" className="etax-fake-tile">
              <span className="etax-fake-tile-ic">票</span>
              <span>发票使用</span>
            </button>
            <button type="button" className="etax-fake-tile">
              <span className="etax-fake-tile-ic">⋯</span>
              <span>查看更多</span>
            </button>
          </div>
        </div>

        <div className="etax-home-block etax-home-query">
          <div className="etax-section-heading">
            <span className="etax-section-marker" />
            <h2 className="etax-block-title">我要查询</h2>
          </div>
          <NavLink className="etax-query-card" to="/query" title="进入申报信息查询">
            <span className="etax-query-card-icon" aria-hidden>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
                <circle
                  cx="11"
                  cy="11"
                  r="6.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M16 16l4.2 4.2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </span>
            <span className="etax-query-card-body">
              <span className="etax-query-card-title">申报信息查询</span>
              <span className="etax-query-card-sub">
                查询已申报税费信息，支持导出与预览。
              </span>
            </span>
            <span className="etax-query-card-arrow" aria-hidden>
              ›
            </span>
          </NavLink>
        </div>
      </section>

      <section className="etax-rec-block" aria-labelledby="etax-rec-title">
        <div className="etax-section-heading">
          <span className="etax-section-marker" />
          <h2 id="etax-rec-title" className="etax-block-title">
            为你推荐
          </h2>
        </div>
        <ul className="etax-rec-cards">
          <li>
            <button type="button" className="etax-rec-card fake">
              <span className="etax-rec-card-h">纳税人学堂</span>
              <span className="etax-rec-card-d">操作指引与视频（示意）</span>
            </button>
          </li>
          <li>
            <button type="button" className="etax-rec-card fake">
              <span className="etax-rec-card-h">常见问答</span>
              <span className="etax-rec-card-d">减税降费政策（示意）</span>
            </button>
          </li>
          <li>
            <button type="button" className="etax-rec-card fake">
              <span className="etax-rec-card-h">互动交流</span>
              <span className="etax-rec-card-d">意见建议（示意）</span>
            </button>
          </li>
        </ul>
      </section>
    </div>
  )
}
