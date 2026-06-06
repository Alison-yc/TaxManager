import type { InvoiceLineItem } from '../../types/database'
import {
  clampMoneyForDb,
  extractPdfText,
  parseCnDateToIso,
  parseMoney,
} from './extractPdfText'

/** PDF 票面标题常为「电子发票（xxx）」，税务系统票种枚举为「数电发票（xxx）」 */
export function normalizeInvoiceType(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  const text = raw.trim().replace(/\(/g, '（').replace(/\)/g, '）')

  const bracket = text.match(/(?:电子|数电)发票[（]([^）]+)[）]/)
  if (bracket) {
    const inner = bracket[1]
    if (/增值税专用/.test(inner)) return '数电发票（增值税专用发票）'
    if (/普通/.test(inner)) return '数电发票（普通发票）'
    return `数电发票（${inner}）`
  }

  if (/增值税专用发票/.test(text)) return '数电发票（增值税专用发票）'
  if (/普通发票/.test(text)) return '数电发票（普通发票）'
  if (text.startsWith('数电发票')) return text
  return null
}

export type ParsedInvoicePdf = {
  digital_invoice_no: string
  invoice_number: string | null
  buyer_name: string | null
  seller_name: string | null
  buyer_tax_id: string | null
  seller_tax_id: string | null
  issue_date: string | null
  invoice_type: string | null
  invoice_status: string
  is_positive: string
  risk_level: string
  invoice_source: string
  issuer: string | null
  amount: number | null
  tax_amount: number | null
  total_amount: number | null
  remark: string | null
  business_type: string | null
  line_items: InvoiceLineItem[]
}

const INVOICE_FILE_RE =
  /^dzfp_(\d{10,30})_(.+?)_(\d{14})(?:\[单一发票\])?\.pdf$/i

export function parseInvoiceFileName(fileName: string): {
  digital_invoice_no: string
  buyer_name: string | null
  issue_stamp: string | null
} | null {
  const m = fileName.match(INVOICE_FILE_RE)
  if (!m) return null
  return {
    digital_invoice_no: m[1],
    buyer_name: m[2] || null,
    issue_stamp: m[3] || null,
  }
}

