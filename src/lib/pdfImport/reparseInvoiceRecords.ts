import { downloadPdfBlob } from '../pdfStorage'
import { supabase } from '../supabase'
import type { InvoiceRecordRow } from '../../types/database'
import { clampMoneyForDb } from './extractPdfText'
import { parseInvoicePdfBytes, type ParsedInvoicePdf } from './invoicePdfImport'

export type ReparseInvoiceResult = {
  id: string
  digital_invoice_no: string
  status: 'success' | 'failed'
  message?: string
}

export type ReparseAllInvoiceResult = {
  total: number
  success: number
  failed: number
  items: ReparseInvoiceResult[]
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

const REPARSE_BATCH = 1000

export async function reparseAllInvoiceRecords(options?: {
  onProgress?: (done: number, total: number) => void
}): Promise<ReparseAllInvoiceResult> {
  const rows: Pick<
    InvoiceRecordRow,
    'id' | 'storage_path' | 'source_file_name' | 'digital_invoice_no'
  >[] = []
  let from = 0

  while (true) {
    const { data, error } = await supabase
      .from('invoice_records')
      .select('id, storage_path, source_file_name, digital_invoice_no')
      .order('created_at', { ascending: true })
      .range(from, from + REPARSE_BATCH - 1)
    if (error) throw new Error(error.message)
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < REPARSE_BATCH) break
    from += REPARSE_BATCH
  }

  const items: ReparseInvoiceResult[] = []
  let done = 0
  for (const row of rows) {
    const result = await reparseInvoiceRecord(row)
    items.push(result)
    done += 1
    options?.onProgress?.(done, rows.length)
  }

  return {
    total: rows.length,
    success: items.filter((x) => x.status === 'success').length,
    failed: items.filter((x) => x.status === 'failed').length,
    items,
  }
}
