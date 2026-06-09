import { useEffect, useRef, useState } from 'react'
import { Button, Spin } from 'antd'
import * as pdfjsLib from 'pdfjs-dist'
import { createSignedPdfUrl, downloadPdfBlob, downloadPdfFile } from '../lib/pdfStorage'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

type Props = {
  fileName: string
  /** Supabase Storage 路径；与 iframeUrl 二选一 */
  storagePath?: string
  /** 直接嵌入的 PDF URL（如 blob URL）；传入时不再请求 Storage */
  iframeUrl?: string | null
  /** iframeUrl 模式下由父组件控制加载态 */
  loading?: boolean
  showDownload?: boolean
  /** 纯内容展示，不使用浏览器 PDF 阅读器工具栏 */
  chromeless?: boolean
  onDownload?: () => void | Promise<void>
  className?: string
}

async function loadPdfData(storagePath?: string, iframeUrl?: string | null): Promise<ArrayBuffer> {
  if (iframeUrl) {
    const res = await fetch(iframeUrl)
    if (!res.ok) throw new Error('PDF 预览加载失败')
    return res.arrayBuffer()
  }
  if (!storagePath) throw new Error('缺少 PDF 路径')
  const blob = await downloadPdfBlob(storagePath)
  return blob.arrayBuffer()
}

function ChromelessPdfCanvas({ data }: { data: ArrayBuffer }) {
  const pagesHostRef = useRef<HTMLDivElement>(null)
  const [rendering, setRendering] = useState(true)
  const [renderError, setRenderError] = useState<string | null>(null)

  useEffect(() => {
    const pagesHost = pagesHostRef.current
    if (!pagesHost) return

    let alive = true
    pagesHost.replaceChildren()
    setRendering(true)
    setRenderError(null)

    async function renderPages() {
      try {
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data) }).promise

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (!alive || !pagesHostRef.current) return
          const hostEl = pagesHostRef.current
          const page = await pdf.getPage(pageNum)
          const baseViewport = page.getViewport({ scale: 1 })
          const hostWidth = hostEl.clientWidth > 0 ? hostEl.clientWidth : baseViewport.width
          const scale = hostWidth / baseViewport.width
          const viewport = page.getViewport({ scale })
          const outputScale = Math.min(window.devicePixelRatio || 1, 3)
          const canvas = document.createElement('canvas')
          const ctx = canvas.getContext('2d')
          if (!ctx) throw new Error('PDF 画布初始化失败')

          canvas.width = Math.floor(viewport.width * outputScale)
          canvas.height = Math.floor(viewport.height * outputScale)
          canvas.style.width = `${Math.floor(viewport.width)}px`
          canvas.style.height = `${Math.floor(viewport.height)}px`
          canvas.className = 'etax-pdf-chromeless-page'

          await page.render({
            canvasContext: ctx,
            viewport,
            canvas,
            transform: outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined,
          }).promise
          if (!alive || !pagesHostRef.current) return
          pagesHostRef.current.appendChild(canvas)
        }
      } catch (e: unknown) {
        if (alive) setRenderError(e instanceof Error ? e.message : String(e))
      } finally {
        if (alive) setRendering(false)
      }
    }

    void renderPages()

    return () => {
      alive = false
      pagesHost.replaceChildren()
    }
  }, [data])

  return (
    <div className="etax-pdf-chromeless-wrap">
      {rendering && (
        <div className="etax-pdf-preview-loading etax-pdf-chromeless-loading">
          <Spin description="正在加载 PDF…" />
        </div>
      )}
      {renderError && <p className="err banner">{renderError}</p>}
      <div ref={pagesHostRef} className="etax-pdf-chromeless" />
    </div>
  )
}

export function PdfEmbedViewer({
  storagePath,
  iframeUrl,
  loading = false,
  fileName,
  showDownload = true,
  chromeless = true,
  onDownload,
  className = '',
}: Props) {
  const [signedUrl, setSignedUrl] = useState<string | null>(null)
  const [loadedPdf, setLoadedPdf] = useState<{ key: string; data: ArrayBuffer } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const useDirectUrl = iframeUrl !== undefined
  const displayUrl = useDirectUrl ? iframeUrl : signedUrl
  const pdfLoadKey = storagePath ?? iframeUrl ?? ''

  useEffect(() => {
    if (chromeless || useDirectUrl || !storagePath) return
    let alive = true
    void createSignedPdfUrl(storagePath)
      .then((signed) => {
        if (alive) setSignedUrl(signed)
      })
      .catch((e: unknown) => {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [storagePath, useDirectUrl, chromeless])

  useEffect(() => {
    if (!chromeless) return
    if (useDirectUrl && !iframeUrl) return
    if (!useDirectUrl && !storagePath) return

    let alive = true

    void (async () => {
      try {
        const data = useDirectUrl
          ? await loadPdfData(undefined, iframeUrl)
          : await loadPdfData(storagePath)
        if (alive) {
          setError(null)
          setLoadedPdf({ key: pdfLoadKey, data })
        }
      } catch (e: unknown) {
        if (alive) setError(e instanceof Error ? e.message : String(e))
      }
    })()

    return () => {
      alive = false
    }
  }, [chromeless, storagePath, iframeUrl, useDirectUrl, pdfLoadKey])

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

  const pdfReady = loadedPdf?.key === pdfLoadKey
  const showSpinner = chromeless
    ? useDirectUrl
      ? loading || (!pdfReady && !error)
      : !pdfReady && !error
    : useDirectUrl
      ? loading
      : !displayUrl && !error

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
          <Spin description={useDirectUrl ? '正在生成 PDF 预览…' : '正在加载 PDF…'} />
        </div>
      )}
      {chromeless && pdfReady && loadedPdf && (
        <ChromelessPdfCanvas key={pdfLoadKey} data={loadedPdf.data} />
      )}
      {!chromeless && displayUrl && (
        <iframe
          title={fileName}
          className="etax-pdf-preview-frame"
          src={`${displayUrl}#toolbar=0&navpanes=0&scrollbar=0&statusbar=0&view=FitH`}
        />
      )}
    </div>
  )
}
