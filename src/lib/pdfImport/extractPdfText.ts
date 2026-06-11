import { loadPdfFromFile } from './loadPdfDocument'
import type * as pdfjsLib from 'pdfjs-dist'

export async function extractPdfTextFromDocument(
  pdf: pdfjsLib.PDFDocumentProxy,
): Promise<string> {
  const parts: string[] = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    try {
      const content = await page.getTextContent()
      const pageText = content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ')
      parts.push(pageText)
    } finally {
      page.cleanup()
    }
  }
  return parts.join('\n')
}

export async function extractPdfTextAndPageCount(
  file: File,
): Promise<{ text: string; pageCount: number }> {
  const { pdf, destroy } = await loadPdfFromFile(file)
  try {
    const text = await extractPdfTextFromDocument(pdf)
    return { text, pageCount: pdf.numPages }
  } finally {
    await destroy()
  }
}

export async function extractPdfText(file: File): Promise<string> {
  const { pdf, destroy } = await loadPdfFromFile(file)
  try {
    return await extractPdfTextFromDocument(pdf)
  } finally {
    await destroy()
  }
}

export async function getPdfPageCount(file: File): Promise<number> {
  const { pdf, destroy } = await loadPdfFromFile(file)
  try {
    return pdf.numPages
  } finally {
    await destroy()
  }
}

function pickFirst(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (m?.[1]) return m[1].trim()
  }
  return null
}

export function parseCnDateToIso(text: string): string | null {
  const compact = text.replace(/\s+/g, '')
  const m = compact.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (!m) return null
  const y = m[1]
  const mo = String(Number(m[2])).padStart(2, '0')
  const d = String(Number(m[3])).padStart(2, '0')
  return `${y}-${mo}-${d}`
}

