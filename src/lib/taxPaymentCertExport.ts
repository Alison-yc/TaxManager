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

export type TaxPaymentCertRefreshResult = {
  issueDate: string
  previewBlob: Blob
  /** 是否成功将填发日期改写为当天并写回 Storage */
  refreshed: boolean
  warning?: string
}

const refreshInflight = new Map<string, Promise<TaxPaymentCertRefreshResult>>()

async function doRefreshTaxPaymentCertIssueDate(
  row: TaxPaymentCertRecordRow,
): Promise<TaxPaymentCertRefreshResult> {
  const issueDate = todayIsoDate()
  const sourceBlob = await fetchPdfFromStorage(row.storage_path)

  if (row.issue_date?.slice(0, 10) === issueDate) {
    return {
      issueDate,
      previewBlob: sourceBlob,
      refreshed: false,
    }
  }

  try {
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

    return {
      issueDate,
      previewBlob: patchedBlob,
      refreshed: true,
    }
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e)
    return {
      issueDate: row.issue_date?.slice(0, 10) ?? issueDate,
      previewBlob: sourceBlob,
      refreshed: false,
      warning: `填发日期未能更新为今天，已展示原件：${message}`,
    }
  }
}

/**
 * 将填发日期更新为当天，写回 Storage 并同步数据库（预览时调用）。
 * 失败时不覆盖桶内原件，仍返回原 PDF 供预览。
 */
export async function refreshTaxPaymentCertIssueDate(
  row: TaxPaymentCertRecordRow,
): Promise<TaxPaymentCertRefreshResult> {
  const existing = refreshInflight.get(row.id)
  if (existing) return existing

  const promise = doRefreshTaxPaymentCertIssueDate(row).finally(() => {
    refreshInflight.delete(row.id)
  })
  refreshInflight.set(row.id, promise)
  return promise
}

/** 下载桶内当前 PDF（预览已更新填发日期后，导出不再重复改写） */
export async function downloadTaxPaymentCert(
  row: TaxPaymentCertRecordRow,
  blob?: Blob,
): Promise<{ fileName: string }> {
  const pdfBlob = blob ?? (await fetchPdfFromStorage(row.storage_path))
  const fileName = defaultCertExportFileName()
  savePdfToDisk(pdfBlob, fileName)
  return { fileName }
}
