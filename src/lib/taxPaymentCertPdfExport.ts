import { createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { TaxPaymentCertPdfDocument } from '../components/TaxPaymentCertPdfDocument'
import { downloadPdfBlob, exportPreviewDomToPdf, waitForCaptureLayout } from './excelExport'
import type { TaxPaymentCertRecordRow } from '../types/database'
import { defaultCertExportFileName } from './taxPaymentCertFormat'

async function mountOffscreenDocument(rows: TaxPaymentCertRecordRow[]): Promise<{
  host: HTMLDivElement
  root: Root
  layout: HTMLElement
}> {
  const host = document.createElement('div')
  host.className = 'tax-payment-cert-pdf-mount'
  host.style.position = 'fixed'
  host.style.left = '-12000px'
  host.style.top = '0'
  host.style.opacity = '0'
  host.style.pointerEvents = 'none'
  document.body.appendChild(host)

  const root = createRoot(host)
  root.render(createElement(TaxPaymentCertPdfDocument, { rows }))

  await waitForCaptureLayout(host)
  const layout = host.querySelector('.tax-payment-cert-pdf-layout')
  if (!(layout instanceof HTMLElement)) {
    root.unmount()
    host.remove()
    throw new Error('完税证明 PDF 排版渲染失败')
  }
  return { host, root, layout }
}

function unmountOffscreen(host: HTMLDivElement, root: Root): void {
  root.unmount()
  host.remove()
}

/** 按勾选的明细行生成并下载表格式完税证明 PDF */
export async function exportTaxPaymentCertRowsToPdf(
  rows: TaxPaymentCertRecordRow[],
  fileName?: string,
): Promise<void> {
  if (rows.length === 0) {
    throw new Error('没有可导出的完税证明明细')
  }
  const { host, root, layout } = await mountOffscreenDocument(rows)
  try {
    await exportPreviewDomToPdf(layout, fileName ?? defaultCertExportFileName())
  } finally {
    unmountOffscreen(host, root)
  }
}

/** 生成完税证明 PDF Blob，供预览 iframe 使用 */
export async function renderTaxPaymentCertRowsToPdfBlob(
  rows: TaxPaymentCertRecordRow[],
): Promise<Blob> {
  if (rows.length === 0) {
    throw new Error('没有可预览的完税证明明细')
  }
  const { host, root, layout } = await mountOffscreenDocument(rows)
  try {
    const { renderPreviewDomToPdfBlob } = await import('./excelExport')
    return await renderPreviewDomToPdfBlob(layout)
  } finally {
    unmountOffscreen(host, root)
  }
}

export { downloadPdfBlob }
