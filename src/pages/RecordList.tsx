import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { parseExcelFile } from '../lib/excelImport'
import type { FormDataRow, Json } from '../types/database'

function getSummary(row: FormDataRow): string {
  const c = row.content as Record<string, unknown> | null
  if (c && typeof c.summary === 'string') return c.summary
  return '—'
}

export function RecordList() {
  const [rows, setRows] = useState<FormDataRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [importBusy, setImportBusy] = useState(false)

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
    const id = window.setTimeout(() => {
      void load()
    }, 0)
    return () => window.clearTimeout(id)
  }, [load])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => {
      const sum = getSummary(r).toLowerCase()
      const id = String(r.id).toLowerCase()
      const blob = JSON.stringify(r.content ?? '').toLowerCase()
      return sum.includes(q) || id.includes(q) || blob.includes(q)
    })
  }, [rows, query])

  async function handleFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0]
    ev.target.value = ''
    if (!file) return
    const lower = file.name.toLowerCase()
    if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
      setError('请选择 .xlsx 或 .xls 文件')
      return
    }
    setImportBusy(true)
    setError(null)
    try {
      const buf = await file.arrayBuffer()
      const content = parseExcelFile(buf, file.name) as Json
      const { error: insErr } = await supabase.from('form_data').insert({ content })
      if (insErr) {
        setError(insErr.message)
        return
      }
      await load()
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setImportBusy(false)
    }
  }

  return (
    <div className="shell wide">
      <header className="header">
        <div>
          <h1 className="title">数据列表</h1>
          <p className="muted">
            操作路径：<strong>导入 Excel</strong> → 列表检索 → 点开<strong>预览</strong> →
            <strong>导出 PDF</strong>
          </p>
        </div>
        <div className="header-actions">
          <label className="btn primary">
            {importBusy ? '导入中…' : '导入 Excel'}
            <input
              type="file"
              accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
              className="hidden-file-input"
              onChange={(e) => void handleFile(e)}
              disabled={importBusy}
            />
          </label>
          <button type="button" className="btn" onClick={() => void load()} disabled={loading}>
            刷新
          </button>
        </div>
      </header>

      <div className="toolbar">
        <label className="search-label">
          检索摘要/内容
          <input
            className="input search-input"
            type="search"
            placeholder="按摘要、编号或表里文字筛选…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      </div>

      {error && <p className="err banner">{error}</p>}

      {loading ? (
        <p className="muted">加载中…</p>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th className="nowrap">录入时间</th>
                <th>可检索摘要</th>
                <th className="col-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={3} className="muted">
                    {rows.length === 0 ? '暂无数据，请使用右上角「导入 Excel」' : '无匹配条目，请修改检索关键词'}
                  </td>
                </tr>
              )}
              {filtered.map((row) => (
                <tr key={row.id}>
                  <td className="nowrap">{new Date(row.created_at).toLocaleString()}</td>
                  <td className="preview">{getSummary(row)}</td>
                  <td className="col-actions">
                    <Link to={`/record/${row.id}`} className="btn sm primary link-btn">
                      预览与导出
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
