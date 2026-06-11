import { downloadPdfBlob } from '../pdfStorage'
import { supabase } from '../supabase'
import type { InvoiceRecordContent, InvoiceRecordRow } from '../../types/database'
import { clampMoneyForDb } from './extractPdfText'
import {
  parseInvoicePdfBytes,
  STANDARD_DIGITAL_INVOICE_NO_LENGTH,
  type ParsedInvoicePdf,
} from './invoicePdfImport'
import type { InvoiceLineItem } from '../../types/database'
import {
  appendReparseFailureLog,
  resetReparseFailureLog,
} from './reparseFailureLog'

export type ReparseInvoiceResult = {
  id: string
  digital_invoice_no: string
  source_file_name?: string
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

export type ReparseMode = 'full' | 'missing'

const REPARSE_FETCH_BATCH = 50
const DEFAULT_REPARSE_CONCURRENCY = 1

type InvoiceRecordForReparse = Pick<
  InvoiceRecordRow,
  | 'id'
  | 'storage_path'
  | 'source_file_name'
  | 'digital_invoice_no'
  | 'invoice_number'
  | 'invoice_source'
  | 'invoice_type'
  | 'invoice_status'
  | 'is_positive'
  | 'risk_level'
  | 'seller_name'
  | 'seller_tax_id'
  | 'buyer_name'
  | 'buyer_tax_id'
  | 'issue_date'
  | 'amount'
  | 'tax_amount'
  | 'total_amount'
  | 'business_type'
  | 'issuer'
  | 'remark'
  | 'content'
>

const REPARSE_SELECT =
  'id, storage_path, source_file_name, digital_invoice_no, invoice_number, invoice_source, invoice_type, invoice_status, is_positive, risk_level, seller_name, seller_tax_id, buyer_name, buyer_tax_id, issue_date, amount, tax_amount, total_amount, business_type, issuer, remark, content'

function isPlaceholderFieldValue(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return true
  if (/^[—–\-－]+$/.test(trimmed)) return true
  if (trimmed === 'null' || trimmed === 'undefined') return true
  if (/[壹贰叁肆伍陆柒捌玖拾佰仟万亿元整角分]/.test(trimmed) && trimmed.length > 4) return true
  return false
}

function hasFilledText(value: string | null | undefined): boolean {
  return typeof value === 'string' && !isPlaceholderFieldValue(value)
}

function hasMoney(value: number | null | undefined): boolean {
  return value != null && Number.isFinite(value)
}

function normalizeInvoiceDigits(value: string | null | undefined): string {
  return (value ?? '').replace(/\D/g, '')
}

/** 数电发票号码是否达到标准 20 位 */
export function hasValidDigitalInvoiceNo(value: string | null | undefined): boolean {
  return normalizeInvoiceDigits(value).length >= STANDARD_DIGITAL_INVOICE_NO_LENGTH
}

function invoiceNumberMatchesDigitalNo(row: InvoiceRecordForReparse): boolean {
  const digitalNo = normalizeInvoiceDigits(row.digital_invoice_no)
  const invoiceNo = normalizeInvoiceDigits(row.invoice_number)
  if (digitalNo.length < STANDARD_DIGITAL_INVOICE_NO_LENGTH) return true
  return invoiceNo === digitalNo
}

function getInvoiceLineItems(row: InvoiceRecordForReparse): InvoiceLineItem[] {
  const content = row.content
  if (!content || typeof content !== 'object' || !('line_items' in content)) return []
  const items = (content as InvoiceRecordContent).line_items
  return Array.isArray(items) ? items : []
}

const LINE_ITEM_FIELD_LABELS = {
  item_name: '货物或应税劳务名称',
  spec: '规格型号',
  unit: '单位',
  quantity: '数量',
  unit_price: '单价',
} as const

function listMissingLineItemFieldLabels(row: InvoiceRecordForReparse): string[] {
  const items = getInvoiceLineItems(row)
  if (items.length === 0) {
    return Object.values(LINE_ITEM_FIELD_LABELS)
  }

  const missing = new Set<string>()
  const activeLines = items.filter(
    (item) =>
      hasFilledText(item.item_name) ||
      hasFilledText(item.spec) ||
      hasFilledText(item.unit) ||
      hasMoney(item.quantity) ||
      hasMoney(item.unit_price) ||
      hasMoney(item.amount),
  )
  const linesToCheck = activeLines.length > 0 ? activeLines : items

  for (const item of linesToCheck) {
    if (!hasFilledText(item.item_name)) {
      missing.add(LINE_ITEM_FIELD_LABELS.item_name)
    }
    if (!hasFilledText(item.spec)) missing.add(LINE_ITEM_FIELD_LABELS.spec)
    if (!hasFilledText(item.unit)) missing.add(LINE_ITEM_FIELD_LABELS.unit)
    if (!hasMoney(item.quantity)) missing.add(LINE_ITEM_FIELD_LABELS.quantity)
    if (!hasMoney(item.unit_price)) missing.add(LINE_ITEM_FIELD_LABELS.unit_price)
  }

  return [...missing]
}

function logReparseFailure(
  row: InvoiceRecordForReparse,
  reason: string,
): void {
  appendReparseFailureLog({
    record_id: row.id,
    digital_invoice_no: row.digital_invoice_no,
    source_file_name: row.source_file_name,
    reason,
  })
}

/** 缺字段模式：任一关键字段缺失或票号不足 20 位则需重解析 */
export function invoiceRecordHasMissingFields(row: InvoiceRecordForReparse): boolean {
  return listMissingInvoiceFieldLabels(row).length > 0
}

/** 返回仍缺失的关键字段名称（用于提示） */
export function listMissingInvoiceFieldLabels(row: InvoiceRecordForReparse): string[] {
  const missing: string[] = []
  if (!hasValidDigitalInvoiceNo(row.digital_invoice_no)) missing.push('数电发票号码')
  if (!invoiceNumberMatchesDigitalNo(row)) missing.push('发票号码')
  if (!hasFilledText(row.invoice_type)) missing.push('票种')
  if (!hasFilledText(row.seller_name)) missing.push('销方名称')
  if (!hasFilledText(row.seller_tax_id)) missing.push('销方识别号')
  if (!hasFilledText(row.buyer_name)) missing.push('购方名称')
  if (!hasFilledText(row.buyer_tax_id)) missing.push('购方识别号')
  if (!hasFilledText(row.issue_date)) missing.push('开票日期')
  if (!hasFilledText(row.issuer)) missing.push('开票人')
  if (!hasMoney(row.amount)) missing.push('金额')
  if (!hasMoney(row.tax_amount)) missing.push('税额')
  if (!hasMoney(row.total_amount)) missing.push('价税合计')
  missing.push(...listMissingLineItemFieldLabels(row))
  return missing
}

/** @deprecated 使用 invoiceRecordHasMissingFields */
export function invoiceRecordNeedsReparse(row: InvoiceRecordForReparse): boolean {
  return invoiceRecordHasMissingFields(row)
}

export function shouldReparseInvoiceRecord(
  row: InvoiceRecordForReparse,
  mode: ReparseMode,
): boolean {
  if (mode === 'full') return true
  return invoiceRecordHasMissingFields(row)
}

function coalesceText(
  parsed: string | null | undefined,
  existing: string | null | undefined,
): string | null {
  if (hasFilledText(parsed)) return parsed!.trim()
  if (hasFilledText(existing)) return existing!.trim()
  return existing ?? null
}

function coalesceMoney(
  parsed: number | null | undefined,
  existing: number | null | undefined,
): number | null {
  const next = clampMoneyForDb(parsed)
  if (next != null) return next
  if (hasMoney(existing)) return existing!
  return null
}

function coalesceDigitalInvoiceNo(parsed: string, existing: string): string {
  const p = normalizeInvoiceDigits(parsed)
  const e = normalizeInvoiceDigits(existing)
  if (!p) return e || existing.trim()
  if (!e) return p
  if (p.length >= STANDARD_DIGITAL_INVOICE_NO_LENGTH && e.length < STANDARD_DIGITAL_INVOICE_NO_LENGTH) {
    return p
  }
  if (e.length >= STANDARD_DIGITAL_INVOICE_NO_LENGTH && p.length < STANDARD_DIGITAL_INVOICE_NO_LENGTH) {
    return e
  }
  return p.length >= e.length ? p : e
}

/** 数电发票：发票号码与数电发票号码保持一致 */
function coalesceInvoiceNumber(
  parsed: ParsedInvoicePdf,
  existing: InvoiceRecordForReparse,
  digitalInvoiceNo: string,
): string {
  const fromParsed = hasFilledText(parsed.invoice_number)
    ? parsed.invoice_number!.trim()
    : hasFilledText(parsed.digital_invoice_no)
      ? parsed.digital_invoice_no.trim()
      : null
  const fromExisting = hasFilledText(existing.invoice_number)
    ? existing.invoice_number!.trim()
    : null

  return digitalInvoiceNo || fromParsed || fromExisting || ''
}

function isPlaceholderLineItem(item: InvoiceLineItem): boolean {
  return (
    !hasFilledText(item.item_name) &&
    !hasFilledText(item.unit) &&
    !hasMoney(item.quantity) &&
    !hasMoney(item.unit_price)
  )
}

function mergeInvoiceContent(
  parsed: ParsedInvoicePdf,
  existing: InvoiceRecordContent | InvoiceRecordRow['content'],
): InvoiceRecordContent {
  const existingItems =
    existing && typeof existing === 'object' && 'line_items' in existing
      ? (existing as InvoiceRecordContent).line_items
      : undefined
  if (!parsed.line_items.length) {
    return { line_items: existingItems ?? [] }
  }
  const onlyPlaceholder =
    parsed.line_items.length === 1 && isPlaceholderLineItem(parsed.line_items[0])
  if (onlyPlaceholder && existingItems?.length) {
    return { line_items: existingItems }
  }
  return { line_items: parsed.line_items }
}

/** 解析结果与库内已有值合并：解析有值则更新，解析为空则保留原值 */
export function mergeParsedInvoiceRecord(
  existing: InvoiceRecordForReparse,
  parsed: ParsedInvoicePdf,
) {
  const digital_invoice_no = coalesceDigitalInvoiceNo(
    parsed.digital_invoice_no,
    existing.digital_invoice_no,
  )
  const invoice_number = coalesceInvoiceNumber(parsed, existing, digital_invoice_no)

  return {
    digital_invoice_no,
    invoice_number,
    invoice_source: coalesceText(parsed.invoice_source, existing.invoice_source),
    invoice_type: coalesceText(parsed.invoice_type, existing.invoice_type),
    invoice_status:
      coalesceText(parsed.invoice_status, existing.invoice_status) ?? '正常',
    is_positive: coalesceText(parsed.is_positive, existing.is_positive) ?? '是',
    risk_level: coalesceText(parsed.risk_level, existing.risk_level) ?? '正常',
    seller_name: coalesceText(parsed.seller_name, existing.seller_name),
    seller_tax_id: coalesceText(parsed.seller_tax_id, existing.seller_tax_id),
    buyer_name: coalesceText(parsed.buyer_name, existing.buyer_name),
    buyer_tax_id: coalesceText(parsed.buyer_tax_id, existing.buyer_tax_id),
    issue_date: coalesceText(parsed.issue_date, existing.issue_date),
    amount: coalesceMoney(parsed.amount, existing.amount),
    tax_amount: coalesceMoney(parsed.tax_amount, existing.tax_amount),
    total_amount: coalesceMoney(parsed.total_amount, existing.total_amount),
    business_type: coalesceText(parsed.business_type, existing.business_type),
    issuer: coalesceText(parsed.issuer, existing.issuer),
    remark: coalesceText(parsed.remark, existing.remark),
    content: mergeInvoiceContent(parsed, existing.content),
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

async function fetchInvoiceRecordBatch(
  from: number,
  to: number,
): Promise<InvoiceRecordForReparse[]> {
  const { data, error } = await supabase
    .from('invoice_records')
    .select(REPARSE_SELECT)
    .order('created_at', { ascending: true })
    .range(from, to)
  if (error) throw new Error(error.message)
  return (data ?? []) as InvoiceRecordForReparse[]
}

async function countInvoiceRecordsForReparse(): Promise<number> {
  const { count, error } = await supabase
    .from('invoice_records')
    .select('id', { count: 'exact', head: true })
  if (error) throw new Error(error.message)
  return count ?? 0
}

export async function fetchInvoiceRecordsForReparseByNumbers(
  digitalInvoiceNos: string[],
): Promise<InvoiceRecordForReparse[]> {
  if (digitalInvoiceNos.length === 0) return []
  const { data, error } = await supabase
    .from('invoice_records')
    .select(REPARSE_SELECT)
    .in('digital_invoice_no', digitalInvoiceNos)
  if (error) throw new Error(error.message)
  return (data ?? []) as InvoiceRecordForReparse[]
}

export async function reparseInvoiceRecord(
  row: InvoiceRecordForReparse,
  options?: { requireComplete?: boolean },
): Promise<ReparseInvoiceResult> {
  try {
    const blob = await downloadPdfBlob(row.storage_path)
    const parsed = await parseInvoicePdfBytes(await blob.arrayBuffer(), row.source_file_name)
    const merged = mergeParsedInvoiceRecord(row, parsed)
    const { error } = await supabase.from('invoice_records').update(merged).eq('id', row.id)
    if (error) {
      const message = error.message
      logReparseFailure(row, `数据库更新失败：${message}`)
      return {
        id: row.id,
        digital_invoice_no: row.digital_invoice_no,
        source_file_name: row.source_file_name,
        status: 'failed',
        message,
      }
    }

    const mergedRow: InvoiceRecordForReparse = { ...row, ...merged }
    const stillMissing = listMissingInvoiceFieldLabels(mergedRow)
    if (options?.requireComplete && stillMissing.length > 0) {
      const message = `解析后仍缺：${stillMissing.join('、')}`
      logReparseFailure(row, message)
      return {
        id: row.id,
        digital_invoice_no: mergedRow.digital_invoice_no,
        source_file_name: row.source_file_name,
        status: 'failed',
        message,
      }
    }

    return {
      id: row.id,
      digital_invoice_no: mergedRow.digital_invoice_no,
      source_file_name: row.source_file_name,
      status: 'success',
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    logReparseFailure(row, message)
    return {
      id: row.id,
      digital_invoice_no: row.digital_invoice_no,
      source_file_name: row.source_file_name,
      status: 'failed',
      message,
    }
  }
}

export async function reparseAllInvoiceRecords(options?: {
  mode?: ReparseMode
  concurrency?: number
  onProgress?: (
    done: number,
    total: number,
    stats: { skipped: number; pending: number; reparseDone: number; reparseTotal: number },
  ) => void
}): Promise<ReparseAllInvoiceResult> {
  const mode = options?.mode ?? 'missing'
  const concurrency = options?.concurrency ?? DEFAULT_REPARSE_CONCURRENCY
  resetReparseFailureLog()

  const total = await countInvoiceRecordsForReparse()
  let done = 0
  let success = 0
  let skipped = 0
  let failed = 0
  let reparseTotal = 0
  let reparseDone = 0
  const failureItems: ReparseInvoiceResult[] = []

  const reportProgress = () => {
    options?.onProgress?.(done, total, {
      skipped,
      pending: Math.max(reparseTotal - reparseDone, 0),
      reparseDone,
      reparseTotal,
    })
  }

  reportProgress()

  for (let from = 0; from < total; from += REPARSE_FETCH_BATCH) {
    const batch = await fetchInvoiceRecordBatch(from, from + REPARSE_FETCH_BATCH - 1)
    const toReparse: InvoiceRecordForReparse[] = []

    for (const row of batch) {
      if (shouldReparseInvoiceRecord(row, mode)) {
        toReparse.push(row)
      } else {
        skipped += 1
        done += 1
      }
    }

    reparseTotal += toReparse.length
    reportProgress()

    await runWithConcurrency(toReparse, concurrency, async (row) => {
      const result = await reparseInvoiceRecord(row, {
        requireComplete: mode === 'missing',
      })
      reparseDone += 1
      done += 1
      if (result.status === 'success') {
        success += 1
      } else if (result.status === 'failed') {
        failed += 1
        failureItems.push(result)
      }
      reportProgress()
    })
  }

  return {
    total,
    success,
    skipped,
    failed,
    items: failureItems,
  }
}
