import fs from 'node:fs'
import fontkit from '@pdf-lib/fontkit'

// mirror extractCertKaitiFont.ts logic for node test
const FZKTJW_MARKER = /FZKTJW--GB1-0[\s\S]{0,220}?\/FontFile2\s+(\d+)\s+\d+\s+R/

function readLengthObject(bytes, objNum) {
  const text = bytes.toString('latin1')
  const marker = `${objNum} 0 obj`
  const start = text.lastIndexOf(marker)
  if (start < 0) return null
  const after = text.slice(start).split('\n', 2)[1] || ''
  const m = after.match(/(\d+)/)
  return m ? Number(m[1]) : null
}

function findFontStream(text, fontFileObjNum) {
  const re = new RegExp(
    `${fontFileObjNum} 0 obj\\s*<<\\/Length1 (\\d+) 0 R\\/Length \\d+ 0 R\\/Filter /FlateDecode>>stream`,
  )
  return text.match(re)
}

async function extract(path) {
  const zlib = await import('node:zlib')
  const bytes = fs.readFileSync(path)
  const text = bytes.toString('latin1')
  const hit = text.match(FZKTJW_MARKER)
  if (!hit) return console.log(path, 'no FZKTJW')
  const fontFileObjNum = Number(hit[1])
  const m = findFontStream(text, fontFileObjNum)
  if (!m) return console.log(path, 'no stream')
  const length1ObjNum = Number(m[1])
  const offset = m.index
  const streamStart = text.indexOf('stream', offset) + 6
  let dataStart = streamStart
  if (bytes[dataStart] === 0x0d) dataStart += 2
  else if (bytes[dataStart] === 0x0a) dataStart += 1
  const dataEnd = text.indexOf('endstream', dataStart)
  let comp = bytes.subarray(dataStart, dataEnd)
  if (comp[comp.length - 1] === 0x0a) comp = comp.subarray(0, comp.length - 1)
  const inflated = zlib.inflateSync(comp)
  const length1 = readLengthObject(bytes, length1ObjNum)
  const ttf = inflated.subarray(0, length1)
  const font = fontkit.create(ttf)
  console.log(path.split('/').pop(), font.postscriptName, font.familyName, ttf.length)
}

const files = process.argv.slice(2)
for (const f of files) await extract(f)
