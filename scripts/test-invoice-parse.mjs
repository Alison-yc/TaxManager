import fs from 'node:fs/promises'
import path from 'node:path'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

function parseCnDateToIso(text) {
  const compact = text.replace(/\s+/g, '')
  const m = compact.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (!m) return null
  return `${m[1]}-${String(Number(m[2])).padStart(2, '0')}-${String(Number(m[3])).padStart(2, '0')}`
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

function pick(text, patterns) {
  for (const pattern of patterns) {
    const m = text.match(pattern)
    if (m?.[1]) return m[1].trim()
  }
  return null
}

const PARTY_NAME = '[\\u4e00-\\u9fa5A-Za-z0-9（）()·\\s]{2,80}?'

function parseDigitalInvoiceBlock(text) {
  const money = '[-+]?\\d[\\d,.]*'
  const block = text.match(
    new RegExp(
      `开票人[：:\\s]*(\\d{10,30})\\s+(\\d{4}\\s*年\\s*\\d{1,2}\\s*月\\s*\\d{1,2}\\s*日)\\s+(${PARTY_NAME})\\s+([0-9A-Z]{15,20})\\s+(${PARTY_NAME})\\s+([0-9A-Z]{15,20})\\s*[¥￥]\\s*(${money})\\s*[¥￥]\\s*(${money})\\s+.+?[¥￥]\\s*(${money})\\s+([\\u4e00-\\u9fa5·]{2,20})`,
    ),
  )
  if (!block) return null
  return {
    digital_invoice_no: block[1],
    issue_date: parseCnDateToIso(block[2]),
    seller_name: block[3].replace(/\\s+/g, ' ').trim(),
    seller_tax_id: block[4],
    buyer_name: block[5].replace(/\\s+/g, ' ').trim(),
    buyer_tax_id: block[6],
    issuer: block[10],
  }
}

function parseInvoice(text, fileName) {
  const digitalBlock = parseDigitalInvoiceBlock(text)
  const rawInvoiceType = pick(text, [/(数电发票（[^）]+）)/, /(电子发票（[^）]+）)/]) ?? null
  const invoice_type = normalizeInvoiceType(rawInvoiceType)
  return {
    fileName,
    digitalBlock: !!digitalBlock,
    invoice_type,
    ...(digitalBlock ?? {}),
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

const dirs = [
  '/Users/mac/Downloads/1.25日',
  '/Users/mac/Library/Containers/com.tencent.xinWeChat/Data/Documents/xwechat_files/wxid_7qtugkm66ffd22_7707/msg/file/2026-06',
]

const files = []
for (const dir of dirs) {
  const names = await fs.readdir(dir).catch(() => [])
  files.push(...names.filter((n) => n.toLowerCase().endsWith('.pdf')).map((n) => path.join(dir, n)))
}

let bad = 0
for (const filePath of files) {
  const text = await extractText(filePath)
  const parsed = parseInvoice(text, path.basename(filePath))
  const missing = [
    !parsed.invoice_type && 'invoice_type',
    !parsed.buyer_name && 'buyer_name',
    !parsed.seller_name && 'seller_name',
    !parsed.issue_date && 'issue_date',
    !parsed.issuer && 'issuer',
  ].filter(Boolean)
  if (missing.length) {
    bad++
    console.log('MISSING', parsed.fileName, missing.join(','), 'digitalBlock=', parsed.digitalBlock)
    if (!parsed.digitalBlock) {
      console.log('  issuer snippet:', text.match(/开票人[\s\S]{0,180}/)?.[0])
    }
  }
}
console.log(`Total ${files.length}, bad ${bad}`)
