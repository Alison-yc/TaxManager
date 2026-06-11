export type ReparseFailureLogEntry = {
  at: string
  record_id: string
  digital_invoice_no: string
  source_file_name: string
  reason: string
}

let batchFailures: ReparseFailureLogEntry[] = []

export function resetReparseFailureLog(): void {
  batchFailures = []
}

export function appendReparseFailureLog(
  entry: Omit<ReparseFailureLogEntry, 'at'>,
): ReparseFailureLogEntry {
  const full: ReparseFailureLogEntry = {
    ...entry,
    at: new Date().toISOString(),
  }
  batchFailures.push(full)
  console.warn(
    `[发票重解析失败] 票号=${full.digital_invoice_no} | 文件=${full.source_file_name} | ${full.reason}`,
  )
  return full
}

export function getReparseFailureLog(): ReparseFailureLogEntry[] {
  return [...batchFailures]
}

export function formatReparseFailureLog(entries: ReparseFailureLogEntry[]): string {
  const header = 'time\tdigital_invoice_no\tsource_file_name\trecord_id\treason'
  const lines = entries.map(
    (e) =>
      `${e.at}\t${e.digital_invoice_no}\t${e.source_file_name}\t${e.record_id}\t${e.reason}`,
  )
  return [header, ...lines].join('\n')
}

/** 将失败记录下载为文本，便于对照 PDF 做兼容 */
export function downloadReparseFailureLog(
  entries: ReparseFailureLogEntry[],
  fileName?: string,
): void {
  if (entries.length === 0) return
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
  const blob = new Blob([formatReparseFailureLog(entries)], {
    type: 'text/plain;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName ?? `invoice-reparse-failures-${stamp}.txt`
  a.click()
  URL.revokeObjectURL(url)
}

export function logReparseFailureSummary(failed: number): void {
  if (failed <= 0) return
  console.error(
    `[发票重解析] 共 ${failed} 张失败，详情见上方 [发票重解析失败] 日志；已尝试下载 failures 文本文件`,
  )
}
