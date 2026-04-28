import * as XLSX from 'xlsx'
import type { Json } from '../types/database'

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
  /** 合并单元格信息（与原表一致时再导出） */
  merges: XLSX.Range[]
  summary: string
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

function sheetToGrid(sheet: XLSX.WorkSheet): {
  grid: GridCell[][]
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
    return { grid: aoa, merges }
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
  return { grid, merges }
}

/**
 * 将 Excel 首表解析为可逆网格 + 摘要，写入 form_data.content
 */
export function parseExcelFile(buffer: ArrayBuffer, fileName: string): Json {
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true })
  const firstName = workbook.SheetNames[0]
  const sheet = workbook.Sheets[firstName]
  const { grid, merges } = sheetToGrid(sheet)

  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: '',
    raw: false,
  }).filter((r) => Object.keys(r).length > 0)

  const displaySummary =
    rows.length > 0 ? pickDisplaySummary(rows[0]) : '（空表或未识别数据）'

  const payload: ImportedExcelContent = {
    importVersion: 2,
    excel: {
      fileName,
      sheetName: firstName,
      rowCount: rows.length,
      rows,
    },
    grid,
    merges,
    summary: displaySummary,
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
