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

function extractDigitalInvoiceNo(text: string): string | null {
  const fromLabel = pick(text, [
    /发票号码[：:\s]*(\d{10,30})/,
    /数电发票号码[：:\s]*(\d{10,30})/,
  ])
  if (fromLabel) return fromLabel

  const fromIssuer = text.match(/开票人[：:\s]*(\d{10,30})/)?.[1]
  if (fromIssuer) return fromIssuer

  const candidates = text.match(/\d{20}/g) ?? []
  if (candidates.length > 0) return candidates[0] ?? null

  const longNums = text.match(/\d{10,30}/g) ?? []
  return longNums.find((n) => n.length >= 18) ?? longNums[0] ?? null
}

function extractLabeledParties(text: string): {
  buyer_name: string | null
  buyer_tax_id: string | null
  seller_name: string | null
  seller_tax_id: string | null
} {
  const buyerBlock = text.match(
    /购\s*买\s*方[\s\S]{0,400}?名称[：:\s]*([\u4e00-\u9fa5（）()·]{2,50})[\s\S]{0,120}?(?:统一社会信用代码|纳税人识别号)[：:/\s]*([0-9A-Z]{15,20})/,
  )
  const sellerBlock = text.match(
    /销\s*售\s*方[\s\S]{0,400}?名称[：:\s]*([\u4e00-\u9fa5（）()·]{2,50})[\s\S]{0,120}?(?:统一社会信用代码|纳税人识别号)[：:/\s]*([0-9A-Z]{15,20})/,
  )

  return {
    buyer_name: buyerBlock?.[1]?.trim() ?? pick(text, [/购买方名称[：:\s]*([^\n\r]{2,80})/]),
    buyer_tax_id:
      buyerBlock?.[2]?.trim() ??
      pick(text, [/购方识别号[：:\s]*([0-9A-Z]{15,20})/, /购买方[\s\S]{0,200}?识别号[：:\s]*([0-9A-Z]{15,20})/]),
    seller_name: sellerBlock?.[1]?.trim() ?? pick(text, [/销售方名称[：:\s]*([^\n\r]{2,80})/]),
    seller_tax_id:
      sellerBlock?.[2]?.trim() ??
      pick(text, [/销方识别号[：:\s]*([0-9A-Z]{15,20})/, /销售方[\s\S]{0,200}?识别号[：:\s]*([0-9A-Z]{15,20})/]),
  }
}

function extractAmountTriplet(text: string): {
  amount: number | null
  tax_amount: number | null
  total_amount: number | null
} {
  const triplet = text.match(/¥\s*([\d,.]+)\s*¥\s*([\d,.]+)[\s\S]{0,80}?¥\s*([\d,.]+)/)
  if (triplet) {
    return {
      amount: parseMoney(triplet[1]),
      tax_amount: parseMoney(triplet[2]),
      total_amount: parseMoney(triplet[3]),
    }
  }

  const totalOnly = parseMoney(pick(text, [/价税合计[（(]小写[）)][：:\s]*¥?\s*([\d,.]+)/, /（小写）[：:\s]*¥?\s*([\d,.]+)/]))
  return { amount: null, tax_amount: null, total_amount: totalOnly }
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
  const text = await extractPdfText(file)
  const digitalBlock = parseDigitalInvoiceBlock(text)
  const labeledParties = extractLabeledParties(text)
  const amountTriplet = extractAmountTriplet(text)

  const rawInvoiceType =
    pick(text, [/(数电发票（[^）]+）)/, /(电子发票（[^）]+）)/, /(增值税专用发票)/]) ?? null
  const invoice_type = normalizeInvoiceType(rawInvoiceType)

  const digitalNo =
    digitalBlock?.digital_invoice_no ??
    extractDigitalInvoiceNo(text) ??
    fromName?.digital_invoice_no ??
    null

  if (!digitalNo) {
    throw new Error('无法从 PDF 中识别数电发票号码，请确认文件为电子/数电发票')
  }

  const issueDateRaw = pick(text, [
    /开票日期[：:\s]*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/,
    /开票日期[：:\s]*(\d{4}-\d{1,2}-\d{1,2})/,
  ])

  const header: ParsedInvoicePdf = digitalBlock
    ? {
        digital_invoice_no: digitalNo,
        invoice_number: pick(text, [/发票号码[：:\s]*(\d{10,30})/]),
        buyer_name: digitalBlock.buyer_name,
        seller_name: digitalBlock.seller_name,
        buyer_tax_id: digitalBlock.buyer_tax_id,
        seller_tax_id: digitalBlock.seller_tax_id,
        issue_date:
          digitalBlock.issue_date ??
          (issueDateRaw ? parseCnDateToIso(issueDateRaw) : null) ??
          stampToDateOnly(fromName?.issue_stamp ?? null),
        invoice_type,
        invoice_status: '正常',
        is_positive: '是',
        risk_level: '正常',
        invoice_source: '电子发票服务平台',
        issuer: digitalBlock.issuer,
        amount: digitalBlock.amount ?? amountTriplet.amount,
        tax_amount: digitalBlock.tax_amount ?? amountTriplet.tax_amount,
        total_amount: digitalBlock.total_amount ?? amountTriplet.total_amount,
        remark:
          text.match(/[\d,.]+\s+([\u4e00-\u9fa5\d]{2,40})\s*$/)?.[1] ??
          pick(text, [/备注[：:\s]*([^\n\r]{2,120})/]),
        business_type: pick(text, [/特定业务类型[：:\s]*([^\n\r]+)/]) || null,
        line_items: [],
      }
    : {
        digital_invoice_no: digitalNo,
        invoice_number: pick(text, [/发票号码[：:\s]*(\d{10,30})/]),
        buyer_name: labeledParties.buyer_name ?? fromName?.buyer_name ?? null,
        seller_name: labeledParties.seller_name,
        buyer_tax_id: labeledParties.buyer_tax_id,
        seller_tax_id: labeledParties.seller_tax_id,
        issue_date:
          (issueDateRaw ? parseCnDateToIso(issueDateRaw) : null) ??
          stampToDateOnly(fromName?.issue_stamp ?? null),
        invoice_type,
        invoice_status: '正常',
        is_positive: '是',
        risk_level: '正常',
        invoice_source: '电子发票服务平台',
        issuer: pick(text, [/开票人[：:\s]*([\u4e00-\u9fa5·]{2,20})/]),
        amount: amountTriplet.amount,
        tax_amount: amountTriplet.tax_amount,
        total_amount: amountTriplet.total_amount,
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
