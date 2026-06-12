import fs from 'node:fs'
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, PDFName } from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  '../node_modules/pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

async function mapFonts(pdfPath) {
  const bytes = fs.readFileSync(pdfPath)
  const data = new Uint8Array(bytes)

  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const pageRes = doc.getPages()[0].node.Resources()
  const fontDict = pageRes?.lookup(PDFName.of('Font'))
  const baseByKey = new Map()
  if (fontDict) {
    for (const [name, ref] of fontDict.entries()) {
      const font = doc.context.lookup(ref)
      baseByKey.set(name.toString(), font?.lookup(PDFName.of('BaseFont'))?.toString())
    }
  }

  const pdf = await pdfjsLib.getDocument({ data, isEvalSupported: false }).promise
  const page = await pdf.getPage(1)
  const content = await page.getTextContent()

  console.log(`\n=== ${pdfPath.split('/').pop()} ===`)
  console.log('embedded:', Object.fromEntries(baseByKey))

  const seen = new Set()
  for (const item of content.items) {
    if (!('str' in item) || !item.str.trim()) continue
    if (!/填发|^\d{4}$|年|月|日/.test(item.str.trim())) continue
    const key = item.fontName
    if (seen.has(key)) continue
    seen.add(key)
    console.log({ str: item.str, pdfjsFont: key, height: item.height || Math.abs(item.transform[3]) })
  }

  // commonObjs font map via operator list is harder; use styles
  const common = await page.getOperatorList()
  console.log('common objs', common.commonObjs?.size)
}

await mapFonts(
  process.argv[2] ||
    '/Users/mac/Downloads/导入信息/增值税完税证明/税收完税证明2026-06-04 14ː50ː32.pdf',
)
