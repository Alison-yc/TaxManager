import { DEFAULT_CORRECTION, DEFAULT_VOID_FLAG } from '../declarationIndex'
import type { ImportCategory, ImportedPdfContent, Json } from '../../types/database'
import { uploadPdfFile } from '../pdfStorage'
import { supabase } from '../supabase'
import {
  clampMoneyForDb,
  extractDeclarationFieldsFromText,
  extractPdfTextAndPageCount,
} from './extractPdfText'

export const FINANCIAL_FORM_CODE = 'CWBB001'
export const FINANCIAL_FORM_TYPE_LABEL =
  '《财务报表报送与信息采集（企业会计准则一般企业）》'

export const CORP_INCOME_TAX_FORM_CODE = 'BDA0640110'
export const CORP_INCOME_TAX_FORM_TYPE_LABEL =
  '《居民企业（查账征收）企业所得税月（季）度申报表》'

export const CORP_INCOME_TAX_ANNUAL_FORM_CODE = 'BDA0640530'
export const CORP_INCOME_TAX_ANNUAL_FORM_TYPE_LABEL =
  '《企业所得税年度纳税申报表（A类）》'

type ParsedDeclarationPdf = {
  form_code: string
  form_type_label: string
  import_category: ImportCategory
  taxpayer_name: string | null
  credit_code: string | null
  tax_period_start: string | null
  tax_period_end: string | null
  declaration_date: string | null
  tax_amount_due: number | null
  summary: string
}

function detectDeclarationPdf(
  fileName: string,
  category: ImportCategory,
  text = '',
): ParsedDeclarationPdf {
  const base = {
    correction_type: DEFAULT_CORRECTION,
    void_flag: DEFAULT_VOID_FLAG,
  }

  if (category === 'financial') {
    return {
      form_code: FINANCIAL_FORM_CODE,
      form_type_label: FINANCIAL_FORM_TYPE_LABEL,
      import_category: 'financial',
      taxpayer_name: null,
      credit_code: null,
      tax_period_start: null,
      tax_period_end: null,
      declaration_date: null,
      tax_amount_due: null,
      summary: fileName.replace(/\.pdf$/i, ''),
      ...base,
    }
  }

  const isQuarterly =
    /月[（(]?季[）)]?度|A200000/i.test(fileName) || /A200000|月（季）度预缴/.test(text)

  if (isQuarterly) {
    return {
      form_code: CORP_INCOME_TAX_FORM_CODE,
      form_type_label: CORP_INCOME_TAX_FORM_TYPE_LABEL,
      import_category: 'declaration',
      taxpayer_name: null,
      credit_code: null,
      tax_period_start: null,
      tax_period_end: null,
      declaration_date: null,
      tax_amount_due: null,
      summary: fileName.replace(/\.pdf$/i, ''),
      ...base,
    }
  }

  const isAnnual =
    /企业所得税.*年度|年度纳税申报|A100000/i.test(fileName) ||
    /企业所得税年度纳税申报表/.test(text)

  if (isAnnual) {
    return {
      form_code: CORP_INCOME_TAX_ANNUAL_FORM_CODE,
      form_type_label: CORP_INCOME_TAX_ANNUAL_FORM_TYPE_LABEL,
      import_category: 'declaration',
      taxpayer_name: null,
      credit_code: null,
      tax_period_start: null,
      tax_period_end: null,
      declaration_date: null,
      tax_amount_due: null,
      summary: fileName.replace(/\.pdf$/i, ''),
      ...base,
    }
  }

  if (fileName.includes('企业所得税') || /居民企业.*企业所得税/.test(text)) {
    return {
      form_code: CORP_INCOME_TAX_FORM_CODE,
      form_type_label: CORP_INCOME_TAX_FORM_TYPE_LABEL,
      import_category: 'declaration',
      taxpayer_name: null,
      credit_code: null,
      tax_period_start: null,
      tax_period_end: null,
      declaration_date: null,
      tax_amount_due: null,
      summary: fileName.replace(/\.pdf$/i, ''),
      ...base,
    }
  }

  throw new Error('无法识别申报 PDF 类型，请使用支持的申报表或财务报表 PDF 文件名')
}

async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', data)
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

async function hasDuplicateDeclarationPdf(
  category: ImportCategory,
  fileHash: string,
  row: Record<string, unknown>,
): Promise<{ ok: true; duplicate: boolean } | { ok: false; message: string }> {
  const { data: hashDup, error: hashErr } = await supabase
    .from('form_data')
    .select('id')
    .eq('source_type', 'pdf')
    .eq('import_category', category)
    .filter('content->pdf->>fileHash', 'eq', fileHash)
    .limit(1)
  if (hashErr) return { ok: false, message: `重复校验失败：${hashErr.message}` }
  if (hashDup && hashDup.length > 0) return { ok: true, duplicate: true }

  let q = supabase
    .from('form_data')
    .select('id')
    .eq('source_type', 'pdf')
    .eq('import_category', category)
    .eq('form_code', String(row.form_code ?? ''))
    .eq('correction_type', String(row.correction_type ?? ''))
    .eq('void_flag', String(row.void_flag ?? ''))

  const nullableKeys = [
    'credit_code',
    'tax_period_start',
    'tax_period_end',
    'declaration_date',
    'tax_amount_due',
  ] as const

  for (const key of nullableKeys) {
    const value = row[key]
    if (value == null) {
      q = q.is(key, null)
    } else {
      q = q.eq(key, value as never)
    }
  }

  const { data: fieldDup, error: fieldErr } = await q.limit(1)
  if (fieldErr) return { ok: false, message: `重复校验失败：${fieldErr.message}` }
  if (fieldDup && fieldDup.length > 0) return { ok: true, duplicate: true }

  return { ok: true, duplicate: false }
}

