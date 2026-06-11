import type { InvoiceLineItem } from '../../types/database'
import {
  clampMoneyForDb,
  extractPdfText,
  parseCnDateToIso,
  parseDateTimeToIso,
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
  invoice_number: string
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
  /^dzfp_(\d{10,30})_(.+?)_(?:[\d,.]+_)?(\d{4}-\d{2}-\d{2}|\d{14})(?:\[单一发票\])?(?:\s*\(\d+\))?\.pdf$/i

const ALT_INVOICE_FILE_RE =
  /^(.+?)_数电(?:发票|票)[（(]([^）)]+)[）)]_(\d{20})\.pdf$/i

/** 公司名+20位票号紧凑文件名，如 河南沃臻贸易有限公司25132000000012559323.pdf */
const COMPACT_INVOICE_FILE_RE =
  /^(.+?)(\d{20})(?:\s*[-–—]\s*副本)?\.pdf$/i

/** PDF 中「开票人」标签可能被拆成「开 票 人」 */
const ISSUER_LABEL = '开\\s*票\\s*人[：:\\s]*'

/** 税号/识别号可能被拆成逐字符空格 */
const SPACED_TAX_ID = '((?:[0-9A-Z][\\s\\u00a0]?){15,22})'

function compactTaxId(value: string): string {
  return value.replace(/[\s\u00a0]/g, '').toUpperCase()
}

function isValidTaxId(value: string | null | undefined): boolean {
  const compact = compactTaxId(value ?? '')
  return compact.length >= 15 && compact.length <= 20
}

/** 数电发票号码标准长度（如 25132000000155822857） */
export const STANDARD_DIGITAL_INVOICE_NO_LENGTH = 20

/** PDF.js 可能在票号中间插入空格，仅压缩指定片段内的数字间隙 */
function compactDigitRun(value: string): string {
  return value.replace(/[\s\u00a0]/g, '')
}

/** 开票人块中票号：连续 20 位，或逐字空格，或中间少量空格 */
const ISSUER_INVOICE_NO =
  '(?:\\d{20}|(?:\\d[\\s\\u00a0]?){20})(?=\\s*(?:\\d{4}|(?:\\d[\\s\\u00a0]?){4})\\s*年)'

/** 中文日期：兼容 2025年01月31日、2025 年 01 月 25 日、2 0 2 5 年0 6 月0 5 日 */
const FLEX_CN_DATE =
  '(?:\\d{4}|(?:\\d[\\s\\u00a0]?){4})\\s*年\\s*(?:\\d{1,2}|(?:\\d[\\s\\u00a0]?){1,2})\\s*月\\s*(?:\\d{1,2}|(?:\\d[\\s\\u00a0]?){1,2})\\s*日'

/** ¥ 后金额（兼容 3 0 9 7 3 . 4 5 与 30973.45） */
const YEN_MONEY_VALUE =
  '(?:[-+]?(?:\\d(?:[\\s\\u00a0]?\\d)*)[\\s\\u00a0]*(?:\\.[\\s\\u00a0]*\\d(?:[\\s\\u00a0]?\\d)*)?)'

const YEN_MONEY_PATTERN = new RegExp(`[¥￥]\\s*(${YEN_MONEY_VALUE})`, 'g')

/** 票面公司名常含空格，如「北威 ( 重庆 ) 科技股份有限公司」 */
const PARTY_NAME = '[\\u4e00-\\u9fa5A-Za-z0-9（）()·\\s]{2,80}?'

function basenameOf(fileName: string): string {
  const normalized = fileName.replace(/\\/g, '/')
  return normalized.slice(normalized.lastIndexOf('/') + 1)
}

export function parseInvoiceFileName(fileName: string): {
  digital_invoice_no: string
  buyer_name: string | null
  issue_stamp: string | null
} | null {
  const m = basenameOf(fileName).match(INVOICE_FILE_RE)
  if (!m) return null
  return {
    digital_invoice_no: m[1],
    buyer_name: m[2]?.trim() || null,
    issue_stamp: m[3] || null,
  }
}

