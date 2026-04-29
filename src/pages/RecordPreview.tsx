import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { VatFormGrid } from '../components/VatFormGrid'
import { exportPreviewDomToPdf } from '../lib/excelExport'
import { isImportedContent } from '../lib/excelImport'
import { supabase } from '../lib/supabase'
import type { FormDataRow } from '../types/database'

export function RecordPreview() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [row, setRow] = useState<FormDataRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const captureRef = useRef<HTMLDivElement>(null)
  const autoPdfRunRef = useRef(0)

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!id) return
      setError(null)
      const { data, error: qErr } = await supabase
        .from('form_data')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (cancelled) return
      if (qErr) {
        setError(qErr.message)
        setRow(null)
        return
      }
      setRow(data as FormDataRow)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [id])

  const content = row?.content

  /** 列表「导出」：带 ?pdf=1 打开本页则自动导出一次 PDF 并移除 query */
  useEffect(() => {
    const wantPdf = searchParams.get('pdf') === '1'
    if (!wantPdf || !id) return
    if (!row || !content) return
    if (!isImportedContent(content)) {
      navigate(`/record/${id}`, { replace: true })
      return
    }

    const runToken = ++autoPdfRunRef.current

    let cancelled = false
    const t = window.setTimeout(() => {
      if (cancelled || runToken !== autoPdfRunRef.current) return
      if (!captureRef.current) return

      void (async () => {
        setBusy(true)
        setError(null)
        try {
          await exportPreviewDomToPdf(captureRef.current!)
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          setBusy(false)
          if (!cancelled) {
            navigate(`/record/${id}`, { replace: true })
          }
        }
      })()
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [id, row, content, searchParams, navigate])

  async function handleExportPdf() {
    if (!captureRef.current || !content) return
    setBusy(true)
    setError(null)
    try {
      await exportPreviewDomToPdf(captureRef.current)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!id) return <p className="muted">缺少记录 ID</p>

  return (
    <div className="shell wide">
      <div className="no-print breadcrumb-row">
        <Link to="/query" className="back-link">
          ← 返回申报信息查询
        </Link>
      </div>

      <header className="header preview-header">
        <div>
          <h1 className="title">申报表预览</h1>
          <p className="muted">
            {row ? `创建于 ${new Date(row.created_at).toLocaleString()}` : ''}
          </p>
        </div>
        <div className="header-actions no-print">
          <button
            type="button"
            className="btn primary"
            onClick={() => void handleExportPdf()}
            disabled={!row || !isImportedContent(content) || busy}
          >
            {busy ? '生成 PDF…' : '导出 PDF'}
          </button>
        </div>
      </header>

      {error && <p className="err banner">{error}</p>}

      {!row && !error && <p className="muted">加载中…</p>}

      {row && content && isImportedContent(content) && (
        <>
          <p className="muted small no-print">
            下列版式与导入时的表格网格一致；「导出 PDF」为整页截图，效果接近税局表样。
          </p>
          <div className="vat-preview-frame">
            <VatFormGrid ref={captureRef} grid={content.grid} merges={content.merges} />
          </div>
        </>
      )}

      {row && content && !isImportedContent(content) && (
        <div className="preview-card">
          <p className="muted">
            该记录为旧版导入数据，未保存整表网格，本页无法导出税表样式；请在列表中重新导入同模版
            Excel 后再试。
          </p>
          <pre className="preview-json">{JSON.stringify(content, null, 2)}</pre>
        </div>
      )}
    </div>
  )
}
