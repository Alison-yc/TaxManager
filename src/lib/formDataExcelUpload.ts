import { parseExcelFile } from './excelImport'
import type { ImportedExcelContent } from './excelImport'
import { flattenDeclarationForInsert } from './declarationIndex'
import { supabase } from './supabase'
import type { Json } from '../types/database'

/** 成功写入 `form_data` 后派发，供申报信息查询页刷新列表 */
export const FORM_DATA_EXCEL_IMPORTED_EVENT = 'taxmanager:form-data-excel-import'

function dispatchFormDataImported() {
  window.dispatchEvent(new Event(FORM_DATA_EXCEL_IMPORTED_EVENT))
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`
  }
  if (value && typeof value === 'object') {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'undefined'
}

async function hasIdenticalImportedForm(
  row: Record<string, unknown>,
  content: Json,
): Promise<{ ok: true; duplicate: boolean } | { ok: false; message: string }> {
  let q = supabase
    .from('form_data')
    .select('id, content')
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
    const v = row[key]
    if (v == null) {
      q = q.is(key, null)
    } else {
      q = q.eq(key, v as never)
    }
  }

  const { data, error } = await q.limit(10)
  if (error) {
    return { ok: false, message: `重复校验失败：${error.message}` }
  }

  const incoming = stableStringify(content)
  const duplicate = (data ?? []).some((item) => stableStringify(item.content) === incoming)
  return { ok: true, duplicate }
}

/**
 * 解析 Excel 并插入 `form_data`；成功时派发 {@link FORM_DATA_EXCEL_IMPORTED_EVENT}。
 */
export async function uploadFormDataFromExcelFile(
  file: File,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const lower = file.name.toLowerCase()
  if (!lower.endsWith('.xlsx') && !lower.endsWith('.xls')) {
    return { ok: false, message: '请选择 .xlsx 或 .xls 文件' }
  }
  try {
    const buf = await file.arrayBuffer()
    const content = parseExcelFile(buf, file.name) as Json
    const parsed = content as unknown as ImportedExcelContent
    if (!parsed.declaration_index) {
      return {
        ok: false,
        message: '无法从 Excel 提取申报检索字段（请使用标准模版：增值税及附加税费申报表）',
      }
    }
    const row = flattenDeclarationForInsert(content, parsed.declaration_index)
    const duplicated = await hasIdenticalImportedForm(row, content)
    if (!duplicated.ok) {
      return { ok: false, message: duplicated.message }
    }
    if (duplicated.duplicate) {
      return { ok: false, message: '该申报表已导入，不能重复上传完全相同的表。' }
    }
    const { error } = await supabase.from('form_data').insert(row)
    if (error) {
      return { ok: false, message: error.message }
    }
    dispatchFormDataImported()
    return { ok: true }
  } catch (e: unknown) {
    return { ok: false, message: e instanceof Error ? e.message : String(e) }
  }
}