function stampToDateOnly(stamp: string | null): string | null {
  if (!stamp || stamp.length < 8) return null
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`
}

function pick(text: string, patterns: RegExp[]): string | null {
  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (m?.[1]) return m[1].trim()
  }
  return null
}

function sanitizeLineItem(item: InvoiceLineItem): InvoiceLineItem {
  return {
    ...item,
    quantity: clampMoneyForDb(item.quantity),
    unit_price: clampMoneyForDb(item.unit_price),
    amount: clampMoneyForDb(item.amount),
    tax_amount: clampMoneyForDb(item.tax_amount),
    total_amount: clampMoneyForDb(item.total_amount),
  }
}

/** 数电票 PDF 正文为稀疏排版，核心字段集中在「开票人：」后的数据块 */
function parseDigitalInvoiceBlock(text: string): {
  digital_invoice_no: string
  issue_date: string | null
  buyer_name: string
  buyer_tax_id: string
  seller_name: string
  seller_tax_id: string
  amount: number | null
  tax_amount: number | null
  total_amount: number | null
  issuer: string
} | null {
  const block = text.match(
    /开票人[：:\s]*(\d{10,30})\s+(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)\s+([\u4e00-\u9fa5（）()·]{2,50}?)\s+([0-9A-Z]{15,20})\s+([\u4e00-\u9fa5（）()·]{2,50}?)\s+([0-9A-Z]{15,20})\s*¥\s*([\d,.]+)\s*¥\s*([\d,.]+)\s+.+?¥\s*([\d,.]+)\s+([\u4e00-\u9fa5·]{2,20})/,
  )
  if (!block) return null
  return {
    digital_invoice_no: block[1],
    issue_date: parseCnDateToIso(block[2]),
    buyer_name: block[3],
    buyer_tax_id: block[4],
    seller_name: block[5],
    seller_tax_id: block[6],
    amount: parseMoney(block[7]),
    tax_amount: parseMoney(block[8]),
    total_amount: parseMoney(block[9]),
    issuer: block[10],
  }
}

function parseDigitalLineItem(text: string, header: ParsedInvoicePdf): InvoiceLineItem[] {
  const line = text.match(
    /(\*[^*]+\*[^\s]*)\s+(\d{1,2}%|\*)\s+([A-Za-z\u4e00-\u9fff]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d.]+)\s+([\d,.]+)/,
  )
  const remark = text.match(/[\d,.]+\s+([\u4e00-\u9fa5\d]{2,40})\s*$/)?.[1] ?? header.remark

  if (!line) {
    return [
      {
        item_name: '—',
        amount: header.amount,
        tax_amount: header.tax_amount,
        total_amount: header.total_amount,
        business_type: header.business_type,
        remark,
      },
    ]
  }

  return [
    sanitizeLineItem({
      item_name: line[1]?.trim() || null,
      tax_rate: line[2]?.trim() || null,
      unit: line[3]?.trim() || null,
      amount: parseMoney(line[4]),
      tax_amount: parseMoney(line[5]),
      unit_price: parseMoney(line[6]),
      quantity: parseMoney(line[7]),
      total_amount: header.total_amount,
      business_type: header.business_type,
      remark,
    }),
  ]
}

function parseLineItems(text: string, header: ParsedInvoicePdf): InvoiceLineItem[] {
  if (/开票人[：:\s]*\d{10,30}/.test(text)) {
    return parseDigitalLineItem(text, header)
  }

  const items: InvoiceLineItem[] = []
  const rowPattern =
    /(\*[^*]+\*[^\s\n]{0,40})\s+([^\s]{0,20})?\s+([A-Za-z\u4e00-\u9fff]{1,6})?\s+([\d,.]+)?\s+([\d.]+)?\s+([\d,.-]+)\s+(\d{1,2}%|\*)\s+([\d,.-]+)/g
  let match: RegExpExecArray | null
  while ((match = rowPattern.exec(text)) !== null) {
    items.push(
      sanitizeLineItem({
        item_name: match[1]?.trim() || null,
        spec: match[2]?.trim() || null,
        unit: match[3]?.trim() || null,
        quantity: parseMoney(match[4]),
        unit_price: parseMoney(match[5]),
        amount: parseMoney(match[6]),
        tax_rate: match[7]?.trim() || null,
        tax_amount: parseMoney(match[8]),
        total_amount: header.total_amount,
        business_type: header.business_type,
      }),
    )
  }

  if (items.length > 0) return items

  return [
    sanitizeLineItem({
      item_name: pick(text, [/(\*[^*\n]{2,40}\*[^*\n]{0,40})/]) ?? '—',
      amount: header.amount,
      tax_amount: header.tax_amount,
      total_amount: header.total_amount,
      tax_rate: pick(text, [/(\d{1,2}%)/]) ?? null,
      business_type: header.business_type,
      remark: header.remark,
    }),
  ]
}

export async function parseInvoicePdf(file: File): Promise<ParsedInvoicePdf> {
  const fromName = parseInvoiceFileName(file.name)
  if (!fromName) {
    throw new Error('无法识别发票 PDF 文件名，请使用 dzfp_数电票号_购方名_时间戳.pdf 格式')
  }

  const text = await extractPdfText(file)
  const digitalBlock = parseDigitalInvoiceBlock(text)

  const rawInvoiceType =
    pick(text, [/(数电发票（[^）]+）)/, /(电子发票（[^）]+）)/, /(增值税专用发票)/]) ?? null
  const invoice_type = normalizeInvoiceType(rawInvoiceType)
  const digitalNo = digitalBlock?.digital_invoice_no || fromName.digital_invoice_no

  const header: ParsedInvoicePdf = digitalBlock
    ? {
        digital_invoice_no: digitalNo,
        invoice_number: null,
        buyer_name: digitalBlock.buyer_name,
        seller_name: digitalBlock.seller_name,
        buyer_tax_id: digitalBlock.buyer_tax_id,
        seller_tax_id: digitalBlock.seller_tax_id,
        issue_date: digitalBlock.issue_date ?? stampToDateOnly(fromName.issue_stamp),
        invoice_type,
        invoice_status: '正常',
        is_positive: '是',
        risk_level: '正常',
        invoice_source: '电子发票服务平台',
        issuer: digitalBlock.issuer,
        amount: digitalBlock.amount,
        tax_amount: digitalBlock.tax_amount,
        total_amount: digitalBlock.total_amount,
        remark:
          text.match(/[\d,.]+\s+([\u4e00-\u9fa5\d]{2,40})\s*$/)?.[1] ??
          pick(text, [/备注[：:\s]*([^\n\r]{2,120})/]),
        business_type: pick(text, [/特定业务类型[：:\s]*([^\n\r]+)/]) || null,
        line_items: [],
      }
    : {
        digital_invoice_no: digitalNo,
        invoice_number: null,
        buyer_name: fromName.buyer_name,
        seller_name: pick(text, [/销售方名称[：:\s]*([^\n\r]{2,80})/]),
        buyer_tax_id: pick(text, [/购方识别号[：:\s]*([0-9A-Z]{15,20})/]),
        seller_tax_id: pick(text, [/销方识别号[：:\s]*([0-9A-Z]{15,20})/]),
        issue_date: stampToDateOnly(fromName.issue_stamp),
        invoice_type,
        invoice_status: '正常',
        is_positive: '是',
        risk_level: '正常',
        invoice_source: '电子发票服务平台',
        issuer: pick(text, [/开票人[：:\s]*([\u4e00-\u9fa5·]{2,20})/]),
        amount: null,
        tax_amount: null,
        total_amount: null,
        remark: pick(text, [/备注[：:\s]*([^\n\r]{2,120})/]),
        business_type: pick(text, [/特定业务类型[：:\s]*([^\n\r]+)/]) || null,
        line_items: [],
      }

  header.line_items = parseLineItems(text, header)
  header.amount = clampMoneyForDb(header.amount)
  header.tax_amount = clampMoneyForDb(header.tax_amount)
  header.total_amount = clampMoneyForDb(header.total_amount)
  return header
}
