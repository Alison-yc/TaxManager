/**
 * 数电发票 PDF 解析全量回归（与 invoicePdfImport.ts 逻辑对齐）
 */
import fs from 'node:fs/promises'
import path from 'node:path'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const STANDARD_LEN = 20
const INVOICE_FILE_RE =
  /^dzfp_(\d{10,30})_(.+?)_(?:[\d,.]+_)?(\d{4}-\d{2}-\d{2}|\d{14})(?:\[单一发票\])?(?:\s*\(\d+\))?\.pdf$/i
const ALT_INVOICE_FILE_RE =
  /^(.+?)_数电(?:发票|票)[（(]([^）)]+)[）)]_(\d{20})\.pdf$/i
const COMPACT_INVOICE_FILE_RE =
  /^(.+?)(\d{20})(?:\s*[-–—]\s*副本)?\.pdf$/i

const ISSUER_LABEL = '开\\s*票\\s*人[：:\\s]*'
const ISSUER_BLOCK_SKIP = '[\\s\\S]{0,1200}?'
const FLEX_CN_DATE =
  '(?:\\d{4}|(?:\\d[\\s\\u00a0]?){4})\\s*年\\s*(?:\\d{1,2}|(?:\\d[\\s\\u00a0]?){1,2})\\s*月\\s*(?:\\d{1,2}|(?:\\d[\\s\\u00a0]?){1,2})\\s*日'
const FLEX_ISO_DATE = '\\d{4}-\\d{1,2}-\\d{1,2}'
const FLEX_ISSUE_DATE = `(?:${FLEX_CN_DATE}|${FLEX_ISO_DATE})`
const ISSUER_INVOICE_NO =
  `(?:\\d{20}|(?:\\d[\\s\\u00a0]?){20})(?=\\s*(?:${FLEX_ISSUE_DATE}))`
const PARTY_NAME = '[\\u4e00-\\u9fa5A-Za-z0-9（）()·\\s]{2,80}?'
const SPACED_TAX_ID = '((?:[0-9A-Za-z][\\s\\u00a0]?){15,22})'
const YEN_MONEY_VALUE =
  '(?:[-+]?(?:\\d(?:[\\s\\u00a0]?\\d)*)[\\s\\u00a0]*(?:\\.[\\s\\u00a0]*\\d(?:[\\s\\u00a0]?\\d)*)?)'
const YEN_MONEY_PATTERN = new RegExp(`[¥￥]\\s*(${YEN_MONEY_VALUE})`, 'g')
const SELLER_NAME_HINTS = ['河北镁神科技股份有限公司']

