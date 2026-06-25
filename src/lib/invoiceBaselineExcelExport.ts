import ExcelJS from 'exceljs'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { downloadInvoiceFullExcelBaselineBlob } from './invoiceFullExcelBaseline'
import { yieldToMain } from './yieldToMain'

const FILTER_YIELD_EVERY = 400

const DEFAULT_EXPORT_FILE_NAME = '全量发票查询导出结果.xlsx'

type DateRange = {
  issueFrom?: Dayjs
  issueTo?: Dayjs
}

type ExportResult = {
  rowCount: number
}

export type InvoiceExcelExportProgress = {
  phase: 'loading' | 'filtering' | 'writing'
  sheetName?: string
  sheetIndex?: number
  sheetCount?: number
  processed?: number
  total?: number
}

type ExportOptions = {
  onProgress?: (progress: InvoiceExcelExportProgress) => void
}

function safeFileName(fileName: string): string {
  return fileName.replace(/[/\\?%*:|"<>]/g, '-')
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = safeFileName(fileName)
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

async function downloadWorkbook(wb: ExcelJS.Workbook, fileName: string): Promise<void> {
  const buffer = await wb.xlsx.writeBuffer()
  downloadBlob(
    new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    }),
    fileName,
  )
}

function headerText(value: ExcelJS.CellValue): string {
  return cellToString(value).replace(/\s+/g, '')
}

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return ''
  if (value instanceof Date) return dayjs(value).format('YYYY-MM-DD HH:mm:ss')
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text
    if ('result' in value) return cellToString(value.result as ExcelJS.CellValue)
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('')
    }
    if ('hyperlink' in value && 'text' in value && typeof value.text === 'string') {
      return value.text
    }
  }
  return String(value)
}

function normalizeDigitalInvoiceNo(value: ExcelJS.CellValue | string | null | undefined): string {
  return cellToString(value as ExcelJS.CellValue).replace(/\D/g, '')
}

function findHeaderColumn(ws: ExcelJS.Worksheet, name: string): number | null {
  const expected = name.replace(/\s+/g, '')
  let col: number | null = null
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (headerText(cell.value) === expected) col = colNumber
  })
  return col
}

function parseIssueDate(value: ExcelJS.CellValue): Dayjs | null {
  if (value instanceof Date) return dayjs(value)
  if (typeof value === 'number') {
    // Excel serial date: 25569 days between 1899-12-30 and 1970-01-01.
    return dayjs(new Date(Math.round((value - 25569) * 86400 * 1000)))
  }
  const text = cellToString(value).trim()
  if (!text) return null
  const parsed = dayjs(text)
  return parsed.isValid() ? parsed : null
}

function renumberSheet(ws: ExcelJS.Worksheet): void {
  const serialCol = findHeaderColumn(ws, '序号')
  if (!serialCol) return
  let serial = 1
  for (let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber += 1) {
    const row = ws.getRow(rowNumber)
    if (!row.hasValues) continue
    row.getCell(serialCol).value = serial
    serial += 1
  }
}

/** 从底部逐行删除不匹配数据；分段让出主线程，避免大数据量导出时页面卡死 */
async function filterWorksheetRows(
  ws: ExcelJS.Worksheet,
  predicate: (row: ExcelJS.Row) => boolean,
  onProgress?: (processed: number, total: number) => void,
): Promise<number> {
  const dataRowCount = Math.max(ws.rowCount - 1, 0)
  if (dataRowCount === 0) return 0

  const rowsToDelete: number[] = []
  let kept = 0
  let processed = 0

  for (let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber += 1) {
    const row = ws.getRow(rowNumber)
    if (row.hasValues && predicate(row)) {
      kept += 1
    } else {
      rowsToDelete.push(rowNumber)
    }
    processed += 1
    if (processed % FILTER_YIELD_EVERY === 0) {
      onProgress?.(processed, dataRowCount)
      await yieldToMain()
    }
  }

  if (rowsToDelete.length === 0) {
    onProgress?.(dataRowCount, dataRowCount)
    return kept
  }

  for (let index = rowsToDelete.length - 1; index >= 0; index -= 1) {
    ws.spliceRows(rowsToDelete[index], 1)
    const deleted = rowsToDelete.length - index
    if (deleted % FILTER_YIELD_EVERY === 0) {
      onProgress?.(dataRowCount, dataRowCount)
      await yieldToMain()
    }
  }

  renumberSheet(ws)
  onProgress?.(dataRowCount, dataRowCount)
  return kept
}

