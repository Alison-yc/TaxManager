import { downloadPdfBlob as fetchPdfFromStorage, IMPORTED_DOCS_BUCKET } from './pdfStorage'
import { downloadPdfBlob as savePdfToDisk } from './excelExport'
import { defaultCertExportFileName } from './taxPaymentCertFormat'
import { supabase } from './supabase'
import type { TaxPaymentCertRecordRow } from '../types/database'

function todayIsoDate(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export type TaxPaymentCertExportResult = {
  issueDate: string
  fileName: string
}

/**
 * 导出完税证明：将填发日期更新为当天，写回 Storage，同步数据库，并触发浏览器下载。
 * 下次预览将显示上次导出时的填发日期。
 */
export async function exportAndPersistTaxPaymentCert(
  row: TaxPaymentCertRecordRow,
): Promise<TaxPaymentCertExportResult> {
  const issueDate = todayIsoDate()
  const sourceBlob = await fetchPdfFromStorage(row.storage_path)
  const { patchTaxPaymentCertIssueDate } = await import('./taxPaymentCertIssueDatePatch')
  const patchedBlob = await patchTaxPaymentCertIssueDate(sourceBlob, issueDate)

  const { error: uploadError } = await supabase.storage
    .from(IMPORTED_DOCS_BUCKET)
    .upload(row.storage_path, patchedBlob, {
      upsert: true,
      contentType: 'application/pdf',
    })
  if (uploadError) {
    throw new Error(`PDF 保存失败：${uploadError.message}`)
  }

  const { error: dbError } = await supabase
    .from('tax_payment_certificate_records')
    .update({ issue_date: issueDate })
    .eq('id', row.id)
  if (dbError) {
    throw new Error(`填发日期更新失败：${dbError.message}`)
  }

  const fileName = defaultCertExportFileName()
  savePdfToDisk(patchedBlob, fileName)

  return { issueDate, fileName }
}
