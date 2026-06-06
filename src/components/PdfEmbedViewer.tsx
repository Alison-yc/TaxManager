import { useEffect, useState } from 'react'
import { Button, Spin } from 'antd'
import { createSignedPdfUrl, downloadPdfFile } from '../lib/pdfStorage'

type Props = {
  fileName: string
  /** Supabase Storage 路径；与 iframeUrl 二选一 */
  storagePath?: string
  /** 直接嵌入的 PDF URL（如 blob URL）；传入时不再请求 Storage */
  iframeUrl?: string | null
  /** iframeUrl 模式下由父组件控制加载态 */
  loading?: boolean
  showDownload?: boolean
  onDownload?: () => void | Promise<void>
  className?: string
}

export function PdfEmbedViewer({
  storagePath,
  iframeUrl,
  loading = false,
  fileName,
  showDownload = true,
  onDownload,
  className = '',
}: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const useDirectUrl = iframeUrl !== undefined
  const displayUrl = useDirectUrl ? iframeUrl : signedUrl

  useEffect(() => {
    if (useDirectUrl || !storagePath) return
    let alive = true
    queueMicrotask(() => {
      if (!alive) return
      setError(null)
      setSignedUrl(null)
      void createSignedPdfUrl(storagePath)
        .then((signed) => {
          if (alive) setSignedUrl(signed)
        })
        .catch((e: unknown) => {
          if (alive) setError(e instanceof Error ? e.message : String(e))
        })
    })
    return () => {
      alive = false
    }
  }, [storagePath, useDirectUrl])

  async function handleDownload() {
    setBusy(true)
    setError(null)
    try {
      if (onDownload) {
        await onDownload()
        return
      }
      if (storagePath) {
        await downloadPdfFile(storagePath, fileName)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const showSpinner = useDirectUrl ? loading : !displayUrl && !error

  return (
    <div className={`etax-pdf-preview-wrap ${className}`.trim()}>
      {showDownload && (
        <div className="etax-pdf-preview-toolbar">
          <Button size="small" onClick={() => void handleDownload()} loading={busy}>
            导出
          </Button>
        </div>
      )}
      {error && <p className="err banner">{error}</p>}
      {showSpinner && (
        <div className="etax-pdf-preview-loading">
          <Spin tip={useDirectUrl ? '正在生成 PDF 预览…' : undefined} />
        </div>
      )}
      {displayUrl && (
        <iframe
          title={fileName}
          className="etax-pdf-preview-frame"
          src={`${displayUrl}#toolbar=1&navpanes=0`}
        />
      )}
    </div>
  )
}
