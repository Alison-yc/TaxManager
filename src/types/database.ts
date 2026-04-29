export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

/** 对应 public.form_data（含导入时抽取的检索/展示字段） */
export type FormDataRow = {
  id: string
  user_id: string | number | null
  created_at: string
  content: Json | null
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