function compactDigitRun(v) {
  return v.replace(/[\s\u00a0]/g, '')
}
function compactTaxId(v) {
  return v.replace(/[\s\u00a0]/g, '').toUpperCase()
}
function basenameOf(fileName) {
  const n = fileName.replace(/\\/g, '/')
  return n.slice(n.lastIndexOf('/') + 1)
}
function parseCnDateToIso(text) {
  const compact = text.replace(/\s+/g, '')
  const m = compact.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (!m) return null
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
}
function parseIssuerBlockIssueDate(raw) {
  const cn = parseCnDateToIso(raw)
  if (cn) return cn
  const iso = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!iso) return null
  return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`
}
function parseMoney(text) {
  if (!text) return null
  const trimmed = text.trim()
  const cleaned = trimmed.replace(/[,，]/g, '').replace(/[^\d.-]/g, '')
  if (!cleaned || cleaned === '-' || cleaned === '.') return null
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return null
  const hasDecimalMarker = /[.,]/.test(trimmed)
  const intDigits = cleaned.replace(/^-/, '').split('.')[0]?.length ?? 0
  if (!hasDecimalMarker && intDigits >= 12) return null
  return Math.round(n * 100) / 100
}
function normalizeInvoiceType(raw) {
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
  return null
}
function parseInvoiceFileNameHints(fileName) {
  const base = basenameOf(fileName)
  const dzfp = base.match(INVOICE_FILE_RE)
  if (dzfp) {
    const stamp = dzfp[3]
    const issue_date = /^\d{4}-\d{2}-\d{2}$/.test(stamp)
      ? stamp
      : stamp?.length >= 8
        ? `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`
        : null
    return {
      pattern: 'dzfp',
      digital_invoice_no: dzfp[1],
      buyer_name: dzfp[2]?.trim() || null,
      seller_name: null,
      invoice_type: null,
      issue_date,
    }
  }
  const alt = base.match(ALT_INVOICE_FILE_RE)
  if (alt) {
    const label = alt[2]?.trim() ?? ''
    const invoice_type = label.includes('专用')
      ? '数电发票（增值税专用发票）'
      : label.includes('普通')
        ? '数电发票（普通发票）'
        : normalizeInvoiceType(`电子发票（${label}）`)
    return {
      pattern: 'alt',
      digital_invoice_no: alt[3],
      buyer_name: null,
      seller_name: alt[1]?.trim() || null,
      invoice_type,
      issue_date: null,
    }
  }
  const compact = base.match(COMPACT_INVOICE_FILE_RE)
  if (compact) {
    return {
      pattern: 'compact',
      digital_invoice_no: compact[2],
      buyer_name: null,
      seller_name: compact[1]?.trim() || null,
      invoice_type: null,
      issue_date: null,
    }
  }
  return null
}
function compactPartyName(value) {
  return value.replace(/\s+/g, '').replace(/[（）()]/g, '')
}
function partyNameMatchesHint(partyName, hint) {
  if (!hint?.trim()) return false
  const party = compactPartyName(partyName)
  const target = compactPartyName(hint)
  if (!party || !target) return false
  return party.includes(target) || target.includes(party)
}
function partyNameMatchesAnyHint(partyName, hints) {
  return hints.some((hint) => partyNameMatchesHint(partyName, hint))
}
function orientIssuerBlockParties(firstName, firstTaxId, secondName, secondTaxId, hints) {
  const first = { name: firstName.replace(/\s+/g, ' ').trim(), taxId: firstTaxId }
  const second = { name: secondName.replace(/\s+/g, ' ').trim(), taxId: secondTaxId }
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
function extractInvoiceTypeFromText(text) {
  for (const p of [/(数电发票（[^）]+）)/, /(电子发票（[^）]+）)/, /(增值税专用发票)/]) {
    const m = text.match(p)
    if (m?.[1]) return normalizeInvoiceType(m[1])
  }
  const compactTitle = text.slice(0, 160).replace(/\s+/g, '')
  const m = compactTitle.match(/(?:电子|数电)发票[（(][^）)]+[）)]/)
  return m ? normalizeInvoiceType(m[0]) : null
}
function extractYenAmounts(text) {
  return [...text.matchAll(YEN_MONEY_PATTERN)]
    .map((m) => parseMoney(m[1]))
    .filter((v) => v != null)
}
function isLikelyIssuerName(value) {
  const t = value.replace(/[\s\u00a0]+/g, '').trim()
  if (t.length < 2 || t.length > 4) return false
  if (/[壹贰叁肆伍陆柒捌玖拾佰仟万]/.test(t) && /[圆整角]/.test(t)) return false
  return /^[\u4e00-\u9fa5·]+$/.test(t)
}
function normalizeIssuerName(value) {
  const normalized = value.replace(/[\s\u00a0]+/g, '').trim()
  if (/页/.test(normalized)) return null
  return isLikelyIssuerName(normalized) ? normalized : null
}
function extractIssuerAfterTotalAmount(text) {
  const yenMatches = [...text.matchAll(YEN_MONEY_PATTERN)]
  for (let i = yenMatches.length - 1; i >= 0; i -= 1) {
    const match = yenMatches[i]
    const region = text.slice(match.index + match[0].length, match.index + match[0].length + 80)
    const beforeItem = region.split('*')[0]?.trim() ?? ''
    if (!beforeItem || isChineseUppercaseAmount(beforeItem)) continue
    const candidate = beforeItem.match(/^([\u4e00-\u9fa5·](?:[\s\u00a0]*[\u4e00-\u9fa5·]){1,3})(?=\s|$)/)?.[1]
    const issuer = candidate ? normalizeIssuerName(candidate) : null
    if (issuer) return issuer
  }
  return null
}
function extractIssuerFromText(text) {
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
  for (const pattern of [
    /[¥￥][^¥]+\s+([\u4e00-\u9fa5·](?:[\s\u00a0]*[\u4e00-\u9fa5·]){1,3})\s+\*/,
    /[¥￥][^¥]+\s+([\u4e00-\u9fa5·](?:[\s\u00a0]*[\u4e00-\u9fa5·]){1,3})(?=\s*收|$)/,
  ]) {
    const m = text.match(pattern)
    if (m?.[1]) {
      const issuer = normalizeIssuerName(m[1])
      if (issuer) return issuer
    }
  }
  return null
}
const REMARK_FIELD_LABEL =
  '购买方地址|销售方地址|购方地址|销方地址|购方开户银行|购买方开户银行|销方开户银行|销售方开户银行|银行账号|电话|收款人|复核人|订单号|被红冲蓝字数电票号码'
function isChineseUppercaseAmount(value) {
  if (!/[壹贰叁肆伍陆柒捌玖拾佰仟万]/.test(value)) return false
  return (
    /[壹贰叁肆伍陆柒捌玖拾佰仟万]{2,}/.test(value) ||
    (/[壹贰叁肆伍陆柒捌玖拾佰仟万]/.test(value) && /[圆整角]/.test(value))
  )
}
function remarkSearchRegion(text) {
  const yenMatches = [...text.matchAll(YEN_MONEY_PATTERN)]
  if (yenMatches.length === 0) return text
  const last = yenMatches[yenMatches.length - 1]
  return text.slice(last.index + last[0].length)
}
function normalizeRemarkLabelSpacing(text) {
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
function formatRemarkSegment(label, value) {
  const normalizedValue =
    label === '银行账号'
      ? value.replace(/[\s\u00a0]/g, '').trim()
      : value.replace(/\s+/g, ' ').trim()
  if (!normalizedValue) return ''
  return `${label}:${normalizedValue.replace(/^[：:\s]+/, '')}`
}
function parseRemarkFieldSegments(region) {
  const re = new RegExp(`(?:${REMARK_FIELD_LABEL})[：:\\s]+([^;；]+)`, 'gi')
  const segments = []
  const seen = new Set()
  let match
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
function extractTrailingRemarkCode(region) {
  return region.match(/(?:[;；\s]+)([A-Z][A-Z0-9-]{5,})\s*$/)?.[1] ?? null
}
function stripRemarkFooter(text) {
  return text
    .replace(/\s*共\s*\d+\s*页\s*第\s*\d+\s*页\s*$/g, '')
    .replace(/\s*第\s*\d+\s*页\s*\/\s*共\s*\d+\s*页\s*$/g, '')
    .trim()
}
function normalizeRemarkText(text) {
  return stripRemarkFooter(text)
    .replace(/\s*([:：])\s*/g, ':')
    .replace(/\s*([;；])\s*/g, '; ')
    .replace(/\s+/g, ' ')
    .replace(/(?:;\s*)+$/g, '')
    .trim()
}
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
function stripIssuerPrefix(region, issuer) {
  const trimmed = region.trimStart()
  if (issuer) {
    return trimmed.replace(new RegExp(`^${escapeRegExp(issuer).replace(/\s+/g, '\\s*')}\\s+`), '')
  }
  return trimmed.replace(/^[\u4e00-\u9fa5·]{2,4}\s+/, '')
}
function stripLeadingLineItemRows(region) {
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
function extractRemarkArea(region, issuer) {
  const withoutIssuer = stripIssuerPrefix(region, issuer)
  const area = normalizeRemarkText(stripLeadingLineItemRows(withoutIssuer))
  if (!area) return null
  if (area.includes('*')) return null
  if (isLikelyIssuerName(area) || isChineseUppercaseAmount(area)) return null
  return area
}
function extractFreeRemarkTail(region, issuer) {
  let tail = region.trimStart()
  if (issuer) {
    tail = tail.replace(new RegExp(`^${issuer.replace(/\s+/g, '\\s*')}\\s+`), '')
  } else {
    tail = tail.replace(/^[\u4e00-\u9fa5·]{2,4}\s+/, '')
  }
  const afterLineItem = tail.match(
    /\*[^*]+\*[\s\S]*?\d(?:\.\d+)?\s+([\u4e00-\u9fa5][\u4e00-\u9fa5A-Za-z0-9（）()·,\s]{1,60})\s*$/,
  )
  if (!afterLineItem?.[1]) return null
  const note = afterLineItem[1].replace(/\s+/g, ' ').trim()
  if (note.length < 2 || isLikelyIssuerName(note) || isChineseUppercaseAmount(note)) return null
  return note
}
function extractInvoiceRemarkFromText(text, issuer = null) {
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
function parsePrefaceInvoiceBlock(text) {
  const head = text.slice(0, 600)
  const block = head.match(
    new RegExp(
      `([\\u4e00-\\u9fa5A-Za-z0-9（）()·\\s]+?)\\s+(${FLEX_CN_DATE})\\s+${SPACED_TAX_ID}\\s+(\\d{20})\\s+${SPACED_TAX_ID}\\s+([\\u4e00-\\u9fa5A-Za-z0-9（）()·\\s]+?)\\s+国家税务总局`,
    ),
  )
  if (!block) return null
  const sellerTaxId = compactTaxId(block[3])
  const buyerTaxId = compactTaxId(block[5])
  if (sellerTaxId.length < 15 || buyerTaxId.length < 15) return null
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
function parseIssuerBlockParties(rest, hints) {
  const twoTax = rest.match(
    new RegExp(`^(${PARTY_NAME})\\s+${SPACED_TAX_ID}\\s+(${PARTY_NAME})\\s+${SPACED_TAX_ID}`),
  )
  if (twoTax) {
    const firstTaxId = compactTaxId(twoTax[2])
    const secondTaxId = compactTaxId(twoTax[4])
    if (firstTaxId.length < 15 || secondTaxId.length < 15) return null
    const oriented = orientIssuerBlockParties(twoTax[1], firstTaxId, twoTax[3], secondTaxId, hints)
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
    if (taxId.length < 15) return null
    const firstName = twoNamesOneTax[1].replace(/\s+/g, ' ').trim()
    const secondName = twoNamesOneTax[2].replace(/\s+/g, ' ').trim()
    let sellerName = secondName
    let sellerTaxId = taxId
    let buyerName = firstName
    let buyerTaxId = null
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
    if (taxId.length < 15) return null
    const firstName = nameTaxName[1].replace(/\s+/g, ' ').trim()
    const secondName = nameTaxName[3].replace(/\s+/g, ' ').trim()
    let sellerName = firstName
    let sellerTaxId = taxId
    let buyerName = secondName
    let buyerTaxId = null
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
function parseDigitalInvoiceBlock(text, fileName) {
  const hints = fileName ? parseInvoiceFileNameHints(fileName) : null
  const headerMatch = text.match(
    new RegExp(`${ISSUER_LABEL}${ISSUER_BLOCK_SKIP}(${ISSUER_INVOICE_NO})\\s+(${FLEX_ISSUE_DATE})\\s+(.*)`, 's'),
  )
  if (!headerMatch) return null
  const rest = headerMatch[3]
  const parties = parseIssuerBlockParties(rest, hints)
  if (!parties) return null
  const afterParties = rest.slice(parties.matchLength)
  const yenAmounts = extractYenAmounts(afterParties)
  if (yenAmounts.length < 2) return null
  const issuer = extractIssuerFromText(afterParties) ?? extractIssuerFromText(text)
  return {
    digital_invoice_no: compactDigitRun(headerMatch[1]),
    issue_date: parseIssuerBlockIssueDate(headerMatch[2]),
    seller_name: parties.seller_name,
    seller_tax_id: parties.seller_tax_id ?? '',
    buyer_name: parties.buyer_name,
    buyer_tax_id: parties.buyer_tax_id ?? '',
    amount: yenAmounts[0],
    tax_amount: yenAmounts[1],
    total_amount:
      yenAmounts[2] ??
      (yenAmounts[0] != null && yenAmounts[1] != null
        ? Math.round((yenAmounts[0] + yenAmounts[1]) * 100) / 100
        : null),
    issuer,
  }
}
function shouldUseDigitalLineItemParser(text) {
  if (new RegExp(`${ISSUER_LABEL}${ISSUER_BLOCK_SKIP}${ISSUER_INVOICE_NO}`).test(text)) return true
  if (/\*[^*]+\*[^*\n]{2,80}?\s+\d{1,2}%/.test(text)) return true
  return /\*[^*]+\*[^*\n]{2,200}?\s+\d(?:[\s\u00a0]?\d)*[\s\u00a0]*%/.test(text)
}
const SPACED_TAX_RATE = String.raw`\d(?:[\s\u00a0]?\d)*[\s\u00a0]*%|\*|免税`
const DIGITAL_LINE_ITEM_WITH_SPEC =
  /\*\s*([^*]+?)\s*\*\s*([\u4e00-\u9fa5A-Za-z0-9（）()·\s]+?)\s+([A-Z0-9][A-Za-z0-9-]{1,30})\s+(\d{1,2}%|\*|免税)\s+(\S+)\s+(-?[\d,.]+)\s+(-?[\d,.]+)\s+(-?[\d,.]+)\s+(-?[\d,.]+)/
const DIGITAL_LINE_ITEM_NO_SPEC =
  /\*\s*([^*]+?)\s*\*\s*([\u4e00-\u9fa5A-Za-z0-9（）()·\s]+?)\s+(\d{1,2}%|\*|免税)\s+(\S+)\s+(-?[\d,.]+)\s+(-?[\d,.]+)\s+(-?[\d,.]+)\s+(-?[\d,.]+)/

function compactSpacedDigits(text) {
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
function separateFixedDecimals(text) {
  return text.replace(/(\d\.\d{2})(?=\d)/g, '$1 ')
}
function normalizeTaxRateDisplay(raw) {
  if (!raw?.trim()) return null
  const trimmed = raw.trim()
  if (trimmed === '免税' || trimmed === '*') return trimmed
  const compact = compactSpacedDigits(trimmed)
  return compact.endsWith('%') ? compact : trimmed
}
function looksLikeSpecToken(value) {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/[\d*/\\-]/.test(trimmed)) return true
  if (/^[A-Z]{1,12}$/.test(trimmed)) return true
  return false
}
function splitLineItemNameAndSpec(category, rawName, explicitSpec = null) {
  const cleanCategory = category.trim().replace(/[\s\u00a0]+/g, '')
  let cleanName = rawName
    .replace(/([\u4e00-\u9fa5])[\s\u00a0]+(?=[\u4e00-\u9fa5])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
  let spec = explicitSpec?.trim() || null
  if (!spec) {
    const m = cleanName.match(/^(.+?)\s+([A-Za-z0-9][A-Za-z0-9/\\\-*（）()·\u4e00-\u9fa5]{0,40})$/)
    if (m?.[1] && m?.[2] && looksLikeSpecToken(m[2])) {
      cleanName = m[1].trim()
      spec = m[2].trim()
    }
  }
  return { item_name: `* ${cleanCategory} * ${cleanName}`, spec }
}
function normalizeSpecAndTaxRate(rawSpec, rawTaxRate) {
  const spec = rawSpec?.trim() || null
  const taxCompact = compactSpacedDigits(rawTaxRate).replace(/\s+/g, '')
  if (spec && /^\d$/.test(spec) && /^\d%$/.test(taxCompact)) {
    return { spec: null, tax_rate: `${spec}${taxCompact}` }
  }
  return { spec, tax_rate: normalizeTaxRateDisplay(rawTaxRate) }
}
const KNOWN_UNIT_PATTERN = '(?:KWH|kwh|kg|KG|千克|公斤|立方米|吨|个|件|套|条|项)'
function expandDecimalCandidates(digitStr) {
  if (!digitStr) return []
  const results = new Set()
  const direct = parseMoney(digitStr)
  if (direct != null) results.add(direct)
  for (let d = 1; d < digitStr.length; d++) {
    const n = parseMoney(`${digitStr.slice(0, d)}.${digitStr.slice(d)}`)
    if (n != null) results.add(n)
  }
  return [...results]
}
function qtyPriceMatchError(amount, a, b) {
  if (a === 0 || b === 0) return Infinity
  return Math.abs(a * b - amount) / Math.max(Math.abs(amount), 1e-9)
}
function findQtyPriceInDigitBlob(blob, amount) {
  const digits = blob.replace(/\D/g, '')
  if (!digits) return null
  let best = null
  for (let i = 1; i < digits.length; i++) {
    for (const a of expandDecimalCandidates(digits.slice(0, i))) {
      for (const b of expandDecimalCandidates(digits.slice(i))) {
        const err = qtyPriceMatchError(amount, a, b)
        if (err >= 0.02) continue
        const resolved = resolveQuantityAndUnitPrice(amount, a, b)
        if (resolved.quantity == null || resolved.unit_price == null) continue
        if (!best || err < best.err) best = { ...resolved, err }
      }
    }
  }
  return best ? { quantity: best.quantity, unit_price: best.unit_price } : null
}
function parseFirstSpacedMoney(raw) {
  const m = raw.match(/^(\d(?:[\s\u00a0]*\d)*[\s\u00a0]*(?:[.,][\s\u00a0]*\d(?:[\s\u00a0]*\d){0,2})?)/)
  if (!m) return { value: null, rest: raw }
  return { value: parseMoney(m[1]), rest: raw.slice(m[0].length).trimStart() }
}
function extractLineItemSections(text) {
  const sections = []
  const pattern = /\*\s*[^*]+?\s*\*[\s\S]{8,600}?(?=收\s*款\s*人|复\s*核\s*人|$)/g
  let match
  while ((match = pattern.exec(text)) !== null) sections.push(match[0].trim())
  return sections
}
function parseLineItemPrefix(section) {
  const withUnit = section.match(
    new RegExp(
      `^\\*\\s*([^*]+?)\\s*\\*\\s*(.+?)\\s+(?:(无|[A-Za-z0-9][A-Za-z0-9-]{0,40})\\s+)?(${SPACED_TAX_RATE})\\s+(\\S+)\\s+(.+)$`,
    ),
  )
  if (withUnit) {
    const specAndTax = normalizeSpecAndTaxRate(withUnit[3], withUnit[4])
    const item = splitLineItemNameAndSpec(withUnit[1], withUnit[2], specAndTax.spec)
    return {
      item_name: item.item_name,
      spec: item.spec,
      tax_rate: specAndTax.tax_rate,
      unit: withUnit[5].trim(),
      numericTail: withUnit[6].trim(),
    }
  }
  const serviceLine = section.match(
    new RegExp(`^\\*\\s*([^*]+?)\\s*\\*\\s*(.+?)\\s+(${SPACED_TAX_RATE})\\s+(.+)$`),
  )
  if (serviceLine) {
    const item = splitLineItemNameAndSpec(serviceLine[1], serviceLine[2])
    return {
      item_name: item.item_name,
      spec: item.spec,
      tax_rate: normalizeTaxRateDisplay(serviceLine[3]),
      unit: null,
      numericTail: serviceLine[4].trim(),
    }
  }
  const amountLine = section.match(
    new RegExp(`^\\*\\s*([^*]+?)\\s*\\*\\s*(.+?)\\s+(${KNOWN_UNIT_PATTERN})(?:\\s+([\\u4e00-\\u9fa5A-Za-z0-9（）()·-]{1,20}))?\\s+(?=[¥￥])(.+)$`),
  )
  if (amountLine) {
    const suffix = amountLine[4]?.trim() ?? ''
    const rawName = suffix ? `${amountLine[2]}${suffix}` : amountLine[2]
    const item = splitLineItemNameAndSpec(amountLine[1], rawName)
    return {
      item_name: item.item_name,
      spec: item.spec,
      tax_rate: null,
      unit: amountLine[3].trim(),
      numericTail: amountLine[5].trim(),
    }
  }
  return null
}
function parseDigitalLineItemNumbers(tail, header = {}) {
  const segments = tail.split(/\s{2,}/).map((s) => s.trim()).filter(Boolean)
  let amount = segments[0] ? parseFirstSpacedMoney(segments[0]).value : null
  let tax_amount = null
  let qtyPriceBlob = ''
  if (segments.length >= 2) {
    const taxPart = parseFirstSpacedMoney(segments[1])
    tax_amount = taxPart.value
    qtyPriceBlob = taxPart.rest
    if (segments.length >= 3) qtyPriceBlob = [qtyPriceBlob, ...segments.slice(2)].filter(Boolean).join(' ')
  }
  const bounded = separateFixedDecimals(compactSpacedDigits(tail))
  const nums = [...bounded.matchAll(/-?\d+(?:\.\d+)?/g)]
    .map((m) => parseMoney(m[0]))
    .filter((n) => n != null)
  if (amount == null && nums.length >= 1) amount = nums[0]
  if (tax_amount == null && nums.length >= 2) tax_amount = nums[1]
  if (header.amount != null) amount = header.amount
  if (header.tax_amount != null) tax_amount = header.tax_amount
  let quantity = null
  let unit_price = null
  const rest = nums.slice(2)
  if (amount != null) {
    let bestErr = Infinity
    for (let i = 0; i < rest.length; i++) {
      for (let j = 0; j < rest.length; j++) {
        if (i === j) continue
        const err = qtyPriceMatchError(amount, rest[i], rest[j])
        if (err >= 0.02 || err >= bestErr) continue
        const resolved = resolveQuantityAndUnitPrice(amount, rest[i], rest[j])
        if (resolved.quantity == null || resolved.unit_price == null) continue
        bestErr = err
        quantity = resolved.quantity
        unit_price = resolved.unit_price
      }
    }
    if (quantity == null || unit_price == null) {
      for (const blob of [qtyPriceBlob, tail, ...rest.map(String)].filter(Boolean)) {
        const fromBlob = findQtyPriceInDigitBlob(blob, amount)
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

function resolveQuantityAndUnitPrice(amount, first, second) {
  if (first == null || second == null) return { quantity: first, unit_price: second }
  if (amount != null && amount !== 0) {
    const err1 =
      first !== 0 ? Math.abs(amount / first - second) / Math.max(Math.abs(second), 1e-9) : Infinity
    const err2 =
      second !== 0 ? Math.abs(amount / second - first) / Math.max(Math.abs(first), 1e-9) : Infinity
    const bothGood = err1 < 0.02 && err2 < 0.02
    if (bothGood) {
      if (Number.isInteger(second) && !Number.isInteger(first)) return { quantity: second, unit_price: first }
      if (Number.isInteger(first) && !Number.isInteger(second)) return { quantity: first, unit_price: second }
      return first >= second
        ? { quantity: first, unit_price: second }
        : { quantity: second, unit_price: first }
    }
    if (err1 < err2) return { quantity: first, unit_price: second }
    return { quantity: second, unit_price: first }
  }
  return { quantity: first, unit_price: second }
}

function parseSpacedDigitalLineItem(text, header = {}) {
  for (const section of extractLineItemSections(text)) {
    const prefix = parseLineItemPrefix(section)
    if (!prefix) continue
    const numbers = parseDigitalLineItemNumbers(prefix.numericTail, {
      amount: header.amount ?? null,
      tax_amount: header.tax_amount ?? null,
    })
    if (numbers.amount == null) continue
    return {
      item_name: prefix.item_name,
      spec: prefix.spec,
      tax_rate: prefix.tax_rate,
      unit: prefix.unit ?? (numbers.quantity === 1 ? '项' : null),
      amount: numbers.amount,
      tax_amount: numbers.tax_amount,
      quantity: numbers.quantity,
      unit_price: numbers.unit_price,
    }
  }
  return null
}

function parseDigitalLineItem(text, header = {}) {
  const spaced = parseSpacedDigitalLineItem(text, header)
  if (spaced) return spaced

  const withSpec = text.match(DIGITAL_LINE_ITEM_WITH_SPEC)
  if (withSpec) {
    const amount = parseMoney(withSpec[6])
    const { quantity, unit_price } = resolveQuantityAndUnitPrice(
      amount,
      parseMoney(withSpec[8]),
      parseMoney(withSpec[9]),
    )
    return {
      item_name: `* ${withSpec[1].trim()} * ${withSpec[2].trim()}`,
      spec: withSpec[3]?.trim() || null,
      unit: withSpec[5]?.trim() || null,
      amount,
      quantity,
      unit_price,
    }
  }
  const noSpec = text.match(DIGITAL_LINE_ITEM_NO_SPEC)
  if (noSpec) {
    const amount = parseMoney(noSpec[5])
    const { quantity, unit_price } = resolveQuantityAndUnitPrice(
      amount,
      parseMoney(noSpec[7]),
      parseMoney(noSpec[8]),
    )
    return {
      item_name: `* ${noSpec[1].trim()} * ${noSpec[2].trim()}`,
      spec: null,
      unit: noSpec[4]?.trim() || null,
      amount,
      quantity,
      unit_price,
    }
  }
  return null
}

function coalesceText(...vals) {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim() && !/^[—–\-－]+$/.test(v.trim())) return v.trim()
  }
  return null
}
function coalesceMoney(...vals) {
  for (const v of vals) {
    if (v != null && Number.isFinite(v)) return v
  }
  return null
}
function resolveIsPositiveInvoice(text, amounts = {}) {
  if (/是否正数发票[：:\s]*否/.test(text)) return '否'
  if (/红字发票|被红冲|负数发票|（负数）|\(负数\)/.test(text)) return '否'
  if (amounts.total_amount != null && amounts.total_amount < 0) return '否'
  if (amounts.amount != null && amounts.amount < 0) return '否'
  if (amounts.tax_amount != null && amounts.tax_amount < 0) return '否'
  if (/是否正数发票[：:\s]*是/.test(text)) return '是'
  return '是'
}
function parseInvoice(text, fileName) {
  const hints = parseInvoiceFileNameHints(fileName)
  const block = parseDigitalInvoiceBlock(text, fileName) ?? parsePrefaceInvoiceBlock(text)
  const invoice_type = coalesceText(extractInvoiceTypeFromText(text), hints?.invoice_type)
  const digitalNo = coalesceText(block?.digital_invoice_no, hints?.digital_invoice_no)
  const amount = coalesceMoney(block?.amount)
  const tax_amount = coalesceMoney(block?.tax_amount)
  const total_amount = coalesceMoney(block?.total_amount)
  return {
    digital_invoice_no: digitalNo,
    invoice_number: digitalNo,
    buyer_name: coalesceText(block?.buyer_name, hints?.pattern === 'dzfp' ? hints?.buyer_name : null),
    seller_name: coalesceText(block?.seller_name),
    buyer_tax_id: block?.buyer_tax_id ?? null,
    seller_tax_id: block?.seller_tax_id ?? null,
    issue_date: coalesceText(block?.issue_date, hints?.issue_date),
    invoice_type,
    issuer: block?.issuer ?? null,
    amount,
    tax_amount,
    total_amount,
    is_positive: resolveIsPositiveInvoice(text, { amount, tax_amount, total_amount }),
  }
}
function expectedNoFromFileName(fileName) {
  const base = basenameOf(fileName)
  return base.match(/(\d{20})\.pdf$/i)?.[1] ?? base.match(INVOICE_FILE_RE)?.[1] ?? null
}
function isInvoicePdfName(fileName) {
  const base = basenameOf(fileName)
  return (
    INVOICE_FILE_RE.test(base) ||
    ALT_INVOICE_FILE_RE.test(base) ||
    COMPACT_INVOICE_FILE_RE.test(base) ||
    /数电(?:发票|票)/.test(base) ||
    base.startsWith('dzfp_')
  )
}
async function extractText(filePath) {
  const data = await fs.readFile(filePath)
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise
  const parts = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    parts.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '))
  }
  return parts.join('\n')
}

function isPlaceholderFieldValue(value) {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (/^[—–\-－]+$/.test(trimmed)) return true
  if (trimmed === 'null' || trimmed === 'undefined') return true
  if (/[壹贰叁肆伍陆柒捌玖拾佰仟万亿元整角分]/.test(trimmed) && trimmed.length > 4) return true
  return false
}

function hasFilledText(value) {
  return typeof value === 'string' && !isPlaceholderFieldValue(value)
}

function hasMoney(value) {
  return value != null && Number.isFinite(value)
}

function normalizeInvoiceDigits(value) {
  return (value ?? '').replace(/\D/g, '')
}

function invoiceNumberMatchesDigitalNo(row) {
  const digitalNo = normalizeInvoiceDigits(row.digital_invoice_no)
  const invoiceNo = normalizeInvoiceDigits(row.invoice_number)
  if (digitalNo.length < STANDARD_LEN) return true
  return invoiceNo === digitalNo
}

function listMissingLineItemFieldLabels(items) {
  if (items.length === 0) {
    return ['货物或应税劳务名称', '规格型号', '单位', '数量', '单价']
  }

  const missing = new Set()
  const activeLines = items.filter(
    (item) =>
      hasFilledText(item.item_name) ||
      hasFilledText(item.spec) ||
      hasFilledText(item.unit) ||
      hasMoney(item.quantity) ||
      hasMoney(item.unit_price) ||
      hasMoney(item.amount),
  )
  const linesToCheck = activeLines.length > 0 ? activeLines : items

  for (const item of linesToCheck) {
    if (!hasFilledText(item.item_name)) missing.add('货物或应税劳务名称')
    if (!hasFilledText(item.unit)) missing.add('单位')
    if (!hasMoney(item.quantity)) missing.add('数量')
    if (!hasMoney(item.unit_price)) missing.add('单价')
  }

  return [...missing]
}

function listMissingInvoiceFieldLabels(row) {
  const missing = []
  if (normalizeInvoiceDigits(row.digital_invoice_no).length < STANDARD_LEN) missing.push('数电发票号码')
  if (!invoiceNumberMatchesDigitalNo(row)) missing.push('发票号码')
  missing.push(...listMissingLineItemFieldLabels(row.line_items ?? []))
  return missing
}

function assertMissingFieldRegression() {
  const cases = [
    {
      name: '占位明细会触发重解析',
      row: {
        digital_invoice_no: '25132000000003577436',
        invoice_number: '25132000000003577436',
        line_items: [{ item_name: '—', amount: 111703.54, tax_amount: 14521.46 }],
      },
      expected: ['货物或应税劳务名称', '单位', '数量', '单价'],
    },
    {
      name: '发票号码不等于数电票号会触发重解析',
      row: {
        digital_invoice_no: '25132000000003577436',
        invoice_number: '03577436',
        line_items: [{ item_name: '* 无机化学原料 * 氧化镁', unit: '吨', quantity: 1, unit_price: 100 }],
      },
      expected: ['发票号码'],
    },
    {
      name: '无规格但明细完整不再触发重解析',
      row: {
        digital_invoice_no: '25132000000003577436',
        invoice_number: '25132000000003577436',
        line_items: [{ item_name: '* 无机化学原料 * 氧化镁', spec: '无', unit: '吨', quantity: 1, unit_price: 100 }],
      },
      expected: [],
    },
  ]

  for (const c of cases) {
    const actual = listMissingInvoiceFieldLabels(c.row)
    const same =
      actual.length === c.expected.length &&
      c.expected.every((label) => actual.includes(label))
    if (!same) {
      throw new Error(`${c.name}: ${actual.join('、') || '(无缺失)'}，期望 ${c.expected.join('、') || '(无缺失)'}`)
    }
  }
}

assertMissingFieldRegression()

function assertLayoutRegression() {
  const isoDateText =
    '开票人：  25132000000216443295 2025-12-03  山东丰源轮胎制造股份有限公司  91370400679206899N  河北镁神科技股份有限公司  911305316610547945  ¥ 1575.22   ¥ 204.78  壹仟柒佰捌拾圆整   ¥ 1780.00  *无机化学原料*氧化镁   13% 吨   1575.22   204.78 7876.1 0.2'
  const block = parseDigitalInvoiceBlock(isoDateText)
  if (!block?.seller_tax_id || !block?.buyer_name || block.issue_date !== '2025-12-03') {
    throw new Error(`ISO 日期版式解析失败: ${JSON.stringify(block)}`)
  }
  if (!block.seller_name.includes('河北镁神') || !block.buyer_name.includes('山东丰源')) {
    throw new Error(`ISO 日期版式购销方方向错误: ${JSON.stringify(block)}`)
  }

  const mitaiText =
    '开票人：  电子发票（增值税专用发票） 发票号码： 开票日期： 25132000000092994521 2025年05月31日  河北镁泰镁质材料有限公司  911305310954895067  河北镁神科技股份有限公司  911305316610547945  ¥ 7921.62   ¥ 1029.79  捌仟玖佰伍拾壹圆肆角壹分   ¥ 8951.41  韩海燕  *塑料制品*白包装55*85   13% 条   3.5946902654867 400   1437.88   186.92'
  const mitaiBlock = parseDigitalInvoiceBlock(
    mitaiText,
    '河北镁泰镁质材料有限公司_数电票（专用发票）_25132000000092994521.pdf',
  )
  if (!mitaiBlock?.seller_tax_id || !mitaiBlock?.buyer_name || mitaiBlock.issue_date !== '2025-05-31') {
    throw new Error(`镁泰模板票头解析失败: ${JSON.stringify(mitaiBlock)}`)
  }
  if (!mitaiBlock.seller_name.includes('镁神') || !mitaiBlock.buyer_name.includes('镁泰')) {
    throw new Error(`镁泰模板购销方方向错误: ${JSON.stringify(mitaiBlock)}`)
  }

  const jilinText =
    '开票人：  25132000000117465784 2025年07月08日  吉林金恒制药股份有限公司  91220201064629684x  河北镁神科技股份有限公司  911305316610547945  ¥ 1061.95   ¥ 138.05  壹仟贰佰圆整   ¥ 1200.00  韩海燕  *无机化学原料*氧化镁   13% 吨   1061.95   138.05 13274.375 0.08'
  const jilinBlock = parseDigitalInvoiceBlock(
    jilinText,
    '吉林金恒制药股份有限公司_数电票（专用发票）_25132000000117465784.pdf',
  )
  if (!jilinBlock?.seller_name?.includes('镁神') || !jilinBlock?.buyer_name?.includes('吉林金恒')) {
    throw new Error(`吉林金恒购销方方向错误: ${JSON.stringify(jilinBlock)}`)
  }

  const klainText =
    '开票人：  25132000000056597615 2025年04月05日  可莱恩食品科技（佛山）有限公司   河北镁神科技股份有限公司  911305316610547945  ¥ 29203.54   ¥ 3796.46  叁万叁仟圆整   ¥ 33000.00  韩海燕  *无机化学原料*氧化镁   13% 吨   29203.54   3796.46'
  const klainBlock = parseDigitalInvoiceBlock(
    klainText,
    '可莱恩食品科技（佛山）有限公司_数电票（普通发票）_25132000000056597615.pdf',
  )
  if (!klainBlock?.seller_name?.includes('镁神') || !klainBlock?.buyer_name?.includes('可莱恩')) {
    throw new Error(`可莱恩购销方方向错误: ${JSON.stringify(klainBlock)}`)
  }

  const redText =
    '开票人：  25132000000004482819 2025 年 01 月 08 日 江苏嘉耐高温材料股份有限公司  91320282567753425A  河北镁神科技股份有限公司  911305316610547945  ¥ -12389.38   ¥ -1610.62  （负数）壹万肆仟圆整   ¥ -14000.00  韩海燕  * 无机化学原料 * 氧化镁   13% 吨   -12389.38   -1610.62 24778.76 -0.5  被红冲蓝字数电票号码： 24132000000195423123'
  const redParsed = parseInvoice(redText, '数电票（专用发票）_25132000000004482819_202518154631.pdf')
  if (redParsed.is_positive !== '否') {
    throw new Error(`红字发票 is_positive 错误: ${JSON.stringify(redParsed)}`)
  }
  const redLine = parseDigitalLineItem(redText)
  if (!redLine?.item_name?.includes('氧化镁') || redLine.unit !== '吨' || redLine.quantity == null) {
    throw new Error(`红字发票明细解析失败: ${JSON.stringify(redLine)}`)
  }

  const jilinRemarkText =
    '开票人：  25132000000117465784 2025年07月08日  吉林金恒制药股份有限公司  91220201064629684x  河北镁神科技股份有限公司  911305316610547945  ¥ 1061.95   ¥ 138.05  壹仟贰佰圆整   ¥ 1200.00  韩海燕  *无机化学原料*氧化镁   13% 吨   1061.95   138.05 13274.375 0.08  收款人:张贵静;   复核人:荣红梅;'
  const jilinRemark = extractInvoiceRemarkFromText(jilinRemarkText, '韩海燕')
  if (!jilinRemark?.includes('收款人:张贵静') || !jilinRemark.includes('复核人:荣红梅')) {
    throw new Error(`吉林金恒备注解析失败: ${JSON.stringify(jilinRemark)}`)
  }
  if (jilinRemark.includes('韩海燕')) {
    throw new Error(`备注误匹配开票人: ${JSON.stringify(jilinRemark)}`)
  }

  const bankRemarkText =
    '¥ 1000.00  *品*名 13% 个 100 13 100 13  购方开户银行:中国工商银行福州分行; 银行账号:1234567890123456789; 销方开户银行:建行邢台分行; 银行账号:9876543210987654321;  ANT25HCM1107'
  const bankRemark = extractInvoiceRemarkFromText(bankRemarkText)
  if (!bankRemark?.includes('购方开户银行:') || !bankRemark.includes('ANT25HCM1107')) {
    throw new Error(`银行备注解析失败: ${JSON.stringify(bankRemark)}`)
  }

  const powerRemarkText =
    '¥ 121082.72  韩海燕  *供电*电   13% KWH   107152.85   13929.87 0.7684513052209 139440  硅钢二车间4月'
  const powerRemark = extractInvoiceRemarkFromText(powerRemarkText, '韩海燕')
  if (powerRemark !== '硅钢二车间4月') {
    throw new Error(`无标签备注解析失败: ${JSON.stringify(powerRemark)}`)
  }

  const redRemark = extractInvoiceRemarkFromText(redText, '韩海燕')
  if (!redRemark?.includes('被红冲蓝字数电票号码:24132000000195423123')) {
    throw new Error(`红字备注解析失败: ${JSON.stringify(redRemark)}`)
  }
}

assertLayoutRegression()

const TEMPLATE_FILES = [
  '河北镁泰镁质材料有限公司_数电票（专用发票）_25132000000092994521.pdf',
  '河北镁泰镁质材料有限公司_数电票（增值税专用发票）_25132000000231452039.pdf',
  '河北镁泰镁质材料有限公司_数电票（增值税专用发票）_25132000000224111482.pdf',
  '河北镁泰镁质材料有限公司_数电票（增值税专用发票）_25132000000231481309.pdf',
  '河北镁泰镁质材料有限公司_数电票（增值税专用发票）_25132000000224101489.pdf',
  '河北镁泰镁质材料有限公司_数电票（普通发票）_25132000000052316914.pdf',
  '河北镁泰镁质材料有限公司_数电发票（增值税专用发票）_25132000000239711893.pdf',
  '河北镁泰镁质材料有限公司_数电发票（增值税专用发票）_25132000000239578649.pdf',
  '河北镁泰镁质材料有限公司_数电发票（增值税专用发票）_25132000000239615949.pdf',
  '河北镁泰镁质材料有限公司_数电发票（增值税专用发票）_25132000000239607501.pdf',
  '常州百佳翔禾实业投资有限公司_数电发票（增值税专用发票）_25132000000176988129.pdf',
  'dzfp_25132000000235207185_浙江洁华新材料股份有限公司_94500.00_2025-12-26.pdf',
  '安徽佳通乘用子午线轮胎有限公司_数电发票（增值税专用发票）_25132000000182814387.pdf',
  '重庆布尔动物药业有限公司_数电发票（增值税专用发票）_25132000000182744703.pdf',
  '广西青龙化学建材有限公司_数电票（增值税专用发票）_25132000000162314154.pdf',
  '四川科伦药业股份有限公司邛崃分公司_数电票（增值税专用发票）_25132000000139173745.pdf',
  '陕西华星电子开发有限公司_数电票（增值税专用发票）_25132000000132494834.pdf',
  '山东昶旭汽车配件有限公司_数电票（专用发票）_25132000000116179573.pdf',
  '宁乡新阳化工有限公司_数电票（专用发票）_25132000000111569569.pdf',
  '广州海有生物科技有限公司_数电票（专用发票）_25132000000095783745.pdf',
  '天津市鑫泓金属制品加工厂_数电票（专用发票）_25132000000052355112.pdf',
  '福州新信制动系统有限公司_数电票（专用发票）_25132000000047232377.pdf',
  '嘉兴合创未来生物科技有限公司_数电票（专用发票）_25132000000039571381.pdf',
  'dzfp_25122000000091880286_河北镁神科技股份有限公司_20251209100306.pdf',
  'dzfp_25122000000091857405_河北镁神科技股份有限公司_20251209100129.pdf',
  'dzfp_25112000000170901636_第一创业证券承销保荐有限责任公司_20250831180205.pdf',
]

const dirs = [
  '/Users/mac/Downloads/1.25日',
  '/Users/mac/Downloads',
  '/Users/mac/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_7qtugkm66ffd22_7707/msg/file/2026-06',
]

const files = new Set(TEMPLATE_FILES.map((f) => `/Users/mac/Downloads/${f}`))
for (const dir of dirs) {
  const names = await fs.readdir(dir).catch(() => [])
  for (const n of names) {
    if (!n.toLowerCase().endsWith('.pdf')) continue
    if (!isInvoicePdfName(n)) continue
    files.add(path.join(dir, n))
  }
}

let pass = 0
let fail = 0
const failures = []
const layoutStats = { normal: 0, spacedChars: 0, spacedIssuer: 0, spacedTaxId: 0 }

for (const filePath of files) {
  const fileName = path.basename(filePath)
  const text = await extractText(filePath)
  const parsed = parseInvoice(text, fileName)
  const expectedNo = expectedNoFromFileName(fileName)

  if (/开\s+票\s+人/.test(text)) layoutStats.spacedIssuer++
  if (/\d\s+\d\s+\d\s+\d\s+年/.test(text)) layoutStats.spacedChars++
  if (/9\s+1\s+1/.test(text)) layoutStats.spacedTaxId++
  if (!layoutStats.spacedIssuer && !layoutStats.spacedChars) layoutStats.normal++

  const issues = []
  const noDigits = compactDigitRun(parsed.digital_invoice_no ?? '')
  if (!noDigits) issues.push('无票号')
  else if (noDigits.length !== STANDARD_LEN) issues.push(`票号${noDigits.length}位(期望20)`)
  if (expectedNo && noDigits !== expectedNo) issues.push(`票号与文件名不符: ${noDigits} vs ${expectedNo}`)
  if (parsed.invoice_number !== parsed.digital_invoice_no) issues.push('发票号码≠数电票号')
  if (!parsed.seller_name) issues.push('缺销方名称')
  if (!parsed.buyer_name) issues.push('缺购方名称')
  if (!parsed.seller_tax_id || parsed.seller_tax_id.length < 15) issues.push('缺销方识别号')
  if (!parsed.buyer_tax_id || parsed.buyer_tax_id.length < 15) issues.push('缺购方识别号')
  if (!parsed.issue_date || !/^\d{4}-\d{2}-\d{2}$/.test(parsed.issue_date)) issues.push('缺开票日期')
  if (!parsed.invoice_type) issues.push('缺票种')
  if (!parsed.issuer) issues.push('缺开票人')
  if (parsed.amount == null) issues.push('缺金额')
  if (parsed.tax_amount == null) issues.push('缺税额')
  if (parsed.total_amount == null) issues.push('缺价税合计')
  if (parsed.is_positive === '否' && parsed.total_amount != null && parsed.total_amount > 0) {
    issues.push('负数发票但 is_positive=否 且价税合计为正')
  }
  if (/红字发票|被红冲|（负数）/.test(text) && parsed.is_positive !== '否') {
    issues.push('红字发票 is_positive 应为否')
  }
  if (parsed.amount != null && parsed.tax_amount != null && parsed.total_amount != null) {
    const sum = Math.round((parsed.amount + parsed.tax_amount) * 100) / 100
    if (Math.abs(sum - parsed.total_amount) > 0.02) {
      issues.push(`金额校验失败: ${parsed.amount}+${parsed.tax_amount}≠${parsed.total_amount}`)
    }
  }

  if (shouldUseDigitalLineItemParser(text)) {
    const line = parseDigitalLineItem(text, { amount: parsed.amount, tax_amount: parsed.tax_amount })
    if (!line?.item_name || line.item_name === '—') issues.push('缺明细项目名称')
    if (!line?.unit) issues.push('缺明细单位')
    if (line?.quantity == null) issues.push('缺明细数量')
    if (line?.unit_price == null) issues.push('缺明细单价')
    if (!line?.tax_rate) issues.push('缺明细税率')
  }

  if (issues.length) {
    fail++
    failures.push({ fileName, issues, parsed })
  } else {
    pass++
  }
}

console.log(`\n=== 数电发票回归 ===`)
console.log(`样本数: ${files.size}  通过: ${pass}  失败: ${fail}`)
console.log(`版式特征(有重叠): 开票人拆字=${layoutStats.spacedIssuer} 票号/日期拆字=${layoutStats.spacedChars} 税号拆字=${layoutStats.spacedTaxId}`)
if (failures.length) {
  console.log('\n失败明细:')
  for (const f of failures) {
    console.log(`- ${f.fileName}`)
    console.log(`  ${f.issues.join('; ')}`)
  }
}
process.exit(fail > 0 ? 1 : 0)
