import * as pdfjsLib from 'pdfjs-dist'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

type LoadOptions = {
  disableFontFace?: boolean
}

export type LoadedPdfDocument = {
  pdf: pdfjsLib.PDFDocumentProxy
  destroy: () => Promise<void>
}

function buildDocumentInit(data: ArrayBuffer, options: LoadOptions = {}) {
  return {
    data,
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
): Promise<LoadedPdfDocument> {
  const loadingTask = pdfjsLib.getDocument(buildDocumentInit(data, options))
  try {
    const pdf = await loadingTask.promise
    return {
      pdf,
      destroy: () => loadingTask.destroy(),
    }
  } catch (e) {
    await loadingTask.destroy()
    if (options.disableFontFace) throw wrapPdfError(e, 'PDF 无法读取')
    try {
      const retryTask = pdfjsLib.getDocument(buildDocumentInit(data, { disableFontFace: true }))
      try {
        const pdf = await retryTask.promise
        return {
          pdf,
          destroy: () => retryTask.destroy(),
        }
      } catch (retryErr) {
        await retryTask.destroy()
        throw wrapPdfError(retryErr, 'PDF 无法读取')
      }
    } catch (retryErr) {
      throw wrapPdfError(retryErr, 'PDF 无法读取')
    }
  }
}

export async function loadPdfFromFile(file: File): Promise<LoadedPdfDocument> {
  return loadPdfDocument(await file.arrayBuffer())
}
