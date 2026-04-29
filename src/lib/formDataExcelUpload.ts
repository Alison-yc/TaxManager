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
