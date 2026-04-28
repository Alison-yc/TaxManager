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

  const imgData = canvas.toDataURL('image/jpeg', 0.92)
  const pdf = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  })

  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 6
  const props = pdf.getImageProperties(imgData)

  let drawW = pageW - margin * 2
  let drawH = (props.height * drawW) / props.width

  const maxH = pageH - margin * 2
  if (drawH > maxH) {
    drawH = maxH
    drawW = (props.width * drawH) / props.height
  }

  const x = (pageW - drawW) / 2
  const y = margin

  pdf.addImage(imgData, 'JPEG', x, y, drawW, drawH)

  pdf.save(fileName.replace(/[/\\?%*:|"<>]/g, '-'))
}
