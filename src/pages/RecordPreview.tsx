import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Button, Select } from 'antd'
import { PdfEmbedViewer } from '../components/PdfEmbedViewer'
import { VatFormGrid } from '../components/VatFormGrid'
import { recordExportClick } from '../lib/exportClickLog'
import { exportPreviewDomToPdf, waitForCaptureLayout } from '../lib/excelExport'
import { isImportedContent } from '../lib/excelImport'
import { downloadPdfFile } from '../lib/pdfStorage'
import { supabase } from '../lib/supabase'
import { isImportedPdfContent, type FormDataRow } from '../types/database'

type PreviewVariant = 'declaration' | 'financial'

function buildMainFormLabel(row: FormDataRow | null, fallback: string): string {
  const code = row?.form_code?.trim()
  const label = row?.form_type_label?.trim()
  if (code && label) {
    return label.startsWith(code) ? label : `${code} ${label}`
  }
  return label || fallback
}

export function RecordPreview({ variant = 'declaration' }: { variant?: PreviewVariant }) {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [row, setRow] = useState<FormDataRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const captureRef = useRef<HTMLDivElement>(null)
  const autoPdfRunRef = useRef(0)
  const autoDownloadRunRef = useRef(0)

  const listPath = variant === 'financial' ? '/financial-query' : '/query'
  const listLabel =
    variant === 'financial' ? '财务报表申报信息查询' : '申报信息查询'
  const detailLabel =
    variant === 'financial' ? '财务报表申报信息查询详情' : '申报信息查询详情'

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
  const isPdfRecord = row?.source_type === 'pdf' && content && isImportedPdfContent(content)
  const isExcelRecord = Boolean(row && content && isImportedContent(content) && !isPdfRecord)

  const pdfStoragePath = useMemo(() => {
    if (row?.storage_path) return row.storage_path
    if (content && isImportedPdfContent(content)) return content.pdf.storagePath
    return null
  }, [row?.storage_path, content])

  const pdfFileName = useMemo(() => {
    if (content && isImportedPdfContent(content)) {
      return content.pdf.fileName
    }
    if (content && isImportedContent(content)) {
      return `${content.excel.fileName.replace(/\.[^.]+$/, '')}.pdf`
    }
    return '申报表.pdf'
  }, [content])

  const mainFormLabel = useMemo(
    () => buildMainFormLabel(row, pdfFileName),
    [row, pdfFileName],
  )

  const mainFormSelectValue = row?.form_code?.trim() || 'main'

  const restoreQueryMode = searchParams.get('restoreQuery')
  const queryBackUrl =
    restoreQueryMode === 'export' || restoreQueryMode === 'preview'
      ? `${listPath}?restoreQuery=${restoreQueryMode}`
      : listPath

  /** 列表「导出」：PDF 记录带 ?download=1 自动下载原文件 */
  useEffect(() => {
    const wantDownload = searchParams.get('download') === '1'
    const shouldReturnQuery = searchParams.get('return') === 'query'
    const shouldRestoreQuery = searchParams.get('restoreQuery') === 'export'
    const queryReturnUrl = shouldRestoreQuery
      ? `${listPath}?restoreQuery=export`
      : listPath
    if (!wantDownload || !id || !row || !isPdfRecord || !pdfStoragePath) return

    const runToken = ++autoDownloadRunRef.current
    let cancelled = false

    void (async () => {
      setBusy(true)
      setError(null)
      try {
        await downloadPdfFile(pdfStoragePath, pdfFileName)
      } catch (e: unknown) {
        if (!cancelled && runToken === autoDownloadRunRef.current) {
          setError(e instanceof Error ? e.message : String(e))
        }
      } finally {
        setBusy(false)
        if (!cancelled && runToken === autoDownloadRunRef.current) {
          const recordPath =
            variant === 'financial' ? `/financial-record/${id}` : `/record/${id}`
          navigate(shouldReturnQuery ? queryReturnUrl : recordPath, { replace: true })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    id,
    row,
    isPdfRecord,
    pdfStoragePath,
    pdfFileName,
    searchParams,
    navigate,
    listPath,
    variant,
  ])

  /** 列表「导出」：Excel 记录带 ?pdf=1 自动 DOM 导出 */
  useEffect(() => {
    const wantPdf = searchParams.get('pdf') === '1'
    const shouldReturnQuery = searchParams.get('return') === 'query'
    const shouldRestoreQuery = searchParams.get('restoreQuery') === 'export'
    const queryReturnUrl = shouldRestoreQuery
      ? `${listPath}?restoreQuery=export`
      : listPath
    if (!wantPdf || !id) return
    if (!row || !content) return
    if (isPdfRecord) return
    if (!isImportedContent(content)) {
      const recordPath =
        variant === 'financial' ? `/financial-record/${id}` : `/record/${id}`
      navigate(shouldReturnQuery ? queryReturnUrl : recordPath, { replace: true })
      return
    }
    const importedContent = content

    const runToken = ++autoPdfRunRef.current

    let cancelled = false
    const t = window.setTimeout(() => {
      if (cancelled || runToken !== autoPdfRunRef.current) return
      if (!captureRef.current) return

      void (async () => {
        setBusy(true)
        setError(null)
        try {
          await waitForCaptureLayout(captureRef.current!)
          await exportPreviewDomToPdf(captureRef.current!, pdfFileName)
          void recordExportClick({
            row,
            content: importedContent,
            pdfFileName,
            trigger: 'query_auto',
          })
        } catch (e: unknown) {
          setError(e instanceof Error ? e.message : String(e))
        } finally {
          setBusy(false)
          if (!cancelled) {
            const recordPath =
              variant === 'financial' ? `/financial-record/${id}` : `/record/${id}`
            navigate(shouldReturnQuery ? queryReturnUrl : recordPath, { replace: true })
          }
        }
      })()
    }, 280)

    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [id, row, content, isPdfRecord, searchParams, navigate, pdfFileName, listPath, variant])

  async function handleExportPdf() {
    if (isPdfRecord && pdfStoragePath) {
      setBusy(true)
      setError(null)
      try {
        await downloadPdfFile(pdfStoragePath, pdfFileName)
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setBusy(false)
      }
      return
    }

    if (!captureRef.current || !row || !content || !isImportedContent(content)) return
    setBusy(true)
    setError(null)
    try {
      await exportPreviewDomToPdf(captureRef.current, pdfFileName)
      void recordExportClick({
        row,
        content,
        pdfFileName,
        trigger: 'preview_button',
      })
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
        <Link to={queryBackUrl} className="etax-query-back">
          ← 返回
        </Link>
        <nav className="etax-query-bc" aria-label="面包屑">
          <Link to="/" className="etax-bc-link">
            税务数字账户
          </Link>
          <span className="etax-bc-sep">&gt;</span>
          <span className="etax-bc-plain">账户查询</span>
          <span className="etax-bc-sep">&gt;</span>
          <Link to={queryBackUrl} className="etax-bc-link">
            {listLabel}
          </Link>
          <span className="etax-bc-sep">&gt;</span>
          <span className="etax-bc-plain etax-bc-current">{detailLabel}</span>
        </nav>
      </div>

      {error && <p className="err banner">{error}</p>}

      {!row && !error && <p className="muted">加载中…</p>}

      {row && isExcelRecord && content && isImportedContent(content) && (
        <section className="etax-record-workbench">
          <div className="no-print etax-record-toolbar">
            <label className="etax-record-main-form">
              <span>主列表单：</span>
              <Select
                size="small"
                value={mainFormSelectValue}
                options={[{ value: mainFormSelectValue, label: mainFormLabel }]}
                style={{ minWidth: 320, maxWidth: 520 }}
                popupMatchSelectWidth={false}
              />
            </label>
            <Button size="small" onClick={() => void handleExportPdf()} loading={busy}>
              导出
            </Button>
          </div>
          <div className="vat-preview-frame etax-record-preview-frame">
            <VatFormGrid
              ref={captureRef}
              grid={content.grid}
              merges={content.merges}
              colWidths={content.colWidths}
            />
          </div>
        </section>
      )}

      {row && isPdfRecord && pdfStoragePath && (
        <section className="etax-record-workbench">
          <div className="no-print etax-record-toolbar">
            <label className="etax-record-main-form">
              <span>主列表单：</span>
              <Select
                size="small"
                value={mainFormSelectValue}
                options={[{ value: mainFormSelectValue, label: mainFormLabel }]}
                style={{ minWidth: 320, maxWidth: 520 }}
                popupMatchSelectWidth={false}
              />
            </label>
            <Button size="small" onClick={() => void handleExportPdf()} loading={busy}>
              导出
            </Button>
          </div>
          <div className="vat-preview-frame etax-record-preview-frame etax-declaration-pdf-preview">
            <PdfEmbedViewer
              storagePath={pdfStoragePath}
              fileName={pdfFileName}
              showDownload={false}
            />
          </div>
        </section>
      )}

      {row && content && !isImportedContent(content) && !isPdfRecord && (
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
        <p>
          {isPdfRecord
            ? '本页面为申报信息查询详情预览，上方为主表类型，下方为导入的原始 PDF；导出为原 PDF 文件。'
            : '本页面为申报信息查询详情预览，由 Excel 申报表版式组装展示；导出为 PDF 文件。'}
        </p>
      </footer>
    </div>
  )
}
