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

/** 开票人标签与票号之间可能插入票种/业务类型/表头占位 */
const ISSUER_BLOCK_SKIP = '[\\s\\S]{0,1200}?'

/** 税号/识别号可能被拆成逐字符空格 */
const SPACED_TAX_ID = '((?:[0-9A-Za-z][\\s\\u00a0]?){15,22})'

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

/** 中文日期：兼容 2025年01月31日、2025 年 01 月 25 日、2 0 2 5 年0 6 月0 5 日 */
const FLEX_CN_DATE =
  '(?:\\d{4}|(?:\\d[\\s\\u00a0]?){4})\\s*年\\s*(?:\\d{1,2}|(?:\\d[\\s\\u00a0]?){1,2})\\s*月\\s*(?:\\d{1,2}|(?:\\d[\\s\\u00a0]?){1,2})\\s*日'

/** ISO 日期：2025-12-03 */
const FLEX_ISO_DATE = '\\d{4}-\\d{1,2}-\\d{1,2}'

const FLEX_ISSUE_DATE = `(?:${FLEX_CN_DATE}|${FLEX_ISO_DATE})`

/** 开票人块中票号：连续 20 位，或逐字空格；后接中文或 ISO 开票日期 */
const ISSUER_INVOICE_NO =
  `(?:\\d{20}|(?:\\d[\\s\\u00a0]?){20})(?=\\s*(?:${FLEX_ISSUE_DATE}))`

/** ¥ 后金额（兼容 3 0 9 7 3 . 4 5 与 30973.45） */
const YEN_MONEY_VALUE =
  '(?:[-+]?(?:\\d(?:[\\s\\u00a0]?\\d)*)[\\s\\u00a0]*(?:\\.[\\s\\u00a0]*\\d(?:[\\s\\u00a0]?\\d)*)?)'

const YEN_MONEY_PATTERN = new RegExp(`[¥￥]\\s*(${YEN_MONEY_VALUE})`, 'g')

/** 票面公司名常含空格，如「北威 ( 重庆 ) 科技股份有限公司」 */
const PARTY_NAME = '[\\u4e00-\\u9fa5A-Za-z0-9（）()·\\s]{2,80}?'

