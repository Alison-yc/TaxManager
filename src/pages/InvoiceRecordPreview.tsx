import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from 'antd'
import { PdfEmbedViewer } from '../components/PdfEmbedViewer'
import { downloadPdfFile } from '../lib/pdfStorage'
import { supabase } from '../lib/supabase'
import type { InvoiceRecordRow } from '../types/database'

export function InvoiceRecordPreview() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [row, setRow] = useState<InvoiceRecordRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!id) return
      const { data, error: qErr } = await supabase.from('invoice_records').select('*').eq('id', id).maybeSingle()
      if (cancelled) return
      if (qErr) {
        setError(qErr.message)
        setRow(null)
        return
      }
      setRow(data as InvoiceRecordRow)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    if (searchParams.get('preview') !== '1' || !row) return
    const next = new URLSearchParams(searchParams)
    next.delete('preview')
    navigate(`/invoice-query/record/${row.id}${next.toString() ? `?${next.toString()}` : ''}`, {
      replace: true,
    })
  }, [navigate, row, searchParams])

  async function handleExport() {
    if (!row) return
    setBusy(true)
    setError(null)
    try {
      await downloadPdfFile(row.storage_path, row.source_file_name)
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
        <Link to="/invoice-query/full" className="etax-query-back">
          ← 返回
        </Link>
        <nav className="etax-query-bc" aria-label="面包屑">
          <Link to="/" className="etax-bc-link">
            税务数字账户
          </Link>
          <span className="etax-bc-sep">&gt;</span>
          <span className="etax-bc-plain">发票业务</span>
          <span className="etax-bc-sep">&gt;</span>
          <Link to="/invoice-query/full" className="etax-bc-link">
            全量发票查询
          </Link>
          <span className="etax-bc-sep">&gt;</span>
          <span className="etax-bc-plain etax-bc-current">发票详情</span>
        </nav>
      </div>

      {error && <p className="err banner">{error}</p>}
      {!row && !error && <p className="muted">加载中…</p>}

      {row && (
        <section className="etax-record-workbench">
          <div className="no-print etax-record-toolbar">
            <div className="etax-record-main-form">
              <span>数电发票号码：{row.digital_invoice_no}</span>
            </div>
            <Button size="small" onClick={() => void handleExport()} loading={busy}>
              导出
            </Button>
          </div>
          <div className="vat-preview-frame etax-record-preview-frame etax-chromeless-pdf-preview">
            <PdfEmbedViewer
              storagePath={row.storage_path}
              fileName={row.source_file_name}
              showDownload={false}
            />
          </div>
        </section>
      )}
    </div>
  )
}
