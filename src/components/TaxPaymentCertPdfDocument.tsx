import type { TaxPaymentCertRecordRow } from '../types/database'
import {
  certHeaderFromRows,
  fmtCertDate,
  fmtCertIssueDate,
  fmtCertMoney,
  fmtCertPeriod,
  sumCertAmount,
} from '../lib/taxPaymentCertFormat'

type TaxPaymentCertPdfDocumentProps = {
  rows: TaxPaymentCertRecordRow[]
}

/** 表格式税收完税证明 PDF 排版（用于预览截图与导出） */
export function TaxPaymentCertPdfDocument({ rows }: TaxPaymentCertPdfDocumentProps) {
  if (rows.length === 0) return null

  const header = certHeaderFromRows(rows)
  const total = sumCertAmount(rows)

  return (
    <div className="tax-payment-cert-pdf-layout">
      <div className="tax-payment-cert-pdf-title-block">
        <div className="tax-payment-cert-pdf-country">中华人民共和国</div>
        <div className="tax-payment-cert-pdf-title">税收完税证明</div>
      </div>

      <div className="tax-payment-cert-pdf-meta">
        <span>No● {header.certificate_no || '—'}</span>
      </div>

      <div className="tax-payment-cert-pdf-meta tax-payment-cert-pdf-meta--row">
        <span>填发日期：{fmtCertIssueDate(header.issue_date) || '—'}</span>
        <span>税务机关：{header.tax_authority || '—'}</span>
      </div>

      <div className="tax-payment-cert-pdf-meta tax-payment-cert-pdf-meta--row">
        <span>纳税人识别号 {header.taxpayer_tax_id || '—'}</span>
        <span>纳税人名称 {header.taxpayer_name || '—'}</span>
      </div>

      <table className="tax-payment-cert-pdf-table">
        <thead>
          <tr>
            <th>原凭证号</th>
            <th>税种</th>
            <th>品目名称</th>
            <th>税款所属时期</th>
            <th>入（退）库日期</th>
            <th>实缴（退）金额</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td>{row.original_voucher_no || '—'}</td>
              <td>{row.tax_type || '—'}</td>
              <td>{row.item_name || '—'}</td>
              <td>{fmtCertPeriod(row.tax_period_start, row.tax_period_end) || '—'}</td>
              <td>{fmtCertDate(row.payment_date) || '—'}</td>
              <td className="tax-payment-cert-pdf-num">{fmtCertMoney(row.actual_amount) || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="tax-payment-cert-pdf-total">
        <span>金额合计</span>
        <span className="tax-payment-cert-pdf-total-num">¥ {fmtCertMoney(total)}</span>
      </div>

      {header.remark ? (
        <div className="tax-payment-cert-pdf-remark">备注：{header.remark}</div>
      ) : null}

      <div className="tax-payment-cert-pdf-footer">
        <span>填票人</span>
        <span>电子税务局</span>
      </div>
    </div>
  )
}
