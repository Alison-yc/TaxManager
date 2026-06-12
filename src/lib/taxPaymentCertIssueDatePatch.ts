import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import * as pdfjsLib from 'pdfjs-dist'
import { extractCertKaitiFontBytes } from './extractCertKaitiFont'
import { fmtCertIssueDate } from './taxPaymentCertFormat'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

type TextItem = {
  str: string
  x: number
  y: number
  width: number
  height: number
}

type IssueDateRegion = {
  pageIndex: number
  coverX: number
  coverY: number
  coverW: number
  coverH: number
  textX: number
  textY: number
  fontSize: number
}

const CERT_KAITI_FALLBACK_FONT_URL = '/fonts/CertKaiTi.ttf'

let cachedFallbackFontBytes: ArrayBuffer | null = null

async function loadFallbackKaitiFontBytes(): Promise<ArrayBuffer> {
  if (cachedFallbackFontBytes) return cachedFallbackFontBytes
  const res = await fetch(CERT_KAITI_FALLBACK_FONT_URL)
  if (!res.ok) throw new Error('填发日期楷体字体加载失败')
  cachedFallbackFontBytes = await res.arrayBuffer()
  return cachedFallbackFontBytes
}

async function resolveCertIssueDateFontBytes(sourcePdf: ArrayBuffer): Promise<Uint8Array> {
  const embedded = await extractCertKaitiFontBytes(sourcePdf)
  if (embedded) return embedded
  return new Uint8Array(await loadFallbackKaitiFontBytes())
}

function asTextItems(items: unknown[]): TextItem[] {
  return items
    .filter((item): item is { str: string; transform: number[]; width: number; height?: number } => {
      return (
        typeof item === 'object' &&
        item !== null &&
        'str' in item &&
        typeof item.str === 'string' &&
        item.str.trim().length > 0
      )
    })
    .map((item) => ({
      str: item.str.trim(),
      x: item.transform[4],
      y: item.transform[5],
      width: item.width,
      height: item.height || Math.abs(item.transform[3]) || 10.5,
    }))
}

/** 定位表格式完税证明首页「填发日期」与「税务机关」之间的可覆盖区域 */
export async function findIssueDateRegion(data: ArrayBuffer): Promise<IssueDateRegion | null> {
  const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(data.slice(0)) })
  const pdf = await loadingTask.promise

  try {
    const page = await pdf.getPage(1)
    const items = asTextItems((await page.getTextContent()).items)

    const label = items.find((it) => it.str.includes('填发日期'))
    if (!label) return null

    const authority = items.find(
      (it) =>
        it.str.includes('税务机关') &&
        Math.abs(it.y - label.y) <= 3 &&
        it.x > label.x + label.width,
    )
    if (!authority) return null

    const lineY = label.y
    const dateParts = items.filter((it) => {
      if (Math.abs(it.y - lineY) > 3) return false
      if (it.x <= label.x + label.width) return false
      if (it.x >= authority.x) return false
      const s = it.str
      return (
        /^\d{1,4}$/.test(s) ||
        /^[年月日]$/.test(s) ||
        /^\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日$/.test(s)
      )
    })

    const fontSize = dateParts[0]?.height ?? label.height ?? 10.5
    const textX = dateParts.length > 0 ? Math.min(...dateParts.map((it) => it.x)) : label.x + label.width + 8
    const maxDateEnd =
      dateParts.length > 0 ? Math.max(...dateParts.map((it) => it.x + it.width)) : textX + 80

    const coverX = label.x + label.width + 2
    const coverEnd = Math.max(maxDateEnd + 6, authority.x - 4)
    const coverW = Math.max(coverEnd - coverX, 40)
    const coverH = fontSize + 6

    return {
      pageIndex: 0,
      coverX,
      coverY: lineY - 3,
      coverW,
      coverH,
      textX,
      textY: lineY,
      fontSize,
    }
  } finally {
    await loadingTask.destroy()
  }
}

/** 将 PDF 中的填发日期替换为指定日期（保持原 PDF 版式） */
export async function patchTaxPaymentCertIssueDate(pdfBlob: Blob, issueDateIso: string): Promise<Blob> {
  const data = await pdfBlob.arrayBuffer()
  const region = await findIssueDateRegion(data)
  if (!region) {
    throw new Error('未能定位 PDF 中的填发日期区域，请确认文件为表格式税收完税证明')
  }

  const pdfDoc = await PDFDocument.load(data)
  pdfDoc.registerFontkit(fontkit)
  const fontBytes = await resolveCertIssueDateFontBytes(data)
  const font = await pdfDoc.embedFont(fontBytes)
  const page = pdfDoc.getPages()[region.pageIndex]
  const newText = fmtCertIssueDate(issueDateIso)

  page.drawRectangle({
    x: region.coverX,
    y: region.coverY,
    width: region.coverW,
    height: region.coverH,
    color: rgb(1, 1, 1),
    borderWidth: 0,
  })

  page.drawText(newText, {
    x: region.textX,
    y: region.textY,
    size: region.fontSize,
    font,
    color: rgb(0, 0, 0),
  })

  const bytes = await pdfDoc.save()
  return new Blob([Uint8Array.from(bytes)], { type: 'application/pdf' })
}
