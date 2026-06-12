import fs from 'node:fs'
import { PDFDocument, PDFName } from 'pdf-lib'

async function listFonts(pdfPath) {
  const bytes = fs.readFileSync(pdfPath)
  const doc = await PDFDocument.load(bytes, { updateMetadata: false })
  const page = doc.getPages()[0]
  const resources = page.node.Resources()
  const fontDict = resources?.lookup(PDFName.of('Font'))
  console.log(`\n=== ${pdfPath.split('/').pop()} ===`)
  if (!fontDict) {
    console.log('no fonts')
    return
  }
  const entries = fontDict.entries()
  for (const [name, ref] of entries) {
    const font = doc.context.lookup(ref)
    const subtype = font?.lookup(PDFName.of('Subtype'))?.toString()
    const baseFont = font?.lookup(PDFName.of('BaseFont'))?.toString()
    const nameObj = font?.lookup(PDFName.of('Name'))?.toString()
    console.log({ key: name.toString(), subtype, baseFont, nameObj })
  }
}

const files = process.argv.slice(2)
for (const f of files) await listFonts(f)
