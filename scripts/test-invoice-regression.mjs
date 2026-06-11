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
const ISSUER_INVOICE_NO =
  '(?:\\d{20}|(?:\\d[\\s\\u00a0]?){20})(?=\\s*(?:\\d{4}|(?:\\d[\\s\\u00a0]?){4})\\s*年)'
const FLEX_CN_DATE =
  '(?:\\d{4}|(?:\\d[\\s\\u00a0]?){4})\\s*年\\s*(?:\\d{1,2}|(?:\\d[\\s\\u00a0]?){1,2})\\s*月\\s*(?:\\d{1,2}|(?:\\d[\\s\\u00a0]?){1,2})\\s*日'
const PARTY_NAME = '[\\u4e00-\\u9fa5A-Za-z0-9（）()·\\s]{2,80}?'
const SPACED_TAX_ID = '((?:[0-9A-Z][\\s\\u00a0]?){15,22})'
const YEN_MONEY_VALUE =
  '(?:[-+]?(?:\\d(?:[\\s\\u00a0]?\\d)*)[\\s\\u00a0]*(?:\\.[\\s\\u00a0]*\\d(?:[\\s\\u00a0]?\\d)*)?)'
const YEN_MONEY_PATTERN = new RegExp(`[¥￥]\\s*(${YEN_MONEY_VALUE})`, 'g')

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
      digital_invoice_no: compact[2],
      buyer_name: compact[1]?.trim() || null,
      seller_name: null,
      invoice_type: null,
      issue_date: null,
    }
  }
  return null
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
  const t = value.trim()
  if (t.length < 2 || t.length > 4) return false
  if (/[壹贰叁肆伍陆柒捌玖拾佰仟万亿元整角分]/.test(t)) return false
  return /^[\u4e00-\u9fa5·]+$/.test(t)
}
function extractIssuerFromText(text) {
  const beforeLabel = text.match(/([\u4e00-\u9fa5·]{2,4})\s+开\s*票\s*人[：:\s]/)
  if (beforeLabel && isLikelyIssuerName(beforeLabel[1])) return beforeLabel[1].trim()
  for (const pattern of [
    /[¥￥][^¥]+\s+([\u4e00-\u9fa5·]{2,4})\s+\*/,
    /[¥￥][^¥]+\s+([\u4e00-\u9fa5·]{2,4})(?=\s*收|$)/,
  ]) {
    const m = text.match(pattern)
    if (m?.[1] && isLikelyIssuerName(m[1])) return m[1].trim()
  }
  return null
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
function parseDigitalInvoiceBlock(text) {
  const headerMatch = text.match(
    new RegExp(`${ISSUER_LABEL}(${ISSUER_INVOICE_NO})\\s+(${FLEX_CN_DATE})\\s+(.*)`, 's'),
  )
  if (!headerMatch) return null
  const rest = headerMatch[3]
  const parties = rest.match(
    new RegExp(`^(${PARTY_NAME})\\s+${SPACED_TAX_ID}\\s+(${PARTY_NAME})\\s+${SPACED_TAX_ID}`),
  )
  if (!parties) return null
  const sellerTaxId = compactTaxId(parties[2])
  const buyerTaxId = compactTaxId(parties[4])
  if (sellerTaxId.length < 15 || buyerTaxId.length < 15) return null
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
const DIGITAL_LINE_ITEM_WITH_SPEC =
  /\*\s*([^*]+?)\s*\*\s*([\u4e00-\u9fa5A-Za-z0-9（）()·\s]+?)\s+([A-Z0-9][A-Za-z0-9\-]{1,30})\s+(\d{1,2}%|\*)\s+(\S+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)/
const DIGITAL_LINE_ITEM_NO_SPEC =
  /\*\s*([^*]+?)\s*\*\s*([\u4e00-\u9fa5A-Za-z0-9（）()·\s]+?)\s+(\d{1,2}%|\*)\s+(\S+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)\s+([\d,.]+)/

function resolveQuantityAndUnitPrice(amount, first, second) {
  if (first == null || second == null) return { quantity: first, unit_price: second }
  if (amount != null && amount > 0) {
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

function parseDigitalLineItem(text) {
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
function parseInvoice(text, fileName) {
  const hints = parseInvoiceFileNameHints(fileName)
  const block = parseDigitalInvoiceBlock(text) ?? parsePrefaceInvoiceBlock(text)
  const invoice_type = coalesceText(extractInvoiceTypeFromText(text), hints?.invoice_type)
  const digitalNo = coalesceText(block?.digital_invoice_no, hints?.digital_invoice_no)
  return {
    digital_invoice_no: digitalNo,
    invoice_number: digitalNo,
    buyer_name: coalesceText(block?.buyer_name, hints?.buyer_name),
    seller_name: coalesceText(block?.seller_name, hints?.seller_name),
    buyer_tax_id: block?.buyer_tax_id ?? null,
    seller_tax_id: block?.seller_tax_id ?? null,
    issue_date: coalesceText(block?.issue_date, hints?.issue_date),
    invoice_type,
    issuer: block?.issuer ?? null,
    amount: coalesceMoney(block?.amount),
    tax_amount: coalesceMoney(block?.tax_amount),
    total_amount: coalesceMoney(block?.total_amount),
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

const dirs = [
  '/Users/mac/Downloads/1.25日',
  '/Users/mac/Downloads',
  '/Users/mac/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_7qtugkm66ffd22_7707/msg/file/2026-06',
]

const files = new Set()
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
  if (parsed.amount != null && parsed.tax_amount != null && parsed.total_amount != null) {
    const sum = Math.round((parsed.amount + parsed.tax_amount) * 100) / 100
    if (Math.abs(sum - parsed.total_amount) > 0.02) {
      issues.push(`金额校验失败: ${parsed.amount}+${parsed.tax_amount}≠${parsed.total_amount}`)
    }
  }

  if (new RegExp(`${ISSUER_LABEL}${ISSUER_INVOICE_NO}`).test(text)) {
    const line = parseDigitalLineItem(text)
    if (!line?.item_name || line.item_name === '—') issues.push('缺明细项目名称')
    if (!line?.unit) issues.push('缺明细单位')
    if (line?.quantity == null) issues.push('缺明细数量')
    if (line?.unit_price == null) issues.push('缺明细单价')
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
