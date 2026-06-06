async function capturePreviewCanvas(element: HTMLElement) {
  const { default: html2canvas } = await import('html2canvas')
  return html2canvas(element, {
    scale: Math.min(3, Math.max(2, (window.devicePixelRatio || 1) * 1.8)),
    logging: false,
    useCORS: true,
    backgroundColor: '#ffffff',
    width: element.scrollWidth,
    height: element.scrollHeight,
    windowWidth: element.scrollWidth,
    windowHeight: element.scrollHeight,
    onclone: (_doc, cloned) => {
      if (!(cloned instanceof HTMLElement)) return
      cloned.style.opacity = '1'
      cloned.style.visibility = 'visible'
      let el: HTMLElement | null = cloned
      while (el) {
        el.style.opacity = '1'
        el.style.visibility = 'visible'
        el.style.overflow = 'visible'
        el.style.overflowX = 'visible'
        el.style.overflowY = 'visible'
        el.style.maxHeight = 'none'
        el.style.transform = 'none'
        el = el.parentElement
      }
    },
  })
}

/** 等待离屏/透明网格完成布局后再截图 */
export async function waitForCaptureLayout(element: HTMLElement): Promise<void> {
  await new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
  for (let i = 0; i < 30; i++) {
    if (element.scrollWidth >= 200 && element.scrollHeight >= 200) return
    await new Promise((r) => window.setTimeout(r, 50))
  }
}

/** 将预览 DOM 渲染为 PDF Blob，供 iframe 嵌入预览或下载。 */
export async function renderPreviewDomToPdfBlob(element: HTMLElement): Promise<Blob> {
  const [{ jsPDF }, canvas] = await Promise.all([import('jspdf'), capturePreviewCanvas(element)])

  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  })

  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const marginX = 20
  const marginY = 16
  const contentW = pageW - marginX * 2
  const contentH = pageH - marginY * 2

  const imgW = canvas.width
  const imgH = canvas.height
  if (imgW <= 0 || imgH <= 0) {
    return pdf.output('blob')
  }

  const scale = Math.min(contentW / imgW, contentH / imgH)
  const drawW = imgW * scale
  const drawH = imgH * scale
  const x = marginX + (contentW - drawW) / 2
  const y = marginY

  pdf.addImage(canvas, 'JPEG', x, y, drawW, drawH, undefined, 'FAST')
  return pdf.output('blob')
}

export function downloadPdfBlob(blob: Blob, fileName: string): void {
  const safeName = fileName.replace(/[/\\?%*:|"<>]/g, '-')
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeName
  a.click()
  URL.revokeObjectURL(url)
}

/** 将预览用的 DOM 截图按纵向 A4 单页缩放下载，尽量贴近税局导出的整页 PDF。 */
export async function exportPreviewDomToPdf(
  element: HTMLElement,
  fileName = '增值税及附加税费申报表.pdf',
): Promise<void> {
  const blob = await renderPreviewDomToPdfBlob(element)
  downloadPdfBlob(blob, fileName)
}
