import fs from 'node:fs/promises'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

function compactDigitRun(value) {
  return value.replace(/[\s\u00a0]/g, '')
}

function parseCnDateToIso(text) {
  const compact = text.replace(/\s+/g, '')
  const m = compact.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (!m) return null
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
}

function parseMoney(text) {
  if (!text) return null
  const cleaned = text.trim().replace(/[,，]/g, '').replace(/[^\d.-]/g, '')
  if (!cleaned) return null
  const n = Number(cleaned)
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null
}

const ISSUER_INVOICE_NO =
  '(?:\\d[\\s\\u00a0]?){18,22}(?=\\s*(?:\\d[\\s\\u00a0]?){4}\\s*年)'
const SPACED_CN_DATE =
  '(?:\\d[\\s\\u00a0]?){4}\\s*年(?:\\d[\\s\\u00a0]?){1,2}\\s*月(?:\\d[\\s\\u00a0]?){1,2}\\s*日'
const PARTY_NAME = '[\\u4e00-\\u9fa5A-Za-z0-9（）()·\\s]{2,80}?'

const YEN_MONEY_VALUE =
  '(?:[-+]?(?:\\d(?:[\\s\\u00a0]?\\d)*)[\\s\\u00a0]*(?:\\.[\\s\\u00a0]*\\d(?:[\\s\\u00a0]?\\d)*)?)'
const YEN_MONEY_PATTERN = new RegExp(`[¥￥]\\s*(${YEN_MONEY_VALUE})`, 'g')

function extractYenAmounts(text) {
  return [...text.matchAll(YEN_MONEY_PATTERN)]
    .map((match) => parseMoney(match[1]))
    .filter((value) => value != null)
}

function parseDigitalInvoiceBlock(text) {
  const headerMatch = text.match(
    new RegExp(`开票人[：:\\s]*(${ISSUER_INVOICE_NO})\\s+(${SPACED_CN_DATE})\\s+(.*)`, 's'),
  )
  if (!headerMatch) return null

  const rest = headerMatch[3]
  const parties = rest.match(
    new RegExp(
      `^(${PARTY_NAME})\\s+([0-9A-Z]{15,20})\\s+(${PARTY_NAME})\\s+([0-9A-Z]{15,20})`,
    ),
  )
  if (!parties) return null

  const afterParties = rest.slice(parties[0].length)
  const yenAmounts = extractYenAmounts(afterParties)
  if (yenAmounts.length < 3) return null

  const issuer =
    afterParties.match(/[¥￥][^¥]+\s+([\u4e00-\u9fa5·]{2,20})\s+\*/)?.[1] ??
    afterParties.match(/[¥￥][^¥]+\s+([\u4e00-\u9fa5·]{2,20})(?=\s*收|$)/)?.[1]
  if (!issuer) return null

  return {
    digital_invoice_no: compactDigitRun(headerMatch[1]),
    issue_date: parseCnDateToIso(headerMatch[2]),
    seller_name: parties[1].replace(/\s+/g, ' ').trim(),
    seller_tax_id: parties[2],
    buyer_name: parties[3].replace(/\s+/g, ' ').trim(),
    buyer_tax_id: parties[4],
    amount: yenAmounts[0],
    tax_amount: yenAmounts[1],
    total_amount: yenAmounts[2],
    issuer,
  }
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

const filePath = process.argv[2]
if (!filePath) {
  console.error('Usage: node scripts/test-invoice-parse-one.mjs <pdf-path>')
  process.exit(1)
}

const text = await extractText(filePath)
const parsed = parseDigitalInvoiceBlock(text)
console.log(JSON.stringify(parsed, null, 2))
