import * as XLSX from 'xlsx'
import {
  extractDeclarationIndexFromGrid,
  flattenDeclarationForInsert,
  isValidUnifiedSocialCreditCode,
  repairUnifiedSocialCreditCode,
} from './declarationIndex'
import {
  detectPreviewHeaderRows,
  isImportedContent,
  type GridCell,
  type ImportedExcelContent,
} from './excelImport'
import { FORM_DATA_EXCEL_IMPORTED_EVENT } from './formDataExcelUpload'
import { supabase } from './supabase'
import type { Json } from '../types/database'

type RepairableFormDataRow = {
  id: string
  content: Json | null
  taxpayer_name?: string | null
  credit_code?: string | null
  tax_period_start?: string | null
  tax_period_end?: string | null
  declaration_date?: string | null
  tax_amount_due?: number | null
}

export type ExcelDeclarationRepairResult = {
  scanned: number
  updated: number
  skipped: number
  creditCodeRepaired: number
  taxpayerNameRepaired: number
  unrepairableCreditCode: number
  failed: number
  errors: string[]
}

export type ExcelDeclarationRepairPreviewResult = {
  scanned: number
  willUpdate: number
  willSkip: number
  creditCodeWillRepair: number
  taxpayerNameWillRepair: number
  unrepairableCreditCode: number
  failed: number
  errors: string[]
}

const PAGE_SIZE = 200

function cellText(cell: GridCell | undefined): string {
  if (cell === undefined || cell === null) return ''
  return String(cell).trim()
}

function compactText(text: string): string {
  return text.replace(/\s/g, '')
}

function cloneContent(content: ImportedExcelContent): ImportedExcelContent {
  return JSON.parse(JSON.stringify(content)) as ImportedExcelContent
}

function updateValueRightOfLabel(
  grid: GridCell[][],
  labelPattern: RegExp,
  value: string,
  maxRows = 14,
): boolean {
  for (let r = 0; r < Math.min(maxRows, grid.length); r++) {
    const row = grid[r] ?? []
    for (let c = 0; c < row.length; c++) {
      const label = compactText(cellText(row[c]))
      if (!labelPattern.test(label)) continue

      for (let j = c + 1; j < row.length; j++) {
        if (!cellText(row[j])) continue
        if (row[j] === value) return false
        row[j] = value
        return true
      }
    }
  }
  return false
}

