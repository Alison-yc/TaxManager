import * as XLSX from 'xlsx'
import type { GridCell } from './excelImport'
import type { Json } from '../types/database'

/** 与 Postgres `form_data` 扩展列对齐，便于列表与检索 */
export type DeclarationIndexFlat = {
  form_code: string
  /** 如 《增值税及附加税费申报表（一般纳税人适用）》 */
  form_type_label: string
  correction_type: string
  void_flag: string
  taxpayer_name: string | null
  credit_code: string | null
  /** ISO yyyy-mm-dd */
  tax_period_start: string | null
  tax_period_end: string | null
  /** 填表日期 / 申报日期 */
  declaration_date: string | null
  /** 本期应补(退)税额（主表行提取） */
  tax_amount_due: number | null
}

export const DEFAULT_CORRECTION = '新产生申报表'
export const DEFAULT_VOID_FLAG = '未作废'
export const DEFAULT_FORM_CODE = 'BDA0610606'
export const DEFAULT_FORM_TYPE_LABEL = '《增值税及附加税费申报表（一般纳税人适用）》'

/** 解析「年月日」为 ISO 日期字符串 */
export function cnDateToIso(s: string): string | null {
  const t = s.trim()
  const m = t.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日?$/)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (!Number.isFinite(y) || mo < 1 || mo > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, mo - 1, d))
  if (dt.getUTCMonth() !== mo - 1) return null
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

function cellStr(cell: GridCell | undefined): string {
  if (cell === undefined || cell === null) return ''
  if (typeof cell === 'number')
    return Math.abs(cell) >= 1e15 ? String(BigInt(Math.round(cell))) : String(cell)
  return String(cell).trim()
}

function parseAmountLoose(v: GridCell | undefined): number | null {
  const s = cellStr(v).replace(/,/g, '').replace(/\s/g, '')
  if (!s || s === '——' || s === '—' || s === '-') return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? n : null
}

function extractMainTaxDueRow(row: GridCell[]): number | null {
  const idx = row.findIndex((c) => /本期应补\s*[（(]退[）)]税额/.test(cellStr(c)))
  if (idx < 0) return null
  for (let j = idx + 1; j < row.length; j++) {
    const n = parseAmountLoose(row[j])
    if (n != null) return n
  }
  return null
}

function extractTaxDueFromVATGrid(grid: GridCell[][]): number | null {
  for (const row of grid) {
    const n = extractMainTaxDueRow(row)
    if (n != null) return n
  }
  return null
}

/**
 * 从增值税一般纳税人申报表样式的 sheet 首表网格提取索引字段（与提供的官方 xlsx 版式一致）。
 */
export function extractDeclarationIndexFromGrid(
  grid: GridCell[][],
  sheet: XLSX.WorkSheet,
): DeclarationIndexFlat {
  const formTitle = [cellStr(grid[0]?.[0]), cellStr(grid[1]?.[0])]
    .filter(Boolean)
    .join(' ')
  const form_type_label =
    formTitle.length > 0 ? formTitle : DEFAULT_FORM_TYPE_LABEL

  const addrCredit = XLSX.utils.encode_cell({ r: 4, c: 2 })
  const crCell = sheet[addrCredit] as { w?: string; v?: unknown } | undefined
  let credit_code: string | null = null
  if (crCell?.w && !/E\+/i.test(crCell.w)) {
    credit_code = String(crCell.w).replace(/\s/g, '')
  } else if (typeof crCell?.v === 'string') {
    credit_code = String(crCell.v).replace(/\s/g, '')
  } else if (typeof crCell?.v === 'number') {
    try {
      credit_code = BigInt(Math.round(Number(crCell.v))).toString()
    } catch {
      credit_code = null
    }
  }

  const taxpayer_name = cellStr(grid[6]?.[2]) || null

  const pStartCn = cellStr(grid[7]?.[2])
  const pEndCn = cellStr(grid[7]?.[5])
  const fillCn = cellStr(grid[7]?.[8])

  const tax_period_start = pStartCn ? cnDateToIso(pStartCn) : null
  const tax_period_end = pEndCn ? cnDateToIso(pEndCn) : null
  const declaration_date = fillCn ? cnDateToIso(fillCn) : null

  const tax_amount_due = extractTaxDueFromVATGrid(grid)

  return {
    form_code: DEFAULT_FORM_CODE,
    form_type_label,
    correction_type: DEFAULT_CORRECTION,
    void_flag: DEFAULT_VOID_FLAG,
    taxpayer_name,
    credit_code,
    tax_period_start,
    tax_period_end,
    declaration_date,
    tax_amount_due,
  }
}

/** 将摘要 JSON 与平面列合并为 insert 行 */
export function flattenDeclarationForInsert(
  content: Json,
  flat: DeclarationIndexFlat,
): Record<string, unknown> {
  return {
    content,
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
}
