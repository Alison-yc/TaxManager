import fs from 'node:fs'
import path from 'node:path'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

async function analyze(pdfPath) {
  const data = new Uint8Array(fs.readFileSync(pdfPath))
  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise
  const page = await pdf.getPage(1)
  const content = await page.getTextContent()
  const styles = content.styles

  console.log(`\n=== ${path.basename(pdfPath)} ===`)
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    if (!/填发|日期|年|月|日|2026|2025|2024|税务/.test(item.str)) continue
    const style = styles[item.fontName]
    console.log({
      str: item.str,
      fontName: item.fontName,
      fontFamily: style?.fontFamily,
      ascent: style?.ascent,
      descent: style?.descent,
      x: item.transform[4],
      y: item.transform[5],
      h: item.height || Math.abs(item.transform[3]),
    })
  }
}

const files = process.argv.slice(2)
if (files.length === 0) {
  files.push(
    '/Users/mac/Downloads/导入信息/增值税完税证明/税收完税证明2026-06-04 14ː50ː32.pdf',
    '/Users/mac/Downloads/导入信息/所得税完税证明/20260609190418-1.pdf',
    '/Users/mac/Downloads/导入信息/所得税完税证明/20260609190418-2.pdf',
  )
}

for (const f of files) await analyze(f)
