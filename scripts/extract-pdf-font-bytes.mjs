import fs from 'node:fs'
import zlib from 'node:zlib'
import fontkit from '@pdf-lib/fontkit'

function extractStream(bytes, objNum) {
  const marker = Buffer.from(`${objNum} 0 obj`, 'latin1')
  const objStart = bytes.indexOf(marker)
  if (objStart < 0) return null
  const header = bytes.subarray(objStart, objStart + 500).toString('latin1')
  const streamToken = Buffer.from('stream', 'latin1')
  const streamStart = bytes.indexOf(streamToken, objStart)
  if (streamStart < 0) return null
  let dataStart = streamStart + streamToken.length
  if (bytes[dataStart] === 0x0d && bytes[dataStart + 1] === 0x0a) dataStart += 2
  else if (bytes[dataStart] === 0x0a) dataStart += 1

  const endToken = Buffer.from('endstream', 'latin1')
  const dataEnd = bytes.indexOf(endToken, dataStart)
  if (dataEnd < 0) return null
  let stream = bytes.subarray(dataStart, dataEnd)
  if (stream[stream.length - 1] === 0x0a) stream = stream.subarray(0, stream.length - 1)

  const filter = /\/Filter\s*\/FlateDecode/.test(header)
  return filter ? zlib.inflateSync(stream) : stream
}

async function main() {
  const pdfPath =
    process.argv[2] ||
    '/Users/mac/Downloads/导入信息/增值税完税证明/税收完税证明2026-06-04 14ː50ː32.pdf'
  const bytes = fs.readFileSync(pdfPath)
  const text = bytes.toString('latin1')

  const fontFileRefs = [...text.matchAll(/\/FontFile2\s+(\d+)\s+(\d+)\s+R/g)]
  fs.mkdirSync('./tmp', { recursive: true })

  for (const m of fontFileRefs) {
    const objNum = Number(m[1])
    try {
      const out = extractStream(bytes, objNum)
      if (!out) continue
      const outPath = `./tmp/fontfile2-${objNum}.bin`
      fs.writeFileSync(outPath, out)
      try {
        const font = fontkit.create(out)
        console.log({
          objNum,
          outPath,
          size: out.length,
          family: font.familyName,
          subfamily: font.subfamilyName,
          fullName: font.fullName,
          postscript: font.postscriptName,
        })
      } catch (e) {
        console.log({ objNum, outPath, size: out.length, fontkitError: e.message })
      }
    } catch (e) {
      console.log({ objNum, error: e.message })
    }
  }
}

await main()