export function parseAltInvoiceFileName(fileName: string): {
  digital_invoice_no: string
  seller_name: string | null
  invoice_type: string | null
} | null {
  const m = basenameOf(fileName).match(ALT_INVOICE_FILE_RE)
  if (!m) return null
  const ticketLabel = m[2]?.trim() ?? ''
  const invoice_type = ticketLabel.includes('专用')
    ? '数电发票（增值税专用发票）'
    : ticketLabel.includes('普通')
      ? '数电发票（普通发票）'
      : normalizeInvoiceType(`电子发票（${ticketLabel}）`)
  return {
    digital_invoice_no: m[3],
    seller_name: m[1]?.trim() || null,
    invoice_type,
  }
}

export function parseCompactInvoiceFileName(fileName: string): {
  digital_invoice_no: string
  buyer_name: string | null
} | null {
  const base = basenameOf(fileName)
  if (INVOICE_FILE_RE.test(base) || ALT_INVOICE_FILE_RE.test(base)) return null
  const m = base.match(COMPACT_INVOICE_FILE_RE)
  if (!m) return null
  return {
    digital_invoice_no: m[2],
    buyer_name: m[1]?.trim() || null,
  }
}

/** 文件名可提供的字段预填（PDF 正文解析优先，文件名作兜底） */
export type InvoiceFileNameHints = {
  pattern: 'dzfp' | 'alt' | 'compact'
  digital_invoice_no: string
  invoice_number: string
  buyer_name: string | null
  seller_name: string | null
  invoice_type: string | null
  issue_date: string | null
}

/** 符合命名规则时，在 PDF 解析前即可确定的字段 */
export function parseInvoiceFileNameHints(fileName: string): InvoiceFileNameHints | null {
  const base = basenameOf(fileName)
  const fromDzfp = parseInvoiceFileName(base)
  if (fromDzfp) {
    return {
      pattern: 'dzfp',
      digital_invoice_no: fromDzfp.digital_invoice_no,
      invoice_number: fromDzfp.digital_invoice_no,
      buyer_name: fromDzfp.buyer_name,
      seller_name: null,
      invoice_type: null,
      issue_date: stampToDateOnly(fromDzfp.issue_stamp),
    }
  }

  const fromAlt = parseAltInvoiceFileName(base)
  if (fromAlt) {
    return {
      pattern: 'alt',
      digital_invoice_no: fromAlt.digital_invoice_no,
      invoice_number: fromAlt.digital_invoice_no,
      buyer_name: null,
      seller_name: fromAlt.seller_name,
      invoice_type: fromAlt.invoice_type,
      issue_date: null,
    }
  }

  const fromCompact = parseCompactInvoiceFileName(base)
  if (fromCompact) {
    return {
      pattern: 'compact',
      digital_invoice_no: fromCompact.digital_invoice_no,
      invoice_number: fromCompact.digital_invoice_no,
      buyer_name: fromCompact.buyer_name,
      seller_name: null,
      invoice_type: null,
      issue_date: null,
    }
  }

  return null
}

function coalesceOptionalText(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') continue
    const trimmed = value.trim()
    if (!trimmed || /^[—–\-－]+$/.test(trimmed)) continue
    return trimmed
  }
  return null
}

function coalesceOptionalMoney(...values: (number | null | undefined)[]): number | null {
  for (const value of values) {
    if (value != null && Number.isFinite(value)) return value
  }
  return null
}

function stampToDateOnly(stamp: string | null): string | null {
  if (!stamp) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(stamp)) return stamp
  if (stamp.length < 8) return null
  return `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`
}