export async function uploadDeclarationPdfFile(
  file: File,
  category: ImportCategory,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const lower = file.name.toLowerCase()
  if (!lower.endsWith('.pdf')) {
    return { ok: false, message: '请选择 PDF 文件' }
  }

  try {
    const fileBytes = await file.arrayBuffer()
    const fileHash = await sha256Hex(fileBytes)
    const { text, pageCount } = await extractPdfTextAndPageCount(file)
    const detected = detectDeclarationPdf(file.name, category, text)
    const extracted = extractDeclarationFieldsFromText(text)

    const declaration_index = {
      form_code: detected.form_code,
      form_type_label: detected.form_type_label,
      correction_type: DEFAULT_CORRECTION,
      void_flag: DEFAULT_VOID_FLAG,
      taxpayer_name: extracted.taxpayer_name,
      credit_code: extracted.credit_code,
      tax_period_start: extracted.tax_period_start,
      tax_period_end: extracted.tax_period_end,
      declaration_date: extracted.declaration_date ?? new Date().toISOString().slice(0, 10),
      tax_amount_due: clampMoneyForDb(extracted.tax_amount_due),
    }

    const duplicateCheck = await hasDuplicateDeclarationPdf(
      category,
      fileHash,
      {
        form_code: declaration_index.form_code,
        correction_type: declaration_index.correction_type,
        void_flag: declaration_index.void_flag,
        credit_code: declaration_index.credit_code,
        tax_period_start: declaration_index.tax_period_start,
        tax_period_end: declaration_index.tax_period_end,
        declaration_date: declaration_index.declaration_date,
        tax_amount_due: declaration_index.tax_amount_due,
      },
    )
    if (!duplicateCheck.ok) {
      return { ok: false, message: duplicateCheck.message }
    }
    if (duplicateCheck.duplicate) {
      return {
        ok: false,
        message:
          category === 'financial'
            ? '该财务报表 PDF 已导入，请勿重复上传'
            : '该申报表 PDF 已导入，请勿重复上传',
      }
    }

    const recordId = crypto.randomUUID()
    const { storagePath } = await uploadPdfFile(
      category === 'financial' ? 'financial' : 'declarations',
      file,
      `${recordId}.pdf`,
    )

    const content: ImportedPdfContent = {
      importVersion: 3,
      importSource: 'pdf',
      pdf: {
        fileName: file.name,
        storagePath,
        pageCount,
        fileHash,
      },
      declaration_index,
      summary: extracted.taxpayer_name ?? detected.summary,
    }

    const row = {
      id: recordId,
      content: content as unknown as Json,
      source_type: 'pdf',
      import_category: category,
      storage_path: storagePath,
      form_code: declaration_index.form_code,
      form_type_label: declaration_index.form_type_label,
      correction_type: declaration_index.correction_type,
      void_flag: declaration_index.void_flag,
      taxpayer_name: declaration_index.taxpayer_name,
      credit_code: declaration_index.credit_code,
      tax_period_start: declaration_index.tax_period_start,
      tax_period_end: declaration_index.tax_period_end,
      declaration_date: declaration_index.declaration_date,
      tax_amount_due: declaration_index.tax_amount_due,
    }

    const { error } = await supabase.from('form_data').insert(row)
    if (error) return { ok: false, message: error.message }
    return { ok: true, id: recordId }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}

export async function uploadInvoicePdfFile(
  file: File,
): Promise<{ ok: true; id: string } | { ok: false; message: string }> {
  const lower = file.name.toLowerCase()
  if (!lower.endsWith('.pdf')) {
    return { ok: false, message: '请选择 PDF 文件' }
  }

  try {
    const { parseInvoicePdf } = await import('./invoicePdfImport')
    const parsed = await parseInvoicePdf(file)
    const { storagePath } = await uploadPdfFile(
      'invoices',
      file,
      `${parsed.digital_invoice_no}.pdf`,
    )

    const { data: existing, error: dupErr } = await supabase
      .from('invoice_records')
      .select('id')
      .eq('digital_invoice_no', parsed.digital_invoice_no)
      .maybeSingle()
    if (dupErr) return { ok: false, message: dupErr.message }
    if (existing) {
      return { ok: false, message: `发票 ${parsed.digital_invoice_no} 已导入，请勿重复上传` }
    }

    const row = {
      digital_invoice_no: parsed.digital_invoice_no,
      invoice_number: parsed.invoice_number,
      query_type: '开具发票',
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
      source_file_name: file.name,
      storage_path: storagePath,
      content: { line_items: parsed.line_items },
    }

    const { data, error } = await supabase.from('invoice_records').insert(row).select('id').single()
    if (error) return { ok: false, message: error.message }
    return { ok: true, id: data.id as string }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
