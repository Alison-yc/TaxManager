import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button } from 'antd'
import { PdfEmbedViewer } from '../components/PdfEmbedViewer'
import { downloadPdfFile } from '../lib/pdfStorage'
import { supabase } from '../lib/supabase'
import type { TaxPaymentCertRecordRow } from '../types/database'

export function TaxPaymentCertRecordPreview() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [row, setRow] = useState<TaxPaymentCertRecordRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function run() {
      if (!id) return
      const { data, error: qErr } = await supabase
        .from('tax_payment_certificate_records')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (cancelled) return
      if (qErr) {
        setError(qErr.message)
        setRow(null)
        return
      }
      setRow(data as TaxPaymentCertRecordRow | null)
    }
    void run()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    const download = searchParams.get('download')
    if (download !== '1' || !row) return
    void downloadPdfFile(row.storage_path, row.source_file_name)
      .then(() => {
        if (searchParams.get('return') === 'query') {
          navigate('/tax-payment-cert/query?restoreQuery=export', { replace: true })
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
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

  const backTo = '/tax-payment-cert/query'
  const restore = searchParams.get('restoreQuery')

  if (!id) return <p className="muted">缺少记录 ID</p>

  return (
    <div className="etax-record-preview-page">
      <div className="no-print etax-query-bc-bar">
        <Link
          to={restore ? `${backTo}?restoreQuery=${restore}` : backTo}
          className="etax-query-back"
        >
          ← 返回
        </Link>
        <nav className="etax-query-bc" aria-label="面包屑">
          <Link to="/" className="etax-bc-link">
            税务数字账户
          </Link>
          <span className="etax-bc-sep">&gt;</span>
          <span className="etax-bc-plain">证明开具</span>
          <span className="etax-bc-sep">&gt;</span>
          <Link to={backTo} className="etax-bc-link">
            开具税收完税证明
          </Link>
          <span className="etax-bc-sep">&gt;</span>
          <span className="etax-bc-plain etax-bc-current">完税证明预览</span>
        </nav>
      </div>

      {error && <p className="err banner">{error}</p>}
      {!row && !error && <p className="muted">加载中…</p>}

      {row && (
        <section className="etax-record-workbench">
          <div className="no-print etax-record-toolbar">
            <div className="etax-record-main-form">
              <span>完税证明号码：{row.certificate_no}</span>
              {row.taxpayer_name && <span> · {row.taxpayer_name}</span>}
            </div>
            <Button size="small" onClick={() => void handleExport()} loading={busy}>
              导出
            </Button>
          </div>
          <div className="vat-preview-frame etax-record-preview-frame etax-pdf-preview-shell">
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
