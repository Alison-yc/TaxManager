import { uploadInvoicePdfFile } from './declarationPdfImport'

export type InvoiceBatchItemResult = {
  fileName: string
  status: 'success' | 'skipped' | 'failed'
  message?: string
}

export type InvoiceBatchImportResult = {
  total: number
  success: number
  skipped: number
  failed: number
  items: InvoiceBatchItemResult[]
}

const DEFAULT_CONCURRENCY = 4

/** 从文件列表/文件夹选择结果中收集全部 PDF（含子目录） */
export function collectInvoicePdfFiles(files: FileList | File[]): File[] {
  return Array.from(files)
    .filter((file) => file.name.toLowerCase().endsWith('.pdf'))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

function isDuplicateMessage(message: string): boolean {
  return /已导入|请勿重复上传/.test(message)
}

async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  if (items.length === 0) return
  let nextIndex = 0
  async function runWorker() {
    while (nextIndex < items.length) {
      const index = nextIndex
      nextIndex += 1
      await worker(items[index], index)
    }
  }
  const workers = Math.min(concurrency, items.length)
  await Promise.all(Array.from({ length: workers }, () => runWorker()))
}

export async function uploadInvoicePdfBatch(
  files: File[],
  options?: {
    concurrency?: number
    onProgress?: (done: number, total: number) => void
  },
): Promise<InvoiceBatchImportResult> {
  const pdfs = collectInvoicePdfFiles(files)
  const items: InvoiceBatchItemResult[] = new Array(pdfs.length)
  let done = 0

  await runWithConcurrency(pdfs, options?.concurrency ?? DEFAULT_CONCURRENCY, async (file, index) => {
    const result = await uploadInvoicePdfFile(file)
    if (result.ok) {
      items[index] = { fileName: file.name, status: 'success' }
    } else if (isDuplicateMessage(result.message)) {
      items[index] = { fileName: file.name, status: 'skipped', message: result.message }
    } else {
      items[index] = { fileName: file.name, status: 'failed', message: result.message }
    }
    done += 1
    options?.onProgress?.(done, pdfs.length)
  })

  const success = items.filter((x) => x?.status === 'success').length
  const skipped = items.filter((x) => x?.status === 'skipped').length
  const failed = items.filter((x) => x?.status === 'failed').length

  return {
    total: pdfs.length,
    success,
    skipped,
    failed,
    items: items.filter(Boolean),
  }
}
