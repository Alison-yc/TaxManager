import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Spin } from 'antd'
import { PdfEmbedViewer } from '../components/PdfEmbedViewer'
import {
  downloadTaxPaymentCert,
  refreshTaxPaymentCertIssueDate,
} from '../lib/taxPaymentCertExport'
import { supabase } from '../lib/supabase'
import type { TaxPaymentCertRecordRow } from '../types/database'

export function TaxPaymentCertRecordPreview() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [row, setRow] = useState<TaxPaymentCertRecordRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [preparing, setPreparing] = useState(true)
  const [previewData, setPreviewData] = useState<ArrayBuffer | null>(null)
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null)
  const loadGenRef = useRef(0)

  useEffect(() => {
    const gen = ++loadGenRef.current
    let cancelled = false

    async function run() {
      if (!id) return
      setPreparing(true)
      setError(null)
      setWarning(null)
      setRow(null)
      setPreviewData(null)
      setPreviewBlob(null)

      const { data, error: qErr } = await supabase
        .from('tax_payment_certificate_records')
        .select('*')
        .eq('id', id)
        .maybeSingle()
      if (cancelled || gen !== loadGenRef.current) return
      if (qErr) {
        setError(qErr.message)
        setPreparing(false)
        return
      }
      if (!data) {
        setError('未找到该完税证明记录')
        setPreparing(false)
        return
      }

      try {
        const result = await refreshTaxPaymentCertIssueDate(data as TaxPaymentCertRecordRow)
        if (cancelled || gen !== loadGenRef.current) return

        const buffer = await result.previewBlob.arrayBuffer()
        setRow({ ...(data as TaxPaymentCertRecordRow), issue_date: result.issueDate })
        setPreviewBlob(result.previewBlob)
        setPreviewData(buffer)
        if (result.warning) setWarning(result.warning)
      } catch (e: unknown) {
        if (cancelled || gen !== loadGenRef.current) return
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        if (!cancelled && gen === loadGenRef.current) setPreparing(false)
      }
    }

    void run()
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    const download = searchParams.get('download')
    if (download !== '1' || !row || preparing) return
    void downloadTaxPaymentCert(row, previewBlob ?? undefined)
      .then(() => {
        if (searchParams.get('return') === 'query') {
          navigate('/tax-payment-cert/query?restoreQuery=export', { replace: true })
        }
      })
      .catch((e: unknown) => {
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [navigate, preparing, previewBlob, row, searchParams])

  async function handleExport() {
    if (!row) return
    setBusy(true)
    setError(null)
    try {
      await downloadTaxPaymentCert(row, previewBlob ?? undefined)
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
      {warning && <p className="warn banner">{warning}</p>}
      {preparing && (
        <div className="etax-pdf-preview-loading">
          <Spin description="正在更新填发日期并加载预览…" />
        </div>
      )}

      {row && previewData && !preparing && (
        <section className="etax-record-workbench">
          <div className="no-print etax-record-toolbar">
            <div className="etax-record-main-form">
              <span>完税证明号码：{row.certificate_no}</span>
              {row.taxpayer_name && <span> · {row.taxpayer_name}</span>}
              {row.issue_date && <span> · 填发日期 {row.issue_date}</span>}
            </div>
            <Button size="small" onClick={() => void handleExport()} loading={busy}>
              导出
            </Button>
          </div>
          <div className="vat-preview-frame etax-record-preview-frame etax-pdf-preview-shell">
            <PdfEmbedViewer
              fileName={row.source_file_name}
              pdfData={previewData}
              reloadKey={row.issue_date ?? row.created_at}
              showDownload={false}
            />
          </div>
        </section>
      )}
    </div>
  )
}
