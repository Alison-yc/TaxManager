export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type ImportSourceType = 'excel' | 'pdf'
export type ImportCategory = 'declaration' | 'financial'

/** 对应 public.form_data（含导入时抽取的检索/展示字段） */
export type FormDataRow = {
  id: string
  user_id: string | number | null
  created_at: string
  content: Json | null
  source_type?: ImportSourceType | null
  import_category?: ImportCategory | null
  storage_path?: string | null
  form_code?: string | null
  form_type_label?: string | null
  correction_type?: string | null
  void_flag?: string | null
  taxpayer_name?: string | null
  credit_code?: string | null
  tax_period_start?: string | null
  tax_period_end?: string | null
  declaration_date?: string | null
  tax_amount_due?: number | null
}

export type InvoiceLineItem = {
  tax_class_code?: string | null
  business_type?: string | null
  item_name?: string | null
  spec?: string | null
  unit?: string | null
  quantity?: number | null
  unit_price?: number | null
  amount?: number | null
  tax_rate?: string | null
  tax_amount?: number | null
  total_amount?: number | null
  remark?: string | null
}

export type InvoiceRecordContent = {
  line_items: InvoiceLineItem[]
}

/** 对应 public.invoice_records */
export type InvoiceRecordRow = {
  id: string
  created_at: string
  auth_user_id: string
  digital_invoice_no: string
  invoice_code?: string | null
  invoice_number?: string | null
  query_type: string
  invoice_source?: string | null
  invoice_type?: string | null
  invoice_status?: string | null
  is_positive?: string | null
  risk_level?: string | null
  seller_name?: string | null
  seller_tax_id?: string | null
  buyer_name?: string | null
  buyer_tax_id?: string | null
  issue_date?: string | null
  amount?: number | null
  tax_amount?: number | null
  total_amount?: number | null
  business_type?: string | null
  issuer?: string | null
  remark?: string | null
  source_file_name: string
  storage_path: string
  content: InvoiceRecordContent | Json | null
}

export type InvoiceFullExcelBaselineRow = {
  id: string
  created_at: string
  updated_at: string
  auth_user_id: string
  storage_path: string
  source_file_name: string
  sheet_count: number
  row_count: number
  content: Json | null
}

export type ImportedPdfContent = {
  importVersion: 3
  importSource: 'pdf'
  pdf: {
    fileName: string
    storagePath: string
    pageCount?: number
  }
  declaration_index?: {
    form_code: string
    form_type_label: string
    correction_type: string
    void_flag: string
    taxpayer_name: string | null
    credit_code: string | null
    tax_period_start: string | null
    tax_period_end: string | null
    declaration_date: string | null
    tax_amount_due: number | null
  }
  summary?: string
}

export function isImportedPdfContent(content: unknown): content is ImportedPdfContent {
  return (
    typeof content === 'object' &&
    content !== null &&
    'importSource' in content &&
    (content as ImportedPdfContent).importSource === 'pdf'
  )
}

/** 对应 public.tax_payment_certificate_records */
export type TaxPaymentCertRecordRow = {
  id: string
  created_at: string
  auth_user_id: string
  import_id: string
  line_index: number
  certificate_no: string
  original_voucher_no: string
  tax_type?: string | null
  item_name?: string | null
  tax_period_start?: string | null
  tax_period_end?: string | null
  payment_date?: string | null
  actual_amount?: number | null
  taxpayer_name?: string | null
  taxpayer_tax_id?: string | null
  issue_date?: string | null
  tax_authority?: string | null
  total_amount?: number | null
  remark?: string | null
  source_file_name: string
  storage_path: string
  content: Json | null
}
