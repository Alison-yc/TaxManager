const FZKTJW_MARKER = /FZKTJW--GB1-0[\s\S]{0,220}?\/FontFile2\s+(\d+)\s+\d+\s+R/

function readLengthObject(bytes: Uint8Array, objNum: number): number | null {
  const text = new TextDecoder('latin1').decode(bytes)
  const re = new RegExp(`${objNum} 0 obj\\s*\\r?\\n\\s*(\\d+)\\s*\\r?\\n`, 'g')
  let match: RegExpExecArray | null = null
  let last: RegExpExecArray | null = null
  while ((match = re.exec(text)) !== null) {
    last = match
  }
  return last ? Number(last[1]) : null
}

function extractCompressedStreamAt(bytes: Uint8Array, start: number): Uint8Array | null {
  const streamToken = new TextEncoder().encode('stream')
  let streamStart = -1
  for (let i = start; i <= bytes.length - streamToken.length; i++) {
    let matched = true
    for (let j = 0; j < streamToken.length; j++) {
      if (bytes[i + j] !== streamToken[j]) {
        matched = false
        break
      }
    }
    if (matched) {
      streamStart = i + streamToken.length
      break
    }
  }
  if (streamStart < 0) return null

  if (bytes[streamStart] === 0x0d && bytes[streamStart + 1] === 0x0a) streamStart += 2
  else if (bytes[streamStart] === 0x0a) streamStart += 1

  const endToken = new TextEncoder().encode('endstream')
  let dataEnd = -1
  for (let i = streamStart; i <= bytes.length - endToken.length; i++) {
    let matched = true
    for (let j = 0; j < endToken.length; j++) {
      if (bytes[i + j] !== endToken[j]) {
        matched = false
        break
      }
    }
    if (matched) {
      dataEnd = i
      break
    }
  }
  if (dataEnd < 0) return null

  let compressed = bytes.subarray(streamStart, dataEnd)
  if (compressed.length > 0 && compressed[compressed.length - 1] === 0x0a) {
    compressed = compressed.subarray(0, compressed.length - 1)
  }
  return compressed
}

async function inflateDeflate(input: Uint8Array): Promise<Uint8Array> {
  const DecompressionStreamCtor = (
    globalThis as typeof globalThis & {
      DecompressionStream?: new (format: string) => TransformStream<Uint8Array, Uint8Array>
    }
  ).DecompressionStream
  if (!DecompressionStreamCtor) {
    throw new Error('当前环境不支持 PDF 字体解压')
  }
  const stream = new Blob([Uint8Array.from(input)]).stream()
  const decompressed = stream.pipeThrough(new DecompressionStreamCtor('deflate'))
  const buffer = await new Response(decompressed).arrayBuffer()
  return new Uint8Array(buffer)
}

function findFontStreamLength1Ref(bytes: Uint8Array, fontFileObjNum: number): number | null {
  const text = new TextDecoder('latin1').decode(bytes)
  const re = new RegExp(
    `${fontFileObjNum} 0 obj\\s*<<\\/Length1 (\\d+) 0 R\\/Length \\d+ 0 R\\/Filter /FlateDecode>>stream`,
  )
  const match = text.match(re)
  return match ? Number(match[1]) : null
}

function findFontStreamObjectOffset(bytes: Uint8Array, fontFileObjNum: number): number | null {
  const text = new TextDecoder('latin1').decode(bytes)
  const re = new RegExp(
    `${fontFileObjNum} 0 obj\\s*<<\\/Length1 \\d+ 0 R\\/Length \\d+ 0 R\\/Filter /FlateDecode>>stream`,
  )
  const match = re.exec(text)
  return match ? match.index : null
}

/** 从表格式完税证明 PDF 内嵌字体中提取方正楷体（FZKTJW）子集 */
export async function extractCertKaitiFontBytes(data: ArrayBuffer): Promise<Uint8Array | null> {
  const bytes = new Uint8Array(data)
  const text = new TextDecoder('latin1').decode(bytes)
  const hit = text.match(FZKTJW_MARKER)
  if (!hit) return null

  const fontFileObjNum = Number(hit[1])
  const length1ObjNum = findFontStreamLength1Ref(bytes, fontFileObjNum)
  const streamOffset = findFontStreamObjectOffset(bytes, fontFileObjNum)
  if (!length1ObjNum || streamOffset == null) return null

  const compressed = extractCompressedStreamAt(bytes, streamOffset)
  if (!compressed) return null

  try {
    const inflated = await inflateDeflate(compressed)
    const length1 = readLengthObject(bytes, length1ObjNum)
    if (!length1 || length1 <= 0 || length1 > inflated.length) return null
    return inflated.subarray(0, length1)
  } catch {
    return null
  }
}
