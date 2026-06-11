import { supabase } from '../supabase'
import { downloadPdfBlob } from '../pdfStorage'
import type { InvoiceRecordRow } from '../../types/database'
import { STANDARD_DIGITAL_INVOICE_NO_LENGTH } from './invoicePdfImport'
import { uploadInvoicePdfFile } from './declarationPdfImport'
import type { InvoiceBatchImportResult, InvoiceBatchItemResult } from './invoicePdfBatchImport'
import {
  fetchInvoiceRecordsForReparseByNumbers,
  reparseInvoiceRecord,
  type ReparseInvoiceResult,
} from './reparseInvoiceRecords'

const NUMBER_SPLIT_RE = /[\s,，;；\n\r\t|]+/

export type InvoiceNumbersBatchItemResult = {
  digital_invoice_no: string
  status: 'success' | 'not_found' | 'failed' | 'skipped'
  message?: string
  source_file_name?: string
}

export type InvoiceNumbersBatchResult = {
  requested: number
  success: number
  failed: number
  notFound: number
  skipped: number
  items: InvoiceNumbersBatchItemResult[]
}

/** 从文本中提取数电票号（20 位），支持换行/逗号/空格等分隔 */
export function parseInvoiceNumbersInput(raw: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []

  for (const match of raw.match(/\d{20}/g) ?? []) {
    if (!seen.has(match)) {
      seen.add(match)
      result.push(match)
    }
  }
  if (result.length > 0) return result

  for (const part of raw.split(NUMBER_SPLIT_RE)) {
    const digits = part.replace(/\D/g, '')
    if (digits.length >= STANDARD_DIGITAL_INVOICE_NO_LENGTH) {
      const no = digits.slice(0, STANDARD_DIGITAL_INVOICE_NO_LENGTH)
      if (!seen.has(no)) {
        seen.add(no)
        result.push(no)
      }
    }
  }
  return result
}

export async function fetchInvoiceRecordsByNumbers(
  numbers: string[],
): Promise<{ records: InvoiceRecordRow[]; notFound: string[] }> {
  if (numbers.length === 0) return { records: [], notFound: [] }

  const { data, error } = await supabase
    .from('invoice_records')
    .select('*')
    .in('digital_invoice_no', numbers)
  if (error) throw new Error(error.message)

  const records = (data ?? []) as InvoiceRecordRow[]
  const found = new Set(records.map((row) => row.digital_invoice_no))
  const notFound = numbers.filter((no) => !found.has(no))
  return { records, notFound }
}