function normalizeDbDate(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

function normalizeDbMoney(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function sameNullableString(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null)
}

function sameNullableNumber(a: unknown, b: unknown): boolean {
  const left = normalizeDbMoney(a)
  const right = normalizeDbMoney(b)
  return left === right
}

function buildRepairedContent(
  row: RepairableFormDataRow,
): {
  content: ImportedExcelContent
  update: Record<string, unknown>
  creditCodeRepaired: boolean
  taxpayerNameRepaired: boolean
  unrepairableCreditCode: boolean
} | null {
  if (!isImportedContent(row.content)) return null

  const content = cloneContent(row.content)
  content.previewHeaderRows = detectPreviewHeaderRows(content.grid)
  const sheet = XLSX.utils.aoa_to_sheet(content.grid)
  const declarationIndex = extractDeclarationIndexFromGrid(content.grid, sheet)
  const rawCreditCode = declarationIndex.credit_code
  const repairedCreditCode =
    repairUnifiedSocialCreditCode(rawCreditCode) ??
    repairUnifiedSocialCreditCode(row.credit_code)
  const finalCreditCode =
    repairedCreditCode ??
    (isValidUnifiedSocialCreditCode(rawCreditCode) ? rawCreditCode : null) ??
    (isValidUnifiedSocialCreditCode(row.credit_code) ? row.credit_code ?? null : null)
  const unrepairableCreditCode =
    Boolean(rawCreditCode) &&
    !isValidUnifiedSocialCreditCode(rawCreditCode) &&
    finalCreditCode == null

  let creditCodeGridRepaired = false
  if (finalCreditCode && finalCreditCode !== rawCreditCode) {
    declarationIndex.credit_code = finalCreditCode
    creditCodeGridRepaired = updateValueRightOfLabel(
      content.grid,
      /纳税人识别号|统一社会信用代码/,
      finalCreditCode,
    )
  }

  content.declaration_index = declarationIndex

  const flat = flattenDeclarationForInsert(content as unknown as Json, declarationIndex)
  const update = {
    content: content as unknown as Json,
    form_code: flat.form_code,
    form_type_label: flat.form_type_label,
    correction_type: flat.correction_type,
    void_flag: flat.void_flag,
    taxpayer_name: flat.taxpayer_name,
    credit_code: flat.credit_code,
    tax_period_start: flat.tax_period_start,
    tax_period_end: flat.tax_period_end,
    declaration_date: flat.declaration_date,
    tax_amount_due: flat.tax_amount_due,
  }

  const taxpayerNameRepaired = !sameNullableString(row.taxpayer_name, update.taxpayer_name)
  const creditCodeRepaired = !sameNullableString(row.credit_code, update.credit_code)
  const changed =
    taxpayerNameRepaired ||
    creditCodeRepaired ||
    creditCodeGridRepaired ||
    !sameNullableString(row.tax_period_start, normalizeDbDate(update.tax_period_start)) ||
    !sameNullableString(row.tax_period_end, normalizeDbDate(update.tax_period_end)) ||
    !sameNullableString(row.declaration_date, normalizeDbDate(update.declaration_date)) ||
    !sameNullableNumber(row.tax_amount_due, update.tax_amount_due)

  if (!changed && !unrepairableCreditCode) return null

  return {
    content,
    update,
    creditCodeRepaired,
    taxpayerNameRepaired,
    unrepairableCreditCode,
  }
}

export async function repairImportedExcelDeclarationIndexes(): Promise<ExcelDeclarationRepairResult> {
  const result: ExcelDeclarationRepairResult = {
    scanned: 0,
    updated: 0,
    skipped: 0,
    creditCodeRepaired: 0,
    taxpayerNameRepaired: 0,
    unrepairableCreditCode: 0,
    failed: 0,
    errors: [],
  }

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('form_data')
      .select(
        'id,content,taxpayer_name,credit_code,tax_period_start,tax_period_end,declaration_date,tax_amount_due',
      )
      .or('source_type.is.null,source_type.eq.excel')
      .range(from, to)

    if (error) {
      return {
        ...result,
        failed: result.failed + 1,
        errors: [`读取历史 Excel 申报表失败：${error.message}`],
      }
    }

    const rows = (data ?? []) as RepairableFormDataRow[]
    if (rows.length === 0) break

    for (const row of rows) {
      result.scanned += 1
      const repaired = buildRepairedContent(row)
      if (!repaired) {
        result.skipped += 1
        continue
      }
      if (repaired.unrepairableCreditCode) {
        result.unrepairableCreditCode += 1
      }

      const { error: updateError } = await supabase
        .from('form_data')
        .update(repaired.update)
        .eq('id', row.id)

      if (updateError) {
        result.failed += 1
        if (result.errors.length < 5) {
          result.errors.push(`${row.id}：${updateError.message}`)
        }
        continue
      }

      result.updated += 1
      if (repaired.creditCodeRepaired) result.creditCodeRepaired += 1
      if (repaired.taxpayerNameRepaired) result.taxpayerNameRepaired += 1
    }

    if (rows.length < PAGE_SIZE) break
  }

  if (result.updated > 0) {
    window.dispatchEvent(new Event(FORM_DATA_EXCEL_IMPORTED_EVENT))
  }

  return result
}

export async function previewImportedExcelDeclarationRepairs(): Promise<ExcelDeclarationRepairPreviewResult> {
  const result: ExcelDeclarationRepairPreviewResult = {
    scanned: 0,
    willUpdate: 0,
    willSkip: 0,
    creditCodeWillRepair: 0,
    taxpayerNameWillRepair: 0,
    unrepairableCreditCode: 0,
    failed: 0,
    errors: [],
  }

  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from('form_data')
      .select(
        'id,content,taxpayer_name,credit_code,tax_period_start,tax_period_end,declaration_date,tax_amount_due',
      )
      .or('source_type.is.null,source_type.eq.excel')
      .range(from, to)

    if (error) {
      return {
        ...result,
        failed: result.failed + 1,
        errors: [`读取历史 Excel 申报表失败：${error.message}`],
      }
    }

    const rows = (data ?? []) as RepairableFormDataRow[]
    if (rows.length === 0) break

    for (const row of rows) {
      result.scanned += 1
      const repaired = buildRepairedContent(row)
      if (!repaired) {
        result.willSkip += 1
        continue
      }

      result.willUpdate += 1
      if (repaired.creditCodeRepaired) result.creditCodeWillRepair += 1
      if (repaired.taxpayerNameRepaired) result.taxpayerNameWillRepair += 1
      if (repaired.unrepairableCreditCode) result.unrepairableCreditCode += 1
    }

    if (rows.length < PAGE_SIZE) break
  }

  return result
}
