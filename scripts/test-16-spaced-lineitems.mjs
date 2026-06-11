/**
 * 回归：16 张 PDF.js 拆字版式的数电发票明细解析
 */
import fs from 'node:fs/promises'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const FILES = [
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

const ISSUER_LABEL = '开\\s*票\\s*人[：:\\s]*'
const ISSUER_BLOCK_SKIP = '[\\s\\S]{0,1200}?'
const FLEX_CN_DATE =
  '(?:\\d{4}|(?:\\d[\\s\\u00a0]?){4})\\s*年\\s*(?:\\d{1,2}|(?:\\d[\\s\\u00a0]?){1,2})\\s*月\\s*(?:\\d{1,2}|(?:\\d[\\s\\u00a0]?){1,2})\\s*日'
const FLEX_ISO_DATE = '\\d{4}-\\d{1,2}-\\d{1,2}'
const FLEX_ISSUE_DATE = `(?:${FLEX_CN_DATE}|${FLEX_ISO_DATE})`
const ISSUER_INVOICE_NO =
  `(?:\\d{20}|(?:\\d[\\s\\u00a0]?){20})(?=\\s*(?:${FLEX_ISSUE_DATE}))`
const YEN_MONEY_VALUE =
  '(?:[-+]?(?:\\d(?:[\\s\\u00a0]?\\d)*)[\\s\\u00a0]*(?:\\.[\\s\\u00a0]*\\d(?:[\\s\\u00a0]?\\d)*)?)'
const YEN_MONEY_PATTERN = new RegExp(`[¥￥]\\s*(${YEN_MONEY_VALUE})`, 'g')
const SPACED_TAX_RATE = String.raw`\d(?:[\s\u00a0]?\d)*[\s\u00a0]*%|\*|免税`

function compactDigitRun(v) {
  return v.replace(/[\s\u00a0]/g, '')
}
function parseMoney(text) {
  if (!text) return null
  const cleaned = text.trim().replace(/[,，]/g, '').replace(/[^\d.-]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}
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
function hasTaxExemptTaxAmountMarker(text) {
  return /免\s*税/.test(text) && /\*{3}/.test(text)
}
function resolveQuantityAndUnitPrice(amount, first, second) {
  if (first == null || second == null) return { quantity: first, unit_price: second }
  if (amount != null && amount !== 0) {
    const err1 =
      first !== 0 ? Math.abs(Math.abs(amount) / first - second) / Math.max(Math.abs(second), 1e-9) : Infinity
    const err2 =
      second !== 0 ? Math.abs(Math.abs(amount) / second - first) / Math.max(Math.abs(first), 1e-9) : Infinity
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
function isLikelyUnit(value) {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (/[壹贰叁肆伍陆柒捌玖拾佰仟万亿元整]/.test(trimmed)) return false
  const money = parseMoney(trimmed)
  if (money != null && /^[\d\s\u00a0.,]+$/.test(trimmed)) return false
  return true
}
function isLikelyLineItemCategory(category) {
  const trimmed = category.trim().replace(/[\s\u00a0]+/g, '')
  if (/[壹贰叁肆伍陆柒捌玖拾佰仟万亿元整]/.test(trimmed)) return false
  if (/^[¥￥]/.test(trimmed)) return false
  if (/\d/.test(trimmed)) return false
  return trimmed.length >= 2
}
const LINE_ITEM_CATEGORY = '[\\u4e00-\\u9fa5A-Za-z（）()·\\s]{2,40}'
function scoreQtyPriceCandidate(amount, a, b, unit) {
  const err = qtyPriceMatchError(amount, a, b)
  if (err >= 0.02) return Infinity
  const resolved = resolveQuantityAndUnitPrice(amount, a, b)
  let score = err
  if (resolved.quantity != null && resolved.unit_price != null && unit && /吨|千克|公斤|kg/i.test(unit)) {
    if (resolved.unit_price < resolved.quantity) score += 1
  }
  return score
}
function findDigitalLineItemPrefixes(text) {
  const items = []
  const pattern = new RegExp(
    `\\*\\s*(${LINE_ITEM_CATEGORY}?)\\s*\\*\\s*(.+?)\\s+(?:(无|[A-Za-z0-9][A-Za-z0-9-]{0,40})\\s+)?(${SPACED_TAX_RATE})\\s+(\\S+)\\s+`,
    'g',
  )
  let match
  while ((match = pattern.exec(text)) !== null) {
    if (!isLikelyLineItemCategory(match[1])) continue
    if (!isLikelyUnit(match[5])) continue
    const tailStart = match.index + match[0].length
    const tailSlice = text.slice(tailStart)
    const tailEnd = tailSlice.search(
      /(?:\*\s*[^*]+?\s*\*|收\s*款\s*人|复\s*核\s*人|购\s*方|销\s*方|购买方|销售方)/,
    )
    const numericTail = (tailEnd >= 0 ? tailSlice.slice(0, tailEnd) : tailSlice).trim()
    items.push({
      item_name: `* ${match[1].trim().replace(/[\s\u00a0]+/g, '')} * ${match[2].trim()}`,
      tax_rate: normalizeTaxRateDisplay(match[4]),
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
    items.push({
      item_name: `* ${match[1].trim().replace(/[\s\u00a0]+/g, '')} * ${match[2].trim()}`,
      tax_rate: normalizeTaxRateDisplay(match[3]),
      unit: null,
      numericTail,
    })
  }
  const seen = new Set()
  return items.filter((item) => {
    const key = `${item.item_name}|${item.numericTail.slice(0, 40)}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
function findQtyPriceInDigitBlob(blob, amount, unit = null) {
  const digits = blob.replace(/\D/g, '')
  if (!digits) return null
  let best = null
  for (let i = 1; i < digits.length; i++) {
    for (const a of expandDecimalCandidates(digits.slice(0, i))) {
      for (const b of expandDecimalCandidates(digits.slice(i))) {
        const score = scoreQtyPriceCandidate(amount, a, b, unit)
        if (!Number.isFinite(score)) continue
        const resolved = resolveQuantityAndUnitPrice(amount, a, b)
        if (resolved.quantity == null || resolved.unit_price == null) continue
        if (!best || score < best.err) best = { ...resolved, err: score }
      }
    }
  }
  return best ? { quantity: best.quantity, unit_price: best.unit_price } : null
}
function parseDigitalLineItemNumbers(tail, header = {}, unit = null) {
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
      for (const blob of [qtyPriceBlob, tail, ...rest.map(String)].filter(Boolean)) {
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
function parseFirstSpacedMoney(raw) {
  const m = raw.match(/^(\d(?:[\s\u00a0]*\d)*[\s\u00a0]*(?:[.,][\s\u00a0]*\d(?:[\s\u00a0]*\d){0,2})?)/)
  if (!m) return { value: null, rest: raw }
  return { value: parseMoney(m[1]), rest: raw.slice(m[0].length).trimStart() }
}
function parseSpacedDigitalLineItem(text, header = {}) {
  for (const prefix of findDigitalLineItemPrefixes(text)) {
    const numbers = parseDigitalLineItemNumbers(prefix.numericTail, header, prefix.unit)
    if (numbers.amount == null) continue
    return {
      item_name: prefix.item_name,
      tax_rate: prefix.tax_rate,
      unit: prefix.unit ?? (numbers.quantity === 1 ? '项' : null),
      tax_amount: prefix.tax_rate === '免税' ? 0 : numbers.tax_amount,
      quantity: numbers.quantity,
      unit_price: numbers.unit_price,
    }
  }
  return null
}
function extractYenAmounts(text) {
  return [...text.matchAll(YEN_MONEY_PATTERN)]
    .map((m) => parseMoney(m[1]))
    .filter((n) => n != null)
}
function parseHeaderAmounts(text) {
  const yen = extractYenAmounts(text)
  if (hasTaxExemptTaxAmountMarker(text) && yen.length >= 2) {
    return { amount: yen[0], tax_amount: 0 }
  }
  return { amount: yen[0] ?? null, tax_amount: yen[1] ?? null }
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

let pass = 0
let fail = 0
for (const fileName of FILES) {
  const filePath = `/Users/mac/Downloads/${fileName}`
  const text = await extractText(filePath)
  const header = parseHeaderAmounts(text)
  const line = parseSpacedDigitalLineItem(text, header)
  const issues = []
  if (!line?.item_name) issues.push('名称')
  if (!line?.unit) issues.push('单位')
  if (line?.quantity == null) issues.push('数量')
  if (line?.unit_price == null) issues.push('单价')
  if (!line?.tax_rate) issues.push('税率')
  if (line?.tax_rate === '免税' && line?.tax_amount !== 0) issues.push('免税税额应为0')
  if (issues.length) {
    fail++
    console.log('FAIL', fileName.slice(0, 40), issues.join(','), line)
  } else {
    pass++
    console.log('OK  ', fileName.slice(0, 40), line.item_name.slice(0, 22), line.unit, line.quantity, line.unit_price, line.tax_rate)
  }
}
console.log(`\n通过 ${pass}/${FILES.length}  失败 ${fail}`)
process.exit(fail > 0 ? 1 : 0)
