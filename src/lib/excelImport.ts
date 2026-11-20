import * as XLSX from 'xlsx'
import type { Json } from '../types/database'
import {
  extractDeclarationIndexFromGrid,
  repairUnifiedSocialCreditCode,
} from './declarationIndex'

/** 与 xlsx 写入兼容的单元格值 */
export type GridCell = string | number | boolean

export type ImportedExcelContent = {
  importVersion: number
  excel: {
    fileName: string
    sheetName: string
    rowCount: number
    rows: Record<string, unknown>[]
  }
  /** 与模版版式对齐的整块网格，用于回填导出 */
  grid: GridCell[][]
  /** Excel 可见列宽，用于不同列数模板导出时保持右侧字段可见 */
  colWidths?: number[]
  /** 合并单元格信息（与原表一致时再导出） */
  merges: XLSX.Range[]
  /** 预览时顶部无边框信息区占用的行数；不同导出器可能是 3 或 4 */
  previewHeaderRows?: number
  summary: string
  /** 入库索引字段快照（写入 form_data JSON 与各列冗余） */
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
    template_kind?:
      | 'official_split_cells'
      | 'combined_period_in_cell'
      | 'compact_main_table'
      | 'unknown'
  }
}

function pickDisplaySummary(firstRow: Record<string, unknown>): string {
  const keys = ['纳税人名称', '纳税人名称 ', '全称', '税号', '统一社会信用代码']
  const parts: string[] = []
  for (const k of keys) {
    const v = firstRow[k]
    if (v != null && String(v).trim() !== '') {
      parts.push(String(v).trim())
      break
    }
  }
  if (parts.length === 0) {
    const vals = Object.values(firstRow).filter(
      (v) => v != null && String(v).trim() !== '',
    )
    parts.push(vals.slice(0, 2).join(' · ') || '(无摘要)')
  }
  return parts[0]?.slice(0, 120) ?? '(导入数据)'
}

function compactText(text: string): string {
  return text.replace(/\s/g, '')
}

function cellToText(cell: GridCell | undefined): string {
  if (cell === undefined || cell === null) return ''
  return String(cell).trim()
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
      const label = compactText(cellToText(row[c]))
      if (!labelPattern.test(label)) continue

      for (let j = c + 1; j < row.length; j++) {
        if (!cellToText(row[j])) continue
        row[j] = value
        return true
      }
    }
  }
  return false
}

function sheetToGrid(sheet: XLSX.WorkSheet): {
  grid: GridCell[][]
  colWidths: number[]
  merges: XLSX.Range[]
} {
  const merges = sheet['!merges']
    ? (JSON.parse(JSON.stringify(sheet['!merges'])) as XLSX.Range[])
    : []

  if (!sheet['!ref']) {
    const aoa = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: '',
      raw: true,
    }) as GridCell[][]
    return { grid: aoa, colWidths: sheetColumnWidths(sheet, aoa[0]?.length ?? 0), merges }
  }

  const range = XLSX.utils.decode_range(sheet['!ref'])
  const grid: GridCell[][] = []
  for (let r = range.s.r; r <= range.e.r; r++) {
    const row: GridCell[] = []
    for (let c = range.s.c; c <= range.e.c; c++) {
      const addr = XLSX.utils.encode_cell({ r, c })
      const cell = sheet[addr]
      if (!cell) {
        row.push('')
      } else if (cell.t === 'n' && typeof cell.v === 'number') {
        // 优先使用 w，长税号等不变成科学计数法
        row.push(cell.w != null && String(cell.w) !== '' ? String(cell.w) : cell.v)
      } else if (cell.t === 'b') {
        row.push(Boolean(cell.v))
      } else if (cell.w != null) {
        row.push(String(cell.w))
      } else if (cell.v != null && typeof cell.v !== 'object') {
        row.push(cell.v as string | number | boolean)
      } else {
        row.push('')
      }
    }
    grid.push(row)
  }
  // 某些“Excel 兼容 HTML”文件的 !ref 会比实际内容多出一个空列。
  // 只裁掉末尾完全为空且不被合并区域覆盖的列，保留真实表格的空白列。
  let lastUsedColumn = grid.reduce((last, row) => {
    for (let c = row.length - 1; c >= 0; c -= 1) {
      if (cellHasDisplayValue(row[c])) return Math.max(last, c)
    }
    return last
  }, -1)
  for (const merge of merges) lastUsedColumn = Math.max(lastUsedColumn, merge.e.c)
  const trimmedGrid = lastUsedColumn >= 0
    ? grid.map((row) => row.slice(0, lastUsedColumn + 1))
    : grid
  return {
    grid: trimmedGrid,
    colWidths: sheetColumnWidths(sheet, trimmedGrid[0]?.length ?? 0),
    merges,
  }
}

function cellHasDisplayValue(cell: GridCell | undefined): boolean {
  return cell !== undefined && cell !== null && String(cell).trim() !== ''
}

export function detectPreviewHeaderRows(grid: GridCell[][]): number {
  const headerIndex = grid.slice(0, 8).findIndex((row) => {
    const text = row.map((cell) => String(cell ?? '').replace(/\s/g, '')).join(' ')
    return /项目/.test(text) && /栏次/.test(text)
  })
  return headerIndex === 3 ? 3 : Math.min(4, grid.length)
}

function sheetColumnWidths(sheet: XLSX.WorkSheet, colCount: number): number[] {
  const cols = sheet['!cols'] ?? []
  const widths: number[] = []
  for (let i = 0; i < colCount; i++) {
    const col = cols[i]
    const raw =
      typeof col?.wpx === 'number'
        ? col.wpx
        : typeof col?.wch === 'number'
          ? col.wch
          : typeof col?.width === 'number'
            ? col.width
            : 0
    widths.push(Number.isFinite(raw) && raw > 0 && !col?.hidden ? raw : 0)
  }
  return widths.some((w) => w > 0) ? widths : []
}

/**
 * 将 Excel 首表解析为可逆网格 + 摘要，写入 form_data.content
 */
export function parseExcelFile(buffer: ArrayBuffer, fileName: string): Json {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, cellStyles: true })
  const firstName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstName]
  const { grid, colWidths, merges } = sheetToGrid(sheet)

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  }).filter((r) => Object.keys(r).length > 0)

  const displaySummary =
    rows.length > 0 ? pickDisplaySummary(rows[0]) : '（空表或未识别数据）'

  const declaration_index = extractDeclarationIndexFromGrid(grid, sheet)
  const repairedCreditCode = repairUnifiedSocialCreditCode(declaration_index.credit_code)
  if (repairedCreditCode && repairedCreditCode !== declaration_index.credit_code) {
    declaration_index.credit_code = repairedCreditCode
    updateValueRightOfLabel(
      grid,
      /纳税人识别号|统一社会信用代码/,
      repairedCreditCode,
    )
  }

  const payload: ImportedExcelContent = {
    importVersion: 2,
    excel: {
      fileName,
      sheetName: firstName,
      rowCount: rows.length,
      rows,
    },
    grid,
    colWidths,
    merges,
    previewHeaderRows: detectPreviewHeaderRows(grid),
    summary: displaySummary,
    declaration_index,
  }

  return payload as unknown as Json
}

export function isImportedContent(
  content: unknown,
): content is ImportedExcelContent {
  return (
    typeof content === 'object' &&
    content !== null &&
    'importVersion' in content &&
    'grid' in content &&
    Array.isArray((content as ImportedExcelContent).grid)
  )
}
