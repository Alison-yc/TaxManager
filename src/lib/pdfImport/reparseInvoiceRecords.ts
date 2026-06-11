import { downloadPdfBlob } from '../pdfStorage'
import { supabase } from '../supabase'
import type { InvoiceRecordRow } from '../../types/database'
import { clampMoneyForDb } from './extractPdfText'
import { parseInvoicePdfBytes, type ParsedInvoicePdf } from './invoicePdfImport'

export type ReparseInvoiceResult = {
  id: string
  digital_invoice_no: string
  status: 'success' | 'skipped' | 'failed'
  message?: string
}

export type ReparseAllInvoiceResult = {
  total: number
  success: number
  skipped: number
  failed: number
  items: ReparseInvoiceResult[]
}

const REPARSE_FETCH_BATCH = 1000
const DEFAULT_REPARSE_CONCURRENCY = 4

type InvoiceRecordForReparse = Pick<
  InvoiceRecordRow,
  | 'id'
  | 'storage_path'
  | 'source_file_name'
  | 'digital_invoice_no'
  | 'invoice_type'
  | 'seller_name'
  | 'seller_tax_id'
  | 'buyer_name'
  | 'buyer_tax_id'
  | 'issue_date'
  | 'issuer'
>

const REPARSE_SELECT =
  'id, storage_path, source_file_name, digital_invoice_no, invoice_type, seller_name, seller_tax_id, buyer_name, buyer_tax_id, issue_date, issuer'

function hasFilledText(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/** 关键票面字段齐全则无需重新下载 PDF 解析 */
export function invoiceRecordNeedsReparse(row: InvoiceRecordForReparse): boolean {
  return !(
    hasFilledText(row.invoice_type) &&
    hasFilledText(row.seller_name) &&
    hasFilledText(row.seller_tax_id) &&
    hasFilledText(row.buyer_name) &&
    hasFilledText(row.buyer_tax_id) &&
    hasFilledText(row.issue_date) &&
    hasFilledText(row.issuer)
  )
}

function parsedToRowUpdate(parsed: ParsedInvoicePdf) {
  return {
    invoice_number: parsed.invoice_number,
    invoice_source: parsed.invoice_source,
    invoice_type: parsed.invoice_type,
    invoice_status: parsed.invoice_status,
    is_positive: parsed.is_positive,
    risk_level: parsed.risk_level,
    seller_name: parsed.seller_name,
    seller_tax_id: parsed.seller_tax_id,
    buyer_name: parsed.buyer_name,
    buyer_tax_id: parsed.buyer_tax_id,
    issue_date: parsed.issue_date,
    amount: clampMoneyForDb(parsed.amount),
    tax_amount: clampMoneyForDb(parsed.tax_amount),
    total_amount: clampMoneyForDb(parsed.total_amount),
    business_type: parsed.business_type,
    issuer: parsed.issuer,
    remark: parsed.remark,
    content: { line_items: parsed.line_items },
  }
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

async function fetchAllInvoiceRecordsForReparse(): Promise<InvoiceRecordForReparse[]> {
  const rows: InvoiceRecordForReparse[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('invoice_records')
      .select(REPARSE_SELECT)
      .order('created_at', { ascending: true })
      .range(from, from + REPARSE_FETCH_BATCH - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as InvoiceRecordForReparse[]
    rows.push(...batch)
    if (batch.length < REPARSE_FETCH_BATCH) break
    from += REPARSE_FETCH_BATCH
  }

  return rows
}

export async function reparseInvoiceRecord(
  row: Pick<InvoiceRecordRow, 'id' | 'storage_path' | 'source_file_name' | 'digital_invoice_no'>,
): Promise<ReparseInvoiceResult> {
  try {
    const blob = await downloadPdfBlob(row.storage_path)
    const parsed = await parseInvoicePdfBytes(await blob.arrayBuffer(), row.source_file_name)
    const { error } = await supabase
      .from('invoice_records')
      .update(parsedToRowUpdate(parsed))
      .eq('id', row.id)
    if (error) {
      return {
        id: row.id,
        digital_invoice_no: row.digital_invoice_no,
        status: 'failed',
        message: error.message,
      }
    }
    return { id: row.id, digital_invoice_no: row.digital_invoice_no, status: 'success' }
  } catch (e: unknown) {
    return {
      id: row.id,
      digital_invoice_no: row.digital_invoice_no,
      status: 'failed',
      message: e instanceof Error ? e.message : String(e),
    }
  }
}

export async function reparseAllInvoiceRecords(options?: {
  concurrency?: number
  onProgress?: (done: number, total: number, stats: { skipped: number; pending: number }) => void
}): Promise<ReparseAllInvoiceResult> {
  const rows = await fetchAllInvoiceRecordsForReparse()
  const items: ReparseInvoiceResult[] = new Array(rows.length)
  const toReparse: { row: InvoiceRecordForReparse; index: number }[] = []

  rows.forEach((row, index) => {
    if (!invoiceRecordNeedsReparse(row)) {
      items[index] = {
        id: row.id,
        digital_invoice_no: row.digital_invoice_no,
        status: 'skipped',
        message: '字段已完整',
      }
      return
    }
    toReparse.push({ row, index })
  })

  const skipped = rows.length - toReparse.length
  let done = skipped

  const reportProgress = () => {
    options?.onProgress?.(done, rows.length, {
      skipped,
      pending: toReparse.length,
    })
  }

  reportProgress()

  await runWithConcurrency(
    toReparse,
    options?.concurrency ?? DEFAULT_REPARSE_CONCURRENCY,
    async ({ row, index }) => {
      items[index] = await reparseInvoiceRecord(row)
      done += 1
      reportProgress()
    },
  )

  const resolved = items.filter(Boolean)
  return {
    total: rows.length,
    success: resolved.filter((x) => x.status === 'success').length,
    skipped: resolved.filter((x) => x.status === 'skipped').length,
    failed: resolved.filter((x) => x.status === 'failed').length,
    items: resolved,
  }
}
