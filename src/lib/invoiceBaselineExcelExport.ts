import ExcelJS from 'exceljs'
import type { Dayjs } from 'dayjs'
import dayjs from 'dayjs'
import { downloadInvoiceFullExcelBaselineBlob } from './invoiceFullExcelBaseline'

const DEFAULT_EXPORT_FILE_NAME = '全量发票查询导出结果.xlsx'

type DateRange = {
  issueFrom?: Dayjs
  issueTo?: Dayjs
}

type ExportResult = {
  rowCount: number
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

function deleteRowsNotMatching(
  ws: ExcelJS.Worksheet,
  predicate: (row: ExcelJS.Row) => boolean,
): number {
  let kept = 0
  for (let rowNumber = ws.rowCount; rowNumber >= 2; rowNumber -= 1) {
    const row = ws.getRow(rowNumber)
    if (row.hasValues && predicate(row)) {
      kept += 1
      continue
    }
    ws.spliceRows(rowNumber, 1)
  }
  renumberSheet(ws)
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
): Promise<ExportResult> {
  const nos = new Set([...digitalInvoiceNos].map(normalizeDigitalInvoiceNo).filter(Boolean))
  if (nos.size === 0) throw new Error('没有可导出的数电发票号码')

  const { wb } = await loadBaselineWorkbook()
  let totalKept = 0
  for (const ws of wb.worksheets) {
    const noCol = findHeaderColumn(ws, '数电发票号码')
    if (!noCol) throw new Error(`工作表「${ws.name}」缺少「数电发票号码」列`)
    totalKept += deleteRowsNotMatching(ws, (row) =>
      nos.has(normalizeDigitalInvoiceNo(row.getCell(noCol).value)),
    )
  }

  await downloadWorkbook(wb, fileName)
  return { rowCount: totalKept }
}

export async function exportInvoiceFullExcelByIssueDateRange(
  range: DateRange,
  fileName = DEFAULT_EXPORT_FILE_NAME,
): Promise<ExportResult> {
  const from = range.issueFrom?.startOf('day')
  const to = range.issueTo?.endOf('day')
  if (!from && !to) {
    await exportOriginalInvoiceFullExcelBaseline()
    return { rowCount: 0 }
  }

  const { wb } = await loadBaselineWorkbook()
  let totalKept = 0
  for (const ws of wb.worksheets) {
    const issueCol = findHeaderColumn(ws, '开票日期')
    if (!issueCol) throw new Error(`工作表「${ws.name}」缺少「开票日期」列`)
    totalKept += deleteRowsNotMatching(ws, (row) => {
      const issueDate = parseIssueDate(row.getCell(issueCol).value)
      if (!issueDate) return false
      if (from && issueDate.isBefore(from)) return false
      if (to && issueDate.isAfter(to)) return false
      return true
    })
  }

  await downloadWorkbook(wb, fileName)
  return { rowCount: totalKept }
}