function parseInvoiceDate(text: string | null): string | null {
  if (!text) return null
  return parseCnDateToIso(text) ?? parseDateTimeToIso(text)?.slice(0, 10) ?? null
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

/** 数电票 PDF 正文为稀疏排版，核心字段集中在「开票人：」后的数据块（销方在前、购方在后） */
function parseDigitalInvoiceBlock(text: string): InvoiceFieldBlock | null {
  const headerMatch = text.match(
    new RegExp(`${ISSUER_LABEL}(${ISSUER_INVOICE_NO})\\s+(${FLEX_CN_DATE})\\s+(.*)`, 's'),
  )
  if (!headerMatch) return null

  const rest = headerMatch[3]
  const parties = rest.match(
    new RegExp(
      `^(${PARTY_NAME})\\s+${SPACED_TAX_ID}\\s+(${PARTY_NAME})\\s+${SPACED_TAX_ID}`,
    ),
  )
  if (!parties) return null

  const sellerTaxId = compactTaxId(parties[2])
  const buyerTaxId = compactTaxId(parties[4])
  if (!isValidTaxId(sellerTaxId) || !isValidTaxId(buyerTaxId)) return null

  const afterParties = rest.slice(parties[0].length)
  const yenAmounts = extractYenAmounts(afterParties)

  if (yenAmounts.length < 3) return null

  const issuer = extractIssuerFromText(afterParties) ?? extractIssuerFromText(text)

  if (!issuer) return null

  return {
    digital_invoice_no: compactDigitRun(headerMatch[1]),
    issue_date: parseCnDateToIso(headerMatch[2]),
    seller_name: parties[1].replace(/\s+/g, ' ').trim(),
    seller_tax_id: sellerTaxId,
    buyer_name: parties[3].replace(/\s+/g, ' ').trim(),
    buyer_tax_id: buyerTaxId,
    amount: yenAmounts[0],
    tax_amount: yenAmounts[1],
    total_amount: yenAmounts[2],
    issuer,
  }
}

function extractIssueDateFromIssuerBlock(text: string): string | null {
  const m = text.match(
    new RegExp(`${ISSUER_LABEL}${ISSUER_INVOICE_NO}\\s+(${FLEX_CN_DATE})`),
  )
  return m ? parseCnDateToIso(m[1]) : null
}

function extractInvoiceTypeFromText(text: string): string | null {
  const fromPick = pick(text, [
    /(数电发票（[^）]+）)/,
    /(电子发票（[^）]+）)/,
    /(增值税专用发票)/,
  ])
  if (fromPick) return fromPick

  const compactTitle = text.slice(0, 160).replace(/\s+/g, '')
  const bracket = compactTitle.match(/(?:电子|数电)发票[（(]([^）)]+)[）)]/)
  if (bracket) {
    return compactTitle.match(/(?:电子|数电)发票[（(][^）)]+[）)]/)?.[0] ?? null
  }
  return null
}

function extractYenAmounts(text: string): number[] {
  return [...text.matchAll(YEN_MONEY_PATTERN)]
    .map((match) => parseMoney(match[1]))
    .filter((value): value is number => value != null)
}

function isChineseUppercaseAmount(value: string): boolean {
  return /[壹贰叁肆伍陆柒捌玖拾佰仟万亿元整角分]/.test(value)
}

function isLikelyIssuerName(value: string): boolean {
  const trimmed = value.trim()
  if (trimmed.length < 2 || trimmed.length > 4) return false
  if (isChineseUppercaseAmount(trimmed)) return false
  return /^[\u4e00-\u9fa5·]+$/.test(trimmed)
}

/** 开票人姓名（排除价税合计大写如「叁万贰仟圆整」） */
function extractIssuerFromText(text: string): string | null {
  const beforeLabel = text.match(/([\u4e00-\u9fa5·]{2,4})\s+开\s*票\s*人[：:\s]/)
  if (beforeLabel && isLikelyIssuerName(beforeLabel[1])) return beforeLabel[1].trim()

  const patterns = [
    /[¥￥][^¥]+\s+([\u4e00-\u9fa5·]{2,4})\s+\*/,
    /[¥￥][^¥]+\s+([\u4e00-\u9fa5·]{2,4})(?=\s*收|$)/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1] && isLikelyIssuerName(match[1])) return match[1].trim()
  }
  return null
}

type InvoiceFieldBlock = {
  digital_invoice_no: string
  issue_date: string | null
  buyer_name: string
  buyer_tax_id: string
  seller_name: string
  seller_tax_id: string
  amount: number | null
  tax_amount: number | null
  total_amount: number | null
  issuer: string | null
}

