import type { ImportedExcelContent } from './excelImport'

/** 由保存的 grid + merges 生成 xlsx（版式与导入模版一致） */
export async function downloadFilledExcelFile(
  content: ImportedExcelContent,
  baseName = '增值税及附加税费申报表',
): Promise<void> {
  const XLSX = await import('xlsx')
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(content.grid as (string | number | boolean)[][])
  if (content.merges?.length) {
    ws['!merges'] = content.merges
  }
  XLSX.utils.book_append_sheet(wb, ws, content.excel.sheetName || 'Sheet1')
  const safe = baseName.replace(/[/\\?%*:|"<>]/g, '-')
  XLSX.writeFile(wb, `${safe}.xlsx`, { bookType: 'xlsx' })
}

/** 将预览用的 DOM 截图按纵向 A4 单页缩放下载，尽量贴近税局导出的整页 PDF。 */
export async function exportPreviewDomToPdf(
  element: HTMLElement,
  fileName = '增值税及附加税费申报表.pdf',
): Promise<void> {
  const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
    import('html2canvas'),
    import('jspdf'),
  ])

  const canvas = await html2canvas(element, {
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
      cloned.style.overflow = 'visible'
      cloned.style.overflowX = 'visible'
      cloned.style.overflowY = 'visible'
      cloned.style.maxHeight = 'none'
      let el: HTMLElement | null = cloned.parentElement
      while (el) {
        el.style.overflow = 'visible'
        el.style.overflowX = 'visible'
        el.style.overflowY = 'visible'
        el.style.maxHeight = 'none'
        el = el.parentElement
      }
    },
  })

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
    pdf.save(fileName.replace(/[/\\?%*:|"<>]/g, '-'))
    return
  }

  const scale = Math.min(contentW / imgW, contentH / imgH)
  const drawW = imgW * scale
  const drawH = imgH * scale
  const x = marginX + (contentW - drawW) / 2
  const y = marginY

  pdf.addImage(canvas, 'JPEG', x, y, drawW, drawH, undefined, 'FAST')

  pdf.save(fileName.replace(/[/\\?%*:|"<>]/g, '-'))
}
