import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Select } from 'antd'
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

  const pdfFileName = useMemo(() => {
    if (content && isImportedContent(content)) {
      return `${content.excel.fileName.replace(/\.[^.]+$/, '')}.pdf`
    }
    return '增值税及附加税费申报表.pdf'
  }, [content])

  /** 列表「导出」：带 ?pdf=1 打开本页则自动导出一次 PDF 并移除 query */
  useEffect(() => {
    const wantPdf = searchParams.get('pdf') === '1'
    const shouldReturnQuery = searchParams.get('return') === 'query'
    if (!wantPdf || !id) return
    if (!row || !content) return
    if (!isImportedContent(content)) {
      navigate(shouldReturnQuery ? '/query' : `/record/${id}`, { replace: true })
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
          await exportPreviewDomToPdf(captureRef.current!, pdfFileName)
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          setBusy(false)
          if (!cancelled) {
            navigate(shouldReturnQuery ? '/query' : `/record/${id}`, { replace: true })
          }
        }
      })()
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [id, row, content, searchParams, navigate, pdfFileName])

  async function handleExportPdf() {
    if (!captureRef.current || !content) return
    setBusy(true)
    setError(null)
    try {
      await exportPreviewDomToPdf(captureRef.current, pdfFileName)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (!id) return <p className="muted">缺少记录 ID</p>

  return (
    <div className="etax-record-preview-page">
      <div className="no-print etax-query-bc-bar">
        <Link to="/query" className="etax-query-back">
          ← 返回
        </Link>
        <nav className="etax-query-bc" aria-label="面包屑">
          <Link to="/" className="etax-bc-link">
            税务数字账户
          </Link>
          <span className="etax-bc-sep">&gt;</span>
          <span className="etax-bc-plain">账户查询</span>
          <span className="etax-bc-sep">&gt;</span>
          <Link to="/query" className="etax-bc-link">
            申报信息查询
          </Link>
          <span className="etax-bc-sep">&gt;</span>
          <span className="etax-bc-plain etax-bc-current">申报信息查询详情</span>
        </nav>
      </div>

      {error && <p className="err banner">{error}</p>}

      {!row && !error && <p className="muted">加载中…</p>}

      {row && content && isImportedContent(content) && (
        <section className="etax-record-workbench">
          <div className="no-print etax-record-toolbar">
            <label className="etax-record-main-form">
              <span>主列表单：</span>
              <Select
                size="small"
                value="vat-main"
                options={[
                  {
                    value: 'vat-main',
                    label: '增值税及附加税费申报表（一般纳税人适用）',
                  },
                ]}
                style={{ width: 300 }}
              />
            </label>
            <Button
              size="small"
              onClick={() => void handleExportPdf()}
              disabled={!row || !isImportedContent(content) || busy}
            >
              {busy ? '生成中…' : '导出'}
            </Button>
          </div>

          <div className="vat-preview-frame etax-record-preview-frame">
            <VatFormGrid ref={captureRef} grid={content.grid} merges={content.merges} />
          </div>
        </section>
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

      <footer className="no-print etax-record-footer">
        <p>主管税务机关：国家税务总局河北省电子税务局</p>
        <p>本页面为申报信息查询详情预览，导出 PDF 以当前申报表版式生成。</p>
      </footer>
    </div>
  )
}
