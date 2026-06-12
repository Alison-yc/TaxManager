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

export type InvoiceFullExcelBaselineIncrementResult = {
  baseline: InvoiceFullExcelBaselineRow;
  added: number;
  updated: number;
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

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return cellToString(value.result as ExcelJS.CellValue);
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
  }
  return String(value);
}

function headerText(value: ExcelJS.CellValue): string {
  return cellToString(value).replace(/\s+/g, "");
}

function normalizeDigitalInvoiceNo(value: ExcelJS.CellValue): string {
  return cellToString(value).replace(/\D/g, "");
}

function findHeaderColumn(ws: ExcelJS.Worksheet, name: string): number | null {
  const expected = name.replace(/\s+/g, "");
  let col: number | null = null;
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, colNumber) => {
    if (headerText(cell.value) === expected) col = colNumber;
  });
  return col;
}

function cloneCellValue(value: ExcelJS.CellValue): ExcelJS.CellValue {
  if (value instanceof Date) return new Date(value.getTime());
  if (value && typeof value === "object") {
    return JSON.parse(JSON.stringify(value)) as ExcelJS.CellValue;
  }
  return value;
}

function cloneStyle(style: Partial<ExcelJS.Style> | undefined): Partial<ExcelJS.Style> {
  return style ? (JSON.parse(JSON.stringify(style)) as Partial<ExcelJS.Style>) : {};
}

function copyRow(source: ExcelJS.Row, target: ExcelJS.Row, columnCount: number): void {
  for (let col = 1; col <= columnCount; col += 1) {
    const sourceCell = source.getCell(col);
    const targetCell = target.getCell(col);
    targetCell.value = cloneCellValue(sourceCell.value);
    targetCell.style = cloneStyle(sourceCell.style);
    if (sourceCell.numFmt) targetCell.numFmt = sourceCell.numFmt;
  }
  target.height = source.height;
  target.commit();
}

function buildDigitalNoRowMap(
  ws: ExcelJS.Worksheet,
  digitalNoCol: number,
): Map<string, number> {
  const map = new Map<string, number>();
  for (let rowNumber = 2; rowNumber <= ws.rowCount; rowNumber += 1) {
    const no = normalizeDigitalInvoiceNo(ws.getRow(rowNumber).getCell(digitalNoCol).value);
    if (no) map.set(no, rowNumber);
  }
  return map;
}

function mergeWorksheetRows(
  baseWs: ExcelJS.Worksheet,
  incomingWs: ExcelJS.Worksheet,
): { added: number; updated: number } {
  const baseNoCol = findHeaderColumn(baseWs, "数电发票号码");
  const incomingNoCol = findHeaderColumn(incomingWs, "数电发票号码");
  if (!baseNoCol) throw new Error(`当前基准工作表「${baseWs.name}」缺少「数电发票号码」列`);
  if (!incomingNoCol) throw new Error(`增量工作表「${incomingWs.name}」缺少「数电发票号码」列`);

  const rowByNo = buildDigitalNoRowMap(baseWs, baseNoCol);
  const columnCount = Math.max(baseWs.columnCount, incomingWs.columnCount);
  let added = 0;
  let updated = 0;

  for (let rowNumber = 2; rowNumber <= incomingWs.rowCount; rowNumber += 1) {
    const incomingRow = incomingWs.getRow(rowNumber);
    const no = normalizeDigitalInvoiceNo(incomingRow.getCell(incomingNoCol).value);
    if (!no) continue;

    const existingRowNumber = rowByNo.get(no);
    if (existingRowNumber != null) {
      copyRow(incomingRow, baseWs.getRow(existingRowNumber), columnCount);
      updated += 1;
      continue;
    }

    const appendedRowNumber = baseWs.rowCount + 1;
    copyRow(incomingRow, baseWs.getRow(appendedRowNumber), columnCount);
    rowByNo.set(no, appendedRowNumber);
    added += 1;
  }

  return { added, updated };
}

async function saveBaselineWorkbook(
  userId: string,
  sourceFileName: string,
  data: ArrayBuffer,
  extraContent: Record<string, unknown> = {},
): Promise<InvoiceFullExcelBaselineRow> {
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
    source_file_name: sourceFileName,
    sheet_count: stats.sheet_count,
    row_count: stats.row_count,
    updated_at: new Date().toISOString(),
    content: { sheets: stats.sheets, ...extraContent },
  };
  const { data: row, error } = await supabase
    .from("invoice_full_excel_baselines")
    .upsert(payload, { onConflict: "auth_user_id" })
    .select("*")
    .single();

  if (error) throw new Error(`全量发票 Excel 信息保存失败：${error.message}`);
  return row as InvoiceFullExcelBaselineRow;
}

export async function uploadInvoiceFullExcelBaseline(
  file: File,
): Promise<InvoiceFullExcelBaselineRow> {
  assertExcelFile(file);
  const userId = await getCurrentUserId();
  const data = await file.arrayBuffer();
  return saveBaselineWorkbook(userId, file.name, data, { updateMode: "replace" });
}

export async function mergeInvoiceFullExcelBaseline(
  file: File,
): Promise<InvoiceFullExcelBaselineIncrementResult> {
  assertExcelFile(file);
  const userId = await getCurrentUserId();
  const { blob, baseline } = await downloadInvoiceFullExcelBaselineBlob();

  const baseWb = new ExcelJS.Workbook();
  await baseWb.xlsx.load(await blob.arrayBuffer());

  const incomingWb = new ExcelJS.Workbook();
  await incomingWb.xlsx.load(await file.arrayBuffer());

  let added = 0;
  let updated = 0;
  for (const incomingWs of incomingWb.worksheets) {
    const baseWs = baseWb.getWorksheet(incomingWs.name);
    if (!baseWs) {
      throw new Error(`当前基准 Excel 缺少工作表「${incomingWs.name}」，请确认模板一致`);
    }
    const result = mergeWorksheetRows(baseWs, incomingWs);
    added += result.added;
    updated += result.updated;
  }

  const mergedData = await baseWb.xlsx.writeBuffer();
  const row = await saveBaselineWorkbook(userId, baseline.source_file_name, mergedData, {
    updateMode: "incremental",
    lastIncrementFileName: file.name,
    added,
    updated,
  });

  return { baseline: row, added, updated };
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
