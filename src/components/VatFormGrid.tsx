import { forwardRef, useCallback, useEffect, useState, type CSSProperties } from 'react'
import type { Range } from 'xlsx'
import type { GridCell } from '../lib/excelImport'

type Props = {
  grid: GridCell[][]
  merges: Range[]
  colWidths?: number[]
}

const UNBORDERED_HEADER_ROWS = 4
const TEN_COL_PREVIEW_WIDTHS = [7, 12.1, 12.1, 9.9, 5.5, 8.3, 11.05, 11.05, 11.05, 12]
const FOURTEEN_COL_TEMPLATE_WIDTHS = [50, 63, 32, 44, 56, 85, 108, 53, 50, 47, 70, 37, 30, 50]

function browserInflatesSmallFonts(): boolean {
  if (typeof document === 'undefined') return false

  const probe = document.createElement('div')
  probe.style.cssText = [
    'position:absolute',
    'left:-9999px',
    'top:-9999px',
    'visibility:hidden',
    'white-space:nowrap',
    'font-family:Arial,sans-serif',
  ].join(';')

  const small = document.createElement('span')
  const large = document.createElement('span')
  small.style.fontSize = '10px'
  large.style.fontSize = '20px'
  small.textContent = 'mmmmmmmmmm'
  large.textContent = small.textContent
  probe.append(small, large)
  document.body.appendChild(probe)

  const smallWidth = small.getBoundingClientRect().width
  const largeWidth = large.getBoundingClientRect().width
  document.body.removeChild(probe)

  if (smallWidth <= 0 || largeWidth <= 0) return false
  return smallWidth / largeWidth > 0.57
}

function cellText(v: GridCell): string {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  return String(v)
}

function normalizeNumericText(v: GridCell): string | null {
  const text = cellText(v).trim().replace(/,/g, '')
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null
  const n = Number(text)
  return Number.isFinite(n) ? n.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }) : null
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

function amountColumnIndexes(cols: number): Set<number> {
  if (cols === 10) return new Set([6, 7, 8, 9])
  if (cols === 14) return new Set([6, 7, 8, 9, 10, 11, 12, 13])
  return new Set()
}

function isAmountCell(colIndex: number, rowIndex: number, cols: number, raw: GridCell): boolean {
  if (rowIndex <= 9) return false
  if (!amountColumnIndexes(cols).has(colIndex)) return false
  return normalizeNumericText(raw) !== null
}

function cellAlignClass(colIndex: number, rowIndex: number, raw: GridCell, cols: number): string {
  if (rowIndex <= 7) return ''
  if (colIndex === 0) return 'vat-center'
  if (colIndex === 4) return 'vat-center'
  if (typeof raw === 'string' && looksLikeEmptyDash(raw)) return 'vat-center'
  if (isAmountCell(colIndex, rowIndex, cols, raw)) return 'vat-num'
  if (typeof raw === 'number' && Number.isFinite(raw)) return 'vat-num'
  if (typeof raw === 'string' && raw && looksLikeAmount(raw)) return 'vat-num'
  return ''
}

function cellContent(raw: GridCell, colIndex: number, rowIndex: number, cols: number): JSX.Element {
  const text = isAmountCell(colIndex, rowIndex, cols, raw)
    ? normalizeNumericText(raw)
    : cellText(raw)
  return <span className="vat-cell-content">{text || '\u00a0'}</span>
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

function textWeight(cell: GridCell): number {
  const text = cellText(cell).trim()
  if (!text) return 0
  if (looksLikeAmount(text)) return Math.min(16, Math.max(8, text.length))
  return Math.min(24, Math.max(4, text.length * 1.1))
}

function estimatedColumnWeights(grid: GridCell[][], cols: number): number[] {
  const weights = Array(cols).fill(6) as number[]
  for (const row of grid) {
    for (let c = 0; c < cols; c++) {
      weights[c] = Math.max(weights[c], textWeight(row[c] ?? ''))
    }
  }
  return weights
}

function columnPercentages(grid: GridCell[][], cols: number, colWidths?: number[]): number[] {
  const explicit = colWidths?.slice(0, cols) ?? []
  const hasExplicit = explicit.length === cols && explicit.some((w) => w > 0)
  const baseWeights = hasExplicit
    ? explicit.map((w) => (Number.isFinite(w) && w > 0 ? w : 6))
    : cols === 10
      ? TEN_COL_PREVIEW_WIDTHS
      : cols === 14
        ? FOURTEEN_COL_TEMPLATE_WIDTHS
        : estimatedColumnWeights(grid, cols)
  const weights = widenAmountColumns(baseWeights, cols)

  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total <= 0) return Array(cols).fill(100 / Math.max(1, cols))
  return weights.map((w) => (w / total) * 100)
}

function widenAmountColumns(weights: number[], cols: number): number[] {
  const amountCols = amountColumnIndexes(cols)
  if (amountCols.size === 0) return weights

  const amountBoost = cols === 10 ? 1.075 : 1.055
  const widened = weights.map((w, i) => (amountCols.has(i) ? w * amountBoost : w))
  const originalTotal = weights.reduce((sum, w) => sum + w, 0)
  const widenedTotal = widened.reduce((sum, w) => sum + w, 0)
  const extra = widenedTotal - originalTotal
  const shrinkableTotal = weights.reduce((sum, w, i) => (amountCols.has(i) ? sum : sum + w), 0)

  if (extra <= 0 || shrinkableTotal <= 0) return widened

  return widened.map((w, i) => {
    if (amountCols.has(i)) return w
    const reduced = w - (extra * weights[i]) / shrinkableTotal
    return Math.max(reduced, w * 0.82)
  })
}

/**
 * 使用 Excel merges 合并单元格，版式更接近税局 PDF。
 * ref 落在版心根节点，供导出 PDF 完整截图（勿包在 overflow 滚动容器内）。
 */
export const VatFormGrid = forwardRef<HTMLDivElement, Props>(function VatFormGrid(
  { grid, merges, colWidths },
  ref,
) {
  const [shouldCompensateFontInflation, setShouldCompensateFontInflation] = useState(false)
  const setDocumentRef = useCallback(
    (node: HTMLDivElement | null) => {
      if (typeof ref === 'function') {
        ref(node)
      } else if (ref) {
        ref.current = node
      }
    },
    [ref],
  )

  useEffect(() => {
    setShouldCompensateFontInflation(browserInflatesSmallFonts())
  }, [])

  if (!grid.length) {
    return (
      <div ref={setDocumentRef} className="vat-form-document">
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
  const colPercents = columnPercentages(normalized, cols, colWidths)

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
            className={`${rowClassTd(originalRowIndex)} ${cellAlignClass(c, originalRowIndex, raw, cols)}`.trim()}
          >
            {cellContent(raw, c, originalRowIndex, cols)}
          </td>,
        )
      } else {
        covered[r][c] = true
        cells.push(
          <td
            key={`${r}-${c}`}
            className={`${rowClassTd(originalRowIndex)} ${cellAlignClass(c, originalRowIndex, raw, cols)}`.trim()}
          >
            {cellContent(raw, c, originalRowIndex, cols)}
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
          <col
            key={i}
            className={`vat-dyn-col col-i-${i}`}
            style={{ width: `${colPercents[i] ?? 100 / colgroupCount}%` } as CSSProperties}
          />
        ))}
      </colgroup>
    ) : null

  return (
    <div
      ref={setDocumentRef}
      className={`vat-form-document${shouldCompensateFontInflation ? ' vat-form-document--font-compensated' : ''}`}
    >
      <div className="vat-form-render">
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
    </div>
  )
})