/** 部分 PDF 购销方与票号在正文开头：销方 日期 销方税号 票号 购方税号 购方 */
function parsePrefaceInvoiceBlock(text: string): InvoiceFieldBlock | null {
  const head = text.slice(0, 600)
  const block = head.match(
    new RegExp(
      `([\\u4e00-\\u9fa5A-Za-z0-9（）()·\\s]+?)\\s+(${FLEX_CN_DATE})\\s+${SPACED_TAX_ID}\\s+(\\d{20})\\s+${SPACED_TAX_ID}\\s+([\\u4e00-\\u9fa5A-Za-z0-9（）()·\\s]+?)\\s+国家税务总局`,
    ),
  )
  if (!block) return null

  const sellerTaxId = compactTaxId(block[3])
  const buyerTaxId = compactTaxId(block[5])
  if (!isValidTaxId(sellerTaxId) || !isValidTaxId(buyerTaxId)) return null

  const yenAmounts = extractYenAmounts(text)
  if (yenAmounts.length < 3) return null

  return {
    digital_invoice_no: block[4],
    issue_date: parseCnDateToIso(block[2]),
    seller_name: block[1].replace(/\s+/g, ' ').trim(),
    seller_tax_id: sellerTaxId,
    buyer_name: block[6].replace(/\s+/g, ' ').trim(),
    buyer_tax_id: buyerTaxId,
    amount: yenAmounts[0],
    tax_amount: yenAmounts[1],
    total_amount: yenAmounts[2],
    issuer: extractIssuerFromText(text),
  }
}

function collectDigitalInvoiceNoCandidates(
  text: string,
  fileName: string,
  blockNo?: string | null,
): string[] {
  const candidates: string[] = []

  if (blockNo) candidates.push(compactDigitRun(blockNo))

  const fromIssuerBlock = text.match(
    new RegExp(`${ISSUER_LABEL}(${ISSUER_INVOICE_NO})\\s+(${FLEX_CN_DATE})`),
  )?.[1]
  if (fromIssuerBlock) candidates.push(compactDigitRun(fromIssuerBlock))

  const fromLabel = pick(text, [/数电发票号码[：:\s]*((?:\d[\s\u00a0]?){18,28})/])
  if (fromLabel) candidates.push(compactDigitRun(fromLabel))

  candidates.push(...(text.match(/\d{20}/g) ?? []))

  const fromName = parseInvoiceFileName(fileName)?.digital_invoice_no
  if (fromName) candidates.push(fromName)
  const fromAltName = parseAltInvoiceFileName(fileName)?.digital_invoice_no
  if (fromAltName) candidates.push(fromAltName)

  const fromFile = fileName.match(/(\d{20})/)?.[1]
  if (fromFile) candidates.push(fromFile)

  return [...new Set(candidates.filter((n) => n.length >= 18 && n.length <= 22))]
}

/** 优先 20 位完整票号，其次取更长者（修复 PDF 数字被空格截断） */
export function resolveDigitalInvoiceNo(
  text: string,
  fileName: string,
  blockNo?: string | null,
): string | null {
  const candidates = collectDigitalInvoiceNoCandidates(text, fileName, blockNo)
  if (candidates.length === 0) return null

  candidates.sort((a, b) => {
    const aOk = a.length === STANDARD_DIGITAL_INVOICE_NO_LENGTH
    const bOk = b.length === STANDARD_DIGITAL_INVOICE_NO_LENGTH
    if (aOk && !bOk) return -1
    if (!aOk && bOk) return 1
    return b.length - a.length
  })
  return candidates[0] ?? null
}

/** 数电发票：发票号码与数电发票号码相同 */
export function resolveInvoiceNumber(
  text: string,
  digitalInvoiceNo: string,
  invoiceType: string | null,
): string {
  const isDigitalInvoice =
    invoiceType?.startsWith('数电发票') === true ||
    /电子发票|数电发票/.test(text.slice(0, 120))

  if (isDigitalInvoice) return digitalInvoiceNo

  const raw = pick(text, [/(?<!数电)发票号码[：:\s]*((?:\d[\s\u00a0]?)+)/])
  if (!raw) return digitalInvoiceNo

  const compact = compactDigitRun(raw)
  return compact || digitalInvoiceNo
}

