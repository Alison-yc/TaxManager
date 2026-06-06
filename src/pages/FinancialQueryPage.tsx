import { QueryPage } from './QueryPage'

/** 财务报表申报信息查询列表（复用 QueryPage，固定 import_category=financial） */
export function FinancialQueryPage() {
  return <QueryPage variant="financial" />
}
