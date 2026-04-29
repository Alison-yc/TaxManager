import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { FORM_DATA_EXCEL_IMPORTED_EVENT } from '../lib/formDataExcelUpload'
import { supabase } from '../lib/supabase'
import type { FormDataRow } from '../types/database'

function getSummary(row: FormDataRow): string {
  const c = row.content as Record<string, unknown> | null
  if (c && typeof c.summary === 'string') return c.summary
  return '—'
}

/** 申报种类列展示文案（与导入模版一致即可） */
function getDeclarationKindLabel(): string {
  return '增值税及附加税费申报'
}

function EmptyIllustration() {
  return (
    <svg
      className="etax-empty-svg"
      width="96"
      height="72"
      viewBox="0 0 96 72"
      aria-hidden
    >
      <ellipse cx="48" cy="54" rx="34" ry="10" fill="rgba(20,100,180,0.06)" />
      <rect
        x="24"
        y="18"
        width="48"
        height="38"
        rx="4"
        fill="none"
        stroke="rgba(70,130,200,0.35)"
        strokeWidth="1.8"
        strokeDasharray="5 4"
      />
      <path
        d="M42 32h12M48 26v12"
        stroke="rgba(70,130,200,0.35)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

/**
 * 申报信息查询：版式用页面结构还原；筛选与表格交互不变；Excel 录入从右上角用户菜单「账户中心」进入。
 */
export function QueryPage() {
  const [rows, setRows] = useState<FormDataRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [correctionType, setCorrectionType] = useState('normal')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    const { data, error: qErr } = await supabase
      .from('form_data')
      .select('*')
      .order('created_at', { ascending: false })
    if (qErr) {
      setError(qErr.message)
      setRows([])
    } else {
      setRows((data ?? []) as FormDataRow[])
    }
    setLoading(false)
  }, [])
  useEffect(() => {
    const onImported = () => void load()
    window.addEventListener(FORM_DATA_EXCEL_IMPORTED_EVENT, onImported)
    return () => window.removeEventListener(FORM_DATA_EXCEL_IMPORTED_EVENT, onImported)
  }, [load])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(id)
  }, [load])

  const filtered = useMemo(() => {
    let list = rows
    const q = query.trim().toLowerCase()
    if (q) {
      list = list.filter((r) => {
        const sum = getSummary(r).toLowerCase()
        const idStr = String(r.id).toLowerCase()
        const blob = JSON.stringify(r.content ?? '').toLowerCase()
        return sum.includes(q) || idStr.includes(q) || blob.includes(q)
      })
    }
    return list
  }, [rows, query])

  function handleSearchClick(e: React.FormEvent) {
    e.preventDefault()
    void load()
  }

  return (
    <div className="shell wide etax-query">
      <header className="header etax-query-page-head">
        <div>
          <h1 className="title etax-query-h1">申报信息查询</h1>
          <p className="muted etax-query-sub">按条件筛选申报记录；查询可先拉取全部数据再在前端筛选。</p>
        </div>
        <div className="header-actions">
          <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        </div>
      </header>

      <section className="etax-query-filters-card" aria-labelledby="etax-filter-title">
        <h2 id="etax-filter-title" className="etax-filter-section-title">
          查询条件
        </h2>
        <form className="etax-filter-grid" onSubmit={handleSearchClick}>
          <label className="etax-filter-item">
            申报表种类
            <select className="input etax-input" disabled aria-disabled title="暂未配置枚举">
              <option value="">（暂无枚举数据）</option>
            </select>
          </label>

          <label className="etax-filter-item">
            更正类型
            <select
              className="input etax-input"
              value={correctionType}
              onChange={(ev) => setCorrectionType(ev.target.value)}
            >
              <option value="normal">正常申报</option>
              <option value="wrong">更正申报（占位）</option>
            </select>
          </label>

          <label className="etax-filter-item">
            税款所属期起
            <input
              className="input etax-input"
              type="date"
              value={dateFrom}
              onChange={(ev) => setDateFrom(ev.target.value)}
            />
          </label>

          <label className="etax-filter-item">
            税款所属期止
            <input
              className="input etax-input"
              type="date"
              value={dateTo}
              onChange={(ev) => setDateTo(ev.target.value)}
            />
          </label>

          <div className="etax-filter-submit">
            <button type="submit" className="btn primary">
              查询
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => {
                setCorrectionType('normal')
                setDateFrom('')
                setDateTo('')
                void load()
              }}
            >
              重置条件
            </button>
          </div>
        </form>
      </section>

      <div className="toolbar etax-query-toolbar">
        <label className="search-label">
          在结果中筛选
          <input
            className="input search-input etax-input"
            type="search"
            placeholder="关键字：摘要 / 编号 / 内容片段"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {error && <p className="err banner">{error}</p>}

      <section className="etax-query-result" aria-labelledby="etax-result-title">
        <h2 id="etax-result-title" className="etax-result-title">
          查询结果
        </h2>

        {loading ? (
          <p className="muted etax-loading">加载中…</p>
        ) : (
          <div className="table-wrap etax-table-shell">
            <table className="table etax-query-table">
              <thead>
                <tr>
                  <th style={{ width: '56px' }}>序号</th>
                  <th>种类</th>
                  <th>摘要</th>
                  <th className="nowrap">录入时间</th>
                  <th className="col-actions">导出</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      <div className="etax-empty">
                        <EmptyIllustration />
                        <span className="muted etax-empty-text">
                          {rows.length === 0
                            ? '暂无数据：可使用右上角用户名旁下拉菜单中的「账户中心」导入 Excel'
                            : '无匹配记录，请调整关键字或条件'}
                        </span>
                      </div>
                    </td>
                  </tr>
                )}
                {filtered.map((row, index) => (
                  <tr key={row.id}>
                    <td className="etax-td-num">{index + 1}</td>
                    <td>
                      <Link className="etax-kind-link" to={`/record/${row.id}`}>
                        {getDeclarationKindLabel()}
                      </Link>
                    </td>
                    <td className="preview">{getSummary(row)}</td>
                    <td className="nowrap">{new Date(row.created_at).toLocaleString()}</td>
                    <td className="col-actions">
                      <Link className="btn sm primary link-btn" to={`/record/${row.id}?pdf=1`}>
                        导出
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
