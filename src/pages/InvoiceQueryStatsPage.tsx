import { Link, useNavigate } from 'react-router-dom'
import { ETAX_PUBLIC } from '../constants/assetBase'
import { INVOICE_STATS_CARDS } from '../constants/invoiceQuery'

export function InvoiceQueryStatsPage() {
  const navigate = useNavigate()

  return (
    <div className="etax-invoice-stats-page">
      <div className="etax-query-bc-bar">
        <button type="button" className="etax-query-back" onClick={() => navigate('/')}>
          ← 返回
        </button>
        <nav className="etax-query-bc" aria-label="面包屑">
          <Link to="/" className="etax-bc-link">
            税务数字账户
          </Link>
          <span className="etax-bc-sep">&gt;</span>
          <span className="etax-bc-plain">发票业务</span>
          <span className="etax-bc-sep">&gt;</span>
          <span className="etax-bc-plain etax-bc-current">发票查询统计</span>
        </nav>
      </div>

      <section className="etax-invoice-stats-panel">
        <h1 className="etax-invoice-stats-title">发票查询统计</h1>
        <div className="etax-invoice-stats-grid">
          {INVOICE_STATS_CARDS.map((card) => (
            <button
              key={card.key}
              type="button"
              className="etax-invoice-stats-card"
              onClick={() => {
                if ('route' in card && card.route) {
                  navigate(card.route)
                }
              }}
            >
              <span className="etax-invoice-stats-card-icon" aria-hidden>
                <img
                  src={`${ETAX_PUBLIC}invoice-stats/${encodeURIComponent(card.icon)}`}
                  alt=""
                  width={48}
                  height={48}
                />
              </span>
              <span className="etax-invoice-stats-card-body">
                <strong>{card.title}</strong>
                <span>{card.desc}</span>
              </span>
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
