import type { Dayjs } from "dayjs";
import { supabase } from "./supabase";
import type { InvoiceRecordRow } from "../types/database";

/** 列表查询最多展示条数（Supabase 默认上限） */
export const INVOICE_QUERY_DISPLAY_LIMIT = 1000;

/** 导出时分页拉取的批次大小 */
export const INVOICE_EXPORT_BATCH_SIZE = 1000;

export type InvoiceQueryFilters = {
  queryType: string;
  invoiceSource: string;
  invoiceType: string;
  invoiceStatus: string;
  isPositive: string;
  digitalNo: string;
  invoiceCode: string;
  invoiceNumber: string;
  counterpartyTaxId: string;
  counterpartyName: string;
  amountFrom?: number;
  amountTo?: number;
  issueFrom?: Dayjs;
  issueTo?: Dayjs;
};

// Supabase 查询 builder 泛型过深，此处用宽松类型即可
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type InvoiceQueryBuilder = any;

export function applyInvoiceRecordFilters(
  q: InvoiceQueryBuilder,
  filters: InvoiceQueryFilters,
): InvoiceQueryBuilder {
  if (filters.digitalNo.trim()) {
    q = q.ilike("digital_invoice_no", `%${filters.digitalNo.trim()}%`);
  }
  if (filters.invoiceCode.trim()) {
    q = q.ilike("invoice_code", `%${filters.invoiceCode.trim()}%`);
  }
  if (filters.invoiceNumber.trim()) {
    q = q.ilike("invoice_number", `%${filters.invoiceNumber.trim()}%`);
  }
  if (filters.counterpartyTaxId.trim()) {
    q = q.or(
      `buyer_tax_id.ilike.%${filters.counterpartyTaxId.trim()}%,seller_tax_id.ilike.%${filters.counterpartyTaxId.trim()}%`,
    );
  }
  if (filters.counterpartyName.trim()) {
    q = q.or(
      `buyer_name.ilike.%${filters.counterpartyName.trim()}%,seller_name.ilike.%${filters.counterpartyName.trim()}%`,
    );
  }
  if (filters.invoiceSource !== "全部")
    q = q.eq("invoice_source", filters.invoiceSource);
  const invoiceStatus = filters.invoiceStatus?.trim();
  if (invoiceStatus && invoiceStatus !== "全部")
    q = q.eq("invoice_status", invoiceStatus);
  const isPositive = filters.isPositive?.trim();
  if (isPositive && isPositive !== "全部") q = q.eq("is_positive", isPositive);
  if (filters.invoiceType !== "全部")
    q = q.eq("invoice_type", filters.invoiceType);
  if (filters.amountFrom != null) q = q.gte("total_amount", filters.amountFrom);
  if (filters.amountTo != null) q = q.lte("total_amount", filters.amountTo);
  if (filters.issueFrom)
    q = q.gte("issue_date", filters.issueFrom.startOf("day").toISOString());
  if (filters.issueTo)
    q = q.lte("issue_date", filters.issueTo.endOf("day").toISOString());
  return q;
}

/** 列表页展示字段（不含 content 明细，避免数千张发票占用 GB 级内存） */
export const INVOICE_LIST_SELECT =
  "id, created_at, auth_user_id, digital_invoice_no, invoice_code, invoice_number, query_type, invoice_source, invoice_type, invoice_status, is_positive, risk_level, seller_name, seller_tax_id, buyer_name, buyer_tax_id, issue_date, amount, tax_amount, total_amount, business_type, issuer, remark, source_file_name, storage_path";

/** 列表页查询：最多返回 INVOICE_QUERY_DISPLAY_LIMIT 条 */
export async function fetchInvoiceRecordsForDisplay(
  filters: InvoiceQueryFilters,
): Promise<{ data: InvoiceRecordRow[]; error: Error | null }> {
  let q = supabase
    .from("invoice_records")
    .select(INVOICE_LIST_SELECT)
    .order("issue_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });
  q = applyInvoiceRecordFilters(q, filters);
  const { data, error } = await q.range(0, INVOICE_QUERY_DISPLAY_LIMIT - 1);
  if (error) return { data: [], error: new Error(error.message) };
  return { data: (data ?? []) as InvoiceRecordRow[], error: null };
}

/** 按 id 拉取完整记录（含 content），用于勾选导出等需要明细的场景 */
export async function fetchInvoiceRecordsByIds(
  ids: string[],
): Promise<{ data: InvoiceRecordRow[]; error: Error | null }> {
  if (ids.length === 0) return { data: [], error: null };
  const { data, error } = await supabase
    .from("invoice_records")
    .select("*")
    .in("id", ids);
  if (error) return { data: [], error: new Error(error.message) };
  return { data: (data ?? []) as InvoiceRecordRow[], error: null };
}

/** 导出：按当前筛选条件分页拉取全部匹配发票 */
export async function fetchAllInvoiceRecordsForExport(
  filters: InvoiceQueryFilters,
  options?: { onProgress?: (loaded: number) => void },
): Promise<InvoiceRecordRow[]> {
  const all: InvoiceRecordRow[] = [];
  let from = 0;

  while (true) {
    let q = supabase
      .from("invoice_records")
      .select("*")
      .order("issue_date", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false });
    q = applyInvoiceRecordFilters(q, filters);
    const to = from + INVOICE_EXPORT_BATCH_SIZE - 1;
    const { data, error } = await q.range(from, to);
    if (error) throw new Error(error.message);

    const batch = (data ?? []) as InvoiceRecordRow[];
    all.push(...batch);
    options?.onProgress?.(all.length);

    if (batch.length < INVOICE_EXPORT_BATCH_SIZE) break;
    from += INVOICE_EXPORT_BATCH_SIZE;
  }

  return all;
}
