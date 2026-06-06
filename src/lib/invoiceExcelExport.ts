import ExcelJS from 'exceljs'
import type { InvoiceLineItem, InvoiceRecordRow } from '../types/database'

const TEMPLATE_URL = `${import.meta.env.BASE_URL}assets/templates/invoice-export-template.xlsx`

const SUMMARY_HEADERS = [
  '序号',
  '发票代码',
  '发票号码',
  '数电发票号码',
  '销方识别号',
  '销方名称',
  '购方识别号',
  '购买方名称',
  '开票日期',
  '税收分类编码',
  '特定业务类型',
  '货物或应税劳务名称',
  '规格型号',
  '单位',
  '数量',
  '单价',
  '金额',
  '税率',
  '税额',
  '价税合计',
  '发票来源',
  '发票票种',
  '发票状态',
  '是否正数发票',
  '发票风险等级',
  '开票人',
  '备注',
]

const BASE_HEADERS = [
  '序号',
  '发票代码',
  '发票号码',
  '数电发票号码',
  '销方识别号',
  '销方名称',
  '购方识别号',
  '购买方名称',
  '开票日期',
  '金额',
  '税额',
  '价税合计',
  '发票来源',
  '发票票种',
  '发票状态',
  '是否正数发票',
  '发票风险等级',
  '开票人',
  '备注',
]

function fmtDate(v?: string | null): string {
  if (!v) return ''
  return v.slice(0, 10)
}

function cloneStyle(style: Partial<ExcelJS.Style> | undefined): Partial<ExcelJS.Style> | undefined {
  if (!style) return undefined
  return JSON.parse(JSON.stringify(style)) as Partial<ExcelJS.Style>
}

function lineItemsOf(row: InvoiceRecordRow): InvoiceLineItem[] {
  const content = row.content
  if (content && typeof content === 'object' && 'line_items' in content) {
    const items = (content as { line_items?: InvoiceLineItem[] }).line_items
    if (Array.isArray(items) && items.length > 0) return items
  }
  return [
    {
      item_name: '—',
      amount: row.amount ?? null,
      tax_amount: row.tax_amount ?? null,
      total_amount: row.total_amount ?? null,
      business_type: row.business_type ?? null,
      remark: row.remark ?? null,
    },
  ]
}

function cacheRowStyles(row: ExcelJS.Row): Partial<ExcelJS.Style>[] {
  const styles: Partial<ExcelJS.Style>[] = []
  row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    styles[colNumber] = cloneStyle(cell.style) ?? {}
  })
  return styles
}

function writeStyledRow(
  ws: ExcelJS.Worksheet,
  rowNumber: number,
  values: unknown[],
  styles: Partial<ExcelJS.Style>[],
  rowHeight?: number,
): void {
  const row = ws.getRow(rowNumber)
  values.forEach((value, index) => {
    const cell = row.getCell(index + 1)
    if (value === '' || value === null || value === undefined) {
      cell.value = null
    } else {
      cell.value = value as ExcelJS.CellValue
    }
    const style = styles[index + 1]
    if (style) cell.style = cloneStyle(style) ?? {}
  })
  if (rowHeight) row.height = rowHeight
  row.commit()
}

/** ExcelJS 批量 spliceRows(2, n) 不会真正删行，需从底部逐行删除模板示例数据 */
function clearTemplateDataRows(ws: ExcelJS.Worksheet): void {
  while (ws.rowCount > 1) {
    ws.spliceRows(ws.rowCount, 1)
  }
}

function fillDataSheet(
  ws: ExcelJS.Worksheet,
  dataRows: unknown[][],
  expectedHeaders: string[],
): void {
  const headerRow = ws.getRow(1)
  const headerTexts: string[] = []
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    headerTexts[colNumber] = String(cell.value ?? '')
  })
  if (headerTexts.filter(Boolean).join('|') !== expectedHeaders.join('|')) {
    throw new Error(`模板表「${ws.name}」表头与预期不一致，请更新 invoice-export-template.xlsx`)
  }

  const styleSourceRow = ws.rowCount >= 2 ? ws.getRow(2) : headerRow
  const styles = cacheRowStyles(styleSourceRow)
  const rowHeight = styleSourceRow.height

  clearTemplateDataRows(ws)

  dataRows.forEach((values, index) => {
    writeStyledRow(ws, index + 2, values, styles, rowHeight)
  })
}

function buildBaseRows(rows: InvoiceRecordRow[]): unknown[][] {
  return rows.map((row, index) => [
    index + 1,
    row.invoice_code ?? '',
    row.invoice_number ?? '',
    row.digital_invoice_no,
    row.seller_tax_id ?? '',
    row.seller_name ?? '',
    row.buyer_tax_id ?? '',
    row.buyer_name ?? '',
    fmtDate(row.issue_date),
    row.amount ?? '',
    row.tax_amount ?? '',
    row.total_amount ?? '',
    row.invoice_source ?? '',
    row.invoice_type ?? '',
    row.invoice_status ?? '',
    row.is_positive ?? '',
    row.risk_level ?? '',
    row.issuer ?? '',
    row.remark ?? '',
  ])
}

function buildSummaryRows(rows: InvoiceRecordRow[]): unknown[][] {
  const summaryRows: unknown[][] = []
  let serial = 1
  for (const row of rows) {
    for (const item of lineItemsOf(row)) {
      summaryRows.push([
        serial++,
        row.invoice_code ?? '',
        row.invoice_number ?? '',
        row.digital_invoice_no,
        row.seller_tax_id ?? '',
        row.seller_name ?? '',
        row.buyer_tax_id ?? '',
        row.buyer_name ?? '',
        fmtDate(row.issue_date),
        item.tax_class_code ?? '',
        item.business_type ?? row.business_type ?? '',
        item.item_name ?? '',
        item.spec ?? '',
        item.unit ?? '',
        item.quantity ?? '',
        item.unit_price ?? '',
        item.amount ?? row.amount ?? '',
        item.tax_rate ?? '',
        item.tax_amount ?? row.tax_amount ?? '',
        item.total_amount ?? row.total_amount ?? '',
        row.invoice_source ?? '',
        row.invoice_type ?? '',
        row.invoice_status ?? '',
        row.is_positive ?? '',
        row.risk_level ?? '',
        row.issuer ?? '',
        item.remark ?? row.remark ?? '',
      ])
    }
  }
  return summaryRows
}

/** 基于官方样式模板导出全量发票 Excel（保留字号、列宽、边框等样式） */
export async function exportInvoicesToExcel(
  rows: InvoiceRecordRow[],
  fileName: string,
): Promise<void> {
  const resp = await fetch(TEMPLATE_URL)
  if (!resp.ok) {
    throw new Error('无法加载发票导出模板，请确认 public/assets/templates/invoice-export-template.xlsx 存在')
  }

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(await resp.arrayBuffer())

  const baseSheet = wb.getWorksheet('发票基础信息')
  const summarySheet = wb.getWorksheet('信息汇总表')
  if (!baseSheet || !summarySheet) {
    throw new Error('模板缺少「发票基础信息」或「信息汇总表」工作表')
  }

  fillDataSheet(baseSheet, buildBaseRows(rows), BASE_HEADERS)
  fillDataSheet(summarySheet, buildSummaryRows(rows), SUMMARY_HEADERS)

  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName.replace(/[/\\?%*:|"<>]/g, '-')
  a.click()
  URL.revokeObjectURL(url)
}