function parseDashDateToIso(text: string): string | null {
  const m = text.trim().match(/(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return null
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
}

/** 从申报 PDF 正文抽取「税款所属期起 / 止」 */
export function extractTaxPeriodFromText(text: string): {
  tax_period_start: string | null
  tax_period_end: string | null
} {
  // 财务报表等：税款所属期起止：2023-01-01至2023-12-31
  const dashRange = text.match(
    /税款所属期(?:起止|起|间)?[：:\s]*(\d{4}-\d{1,2}-\d{1,2})\s*至\s*(\d{4}-\d{1,2}-\d{1,2})/,
  )
  if (dashRange) {
    return {
      tax_period_start: parseDashDateToIso(dashRange[1]),
      tax_period_end: parseDashDateToIso(dashRange[2]),
    }
  }

  const cnDate = '(?:\\d{4}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日)'

  const spacedPeriod = text.match(
    new RegExp(
      `税款所属期间[：:\\s]*(${cnDate})\\s*至\\s*(${cnDate})`,
    ),
  )
  if (spacedPeriod) {
    return {
      tax_period_start: parseCnDateToIso(spacedPeriod[1]),
      tax_period_end: parseCnDateToIso(spacedPeriod[2]),
    }
  }

  const direct = text.match(
    new RegExp(
      `税款所属期(?:间)?[：:\\s]*(${cnDate})\\s*至\\s*((${cnDate})|((?:\\d{4}\\s*年\\s*)?\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日))`,
    ),
  )
  if (direct) {
    const start = parseCnDateToIso(direct[1])
    let endRaw = direct[2] || direct[3] || direct[4] || ''
    if (endRaw && !/\d{4}\s*年/.test(endRaw)) {
      const year = direct[1].match(/(\d{4})\s*年/)?.[1]
      if (year) endRaw = `${year}年${endRaw}`
    }
    return { tax_period_start: start, tax_period_end: parseCnDateToIso(endRaw) }
  }

  const periodText = pickFirst(text, [
    /税款所属期(?:间)?[：:\s]*(\d{4}年\d{1,2}月\d{1,2}日[^\n\r]*?至[^\n\r]*?\d{1,2}日)/,
    /所属期[：:\s]*(\d{4}年\d{1,2}月\d{1,2}日[^\n\r]*?至[^\n\r]*?\d{1,2}日)/,
  ])
  if (!periodText) {
    return { tax_period_start: null, tax_period_end: null }
  }

  const parts = periodText.match(/(\d{4}年\d{1,2}月\d{1,2}日).*?((?:\d{4}年)?\d{1,2}月\d{1,2}日)/)
  if (!parts) {
    return { tax_period_start: null, tax_period_end: null }
  }

  const tax_period_start = parseCnDateToIso(parts[1])
  let endRaw = parts[2]
  if (!endRaw.includes('年')) {
    const year = parts[1].match(/(\d{4})年/)?.[1]
    if (year) endRaw = `${year}年${endRaw}`
  }
  return { tax_period_start, tax_period_end: parseCnDateToIso(endRaw) }
}

export function parseDateTimeToIso(text: string): string | null {
  const m = text.match(/(\d{4})[-年/](\d{1,2})[-月/](\d{1,2})日?(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/)
  if (!m) return null
  const y = m[1]
  const mo = String(Number(m[2])).padStart(2, '0')
  const d = String(Number(m[3])).padStart(2, '0')
  const hh = m[4] ? String(Number(m[4])).padStart(2, '0') : '00'
  const mm = m[5] ? String(Number(m[5])).padStart(2, '0') : '00'
  const ss = m[6] ? String(Number(m[6])).padStart(2, '0') : '00'
  return `${y}-${mo}-${d}T${hh}:${mm}:${ss}`
}

/** Postgres numeric(20,2)：整数部分最多 18 位 */
const MONEY_DB_MAX_INTEGER_DIGITS = 18

function isWithinDbMoneyRange(n: number): boolean {
  const rounded = Math.round(n * 100) / 100
  const intPart = String(Math.abs(rounded)).split('.')[0] ?? ''
  return intPart.length <= MONEY_DB_MAX_INTEGER_DIGITS
}

export function parseMoney(text: string | null | undefined): number | null {
  if (!text) return null
  const trimmed = text.trim()
  const cleaned = trimmed.replace(/[,，]/g, '').replace(/[^\d.-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null

  // 无小数点的超长整数多为数电票号/税号，不是金额
  const hasDecimalMarker = /[.,]/.test(trimmed)
  const intDigits = cleaned.replace(/^-/, '').split('.')[0]?.length ?? 0
  if (!hasDecimalMarker && intDigits >= 12) return null

  if (!isWithinDbMoneyRange(n)) return null
  return Math.round(n * 100) / 100
}

/** 入库前再次收紧，避免解析漏网导致 numeric overflow */
export function clampMoneyForDb(value: number | null | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  const rounded = Math.round(value * 100) / 100
  if (!isWithinDbMoneyRange(rounded)) return null
  return rounded
}

export function extractDeclarationFieldsFromText(text: string): {
  taxpayer_name: string | null
  credit_code: string | null
  tax_period_start: string | null
  tax_period_end: string | null
  declaration_date: string | null
  tax_amount_due: number | null
} {
  const taxpayer_name = pickFirst(text, [
    /纳税人名称[：:\s]*([\u4e00-\u9fa5（）()·]{2,50}?)(?:\s+金额单位|\s+谨声明|\s+统一社会信用代码|$)/,
    /纳税人名称[：:\s]*([^\n\r]{2,80}?)(?:\n|统一社会信用代码|纳税人识别号|$)/,
    /编制单位[：:\s]*([\u4e00-\u9fa5（）()·]{2,50})/,
    /名称[：:\s]*([^\n\r]{2,80}?)(?:\n|统一社会信用代码|$)/,
  ])
  const credit_code = pickFirst(text, [
    /纳税人识别号[（(]统一社会信用代码[）)]?[：:\s]*([0-9A-Z]{15,20})/,
    /统一社会信用代码[（(]纳税人识别号[）)]?[：:\s]*([0-9A-Z]{15,20})/,
    /纳税人识别号[：:\s]*([0-9A-Z]{15,20})/,
  ])
  const { tax_period_start, tax_period_end } = extractTaxPeriodFromText(text)
  const declarationRaw = pickFirst(text, [
    /报送日期[：:\s]*(\d{4}-\d{1,2}-\d{1,2})/,
    /报送日期[：:\s]*(\d{4}年\d{1,2}月\d{1,2}日)/,
    /受理日期[：:\s]*(\d{4}年\d{1,2}月\d{1,2}日)/,
    /填表日期[：:\s]*(\d{4}年\d{1,2}月\d{1,2}日)/,
    /申报日期[：:\s]*(\d{4}年\d{1,2}月\d{1,2}日)/,
  ])
  const declaration_date = declarationRaw
    ? /^\d{4}-\d{1,2}-\d{1,2}$/.test(declarationRaw)
      ? parseDashDateToIso(declarationRaw)
      : parseCnDateToIso(declarationRaw)
    : null
  const tax_amount_due = parseMoney(
    pickFirst(text, [
      /应补（退）所得税额[：:\s]*([0-9,.-]+)/,
      /本期应补（退）税额[：:\s]*([0-9,.-]+)/,
      /应补（退）税额[：:\s]*([0-9,.-]+)/,
      /本期应补\(退\)税额[：:\s]*([0-9,.-]+)/,
    ]),
  )
  return {
    taxpayer_name,
    credit_code,
    tax_period_start,
    tax_period_end,
    declaration_date,
    tax_amount_due,
  }
}
