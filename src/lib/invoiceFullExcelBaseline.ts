import ExcelJS from "exceljs";
import { IMPORTED_DOCS_BUCKET, getCurrentUserId } from "./pdfStorage";
import { supabase } from "./supabase";
import type { InvoiceFullExcelBaselineRow } from "../types/database";

const BASELINE_PREFIX = "invoice-full-excel";
const BASELINE_FILE_NAME = "latest.xlsx";
const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

type WorkbookStats = {
  sheet_count: number;
  row_count: number;
  sheets: Array<{
    name: string;
    rowCount: number;
    columnCount: number;
  }>;
};

function assertExcelFile(file: File): void {
  const lower = file.name.toLowerCase();
  if (!lower.endsWith(".xlsx")) {
    throw new Error("请上传全量发票查询导出的 .xlsx 文件");
  }
}

async function inspectWorkbook(data: ArrayBuffer): Promise<WorkbookStats> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data);
  const sheets = wb.worksheets.map((ws) => ({
    name: ws.name,
    rowCount: ws.rowCount,
    columnCount: ws.columnCount,
  }));
  return {
    sheet_count: sheets.length,
    row_count: sheets.reduce(
      (sum, sheet) => sum + Math.max(sheet.rowCount - 1, 0),
      0,
    ),
    sheets,
  };
}

export function buildInvoiceFullExcelStoragePath(userId: string): string {
  return `${BASELINE_PREFIX}/${userId}/${BASELINE_FILE_NAME}`;
}

export async function uploadInvoiceFullExcelBaseline(
  file: File,
): Promise<InvoiceFullExcelBaselineRow> {
  assertExcelFile(file);
  const userId = await getCurrentUserId();
  const data = await file.arrayBuffer();
  const stats = await inspectWorkbook(data);
  const storagePath = buildInvoiceFullExcelStoragePath(userId);

  const { error: uploadError } = await supabase.storage
    .from(IMPORTED_DOCS_BUCKET)
    .upload(storagePath, data, {
      upsert: true,
      contentType: XLSX_MIME,
    });
  if (uploadError)
    throw new Error(`全量发票 Excel 上传失败：${uploadError.message}`);

  const payload = {
    auth_user_id: userId,
    storage_path: storagePath,
    source_file_name: file.name,
    sheet_count: stats.sheet_count,
    row_count: stats.row_count,
    updated_at: new Date().toISOString(),
    content: { sheets: stats.sheets },
  };
  const { data: row, error } = await supabase
    .from("invoice_full_excel_baselines")
    .upsert(payload, { onConflict: "auth_user_id" })
    .select("*")
    .single();

  if (error) throw new Error(`全量发票 Excel 信息保存失败：${error.message}`);
  return row as InvoiceFullExcelBaselineRow;
}

export async function getLatestInvoiceFullExcelBaseline(): Promise<InvoiceFullExcelBaselineRow> {
  const userId = await getCurrentUserId();
  const { data, error } = await supabase
    .from("invoice_full_excel_baselines")
    .select("*")
    .eq("auth_user_id", userId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data)
    throw new Error(
      "尚未上传全量发票信息 Excel，请先在账户中心更新全量发票信息 Excel 表格",
    );
  return data as InvoiceFullExcelBaselineRow;
}

export async function downloadInvoiceFullExcelBaselineBlob(): Promise<{
  blob: Blob;
  baseline: InvoiceFullExcelBaselineRow;
}> {
  const baseline = await getLatestInvoiceFullExcelBaseline();
  const { data, error } = await supabase.storage
    .from(IMPORTED_DOCS_BUCKET)
    .download(baseline.storage_path);
  if (error) throw new Error(`全量发票 Excel 下载失败：${error.message}`);
  return { blob: data, baseline };
}
