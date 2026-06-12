import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function fmtCertIssueDate(iso) {
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return iso
  return `${Number(m[1])} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`
}

async function findIssueDateBBox(data) {
  const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(data), isEvalSupported: false }).promise
  const page = await pdf.getPage(1)
  const content = await page.getTextContent()
  const items = content.items.filter((it) => 'str' in it && it.str.trim())

  let labelIdx = -1
  for (let i = 0; i < items.length; i++) {
    if (items[i].str.includes('填发日期')) {
      labelIdx = i
      break
    }
  }
  if (labelIdx < 0) return null

  const dateParts = []
  for (let i = labelIdx + 1; i < items.length; i++) {
    const s = items[i].str.trim()
    if (!s) continue
    if (s.includes('税务机关')) break
    if (/^\d{1,4}$/.test(s) || /^[年月日]$/.test(s)) dateParts.push(items[i])
    else if (dateParts.length > 0) break
  }
  if (dateParts.length === 0) return null

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const it of dateParts) {
    const x = it.transform[4]
    const y = it.transform[5]
    const w = it.width
    const h = it.height || Math.abs(it.transform[3])
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x + w)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y + h)
  }

  return {
    pageIndex: 0,
    coverX: minX - 3,
    coverY: minY - 2,
    coverW: maxX - minX + 50,
    coverH: maxY - minY + 5,
    textX: minX,
    textY: minY,
    fontSize: dateParts[0].height || Math.abs(dateParts[0].transform[3]) || 10.5,
  }
}

const pdfPath =
  process.argv[2] ||
  '/Users/mac/Downloads/导入信息/增值税完税证明/税收完税证明2026-06-04 14ː50ː32.pdf'
const outPath = process.argv[3] || path.join(__dirname, '../tmp/cert-patched.pdf')

const data = fs.readFileSync(pdfPath)
const bbox = await findIssueDateBBox(data)
console.log('bbox', bbox)

const todayIso = '2026-06-12'
const newText = fmtCertIssueDate(todayIso)
console.log('newText', newText)

const pdfDoc = await PDFDocument.load(data)
pdfDoc.registerFontkit(fontkit)
const fontBytes = fs.readFileSync(path.join(__dirname, '../public/fonts/CertKaiTi.ttf'))
const font = await pdfDoc.embedFont(fontBytes)
const page = pdfDoc.getPages()[bbox.pageIndex]

page.drawRectangle({
  x: bbox.coverX,
  y: bbox.coverY,
  width: bbox.coverW,
  height: bbox.coverH,
  color: rgb(1, 1, 1),
})

page.drawText(newText, {
  x: bbox.textX,
  y: bbox.textY,
  size: bbox.fontSize,
  font,
  color: rgb(0, 0, 0),
})

fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, await pdfDoc.save())
console.log('written', outPath)

// verify extracted text
const patched = fs.readFileSync(outPath)
const pdf2 = await pdfjsLib.getDocument({ data: new Uint8Array(patched), isEvalSupported: false }).promise
const page2 = await pdf2.getPage(1)
const text = (await page2.getTextContent()).items.map((it) => ('str' in it ? it.str : '')).join(' ')
const m = text.match(/填发日期[：:\s]*(\d{4}\s*年\s*\d{1,2}\s*月\s*\d{1,2}\s*日)/)
console.log('parsed issue date:', m?.[1] ?? 'NOT FOUND')