async function loadBaselineWorkbook(): Promise<{
  wb: ExcelJS.Workbook
  sourceFileName: string
}> {
  const { blob, baseline } = await downloadInvoiceFullExcelBaselineBlob()
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await blob.arrayBuffer())
  return { wb, sourceFileName: baseline.source_file_name || DEFAULT_EXPORT_FILE_NAME }
}

export async function exportOriginalInvoiceFullExcelBaseline(): Promise<void> {
  const { blob, baseline } = await downloadInvoiceFullExcelBaselineBlob()
  downloadBlob(blob, baseline.source_file_name || DEFAULT_EXPORT_FILE_NAME)
}

export async function exportInvoiceFullExcelByDigitalNos(
  digitalInvoiceNos: Iterable<string>,
  fileName = DEFAULT_EXPORT_FILE_NAME,
  options?: ExportOptions,
): Promise<ExportResult> {
  const nos = new Set<string>()
  for (const raw of digitalInvoiceNos) {
    const no = normalizeDigitalInvoiceNo(raw)
    if (no) nos.add(no)
  }
  if (nos.size === 0) throw new Error('没有可导出的数电发票号码')

  options?.onProgress?.({ phase: 'loading' })
  await yieldToMain()
  const { wb } = await loadBaselineWorkbook()
  const worksheets = wb.worksheets
  let totalKept = 0

  for (let sheetIndex = 0; sheetIndex < worksheets.length; sheetIndex += 1) {
    const ws = worksheets[sheetIndex]
    const noCol = findHeaderColumn(ws, '数电发票号码')
    if (!noCol) throw new Error(`工作表「${ws.name}」缺少「数电发票号码」列`)

    options?.onProgress?.({
      phase: 'filtering',
      sheetName: ws.name,
      sheetIndex: sheetIndex + 1,
      sheetCount: worksheets.length,
      processed: 0,
      total: Math.max(ws.rowCount - 1, 0),
    })

    totalKept += await filterWorksheetRows(
      ws,
      (row) => nos.has(normalizeDigitalInvoiceNo(row.getCell(noCol).value)),
      (processed, total) => {
        options?.onProgress?.({
          phase: 'filtering',
          sheetName: ws.name,
          sheetIndex: sheetIndex + 1,
          sheetCount: worksheets.length,
          processed,
          total,
        })
      },
    )
    await yieldToMain()
  }

  options?.onProgress?.({ phase: 'writing' })
  await yieldToMain()
  await downloadWorkbook(wb, fileName)
  return { rowCount: totalKept }
}

export async function exportInvoiceFullExcelByIssueDateRange(
  range: DateRange,
  fileName = DEFAULT_EXPORT_FILE_NAME,
  options?: ExportOptions,
): Promise<ExportResult> {
  const from = range.issueFrom?.startOf('day')
  const to = range.issueTo?.endOf('day')
  if (!from && !to) {
    await exportOriginalInvoiceFullExcelBaseline()
    return { rowCount: 0 }
  }

  options?.onProgress?.({ phase: 'loading' })
  await yieldToMain()
  const { wb } = await loadBaselineWorkbook()
  const worksheets = wb.worksheets
  let totalKept = 0

  for (let sheetIndex = 0; sheetIndex < worksheets.length; sheetIndex += 1) {
    const ws = worksheets[sheetIndex]
    const issueCol = findHeaderColumn(ws, '开票日期')
    if (!issueCol) throw new Error(`工作表「${ws.name}」缺少「开票日期」列`)

    options?.onProgress?.({
      phase: 'filtering',
      sheetName: ws.name,
      sheetIndex: sheetIndex + 1,
      sheetCount: worksheets.length,
      processed: 0,
      total: Math.max(ws.rowCount - 1, 0),
    })

    totalKept += await filterWorksheetRows(
      ws,
      (row) => {
        const issueDate = parseIssueDate(row.getCell(issueCol).value)
        if (!issueDate) return false
        if (from && issueDate.isBefore(from)) return false
        if (to && issueDate.isAfter(to)) return false
        return true
      },
      (processed, total) => {
        options?.onProgress?.({
          phase: 'filtering',
          sheetName: ws.name,
          sheetIndex: sheetIndex + 1,
          sheetCount: worksheets.length,
          processed,
          total,
        })
      },
    )
    await yieldToMain()
  }

  options?.onProgress?.({ phase: 'writing' })
  await yieldToMain()
  await downloadWorkbook(wb, fileName)
  return { rowCount: totalKept }
}
