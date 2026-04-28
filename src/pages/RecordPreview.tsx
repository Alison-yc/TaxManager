import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { VatFormGrid } from '../components/VatFormGrid'
import { downloadFilledExcelFile, exportPreviewDomToPdf } from '../lib/excelExport'
import { isImportedContent } from '../lib/excelImport'
import { supabase } from '../lib/supabase'
import type { FormDataRow } from '../types/database'

export function RecordPreview() {
  const { id } = useParams<{ id: string }>()
  const [row, setRow] = useState<FormDataRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const captureRef = useRef<HTMLDivElement>(null)

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

  function handleExportExcel() {
    if (!content || !isImportedContent(content)) {
      setError('当前记录不含可导出的表格网格，请重新导入模版 Excel')
      return
    }
    try {
      downloadFilledExcelFile(content)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  if (!id) return <p className="muted">缺少记录 ID</p>

  return (
    <div className="shell wide">
      <div className="no-print breadcrumb-row">
        <Link to="/" className="back-link">
          ← 返回列表
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
            className="btn"
            onClick={handleExportExcel}
            disabled={!row || !isImportedContent(content)}
          >
            下载 Excel
          </button>
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
            下列版式与导入时的 Excel 行列一致；导出 PDF 为整表截图，效果接近税局表样。若需与本地 Excel
            「另存为 PDF」完全一致，建议同时保留「下载 Excel」在本地另存。
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