function summarizeBatchResult(result: InvoiceNumbersBatchResult): string {
  const parts: string[] = []
  if (result.success > 0) parts.push(`成功 ${result.success} 张`)
  if (result.notFound > 0) parts.push(`未找到 ${result.notFound} 张`)
  if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 张`)
  if (result.failed > 0) parts.push(`失败 ${result.failed} 张`)
  return parts.join('，') || '未处理任何票号'
}

export function formatInvoiceNumbersBatchSummary(result: InvoiceNumbersBatchResult): string {
  return summarizeBatchResult(result)
}

function triggerBlobDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.replace(/[/\\?%*:|"<>]/g, '-')
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function buildResult(
  numbers: string[],
  items: InvoiceNumbersBatchItemResult[],
): InvoiceNumbersBatchResult {
  return {
    requested: numbers.length,
    success: items.filter((item) => item.status === 'success').length,
    failed: items.filter((item) => item.status === 'failed').length,
    notFound: items.filter((item) => item.status === 'not_found').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
    items,
  }
}

export async function downloadInvoicePdfsByNumbers(
  numbers: string[],
  options?: { onProgress?: (done: number, total: number) => void },
): Promise<InvoiceNumbersBatchResult> {
  const { records, notFound } = await fetchInvoiceRecordsByNumbers(numbers)
  const items: InvoiceNumbersBatchItemResult[] = []

  let done = 0
  for (const row of records) {
    try {
      const blob = await downloadPdfBlob(row.storage_path)
      triggerBlobDownload(blob, row.source_file_name || `${row.digital_invoice_no}.pdf`)
      items.push({
        digital_invoice_no: row.digital_invoice_no,
        status: 'success',
        source_file_name: row.source_file_name,
      })
    } catch (error: unknown) {
      items.push({
        digital_invoice_no: row.digital_invoice_no,
        status: 'failed',
        source_file_name: row.source_file_name,
        message: error instanceof Error ? error.message : String(error),
      })
    }
    done += 1
    options?.onProgress?.(done, records.length)
    if (done < records.length) await sleep(350)
  }

  for (const no of notFound) {
    items.push({ digital_invoice_no: no, status: 'not_found', message: '库中无此票号' })
  }

  return buildResult(numbers, items)
}

export async function deleteInvoiceRecordsByNumbers(
  numbers: string[],
): Promise<InvoiceNumbersBatchResult> {
  const { records, notFound } = await fetchInvoiceRecordsByNumbers(numbers)
  const items: InvoiceNumbersBatchItemResult[] = []

  for (const row of records) {
    const { error } = await supabase.from('invoice_records').delete().eq('id', row.id)
    if (error) {
      items.push({
        digital_invoice_no: row.digital_invoice_no,
        status: 'failed',
        source_file_name: row.source_file_name,
        message: error.message,
      })
    } else {
      items.push({
        digital_invoice_no: row.digital_invoice_no,
        status: 'success',
        source_file_name: row.source_file_name,
      })
    }
  }

  for (const no of notFound) {
    items.push({ digital_invoice_no: no, status: 'not_found', message: '库中无此票号' })
  }

  return buildResult(numbers, items)
}

export async function reparseInvoiceRecordsByNumbers(
  numbers: string[],
  options?: {
    mode?: 'full' | 'missing'
    onProgress?: (done: number, total: number) => void
  },
): Promise<{
  batch: InvoiceNumbersBatchResult
  reparseItems: ReparseInvoiceResult[]
}> {
  const mode = options?.mode ?? 'full'
  const rows = await fetchInvoiceRecordsForReparseByNumbers(numbers)
  const found = new Set(rows.map((row) => row.digital_invoice_no))
  const notFound = numbers.filter((no) => !found.has(no))

  const reparseItems: ReparseInvoiceResult[] = []
  const items: InvoiceNumbersBatchItemResult[] = []
  let done = 0

  for (const row of rows) {
    const result = await reparseInvoiceRecord(row, {
      requireComplete: mode === 'missing',
    })
    reparseItems.push(result)
    items.push({
      digital_invoice_no: row.digital_invoice_no,
      status:
        result.status === 'success'
          ? 'success'
          : result.status === 'skipped'
            ? 'skipped'
            : 'failed',
      source_file_name: row.source_file_name,
      message: result.message,
    })
    done += 1
    options?.onProgress?.(done, rows.length)
  }

  for (const no of notFound) {
    items.push({ digital_invoice_no: no, status: 'not_found', message: '库中无此票号' })
  }

  return {
    batch: buildResult(numbers, items),
    reparseItems,
  }
}

async function deleteRecordByDigitalNo(digitalInvoiceNo: string): Promise<void> {
  const { error } = await supabase
    .from('invoice_records')
    .delete()
    .eq('digital_invoice_no', digitalInvoiceNo)
  if (error) throw new Error(error.message)
}

export async function importInvoicePdfsForNumbers(
  files: File[],
  numbers: string[],
  options?: {
    replaceExisting?: boolean
    onProgress?: (done: number, total: number) => void
  },
): Promise<InvoiceBatchImportResult> {
  const allowed = new Set(numbers)
  const pdfs = files.filter((file) => file.name.toLowerCase().endsWith('.pdf'))
  const items: InvoiceBatchItemResult[] = []
  let done = 0

  for (const file of pdfs) {
    try {
      const { parseInvoicePdf } = await import('./invoicePdfImport')
      const parsed = await parseInvoicePdf(file)
      const no = parsed.digital_invoice_no

      if (allowed.size > 0 && !allowed.has(no)) {
        items.push({
          fileName: file.name,
          status: 'skipped',
          message: `票号 ${no} 不在输入列表中`,
        })
        done += 1
        options?.onProgress?.(done, pdfs.length)
        continue
      }

      if (options?.replaceExisting) {
        await deleteRecordByDigitalNo(no)
      }

      const result = await uploadInvoicePdfFile(file)
      if (result.ok) {
        items.push({ fileName: file.name, status: 'success' })
      } else if (/已导入|请勿重复上传/.test(result.message)) {
        items.push({ fileName: file.name, status: 'skipped', message: result.message })
      } else {
        items.push({ fileName: file.name, status: 'failed', message: result.message })
      }
    } catch (error: unknown) {
      items.push({
        fileName: file.name,
        status: 'failed',
        message: error instanceof Error ? error.message : String(error),
      })
    }
    done += 1
    options?.onProgress?.(done, pdfs.length)
  }

  return {
    total: pdfs.length,
    success: items.filter((item) => item.status === 'success').length,
    skipped: items.filter((item) => item.status === 'skipped').length,
    failed: items.filter((item) => item.status === 'failed').length,
    items,
  }
}
