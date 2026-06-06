import type { TaxPaymentCertRecordRow } from '../types/database'

export function fmtCertMoney(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return ''
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export function fmtCertDate(v?: string | null): string {
  if (!v) return ''
  return v.slice(0, 10)
}

export function fmtCertIssueDate(v?: string | null): string {
  if (!v) return ''
  const m = v.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (!m) return v
  return `${Number(m[1])} 年 ${Number(m[2])} 月 ${Number(m[3])} 日`
}

export function fmtCertPeriod(start?: string | null, end?: string | null): string {
  const s = fmtCertDate(start)
  const e = fmtCertDate(end)
  if (s && e) return `${s} 至 ${e}`
  return s || e || ''
}

export function sumCertAmount(rows: TaxPaymentCertRecordRow[]): number {
  return rows.reduce((sum, row) => sum + (row.actual_amount ?? 0), 0)
}

export function certHeaderFromRows(rows: TaxPaymentCertRecordRow[]): TaxPaymentCertRecordRow {
  return rows[0]
}

export function defaultCertExportFileName(): string {
  const stamp = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  const name = `税收完税证明${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())} ${pad(stamp.getHours())}:${pad(stamp.getMinutes())}:${pad(stamp.getSeconds())}.pdf`
  return name.replace(/:/g, '：')
}
