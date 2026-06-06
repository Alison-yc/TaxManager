import { RecordPreview } from './RecordPreview'

/** 财务报表 PDF 预览（复用 RecordPreview，返回 /financial-query） */
export function FinancialRecordPreview() {
  return <RecordPreview variant="financial" />
}
