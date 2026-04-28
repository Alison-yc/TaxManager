import * as XLSX from 'xlsx'
import html2canvas from 'html2canvas'
import { jsPDF } from 'jspdf'
import type { ImportedExcelContent } from './excelImport'

/** 由保存的 grid + merges 生成 xlsx（版式与导入模版一致） */
export function downloadFilledExcelFile(
  content: ImportedExcelContent,
  baseName = '增值税及附加税费申报表',
): void {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(content.grid as (string | number | boolean)[][])
  if (content.merges?.length) {
    ws['!merges'] = content.merges
  }
  XLSX.utils.book_append_sheet(wb, ws, content.excel.sheetName || 'Sheet1')
  const safe = baseName.replace(/[/\\?%*:|"<>]/g, '-')
  XLSX.writeFile(wb, `${safe}.xlsx`, { bookType: 'xlsx' })
}

/** 将预览用的 DOM 截图写入横向 A4 PDF 并下载（版式接近屏幕上的整表） */
export async function exportPreviewDomToPdf(
  element: HTMLElement,
  fileName = '增值税及附加税费申报表.pdf',
): Promise<void> {
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
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  })

  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  /** 与打印机可打印区相比尽量贴边，显著减小 PDF 左右留白 */
  const margin = 20
  const contentW = pageW - margin * 2
  const contentH = pageH - margin * 2

  const imgW = canvas.width
  const imgH = canvas.height
  if (imgW <= 0 || imgH <= 0) {
    pdf.save(fileName.replace(/[/\\?%*:|"<>]/g, '-'))
    return
  }

  /** 以页面宽度为基准等比缩放后的总高度（mm）。先铺满宽，避免「先限高」导致两侧大片空白。 */
  const totalHmm = (imgH / imgW) * contentW

  if (totalHmm <= contentH) {
    const y = margin + (contentH - totalHmm) / 2
    pdf.addImage(canvas, 'JPEG', margin, y, contentW, totalHmm)
    pdf.save(fileName.replace(/[/\\?%*:|"<>]/g, '-'))
    return
  }

  /**
   * 单页在「铺满宽度」下可容纳的截图像素高度（再高了就分页）。
   * contentH(mm) 对应原图上一段高度 hPx：因整宽均映射到 contentW，比例一致。
   */
  const stripePx = (contentH * imgW) / contentW

  let ySrc = 0
  while (ySrc < imgH) {
    const hPx = Math.min(stripePx, imgH - ySrc)
    const slice = document.createElement('canvas')
    slice.width = imgW
    slice.height = hPx
    const ctx = slice.getContext('2d')
    if (!ctx) break
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, imgW, hPx)
    ctx.drawImage(canvas, 0, ySrc, imgW, hPx, 0, 0, imgW, hPx)

    const hMm = (hPx / imgW) * contentW
    pdf.addImage(slice, 'JPEG', margin, margin, contentW, hMm)

    ySrc += hPx
    if (ySrc < imgH) {
      pdf.addPage('a4', 'landscape')
    }
  }

  pdf.save(fileName.replace(/[/\\?%*:|"<>]/g, '-'))
}