const SELLER_NAME_HINTS = ['河北镁神科技股份有限公司']

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
  /** 紧凑文件名中的公司名一般为开票方（销方） */
  seller_name: string | null
} | null {
  const base = basenameOf(fileName)
  if (INVOICE_FILE_RE.test(base) || ALT_INVOICE_FILE_RE.test(base)) return null
  const m = base.match(COMPACT_INVOICE_FILE_RE)
  if (!m) return null
  return {
    digital_invoice_no: m[2],
    seller_name: m[1]?.trim() || null,
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
      buyer_name: null,
      seller_name: fromCompact.seller_name,
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

const REMARK_FIELD_LABEL =
  '购买方地址|销售方地址|购方地址|销方地址|购方开户银行|购买方开户银行|销方开户银行|销售方开户银行|银行账号|电话|收款人|复核人|订单号|被红冲蓝字数电票号码'

function remarkSearchRegion(text: string): string {
  const yenMatches = [...text.matchAll(YEN_MONEY_PATTERN)]
  if (yenMatches.length === 0) return text
  const last = yenMatches[yenMatches.length - 1]
  return text.slice(last.index! + last[0].length)
}

function normalizeRemarkLabelSpacing(text: string): string {
  return text
    .replace(/购\s*买\s*方\s*地\s*址/g, '购买方地址')
    .replace(/销\s*售\s*方\s*地\s*址/g, '销售方地址')
    .replace(/购\s*方\s*地\s*址/g, '购方地址')
    .replace(/销\s*方\s*地\s*址/g, '销方地址')
    .replace(/购\s*方\s*开\s*户\s*银\s*行/g, '购方开户银行')
    .replace(/购\s*买\s*方\s*开\s*户\s*银\s*行/g, '购买方开户银行')
    .replace(/销\s*方\s*开\s*户\s*银\s*行/g, '销方开户银行')
    .replace(/销\s*售\s*方\s*开\s*户\s*银\s*行/g, '销售方开户银行')
    .replace(/银\s*行\s*账\s*号/g, '银行账号')
    .replace(/收\s*款\s*人/g, '收款人')
    .replace(/复\s*核\s*人/g, '复核人')
    .replace(/订\s*单\s*号/g, '订单号')
    .replace(/备\s*注/g, '备注')
}

function formatRemarkSegment(label: string, value: string): string {
  const normalizedValue =
    label === '银行账号'
      ? value.replace(/[\s\u00a0]/g, '').trim()
      : value.replace(/\s+/g, ' ').trim()
  if (!normalizedValue) return ''
  return `${label}:${normalizedValue.replace(/^[：:\s]+/, '')}`
}

function parseRemarkFieldSegments(region: string): string[] {
  const re = new RegExp(`(?:${REMARK_FIELD_LABEL})[：:\\s]+([^;；]+)`, 'gi')
  const segments: string[] = []
  const seen = new Set<string>()
  let match: RegExpExecArray | null
  while ((match = re.exec(region)) !== null) {
    const full = match[0]
    const labelMatch = full.match(new RegExp(`^(${REMARK_FIELD_LABEL})`, 'i'))
    const label = labelMatch?.[1] ?? ''
    const rawValue = match[1]?.trim() ?? ''
    if (!label || !rawValue) continue
    if (rawValue.includes('*') || isChineseUppercaseAmount(rawValue)) continue
    const formatted = formatRemarkSegment(label, rawValue)
    if (!formatted || seen.has(formatted)) continue
    seen.add(formatted)
    segments.push(formatted)
  }
  return segments
}

function extractTrailingRemarkCode(region: string): string | null {
  const match = region.match(/(?:[;；\s]+)([A-Z][A-Z0-9-]{5,})\s*$/)
  return match?.[1] ?? null
}

function stripRemarkFooter(text: string): string {
  return text
    .replace(/\s*共\s*\d+\s*页\s*第\s*\d+\s*页\s*$/g, '')
    .replace(/\s*第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页\s*$/g, '')
    .trim()
}

function normalizeRemarkText(text: string): string {
  return stripRemarkFooter(text)
    .replace(/\s*([:：])\s*/g, ':')
    .replace(/\s*([;；])\s*/g, '; ')
    .replace(/\s+/g, ' ')
    .replace(/(?:;\s*)+$/g, '')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripIssuerPrefix(region: string, issuer?: string | null): string {
  const trimmed = region.trimStart()
  if (issuer) {
    return trimmed.replace(new RegExp(`^${escapeRegExp(issuer).replace(/\s+/g, '\\s*')}\\s+`), '')
  }
  return trimmed.replace(/^[\u4e00-\u9fa5·]{2,4}\s+/, '')
}

function stripLeadingLineItemRows(region: string): string {
  let rest = region
  const compactNumber = '[-+]?\\d+(?:\\.\\d+)?'
  const rowNumber = '[-+]?(?:\\d[\\s\\u00a0]*)+(?:\\.[\\s\\u00a0]*(?:\\d[\\s\\u00a0]*)+)?'
  const taxRate = '(?:(?:\\d[\\s\\u00a0]*){1,2}%|\\*|免税)'
  const compactLineItemRow = new RegExp(
    `^\\s*\\*[^*]+\\*[\\s\\S]*?${taxRate}\\s+(?:(?!\\*)\\S+\\s+)?(?:${compactNumber}\\s+){3}${compactNumber}\\s*`,
  )
  const spacedLineItemRow = new RegExp(
    `^\\s*\\*[^*]+\\*[\\s\\S]*?${taxRate}\\s+(?:(?!\\*)\\S+\\s+)?(?:${rowNumber}\\s+){3}${rowNumber}\\s*`,
  )

  while (/^\s*\*/.test(rest)) {
    const compactNext = rest.replace(compactLineItemRow, '')
    const next = compactNext !== rest ? compactNext : rest.replace(spacedLineItemRow, '')
    if (next === rest) break
    rest = next
  }

  return rest
}

function extractRemarkArea(region: string, issuer?: string | null): string | null {
  const withoutIssuer = stripIssuerPrefix(region, issuer)
  const area = normalizeRemarkText(stripLeadingLineItemRows(withoutIssuer))
  if (!area) return null
  if (area.includes('*')) return null
  if (isLikelyIssuerName(area) || isChineseUppercaseAmount(area)) return null
  return area
}

function extractFreeRemarkTail(region: string, issuer?: string | null): string | null {
  let tail = region.trimStart()
  if (issuer) {
    tail = tail.replace(new RegExp(`^${issuer.replace(/\s+/g, '\\s*')}\\s+`), '')
  } else {
    tail = tail.replace(/^[\u4e00-\u9fa5·]{2,4}\s+/, '')
  }

  const afterLineItem = tail.match(
    /\*[^*]+\*[\s\S]*?\d(?:\.\d+)?\s+([\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9（）()·,\s]{1,60})\s*$/,
  )
  if (afterLineItem?.[1]) {
    const note = afterLineItem[1].replace(/\s+/g, ' ').trim()
    if (note.length >= 2 && !isLikelyIssuerName(note) && !isChineseUppercaseAmount(note)) {
      return note
    }
  }

  return null
}

/** 从 PDF 正文提取备注（银行/地址/收款人/复核人等），排除开票人姓名误匹配 */
export function extractInvoiceRemarkFromText(
  text: string,
  issuer?: string | null,
): string | null {
  const region = normalizeRemarkLabelSpacing(remarkSearchRegion(text))
  const area = extractRemarkArea(region, issuer)
  if (area) return area

  const segments = parseRemarkFieldSegments(region)

  const trailingCode = extractTrailingRemarkCode(region)
  if (trailingCode) segments.push(trailingCode)

  if (segments.length === 0) {
    const free = extractFreeRemarkTail(region, issuer)
    if (free) segments.push(free)
  }

  const explicit = region.match(/备注[：:\s]+([^;；\n\r]{2,200})/)
  if (explicit?.[1]) {
    const cleaned = explicit[1].replace(/\s+/g, ' ').trim()
    if (cleaned && !cleaned.includes('*') && !isChineseUppercaseAmount(cleaned)) {
      segments.unshift(cleaned)
    }
  }

  if (segments.length === 0) return null
  return segments.join('; ')
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

type IssuerBlockHeader = {
  digital_invoice_no: string
  issue_date: string | null
  rest: string
}

function parseIssuerBlockIssueDate(raw: string): string | null {
  return parseCnDateToIso(raw) ?? parseInvoiceDate(raw)
}

function matchIssuerBlockHeader(text: string): IssuerBlockHeader | null {
  const headerMatch = text.match(
    new RegExp(
      `${ISSUER_LABEL}${ISSUER_BLOCK_SKIP}(${ISSUER_INVOICE_NO})\\s+(${FLEX_ISSUE_DATE})\\s+(.*)`,
      's',
    ),
  )
  if (!headerMatch) return null
  return {
    digital_invoice_no: compactDigitRun(headerMatch[1]),
    issue_date: parseIssuerBlockIssueDate(headerMatch[2]),
    rest: headerMatch[3],
  }
}

function compactPartyName(value: string): string {
  return value.replace(/\s+/g, '').replace(/[（）()]/g, '')
}

function partyNameMatchesHint(partyName: string, hint: string | null | undefined): boolean {
  if (!hint?.trim()) return false
  const party = compactPartyName(partyName)
  const target = compactPartyName(hint)
  if (!party || !target) return false
  return party.includes(target) || target.includes(party)
}

function partyNameMatchesAnyHint(partyName: string, hints: readonly string[]): boolean {
  return hints.some((hint) => partyNameMatchesHint(partyName, hint))
}

/** 开票人块优先按本账套公司识别销方；无法识别时再用版式兜底 */
function orientIssuerBlockParties(
  firstName: string,
  firstTaxId: string,
  secondName: string,
  secondTaxId: string,
  hints?: InvoiceFileNameHints | null,
): Pick<InvoiceFieldBlock, 'seller_name' | 'seller_tax_id' | 'buyer_name' | 'buyer_tax_id'> {
  const first = {
    name: firstName.replace(/\s+/g, ' ').trim(),
    taxId: firstTaxId,
  }
  const second = {
    name: secondName.replace(/\s+/g, ' ').trim(),
    taxId: secondTaxId,
  }

  let seller = first
  let buyer = second

  const firstIsKnownSeller = partyNameMatchesAnyHint(first.name, SELLER_NAME_HINTS)
  const secondIsKnownSeller = partyNameMatchesAnyHint(second.name, SELLER_NAME_HINTS)

  if (secondIsKnownSeller && !firstIsKnownSeller) {
    seller = second
    buyer = first
  } else if (hints?.pattern === 'dzfp' && hints.buyer_name) {
    const firstIsBuyer =
      partyNameMatchesHint(first.name, hints.buyer_name) &&
      !partyNameMatchesHint(second.name, hints.buyer_name)
    if (firstIsBuyer) {
      seller = second
      buyer = first
    }
  }

  return {
    seller_name: seller.name,
    seller_tax_id: seller.taxId,
    buyer_name: buyer.name,
    buyer_tax_id: buyer.taxId,
  }
}

type ParsedIssuerParties = {
  matchLength: number
  seller_name: string
  seller_tax_id: string | null
  buyer_name: string
  buyer_tax_id: string | null
}

function normalizePartyName(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** 解析开票人块中的购销方：支持「名+税号+名+税号」「名+名+税号」「名+税号+名」 */
function parseIssuerBlockParties(
  rest: string,
  hints?: InvoiceFileNameHints | null,
): ParsedIssuerParties | null {
  const twoTax = rest.match(
    new RegExp(
      `^(${PARTY_NAME})\\s+${SPACED_TAX_ID}\\s+(${PARTY_NAME})\\s+${SPACED_TAX_ID}`,
    ),
  )
  if (twoTax) {
    const firstTaxId = compactTaxId(twoTax[2])
    const secondTaxId = compactTaxId(twoTax[4])
    if (!isValidTaxId(firstTaxId) || !isValidTaxId(secondTaxId)) return null
    const oriented = orientIssuerBlockParties(
      twoTax[1],
      firstTaxId,
      twoTax[3],
      secondTaxId,
      hints,
    )
    return {
      matchLength: twoTax[0].length,
      seller_name: oriented.seller_name,
      seller_tax_id: oriented.seller_tax_id,
      buyer_name: oriented.buyer_name,
      buyer_tax_id: oriented.buyer_tax_id,
    }
  }

  const twoNamesOneTax = rest.match(
    new RegExp(`^(${PARTY_NAME})\\s+(${PARTY_NAME})\\s+${SPACED_TAX_ID}`),
  )
  if (twoNamesOneTax) {
    const taxId = compactTaxId(twoNamesOneTax[3])
    if (!isValidTaxId(taxId)) return null
    const firstName = normalizePartyName(twoNamesOneTax[1])
    const secondName = normalizePartyName(twoNamesOneTax[2])

    // 税号紧跟第二个名称；稀疏版式常见：购方名 销方名 销方税号
    let sellerName = secondName
    let sellerTaxId: string | null = taxId
    let buyerName = firstName
    let buyerTaxId: string | null = null

    const firstIsKnownSeller = partyNameMatchesAnyHint(firstName, SELLER_NAME_HINTS)
    const secondIsKnownSeller = partyNameMatchesAnyHint(secondName, SELLER_NAME_HINTS)
    if (firstIsKnownSeller && !secondIsKnownSeller) {
      sellerName = firstName
      sellerTaxId = null
      buyerName = secondName
      buyerTaxId = taxId
    } else if (hints?.pattern === 'dzfp' && hints.buyer_name) {
      const firstIsBuyer =
        partyNameMatchesHint(firstName, hints.buyer_name) &&
        !partyNameMatchesHint(secondName, hints.buyer_name)
      const secondIsBuyer =
        partyNameMatchesHint(secondName, hints.buyer_name) &&
        !partyNameMatchesHint(firstName, hints.buyer_name)
      if (secondIsBuyer && !firstIsBuyer) {
        sellerName = firstName
        sellerTaxId = null
        buyerName = secondName
        buyerTaxId = taxId
      }
    }

    return {
      matchLength: twoNamesOneTax[0].length,
      seller_name: sellerName,
      seller_tax_id: sellerTaxId,
      buyer_name: buyerName,
      buyer_tax_id: buyerTaxId,
    }
  }

  const nameTaxName = rest.match(
    new RegExp(`^(${PARTY_NAME})\\s+${SPACED_TAX_ID}\\s+(${PARTY_NAME})(?=\\s|[¥￥])`),
  )
  if (nameTaxName) {
    const taxId = compactTaxId(nameTaxName[2])
    if (!isValidTaxId(taxId)) return null
    const firstName = normalizePartyName(nameTaxName[1])
    const secondName = normalizePartyName(nameTaxName[3])

    let sellerName = firstName
    let sellerTaxId: string | null = taxId
    let buyerName = secondName
    let buyerTaxId: string | null = null

    const firstIsKnownSeller = partyNameMatchesAnyHint(firstName, SELLER_NAME_HINTS)
    const secondIsKnownSeller = partyNameMatchesAnyHint(secondName, SELLER_NAME_HINTS)
    if (secondIsKnownSeller && !firstIsKnownSeller) {
      sellerName = secondName
      sellerTaxId = null
      buyerName = firstName
      buyerTaxId = taxId
    } else if (
      hints?.pattern === 'dzfp' &&
      hints.buyer_name &&
      partyNameMatchesHint(firstName, hints.buyer_name) &&
      !partyNameMatchesHint(secondName, hints.buyer_name)
    ) {
      sellerName = secondName
      sellerTaxId = null
      buyerName = firstName
      buyerTaxId = taxId
    }

    return {
      matchLength: nameTaxName[0].length,
      seller_name: sellerName,
      seller_tax_id: sellerTaxId,
      buyer_name: buyerName,
      buyer_tax_id: buyerTaxId,
    }
  }

  return null
}

/** 数电票 PDF 正文为稀疏排版，核心字段集中在「开票人：」后的数据块 */
function parseDigitalInvoiceBlock(
  text: string,
  hints?: InvoiceFileNameHints | null,
): InvoiceFieldBlock | null {
  const header = matchIssuerBlockHeader(text)
  if (!header) return null

  const parties = parseIssuerBlockParties(header.rest, hints)
  if (!parties) return null

  const afterParties = header.rest.slice(parties.matchLength)
  const yenAmounts = extractYenAmounts(afterParties)
  if (yenAmounts.length < 2) return null

  const taxExempt = hasTaxExemptTaxAmountMarker(afterParties)
  const amount = yenAmounts[0]
  const tax_amount = taxExempt ? 0 : yenAmounts[1]
  const total_amount =
    (taxExempt ? yenAmounts[1] : yenAmounts[2]) ??
    (amount != null && tax_amount != null
      ? Math.round((amount + tax_amount) * 100) / 100
      : null)

  const issuer = extractIssuerFromText(afterParties) ?? extractIssuerFromText(text)

  return {
    digital_invoice_no: header.digital_invoice_no,
    issue_date: header.issue_date,
    seller_name: parties.seller_name,
    seller_tax_id: parties.seller_tax_id ?? '',
    buyer_name: parties.buyer_name,
    buyer_tax_id: parties.buyer_tax_id ?? '',
    amount,
    tax_amount,
    total_amount,
    issuer,
  }
}

function extractIssueDateFromIssuerBlock(text: string): string | null {
  const m = text.match(
    new RegExp(`${ISSUER_LABEL}${ISSUER_BLOCK_SKIP}${ISSUER_INVOICE_NO}\\s+(${FLEX_ISSUE_DATE})`),
  )
  return m ? parseIssuerBlockIssueDate(m[1]) : null
}

function hasIssuerBlockInvoiceNo(text: string): boolean {
  return new RegExp(`${ISSUER_LABEL}${ISSUER_BLOCK_SKIP}${ISSUER_INVOICE_NO}`).test(text)
}

function shouldUseDigitalLineItemParser(text: string): boolean {
  if (hasIssuerBlockInvoiceNo(text)) return true
  if (/\*[^*]+\*[^*\n]{2,80}?\s+\d{1,2}%/.test(text)) return true
  // PDF.js 可能将税率拆成「1 3 %」
  return /\*[^*]+\*[^*\n]{2,200}?\s+\d(?:[\s\u00a0]?\d)*[\s\u00a0]*%/.test(text)
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

function hasTaxExemptTaxAmountMarker(text: string): boolean {
  return /免\s*税/.test(text) && /\*{3}/.test(text)
}

function isChineseUppercaseAmount(value: string): boolean {
  if (!/[壹贰叁肆伍陆柒捌玖拾佰仟万]/.test(value)) return false
  return (
    /[壹贰叁肆伍陆柒捌玖拾佰仟万]{2,}/.test(value) ||
    (/[壹贰叁肆伍陆柒捌玖拾佰仟万]/.test(value) && /[圆整角]/.test(value))
  )
}

function isLikelyIssuerName(value: string): boolean {
  const trimmed = value.replace(/[\s\u00a0]+/g, '').trim()
  if (trimmed.length < 2 || trimmed.length > 4) return false
  if (isChineseUppercaseAmount(trimmed)) return false
  return /^[\u4e00-\u9fa5·]+$/.test(trimmed)
}

function normalizeIssuerName(value: string): string | null {
  const normalized = value.replace(/[\s\u00a0]+/g, '').trim()
  return isLikelyIssuerName(normalized) ? normalized : null
}

function extractIssuerAfterTotalAmount(text: string): string | null {
  const yenMatches = [...text.matchAll(YEN_MONEY_PATTERN)]
  for (let i = yenMatches.length - 1; i >= 0; i -= 1) {
    const match = yenMatches[i]
    const region = text.slice(match.index! + match[0].length, match.index! + match[0].length + 80)
    const beforeItem = region.split('*')[0]?.trim() ?? ''
    if (!beforeItem || isChineseUppercaseAmount(beforeItem)) continue
    const candidate = beforeItem.match(/^([\u4e00-\u9fa5·](?:[\s\u00a0]*[\u4e00-\u9fa5·]){1,3})(?=\s|$)/)?.[1]
    const issuer = candidate ? normalizeIssuerName(candidate) : null
    if (issuer) return issuer
  }
  return null
}

/** 开票人姓名（排除价税合计大写如「叁万贰仟圆整」） */
function extractIssuerFromText(text: string): string | null {
  const afterTotal = extractIssuerAfterTotalAmount(text)
  if (afterTotal) return afterTotal

  const beforeLabel = text.match(/(?:^|[^*\u4e00-\u9fa5])([\u4e00-\u9fa5·](?:[\s\u00a0]*[\u4e00-\u9fa5·]){1,3})\s+开\s*票\s*人[：:\s]/)
  if (beforeLabel) {
    const beforeIndex = beforeLabel.index ?? 0
    const context = text.slice(Math.max(0, beforeIndex - 20), beforeIndex)
    if (!context.includes('*')) {
      const issuer = normalizeIssuerName(beforeLabel[1])
      if (issuer) return issuer
    }
  }

  const patterns = [
    /[¥￥][^¥]+\s+([\u4e00-\u9fa5·](?:[\s\u00a0]*[\u4e00-\u9fa5·]){1,3})\s+\*/,
    /[¥￥][^¥]+\s+([\u4e00-\u9fa5·](?:[\s\u00a0]*[\u4e00-\u9fa5·]){1,3})(?=\s*收|$)/,
    /开票人[：:\s]+([\u4e00-\u9fa5·](?:[\s\u00a0]*[\u4e00-\u9fa5·]){1,7})(?=\s*(?:收|复|$|\*))/,
  ]
  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      const issuer = normalizeIssuerName(match[1])
      if (issuer) return issuer
    }
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

  const taxExempt = hasTaxExemptTaxAmountMarker(text)
  const yenAmounts = extractYenAmounts(text)
  if (taxExempt ? yenAmounts.length < 2 : yenAmounts.length < 3) return null

  return {
    digital_invoice_no: block[4],
    issue_date: parseCnDateToIso(block[2]),
    seller_name: block[1].replace(/\s+/g, ' ').trim(),
    seller_tax_id: sellerTaxId,
    buyer_name: block[6].replace(/\s+/g, ' ').trim(),
    buyer_tax_id: buyerTaxId,
    amount: yenAmounts[0],
    tax_amount: taxExempt ? 0 : yenAmounts[1],
    total_amount: taxExempt ? yenAmounts[1] : yenAmounts[2],
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
    new RegExp(`${ISSUER_LABEL}${ISSUER_BLOCK_SKIP}(${ISSUER_INVOICE_NO})`),
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
      `购\\s*买\\s*方[\\s\\S]{0,400}?名称[：:\\s]*(${PARTY_NAME})[\\s\\S]{0,120}?(?:统一社会信用代码|纳税人识别号)[：:/\\s]*${SPACED_TAX_ID}`,
    ),
  )
  const sellerBlock = text.match(
    new RegExp(
      `销\\s*售\\s*方[\\s\\S]{0,400}?名称[：:\\s]*(${PARTY_NAME})[\\s\\S]{0,120}?(?:统一社会信用代码|纳税人识别号)[：:/\\s]*${SPACED_TAX_ID}`,
    ),
  )

  return {
    buyer_name: buyerBlock?.[1]?.replace(/\s+/g, ' ').trim() ?? pick(text, [/购买方名称[：:\s]*([^\n\r]{2,80})/]),
    buyer_tax_id:
      compactTaxId(buyerBlock?.[2] ?? '') ||
      pick(text, [/购方识别号[：:\s]*([0-9A-Za-z]{15,20})/, /购买方[\s\S]{0,200}?识别号[：:\s]*([0-9A-Za-z]{15,20})/]) ||
      null,
    seller_name: sellerBlock?.[1]?.replace(/\s+/g, ' ').trim() ?? pick(text, [/销售方名称[：:\s]*([^\n\r]{2,80})/]),
    seller_tax_id:
      compactTaxId(sellerBlock?.[2] ?? '') ||
      pick(text, [/销方识别号[：:\s]*([0-9A-Za-z]{15,20})/, /销售方[\s\S]{0,200}?识别号[：:\s]*([0-9A-Za-z]{15,20})/]) ||
      null,
  }
}

function extractAmountTriplet(text: string): {
  amount: number | null
  tax_amount: number | null
  total_amount: number | null
} {
  const yenAmounts = extractYenAmounts(text)
  const taxExempt = hasTaxExemptTaxAmountMarker(text)

  if (taxExempt && yenAmounts.length >= 2) {
    return {
      amount: yenAmounts[0],
      tax_amount: 0,
      total_amount: yenAmounts[1],
    }
  }

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

function resolveQuantityAndUnitPrice(
  amount: number | null,
  first: number | null,
  second: number | null,
): { quantity: number | null; unit_price: number | null } {
  if (first == null || second == null) {
    return { quantity: first, unit_price: second }
  }
  if (amount != null && amount !== 0) {
    const err1 =
      first !== 0
        ? Math.abs(Math.abs(amount) / first - second) / Math.max(Math.abs(second), 1e-9)
        : Number.POSITIVE_INFINITY
    const err2 =
      second !== 0
        ? Math.abs(Math.abs(amount) / second - first) / Math.max(Math.abs(first), 1e-9)
        : Number.POSITIVE_INFINITY
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

/** PDF.js 可能在数字/税率字符间插入空格 */
const SPACED_TAX_RATE = String.raw`\d(?:[\s\u00a0]?\d)*[\s\u00a0]*%|\*|免税`

/** 明细行（未拆字）：*大类*品名 [规格] 税率 单位 + 四列数字 */
const DIGITAL_LINE_ITEM_ROW =
  /\*\s*([^*]+?)\s*\*\s*(.+?)\s+(?:(无|[A-Za-z0-9][A-Za-z0-9-]{0,40})\s+)?(\d{1,2}%|\*|免税)\s+(\S+)\s+(-?[\d,.]+)\s+(-?[\d,.]+)\s+(-?[\d,.]+)\s+(-?[\d,.]+)/g

function compactSpacedDigits(text: string): string {
  let prev = ''
  let cur = text
  while (cur !== prev) {
    prev = cur
    cur = cur
      .replace(/(\d)[\s\u00a0]+(?=\d)/g, '$1')
      .replace(/(\d)[\s\u00a0]+(?=[.,])/g, '$1')
      .replace(/([.,])[\s\u00a0]+(?=\d)/g, '$1')
  }
  return cur
}

/** 金额小数点后紧跟下一数字字段时插入边界，如 7800.0015000 → 7800.00 15000 */
function separateFixedDecimals(text: string): string {
  return text.replace(/(\d\.\d{2})(?=\d)/g, '$1 ')
}

function normalizeTaxRateDisplay(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null
  const trimmed = raw.trim()
  if (trimmed === '免税' || trimmed === '*') return trimmed
  const compact = compactSpacedDigits(trimmed)
  return compact.endsWith('%') ? compact : trimmed
}

function expandDecimalCandidates(digitStr: string): number[] {
  if (!digitStr) return []
  const results = new Set<number>()
  const direct = parseMoney(digitStr)
  if (direct != null) results.add(direct)
  for (let d = 1; d < digitStr.length; d++) {
    const n = parseMoney(`${digitStr.slice(0, d)}.${digitStr.slice(d)}`)
    if (n != null) results.add(n)
  }
  return [...results]
}

function qtyPriceMatchError(amount: number, a: number, b: number): number {
  if (a === 0 || b === 0) return Number.POSITIVE_INFINITY
  return Math.abs(a * b - amount) / Math.max(Math.abs(amount), 1e-9)
}

function findQtyPriceInDigitBlob(
  blob: string,
  amount: number,
  unit: string | null = null,
): { quantity: number; unit_price: number } | null {
  const digits = blob.replace(/\D/g, '')
  if (!digits) return null

  let best: { quantity: number; unit_price: number; err: number } | null = null
  for (let i = 1; i < digits.length; i++) {
    for (const a of expandDecimalCandidates(digits.slice(0, i))) {
      for (const b of expandDecimalCandidates(digits.slice(i))) {
        const score = scoreQtyPriceCandidate(amount, a, b, unit)
        if (!Number.isFinite(score)) continue
        const { quantity, unit_price } = resolveQuantityAndUnitPrice(amount, a, b)
        if (quantity == null || unit_price == null) continue
        if (!best || score < best.err) best = { quantity, unit_price, err: score }
      }
    }
  }
  return best ? { quantity: best.quantity, unit_price: best.unit_price } : null
}

function parseFirstSpacedMoney(raw: string): { value: number | null; rest: string } {
  const m = raw.match(/^(\d(?:[\s\u00a0]*\d)*[\s\u00a0]*(?:[.,][\s\u00a0]*\d(?:[\s\u00a0]*\d){0,2})?)/)
  if (!m) return { value: null, rest: raw }
  return { value: parseMoney(m[1]), rest: raw.slice(m[0].length).trimStart() }
}

type ParsedLinePrefix = {
  item_name: string
  spec: string | null
  tax_rate: string | null
  unit: string | null
  numericTail: string
}

function looksLikeSpecToken(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/[\d*/\\-]/.test(trimmed)) return true
  if (/^[A-Z]{1,12}$/.test(trimmed)) return true
  return false
}

function splitLineItemNameAndSpec(
  category: string,
  rawName: string,
  explicitSpec?: string | null,
): { item_name: string; spec: string | null } {
  const cleanCategory = category.trim().replace(/[\s\u00a0]+/g, '')
  let cleanName = rawName.replace(/\s+/g, ' ').trim()
  let spec = explicitSpec?.trim() || null

  if (!spec) {
    const m = cleanName.match(/^(.+?)\s+([A-Za-z0-9][A-Za-z0-9/\\\-*（）()·\u4e00-\u9fa5]{0,40})$/)
    if (m?.[1] && m?.[2] && looksLikeSpecToken(m[2])) {
      cleanName = m[1].trim()
      spec = m[2].trim()
    }
  }

  return {
    item_name: `* ${cleanCategory} * ${cleanName}`,
    spec,
  }
}

function normalizeSpecAndTaxRate(
  rawSpec: string | null | undefined,
  rawTaxRate: string,
): { spec: string | null; tax_rate: string | null } {
  const spec = rawSpec?.trim() || null
  const taxCompact = compactSpacedDigits(rawTaxRate).replace(/\s+/g, '')
  if (spec && /^\d$/.test(spec) && /^\d%$/.test(taxCompact)) {
    return { spec: null, tax_rate: `${spec}${taxCompact}` }
  }
  return { spec, tax_rate: normalizeTaxRateDisplay(rawTaxRate) }
}

function isLikelyUnit(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/[壹贰叁肆伍陆柒捌玖拾佰仟万亿元整]/.test(trimmed)) return false
  const money = parseMoney(trimmed)
  if (money != null && /^[\d\s\u00a0.,]+$/.test(trimmed)) return false
  return true
}

/** 数电票明细大类通常仅为中文/字母，PDF.js 可能在字间插空格 */
const LINE_ITEM_CATEGORY = '[\\u4e00-\\u9fa5A-Za-z（）()·\\s]{2,40}'

function isLikelyLineItemCategory(category: string): boolean {
  const trimmed = category.trim().replace(/[\s\u00a0]+/g, '')
  if (/[壹贰叁肆伍陆柒捌玖拾佰仟万亿元整]/.test(trimmed)) return false
  if (/^[¥￥]/.test(trimmed)) return false
  if (/\d/.test(trimmed)) return false
  return trimmed.length >= 2
}

function findDigitalLineItemPrefixes(text: string): ParsedLinePrefix[] {
  const items: ParsedLinePrefix[] = []
  const pattern = new RegExp(
    `\\*\\s*(${LINE_ITEM_CATEGORY}?)\\s*\\*\\s*(.+?)\\s+(?:(无|[A-Za-z0-9][A-Za-z0-9-]{0,40})\\s+)?(${SPACED_TAX_RATE})\\s+(\\S+)\\s+`,
    'g',
  )
  let match: RegExpExecArray | null
  while ((match = pattern.exec(text)) !== null) {
    if (!isLikelyLineItemCategory(match[1])) continue
    const tailStart = match.index + match[0].length
    const tailSlice = text.slice(tailStart)
    const tailEnd = tailSlice.search(
      /(?:\*\s*[^*]+?\s*\*|收\s*款\s*人|复\s*核\s*人|购\s*方|销\s*方|购买方|销售方)/,
    )
    const numericTail = (tailEnd >= 0 ? tailSlice.slice(0, tailEnd) : tailSlice).trim()
    if (!isLikelyUnit(match[5])) continue
    const specAndTax = normalizeSpecAndTaxRate(match[3], match[4])
    const item = splitLineItemNameAndSpec(match[1], match[2], specAndTax.spec)
    items.push({
      item_name: item.item_name,
      spec: item.spec,
      tax_rate: specAndTax.tax_rate,
      unit: match[5].trim(),
      numericTail,
    })
  }

  const servicePattern = new RegExp(
    `\\*\\s*(${LINE_ITEM_CATEGORY}?)\\s*\\*\\s*(.+?)\\s+(${SPACED_TAX_RATE})\\s+`,
    'g',
  )
  while ((match = servicePattern.exec(text)) !== null) {
    if (!isLikelyLineItemCategory(match[1])) continue
    const tailStart = match.index + match[0].length
    const tailSlice = text.slice(tailStart)
    const tailEnd = tailSlice.search(
      /(?:\*\s*[^*]+?\s*\*|收\s*款\s*人|复\s*核\s*人|购\s*方|销\s*方|购买方|销售方)/,
    )
    const numericTail = (tailEnd >= 0 ? tailSlice.slice(0, tailEnd) : tailSlice).trim()
    const item = splitLineItemNameAndSpec(match[1], match[2])
    items.push({
      item_name: item.item_name,
      spec: item.spec,
      tax_rate: normalizeTaxRateDisplay(match[3]),
      unit: null,
      numericTail,
    })
  }

  const amountPattern = new RegExp(
    `\\*\\s*(${LINE_ITEM_CATEGORY}?)\\s*\\*\\s*(.+?)\\s+(\\S+)\\s+(?=[¥￥])`,
    'g',
  )
  while ((match = amountPattern.exec(text)) !== null) {
    if (!isLikelyLineItemCategory(match[1])) continue
    if (!isLikelyUnit(match[3])) continue
    const tailStart = match.index + match[0].length
    const tailSlice = text.slice(tailStart)
    const tailEnd = tailSlice.search(
      /(?:\*\s*[^*]+?\s*\*|收\s*款\s*人|复\s*核\s*人|购\s*方|销\s*方|购买方|销售方)/,
    )
    const numericTail = (tailEnd >= 0 ? tailSlice.slice(0, tailEnd) : tailSlice).trim()
    const item = splitLineItemNameAndSpec(match[1], match[2])
    items.push({
      item_name: item.item_name,
      spec: item.spec,
      tax_rate: null,
      unit: match[3].trim(),
      numericTail,
    })
  }

  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.item_name}|${item.numericTail.slice(0, 40)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function scoreQtyPriceCandidate(
  amount: number,
  a: number,
  b: number,
  unit: string | null,
): number {
  const err = qtyPriceMatchError(amount, a, b)
  if (err >= 0.02) return Number.POSITIVE_INFINITY
  const resolved = resolveQuantityAndUnitPrice(amount, a, b)
  let score = err
  if (resolved.quantity != null && resolved.unit_price != null && unit && /吨|千克|公斤|kg/i.test(unit)) {
    if (resolved.unit_price < resolved.quantity) score += 1
  }
  return score
}

function parseDigitalLineItemNumbers(
  tail: string,
  header: { amount: number | null; tax_amount: number | null },
  unit: string | null = null,
): {
  amount: number | null
  tax_amount: number | null
  quantity: number | null
  unit_price: number | null
} {
  const segments = tail
    .split(/\s{2,}/)
    .map((s) => s.trim())
    .filter(Boolean)

  let amount = segments[0] ? parseFirstSpacedMoney(segments[0]).value : null
  let tax_amount: number | null = null
  let qtyPriceBlob = ''

  if (segments.length >= 2) {
    const taxPart = parseFirstSpacedMoney(segments[1])
    tax_amount = taxPart.value
    qtyPriceBlob = taxPart.rest
    if (segments.length >= 3) {
      qtyPriceBlob = [qtyPriceBlob, ...segments.slice(2)].filter(Boolean).join(' ')
    }
  }

  const bounded = separateFixedDecimals(compactSpacedDigits(tail))
  const nums = [...bounded.matchAll(/-?\d+(?:\.\d+)?/g)]
    .map((m) => parseMoney(m[0]))
    .filter((n): n is number => n != null)

  if (amount == null && nums.length >= 1) amount = nums[0]
  if (tax_amount == null && nums.length >= 2) tax_amount = nums[1]
  if (header.amount != null) amount = header.amount
  if (header.tax_amount != null) tax_amount = header.tax_amount

  let quantity: number | null = null
  let unit_price: number | null = null
  const rest = nums.slice(2)

  if (amount != null) {
    let bestErr = Number.POSITIVE_INFINITY
    for (let i = 0; i < rest.length; i++) {
      for (let j = 0; j < rest.length; j++) {
        if (i === j) continue
        const score = scoreQtyPriceCandidate(amount, rest[i], rest[j], unit)
        if (!Number.isFinite(score) || score >= bestErr) continue
        const resolved = resolveQuantityAndUnitPrice(amount, rest[i], rest[j])
        if (resolved.quantity == null || resolved.unit_price == null) continue
        bestErr = score
        quantity = resolved.quantity
        unit_price = resolved.unit_price
      }
    }

    if (quantity == null || unit_price == null) {
      const blobCandidates = [qtyPriceBlob, tail, ...rest.map(String)].filter(Boolean)
      for (const blob of blobCandidates) {
        const fromBlob = findQtyPriceInDigitBlob(blob, amount, unit)
        if (fromBlob) {
          quantity = fromBlob.quantity
          unit_price = fromBlob.unit_price
          break
        }
      }
    }

    if (quantity == null && unit_price == null) {
      quantity = 1
      unit_price = amount
    }
  }

  return { amount, tax_amount, quantity, unit_price }
}

function parseSpacedDigitalLineItemSection(
  prefix: ParsedLinePrefix,
  header: ParsedInvoicePdf,
): Omit<InvoiceLineItem, 'total_amount' | 'business_type' | 'remark'> | null {
  const numbers = parseDigitalLineItemNumbers(prefix.numericTail, {
    amount: header.amount,
    tax_amount: header.tax_amount,
  }, prefix.unit)
  if (numbers.amount == null) return null
  const tax_amount = prefix.tax_rate === '免税' ? 0 : numbers.tax_amount

  return {
    item_name: prefix.item_name,
    spec: prefix.spec,
    tax_rate: prefix.tax_rate,
    unit: prefix.unit ?? (numbers.quantity === 1 && numbers.unit_price === numbers.amount ? '项' : null),
    amount: numbers.amount,
    tax_amount,
    quantity: numbers.quantity,
    unit_price: numbers.unit_price,
  }
}

function moneyApproxEqual(a: number, b: number, tolerance = 0.02): boolean {
  if (b === 0) return Math.abs(a - b) < 0.01
  return Math.abs(a - b) / Math.abs(b) < tolerance
}

function productApproxEqual(a: number, b: number, target: number, tolerance = 0.02): boolean {
  if (target === 0) return Math.abs(a * b) < 0.01
  return moneyApproxEqual(a * b, target, tolerance)
}

function interpretDigitalLineItemRow(
  match: RegExpExecArray,
): Omit<InvoiceLineItem, 'total_amount' | 'business_type' | 'remark'> | null {
  const item_name = `* ${match[1].trim()} * ${match[2].trim()}`
  const spec = match[3]?.trim() || null
  const tax_rate = match[4]?.trim() || null
  const unit = match[5]?.trim() || null
  const n1 = parseMoney(match[6])
  const n2 = parseMoney(match[7])
  const n3 = parseMoney(match[8])
  const n4 = parseMoney(match[9])
  if (n1 == null || n2 == null || n3 == null || n4 == null) return null

  if (productApproxEqual(n1, n2, n3) || productApproxEqual(n2, n1, n3)) {
    const { quantity, unit_price } = resolveQuantityAndUnitPrice(n3, n1, n2)
    return {
      item_name,
      spec,
      tax_rate,
      unit,
      amount: n3,
      tax_amount: n4,
      quantity,
      unit_price,
    }
  }

  const { quantity, unit_price } = resolveQuantityAndUnitPrice(n1, n3, n4)
  if (
    quantity != null &&
    unit_price != null &&
    productApproxEqual(unit_price, quantity, n1)
  ) {
    return {
      item_name,
      spec,
      tax_rate,
      unit,
      amount: n1,
      tax_amount: n2,
      quantity,
      unit_price,
    }
  }

  return null
}

function parseDigitalLineItem(text: string, header: ParsedInvoicePdf): InvoiceLineItem[] {
  const remark = header.remark
  const items: InvoiceLineItem[] = []

  for (const prefix of findDigitalLineItemPrefixes(text)) {
    const parsed = parseSpacedDigitalLineItemSection(prefix, header)
    if (!parsed) continue
    items.push(
      sanitizeLineItem({
        ...parsed,
        total_amount: header.total_amount,
        business_type: header.business_type,
        remark,
      }),
    )
  }

  if (items.length === 0) {
    const rowPattern = new RegExp(DIGITAL_LINE_ITEM_ROW.source, DIGITAL_LINE_ITEM_ROW.flags)
    let match: RegExpExecArray | null
    while ((match = rowPattern.exec(text)) !== null) {
      const parsed = interpretDigitalLineItemRow(match)
      if (!parsed) continue
      items.push(
        sanitizeLineItem({
          ...parsed,
          total_amount: header.total_amount,
          business_type: header.business_type,
          remark,
        }),
      )
    }
  }

  if (items.length > 0) return items

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
  if (shouldUseDigitalLineItemParser(text)) {
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

/** 是否正数发票：红字/负数金额应为「否」 */
export function resolveIsPositiveInvoice(
  text: string,
  amounts?: {
    amount?: number | null
    tax_amount?: number | null
    total_amount?: number | null
  },
): string {
  if (/是否正数发票[：:\s]*否/.test(text)) return '否'
  if (/红字发票|被红冲|负数发票|（负数）|\(负数\)/.test(text)) return '否'
  if (amounts?.total_amount != null && amounts.total_amount < 0) return '否'
  if (amounts?.amount != null && amounts.amount < 0) return '否'
  if (amounts?.tax_amount != null && amounts.tax_amount < 0) return '否'
  if (/是否正数发票[：:\s]*是/.test(text)) return '是'
  return '是'
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
  const { pdf, destroy } = await loadPdfDocument(data)
  try {
    const text = await extractPdfTextFromDocument(pdf)
    return parseInvoicePdfText(text, fileName)
  } finally {
    await destroy()
  }
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
  const digitalBlock = parseDigitalInvoiceBlock(text, hints)
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
    buyer_name: coalesceOptionalText(
      pdfBuyerName,
      hints?.pattern === 'dzfp' ? hints?.buyer_name : null,
    ),
    seller_name: coalesceOptionalText(pdfSellerName),
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
    remark: extractInvoiceRemarkFromText(text, pdfIssuer),
    business_type: pick(text, [/特定业务类型[：:\s]*([^\n\r]+)/]) || null,
    line_items: [],
  }

  header.line_items = parseLineItems(text, header)
  header.amount = clampMoneyForDb(header.amount)
  header.tax_amount = clampMoneyForDb(header.tax_amount)
  header.total_amount = clampMoneyForDb(header.total_amount)
  header.is_positive = resolveIsPositiveInvoice(text, {
    amount: header.amount,
    tax_amount: header.tax_amount,
    total_amount: header.total_amount,
  })
  return header
}
