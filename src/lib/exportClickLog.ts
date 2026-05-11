import type { ImportedExcelContent } from './excelImport'
import { supabase } from './supabase'
import type { FormDataRow } from '../types/database'

type ExportTrigger = 'query_auto' | 'preview_button'

type ExportClickLogInput = {
  row: FormDataRow
  content: ImportedExcelContent
  pdfFileName: string
  trigger: ExportTrigger
}

function isLocalOrPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase()
  if (!host || host === 'localhost' || host === '::1' || host.endsWith('.localhost')) return true
  if (host === '127.0.0.1' || host.startsWith('127.')) return true
  if (host.startsWith('10.') || host.startsWith('192.168.')) return true

  const private172 = /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  return private172
}

function shouldRecordExportClick(): boolean {
  if (!import.meta.env.PROD) return false
  if (typeof window === 'undefined') return false
  return !isLocalOrPrivateHost(window.location.hostname)
}

export async function recordExportClick({
  row,
  content,
  pdfFileName,
  trigger,
}: ExportClickLogInput): Promise<void> {
  if (!shouldRecordExportClick()) return

  const idx = content.declaration_index
  const { error } = await supabase.from('export_click_logs').insert({
    action: 'pdf_export',
    trigger,
    form_data_record_id: row.id,
    document_name: pdfFileName,
    source_file_name: content.excel.fileName,
    form_code: row.form_code ?? idx?.form_code ?? null,
    form_type_label: row.form_type_label ?? idx?.form_type_label ?? null,
    taxpayer_name: row.taxpayer_name ?? idx?.taxpayer_name ?? null,
    credit_code: row.credit_code ?? idx?.credit_code ?? null,
    tax_period_start: row.tax_period_start ?? idx?.tax_period_start ?? null,
    tax_period_end: row.tax_period_end ?? idx?.tax_period_end ?? null,
    declaration_date: row.declaration_date ?? idx?.declaration_date ?? null,
    tax_amount_due: row.tax_amount_due ?? idx?.tax_amount_due ?? null,
    page_path: `${window.location.pathname}${window.location.search}`,
    page_url: window.location.href,
    user_agent: window.navigator.userAgent,
  })

  if (error) {
    // 统计失败不影响用户导出，只在控制台保留排查线索。
    console.warn('export click log failed:', error.message)
  }
}
