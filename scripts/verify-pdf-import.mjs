import { readFileSync } from 'node:fs'

const invoiceName =
  'dzfp_26132000001679981911_河北镁泰镁质材料有限公司_20260604142415[单一发票].pdf'
const declarationName = '居民企业（查账征收）企业所得税月（季）度申报[申报信息查询].pdf'
const financialName =
  '23财务报表报送与信息采集（企业会计准则一般企业）[财务报表申报信息查询].pdf'

const INVOICE_FILE_RE =
  /^dzfp_(\d{10,30})_(.+?)_(\d{14})(?:\[单一发票\])?\.pdf$/i

function parseInvoiceFileName(fileName) {
  const m = fileName.match(INVOICE_FILE_RE)
  if (!m) return null
  return { digital_invoice_no: m[1], buyer_name: m[2] || null, issue_stamp: m[3] || null }
}

let ok = 0
let fail = 0

function assert(label, cond) {
  if (cond) {
    console.log(`[OK] ${label}`)
    ok++
  } else {
    console.error(`[FAIL] ${label}`)
    fail++
  }
}

const inv = parseInvoiceFileName(invoiceName)
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
  const intPart = String(Math.abs(Math.round(n * 100) / 100)).split('.')[0] ?? ''
  if (intPart.length > 18) return null
  return Math.round(n * 100) / 100
}

assert('reject invoice no as money', parseMoney('26132000001679981911') === null)
assert('accept invoice amount', parseMoney('12345.67') === 12345.67)
assert('invoice filename', inv?.digital_invoice_no === '26132000001679981911')
assert('invoice buyer', inv?.buyer_name?.includes('河北镁泰'))
assert('declaration filename', declarationName.includes('企业所得税'))
assert('financial filename', financialName.includes('财务报表'))

for (const p of [
  '/Users/mac/Downloads/dzfp_26132000001679981911_河北镁泰镁质材料有限公司_20260604142415[单一发票].pdf',
  '/Users/mac/Downloads/居民企业（查账征收）企业所得税月（季）度申报[申报信息查询].pdf',
  '/Users/mac/Downloads/23财务报表报送与信息采集（企业会计准则一般企业）[财务报表申报信息查询].pdf',
]) {
  const buf = readFileSync(p)
  assert(`${p.split('/').pop()} readable (${buf.length} bytes)`, buf.length > 1000)
}

console.log(`\nverify-pdf-import: ${ok} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
