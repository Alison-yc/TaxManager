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
  /** 导入时识别的 Excel 版式（仅存 content JSON，不入库列） */
  template_kind?: DeclarationTemplateKind
}

export const DEFAULT_CORRECTION = '新产生申报表'
export const DEFAULT_VOID_FLAG = '未作废'
export const DEFAULT_FORM_CODE = 'BDA0610606'
export const DEFAULT_FORM_TYPE_LABEL = '《增值税及附加税费申报表（一般纳税人适用）》'

/** 官方「税款所属期起/止」分列 vs 镁神等「税款所属时间…至…」合一格 */
export type DeclarationTemplateKind =
  | 'official_split_cells'
  | 'combined_period_in_cell'

function cnDateToIso(s: string): string | null {
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

function isoFromYmdParts(y: string, mo: string, d: string): string | null {
  return cnDateToIso(`${y}年${Number(mo)}月${Number(d)}日`)
}

function cellStr(cell: GridCell | undefined): string {
  if (cell === undefined || cell === null) return ''
  if (typeof cell === 'number')
    return Math.abs(cell) >= 1e15 ? String(BigInt(Math.round(cell))) : String(cell)
  return String(cell).trim()
}

/**
 * 从「税款所属时间：2023年12月01日 至 2023年12月31日」同格文本解析起止日
 */
function parseCombinedTaxPeriod(text: string): {
  start: string | null
  end: string | null
} {
  const compact = text.replace(/\s/g, '')
  const m = compact.match(
    /税款所属时间[:：]?(\d{4})年(\d{1,2})月(\d{1,2})日[至到](\d{4})年(\d{1,2})月(\d{1,2})日/,
  )
  if (!m) return { start: null, end: null }
  return {
    start: isoFromYmdParts(m[1], m[2], m[3]),
    end: isoFromYmdParts(m[4], m[5], m[6]),
  }
}

/** 从含「填表日期：2024年01月10日」的单元格取申报日 */
function parseFillDateFromCell(text: string): string | null {
  const compact = text.replace(/\s/g, '')
  const m = compact.match(/填表日期[:：](\d{4})年(\d{1,2})月(\d{1,2})日/)
  if (!m) return null
  return isoFromYmdParts(m[1], m[2], m[3])
}

function parseFillDateFromScan(grid: GridCell[][]): string | null {
  for (let r = 0; r < Math.min(14, grid.length); r++) {
    for (const cell of grid[r] ?? []) {
      const s = cellStr(cell)
      if (/填表日期/.test(s)) {
        const d = parseFillDateFromCell(s)
        if (d) return d
      }
    }
  }
  return null
}

function combinedPeriodTextsFromGrid(grid: GridCell[][]): {
  periodCell: string
  fillCell: string
} {
  let periodCell = ''
  let fillCell = ''
  for (let r = 0; r < Math.min(16, grid.length); r++) {
    const row = grid[r] ?? []
    for (const cell of row) {
      const s = cellStr(cell)
      if (
        /税款所属时间/.test(s) &&
        (/至/.test(s) || /到/.test(s)) &&
        /\d{4}年/.test(s)
      ) {
        periodCell = s
      }
      if (/填表日期/.test(s) && /\d{4}年/.test(s)) {
        fillCell = s
      }
    }
  }
  return { periodCell, fillCell }
}

/** 在表头前几行查找 15～20 位统一社会信用代码 */
function findCreditCodeLoose(grid: GridCell[][]): string | null {
  for (let r = 0; r < Math.min(14, grid.length); r++) {
    const row = grid[r] ?? []
    for (const cell of row) {
      const raw = cellStr(cell).replace(/\s/g, '')
      if (/^\d{15,20}$/.test(raw)) return raw
    }
    const joined = row.map((c) => cellStr(c)).join(' ')
    const m = joined.match(/\b(\d{18})\b/)
    if (m) return m[1]
  }
  return null
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

function readCreditOfficialCell(
  sheet: XLSX.WorkSheet,
): string | null {
  const addrCredit = XLSX.utils.encode_cell({ r: 4, c: 2 })
  const crCell = sheet[addrCredit] as { w?: string; v?: unknown } | undefined
  if (crCell?.w && !/E\+/i.test(crCell.w)) {
    return String(crCell.w).replace(/\s/g, '')
  }
  if (typeof crCell?.v === 'string') {
    return String(crCell.v).replace(/\s/g, '')
  }
  if (typeof crCell?.v === 'number') {
    try {
      return BigInt(Math.round(Number(crCell.v))).toString()
    } catch {
      return null
    }
  }
  return null
}

/**
 * 支持两种版式：
 * - 官方模版：税款所属期起/止、填表日期分列（原逻辑）；
 * - 镁神等：同一格「税款所属时间…至…」、另一格「填表日期…」。
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

  const tax_amount_due = extractTaxDueFromVATGrid(grid)

  const { periodCell, fillCell } = combinedPeriodTextsFromGrid(grid)
  const parsedCombined = periodCell ? parseCombinedTaxPeriod(periodCell) : { start: null, end: null }
  const useCombined =
    Boolean(periodCell) &&
    (parsedCombined.start != null || parsedCombined.end != null)

  const taxpayerName = cellStr(grid[6]?.[2]) || null

  let tax_period_start: string | null
  let tax_period_end: string | null
  let declaration_date: string | null
  let credit_code: string | null
  let template_kind: DeclarationTemplateKind

  if (useCombined) {
    template_kind = 'combined_period_in_cell'
    tax_period_start = parsedCombined.start
    tax_period_end = parsedCombined.end
    declaration_date =
      (fillCell ? parseFillDateFromCell(fillCell) : null) ??
      parseFillDateFromScan(grid)
    credit_code = findCreditCodeLoose(grid)
  } else {
    template_kind = 'official_split_cells'
    credit_code = readCreditOfficialCell(sheet)
    if (!credit_code) credit_code = findCreditCodeLoose(grid)

    const pStartCn = cellStr(grid[7]?.[2])
    const pEndCn = cellStr(grid[7]?.[5])
    const fillCn = cellStr(grid[7]?.[8])
    tax_period_start = pStartCn ? cnDateToIso(pStartCn) : null
    tax_period_end = pEndCn ? cnDateToIso(pEndCn) : null
    declaration_date = fillCn ? cnDateToIso(fillCn) : null
  }

  if (!credit_code) credit_code = findCreditCodeLoose(grid)

  return {
    form_code: DEFAULT_FORM_CODE,
    form_type_label,
    correction_type: DEFAULT_CORRECTION,
    void_flag: DEFAULT_VOID_FLAG,
    taxpayer_name: taxpayerName,
    credit_code,
    tax_period_start,
    tax_period_end,
    declaration_date,
    tax_amount_due,
    template_kind,
  }
}

/** 将摘要 JSON 与平面列合并为 insert 行 */
export function flattenDeclarationForInsert(
  content: Json,
  flat: DeclarationIndexFlat,
): Record<string, unknown> {
  const { template_kind: _tk, ...cols } = flat
  void _tk
  return {
    content,
    form_code: cols.form_code,
    form_type_label: cols.form_type_label,
    correction_type: cols.correction_type,
    void_flag: cols.void_flag,
    taxpayer_name: cols.taxpayer_name,
    credit_code: cols.credit_code,
    tax_period_start: cols.tax_period_start,
    tax_period_end: cols.tax_period_end,
    declaration_date: cols.declaration_date,
    tax_amount_due: cols.tax_amount_due,
  }
}
