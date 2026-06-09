import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

type LoadOptions = {
  disableFontFace?: boolean
}

function buildDocumentInit(data: ArrayBuffer, options: LoadOptions = {}) {
  return {
    data: new Uint8Array(data),
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: options.disableFontFace ?? false,
  }
}

function wrapPdfError(e: unknown, fallback: string): Error {
  const msg = e instanceof Error ? e.message : String(e)
  if (/toHex/i.test(msg)) {
    return new Error(`${fallback}：PDF 字体或颜色数据异常，请尝试重新导出 PDF`)
  }
  return new Error(`${fallback}：${msg}`)
}

export async function loadPdfDocument(
  data: ArrayBuffer,
  options: LoadOptions = {},
): Promise<pdfjsLib.PDFDocumentProxy> {
  try {
    return await pdfjsLib.getDocument(buildDocumentInit(data, options)).promise
  } catch (e) {
    if (options.disableFontFace) throw wrapPdfError(e, 'PDF 无法读取')
    try {
      return await pdfjsLib.getDocument(buildDocumentInit(data, { disableFontFace: true })).promise
    } catch (retryErr) {
      throw wrapPdfError(retryErr, 'PDF 无法读取')
    }
  }
}

export async function loadPdfFromFile(file: File): Promise<pdfjsLib.PDFDocumentProxy> {
  return loadPdfDocument(await file.arrayBuffer())
}
