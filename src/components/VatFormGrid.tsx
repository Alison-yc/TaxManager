import { forwardRef } from 'react'
import type { Range } from 'xlsx'
import type { GridCell } from '../lib/excelImport'

type Props = {
  grid: GridCell[][]
  merges: Range[]
}

const UNBORDERED_HEADER_ROWS = 4

function cellText(v: GridCell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return String(v)
}

function clampMerge(m: Range, maxRow: number, maxCol: number): Range | null {
  const sr = m.s.r
  const sc = m.s.c
  const er = Math.min(m.e.r, maxRow)
  const ec = Math.min(m.e.c, maxCol)
  if (sr < 0 || sc < 0 || sr > maxRow || sc > maxCol) return null
  if (sr > er || sc > ec) return null
  return { s: { r: sr, c: sc }, e: { r: er, c: ec } }
}

function normalizeGrid(grid: GridCell[][]): GridCell[][] {
  let maxCols = 0
  grid.forEach((row) => {
    maxCols = Math.max(maxCols, row.length)
  })
  return grid.map((row) => {
    const arr = [...row]
    while (arr.length < maxCols) arr.push('')
    return arr.slice(0, maxCols)
  })
}

/** 右侧金额、栏次等列右对齐 */
function looksLikeAmount(s: string): boolean {
  const t = s.trim().replace(/,/g, '')
  return /^-?\d+(\.\d+)?$/.test(t)
}

function looksLikeEmptyDash(s: string): boolean {
  return /^[—–-]+$/.test(s.trim())
}

function cellAlignClass(colIndex: number, rowIndex: number, raw: GridCell): string {
  if (rowIndex <= 7) return ''
  if (colIndex === 0) return 'vat-center'
  if (colIndex === 4) return 'vat-center'
  if (typeof raw === 'string' && looksLikeEmptyDash(raw)) return 'vat-center'
  if (typeof raw === 'number' && Number.isFinite(raw)) return 'vat-num'
  if (typeof raw === 'string' && raw && looksLikeAmount(raw)) return 'vat-num'
  return ''
}

function cellContent(raw: GridCell): JSX.Element {
  return <span className="vat-cell-content">{cellText(raw) || '\u00a0'}</span>
}

function rowClassTd(rowIndex: number): string {
  if (rowIndex <= 7) return 'vat-cell-meta'
  if (rowIndex <= 9) return 'vat-cell-head'
  return 'vat-cell-body'
}

function rowText(row: GridCell[] | undefined): string {
  return (row ?? [])
    .map((c) => cellText(c).trim())
    .filter(Boolean)
    .join(' ')
}

/**
 * 使用 Excel merges 合并单元格，版式更接近税局 PDF。
 * ref 落在版心根节点，供导出 PDF 完整截图（勿包在 overflow 滚动容器内）。
 */
export const VatFormGrid = forwardRef<HTMLDivElement, Props>(function VatFormGrid(
  { grid, merges },
  ref,
) {
  if (!grid.length) {
    return (
      <div ref={ref} className="vat-form-document">
        <p className="muted">无表格数据</p>
      </div>
    )
  }

  const normalized = normalizeGrid(grid)
  const headerRows = Math.min(UNBORDERED_HEADER_ROWS, normalized.length)
  const tableGrid = normalized.slice(headerRows)
  const rows = tableGrid.length
  const cols = normalized[0]?.length ?? 0
  const maxRow = rows - 1
  const maxCol = cols - 1

  const covered: boolean[][] = Array.from({ length: rows }, () =>
    Array(cols).fill(false),
  )

  const startMap = new Map<string, Range>()
  for (const m of merges) {
    if (m.s.r < headerRows || m.e.r < headerRows) continue
    const shifted = {
      s: { r: m.s.r - headerRows, c: m.s.c },
      e: { r: m.e.r - headerRows, c: m.e.c },
    }
    const cm = clampMerge(shifted, maxRow, maxCol)
    if (!cm) continue
    const rs = cm.e.r - cm.s.r + 1
    const cs = cm.e.c - cm.s.c + 1
    if (rs < 1 || cs < 1) continue
    startMap.set(`${cm.s.r},${cm.s.c}`, cm)
  }

  const body: JSX.Element[] = []
  for (let r = 0; r < rows; r++) {
    const cells: JSX.Element[] = []
    for (let c = 0; c < cols; c++) {
      if (covered[r][c]) continue

      const rng = startMap.get(`${r},${c}`)
      const raw = tableGrid[r]?.[c] ?? ''
      const originalRowIndex = r + headerRows

      if (rng) {
        const rs = rng.e.r - rng.s.r + 1
        const cs = rng.e.c - rng.s.c + 1
        for (let i = rng.s.r; i <= rng.e.r; i++) {
          for (let j = rng.s.c; j <= rng.e.c; j++) {
            if (i <= maxRow && j <= maxCol) covered[i][j] = true
          }
        }
        cells.push(
          <td
            key={`${r}-${c}`}
            rowSpan={rs}
            colSpan={cs}
            className={`${rowClassTd(originalRowIndex)} ${cellAlignClass(c, originalRowIndex, raw)}`.trim()}
          >
            {cellContent(raw)}
          </td>,
        )
      } else {
        covered[r][c] = true
        cells.push(
          <td
            key={`${r}-${c}`}
            className={`${rowClassTd(originalRowIndex)} ${cellAlignClass(c, originalRowIndex, raw)}`.trim()}
          >
            {cellContent(raw)}
          </td>,
        )
      }
    }

    if (cells.length > 0) {
      body.push(<tr key={r}>{cells}</tr>)
    }
  }

  const colgroupCount = cols
  const colsEls =
    colgroupCount > 0 ? (
      <colgroup>
        {Array.from({ length: colgroupCount }).map((_, i) => (
          <col key={i} className={`vat-dyn-col col-i-${i}`} />
        ))}
      </colgroup>
    ) : null

  return (
    <div ref={ref} className="vat-form-document">
      <div className="vat-form-head">
        <div className="vat-form-title">{rowText(normalized[0])}</div>
        <div className="vat-form-subtitle">{rowText(normalized[1])}</div>
        <div className="vat-form-note">{rowText(normalized[2])}</div>
        <div className="vat-form-unit">{rowText(normalized[3])}</div>
      </div>
      <table className="vat-sheet-table vat-sheet-merged">
        {colsEls}
        <tbody>{body}</tbody>
      </table>
    </div>
  )
})