function extractLabeledParties(text: string): {
  buyer_name: string | null
  buyer_tax_id: string | null
  seller_name: string | null
  seller_tax_id: string | null
} {
  const buyerBlock = text.match(
    new RegExp(
      `购\\s*买\\s*方[\\s\\S]{0,400}?名称[：:\\s]*(${PARTY_NAME})[\\s\\S]{0,120}?(?:统一社会信用代码|纳税人识别号)[：:/\\s]*([0-9A-Z]{15,20})`,
    ),
  )
  const sellerBlock = text.match(
    new RegExp(
      `销\\s*售\\s*方[\\s\\S]{0,400}?名称[：:\\s]*(${PARTY_NAME})[\\s\\S]{0,120}?(?:统一社会信用代码|纳税人识别号)[：:/\\s]*([0-9A-Z]{15,20})`,
    ),
  )

  return {
    buyer_name: buyerBlock?.[1]?.replace(/\s+/g, ' ').trim() ?? pick(text, [/购买方名称[：:\s]*([^\n\r]{2,80})/]),
    buyer_tax_id:
      buyerBlock?.[2]?.trim() ??
      pick(text, [/购方识别号[：:\s]*([0-9A-Z]{15,20})/, /购买方[\s\S]{0,200}?识别号[：:\s]*([0-9A-Z]{15,20})/]),
    seller_name: sellerBlock?.[1]?.replace(/\s+/g, ' ').trim() ?? pick(text, [/销售方名称[：:\s]*([^\n\r]{2,80})/]),
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
  const yenAmounts = extractYenAmounts(text)

  if (yenAmounts.length >= 3) {
    return {
      amount: yenAmounts[0],
      tax_amount: yenAmounts[1],
      total_amount: yenAmounts[2],
    }
  }

  const triplet = text.match(
    new RegExp(
      `[¥￥]\\s*(${YEN_MONEY_VALUE})\\s*[¥￥]\\s*(${YEN_MONEY_VALUE})[\\s\\S]{0,80}?[¥￥]\\s*(${YEN_MONEY_VALUE})`,
    ),
  )
  if (triplet) {
    return {
      amount: parseMoney(triplet[1]),
      tax_amount: parseMoney(triplet[2]),
      total_amount: parseMoney(triplet[3]),
    }
  }

  const totalOnly = parseMoney(
    pick(text, [/价税合计[（(]小写[）)][：:\s]*¥?\s*([\d\s\u00a0,.]+)/, /（小写）[：:\s]*¥?\s*([\d\s\u00a0,.]+)/]),
  )
  return { amount: null, tax_amount: null, total_amount: totalOnly }
}

/** 数电票「开票人」块明细：* 大类 * 品名 [规格] 税率 单位 金额 税额 数量 单价（后两项顺序可能互换） */
const DIGITAL_LINE_ITEM_WITH_SPEC =
  /\*\s*([^*]+?)\s*\*\s*([\u4e00-\u9fa5A-Za-z0-9（）()·\s]+?)\s+([A-Z0-9][A-Za-z0-9-]{1,30})\s+(\d{1,2}%|\*)\s+(\S+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)/
const DIGITAL_LINE_ITEM_NO_SPEC =
  /\*\s*([^*]+?)\s*\*\s*([\u4e00-\u9fa5A-Za-z0-9（）()·\s]+?)\s+(\d{1,2}%|\*)\s+(\S+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)/
/** 旧版紧凑项目名（*大类*品名，无星号旁空格） */
const DIGITAL_LINE_ITEM_LEGACY =
  /(\*[^*]+\*[^\s%]{1,80}?)\s+(\d{1,2}%|\*)\s+([A-Za-z\u4e00-\u9fff]+)\s+([-+]?\d[\d,.]*)\s+([-+]?\d[\d,.]*)\s+([-+]?\d[\d.]*)\s+([-+]?\d[\d,.]*)/

function resolveQuantityAndUnitPrice(
  amount: number | null,
  first: number | null,
  second: number | null,
): { quantity: number | null; unit_price: number | null } {
  if (first == null || second == null) {
    return { quantity: first, unit_price: second }
  }
  if (amount != null && amount > 0) {
    const err1 =
      first !== 0 ? Math.abs(amount / first - second) / Math.max(Math.abs(second), 1e-9) : Number.POSITIVE_INFINITY
    const err2 =
      second !== 0 ? Math.abs(amount / second - first) / Math.max(Math.abs(first), 1e-9) : Number.POSITIVE_INFINITY
    const bothGood = err1 < 0.02 && err2 < 0.02
    if (bothGood) {
      if (Number.isInteger(second) && !Number.isInteger(first)) {
        return { quantity: second, unit_price: first }
      }
      if (Number.isInteger(first) && !Number.isInteger(second)) {
        return { quantity: first, unit_price: second }
      }
      return first >= second
        ? { quantity: first, unit_price: second }
        : { quantity: second, unit_price: first }
    }
    if (err1 < err2) return { quantity: first, unit_price: second }
    return { quantity: second, unit_price: first }
  }
  return { quantity: first, unit_price: second }
}

function parseDigitalLineItem(text: string, header: ParsedInvoicePdf): InvoiceLineItem[] {
  const remark = text.match(/[\d,.]+\s+([\u4e00-\u9fa5\d]{2,40})\s*$/)?.[1] ?? header.remark

  const withSpec = text.match(DIGITAL_LINE_ITEM_WITH_SPEC)
  if (withSpec) {
    const amount = parseMoney(withSpec[6])
    const { quantity, unit_price } = resolveQuantityAndUnitPrice(
      amount,
      parseMoney(withSpec[8]),
      parseMoney(withSpec[9]),
    )
    return [
      sanitizeLineItem({
        item_name: `* ${withSpec[1].trim()} * ${withSpec[2].trim()}`,
        spec: withSpec[3]?.trim() || null,
        tax_rate: withSpec[4]?.trim() || null,
        unit: withSpec[5]?.trim() || null,
        amount,
        tax_amount: parseMoney(withSpec[7]),
        quantity,
        unit_price,
        total_amount: header.total_amount,
        business_type: header.business_type,
        remark,
      }),
    ]
  }

  const noSpec = text.match(DIGITAL_LINE_ITEM_NO_SPEC)
  if (noSpec) {
    const amount = parseMoney(noSpec[5])
    const { quantity, unit_price } = resolveQuantityAndUnitPrice(
      amount,
      parseMoney(noSpec[7]),
      parseMoney(noSpec[8]),
    )
    return [
      sanitizeLineItem({
        item_name: `* ${noSpec[1].trim()} * ${noSpec[2].trim()}`,
        tax_rate: noSpec[3]?.trim() || null,
        unit: noSpec[4]?.trim() || null,
        amount,
        tax_amount: parseMoney(noSpec[6]),
        quantity,
        unit_price,
        total_amount: header.total_amount,
        business_type: header.business_type,
        remark,
      }),
    ]
  }

  const legacy = text.match(DIGITAL_LINE_ITEM_LEGACY)
  if (legacy) {
    const amount = parseMoney(legacy[4])
    const { quantity, unit_price } = resolveQuantityAndUnitPrice(
      amount,
      parseMoney(legacy[6]),
      parseMoney(legacy[7]),
    )
    return [
      sanitizeLineItem({
        item_name: legacy[1]?.trim() || null,
        tax_rate: legacy[2]?.trim() || null,
        unit: legacy[3]?.trim() || null,
        amount,
        tax_amount: parseMoney(legacy[5]),
        quantity,
        unit_price,
        total_amount: header.total_amount,
        business_type: header.business_type,
        remark,
      }),
    ]
  }

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

function parseLineItems(text: string, header: ParsedInvoicePdf): InvoiceLineItem[] {
  if (new RegExp(`${ISSUER_LABEL}${ISSUER_INVOICE_NO}`).test(text)) {
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
  const text = await extractPdfText(file)
  return parseInvoicePdfText(text, file.name)
}

export async function parseInvoicePdfBytes(
  data: ArrayBuffer,
  fileName: string,
): Promise<ParsedInvoicePdf> {
  const { loadPdfDocument } = await import('./loadPdfDocument')
  const { extractPdfTextFromDocument } = await import('./extractPdfText')
  const pdf = await loadPdfDocument(data)
  const text = await extractPdfTextFromDocument(pdf)
  return parseInvoicePdfText(text, fileName)
}

export function parseInvoicePdfText(text: string, fileName: string): ParsedInvoicePdf {
  const hints = parseInvoiceFileNameHints(fileName)
  const looksLikeInvoice =
    /电\s*子\s*发\s*票|电子发票|数电\s*发\s*票|数电发票|发\s*票\s*号\s*码|发票号码|开\s*票\s*日\s*期|开票日期|购\s*买\s*方|销\s*售\s*方/.test(
      text,
    ) || hints != null
  if (!looksLikeInvoice) {
    throw new Error('文件内容不像电子/数电发票 PDF')
  }
  const digitalBlock = parseDigitalInvoiceBlock(text)
  const prefaceBlock = digitalBlock ? null : parsePrefaceInvoiceBlock(text)
  const pdfBlock = digitalBlock ?? prefaceBlock
  const labeledParties = extractLabeledParties(text)
  const amountTriplet = extractAmountTriplet(text)

  const rawInvoiceType =
    extractInvoiceTypeFromText(text) ?? hints?.invoice_type ?? null
  const invoice_type = normalizeInvoiceType(rawInvoiceType)

  const digitalNo =
    resolveDigitalInvoiceNo(text, fileName, pdfBlock?.digital_invoice_no) ??
    hints?.digital_invoice_no ??
    null

  if (!digitalNo) {
    throw new Error('无法从 PDF 中识别数电发票号码，请确认文件为电子/数电发票')
  }

  const issueDateRaw = pick(text, [
    /开票日期[：:\s]*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/,
    /开票日期[：:\s]*(\d{4}-\d{1,2}-\d{1,2})/,
  ])

  const invoice_number = resolveInvoiceNumber(text, digitalNo, invoice_type)

  const pdfBuyerName = pdfBlock?.buyer_name ?? labeledParties.buyer_name
  const pdfSellerName = pdfBlock?.seller_name ?? labeledParties.seller_name
  const pdfIssueDate =
    pdfBlock?.issue_date ??
    extractIssueDateFromIssuerBlock(text) ??
    parseInvoiceDate(issueDateRaw)
  const pdfIssuer = pdfBlock?.issuer ?? extractIssuerFromText(text)

  const header: ParsedInvoicePdf = {
    digital_invoice_no: digitalNo,
    invoice_number,
    buyer_name: coalesceOptionalText(pdfBuyerName, hints?.buyer_name),
    seller_name: coalesceOptionalText(pdfSellerName, hints?.seller_name),
    buyer_tax_id: pdfBlock?.buyer_tax_id ?? labeledParties.buyer_tax_id,
    seller_tax_id: pdfBlock?.seller_tax_id ?? labeledParties.seller_tax_id,
    issue_date: coalesceOptionalText(pdfIssueDate, hints?.issue_date),
    invoice_type: coalesceOptionalText(invoice_type, hints?.invoice_type),
    invoice_status: '正常',
    is_positive: '是',
    risk_level: '正常',
    invoice_source: '电子发票服务平台',
    issuer: pdfIssuer,
    amount: coalesceOptionalMoney(pdfBlock?.amount, amountTriplet.amount),
    tax_amount: coalesceOptionalMoney(pdfBlock?.tax_amount, amountTriplet.tax_amount),
    total_amount: coalesceOptionalMoney(pdfBlock?.total_amount, amountTriplet.total_amount),
    remark:
      text.match(/[\d,.]+\s+([\u4e00-\u9fa5\d]{2,40})\s*$/)?.[1] ??
      pick(text, [/备注[：:\s]*([^\n\r]{2,120})/]),
    business_type: pick(text, [/特定业务类型[：:\s]*([^\n\r]+)/]) || null,
    line_items: [],
  }

  header.line_items = parseLineItems(text, header)
  header.amount = clampMoneyForDb(header.amount)
  header.tax_amount = clampMoneyForDb(header.tax_amount)
  header.total_amount = clampMoneyForDb(header.total_amount)
  return header
}
