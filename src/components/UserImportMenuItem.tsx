import { useRef, useState } from "react";
import { createPortal, flushSync } from "react-dom";
import { useNavigate } from "react-router-dom";
import { Dropdown, Spin, message } from "antd";
import type { MenuProps } from "antd";
import type { MessageType } from "antd/es/message/interface";
import { INVOICE_IMPORTED_EVENT } from "../constants/invoiceQuery";
import { TAX_PAYMENT_CERT_IMPORTED_EVENT } from "../constants/taxPaymentCertQuery";
import type { InvoiceBatchImportResult } from "../lib/pdfImport/invoicePdfBatchImport";
import { InvoiceNumbersMaintainModal } from "./InvoiceNumbersMaintainModal";

const FOLDER_INPUT_ID = "invoice-folder-import-input";

type ImportKind =
  | "excel"
  | "invoice-full-excel"
  | "invoice-full-excel-increment"
  | "invoice-pdf"
  | "invoice-pdf-folder"
  | "declaration-pdf"
  | "financial-pdf"
  | "tax-payment-cert-pdf";

type ImportProgressState = {
  done: number;
  total: number;
  phase: "preparing" | "importing";
};

/**
 * 顶栏用户下拉「账户中心」：支持 Excel 申报表与 PDF 导入。
 */
export function UserImportMenuItem() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const folderImportingRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [importProgress, setImportProgress] =
    useState<ImportProgressState | null>(null);
  const [pendingKind, setPendingKind] = useState<ImportKind>("excel");
  const [numbersMaintainOpen, setNumbersMaintainOpen] = useState(false);

  const acceptByKind: Record<
    Exclude<ImportKind, "invoice-pdf-folder">,
    string
  > = {
    excel:
      ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
    "invoice-full-excel":
      ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "invoice-full-excel-increment":
      ".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "invoice-pdf": ".pdf,application/pdf",
    "declaration-pdf": ".pdf,application/pdf",
    "financial-pdf": ".pdf,application/pdf",
    "tax-payment-cert-pdf": ".pdf,application/pdf",
  };

  function showBatchImportResult(result: InvoiceBatchImportResult) {
    const parts: string[] = [];
    if (result.success > 0) parts.push(`成功 ${result.success} 张`);
    if (result.skipped > 0) parts.push(`跳过 ${result.skipped} 张（已存在）`);
    if (result.failed > 0) parts.push(`失败 ${result.failed} 张`);

    const summary = parts.length > 0 ? parts.join("，") : "未处理任何文件";

    if (result.failed === 0 && result.success > 0) {
      void message.success(`导入完成：${summary}`);
    } else if (result.success === 0 && result.failed > 0) {
      void message.error(`导入完成：${summary}`);
    } else if (result.success > 0) {
      void message.warning(`导入完成：${summary}`);
    } else {
      void message.info(`导入完成：${summary}`);
    }

    const failures = result.items.filter((item) => item.status === "failed");
    if (failures.length > 0) {
      const preview = failures
        .slice(0, 3)
        .map((item) => `${item.fileName}：${item.message ?? "未知错误"}`)
        .join("；");
      const suffix =
        failures.length > 3 ? `…等共 ${failures.length} 个错误` : "";
      void message.error(`${preview}${suffix}`, 8);
    }
  }

  async function runInvoiceBatchImport(files: File[]) {
    const pdfCount = files.filter((file) =>
      file.name.toLowerCase().endsWith(".pdf"),
    ).length;
    setImportProgress(
      (prev) => prev ?? { done: 0, total: pdfCount, phase: "preparing" },
    );

    let destroyLoading: MessageType | undefined;
    const showProgress = (text: string) => {
      destroyLoading?.();
      destroyLoading = message.loading(text, 0);
    };

    try {
      const { collectInvoicePdfFiles, uploadInvoicePdfBatch } =
        await import("../lib/pdfImport/invoicePdfBatchImport");
      const pdfs = collectInvoicePdfFiles(files);
      if (pdfs.length === 0) {
        void message.error("文件夹中未找到 PDF 发票文件");
        return;
      }

      setImportProgress({ done: 0, total: pdfs.length, phase: "importing" });
      showProgress(`正在导入 0/${pdfs.length} 张发票…`);

      const result = await uploadInvoicePdfBatch(pdfs, {
        onProgress: (done, total) => {
          setImportProgress({ done, total, phase: "importing" });
          showProgress(`正在导入 ${done}/${total} 张发票…`);
        },
      });

      destroyLoading?.();
      destroyLoading = undefined;
      showBatchImportResult(result);
      if (result.success > 0) {
        window.dispatchEvent(new Event(INVOICE_IMPORTED_EVENT));
        navigate("/invoice-query/full");
      }
    } catch (error: unknown) {
      destroyLoading?.();
      destroyLoading = undefined;
      void message.error(
        error instanceof Error ? error.message : "批量导入失败，请重试",
      );
    } finally {
      destroyLoading?.();
      setImportProgress(null);
    }
  }

  async function handleFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const input = ev.currentTarget;
    const picked = input.files;
    if (!picked?.length) return;

    const files = Array.from(picked);

    if (pendingKind === "invoice-pdf") {
      setBusy(true);
      try {
        if (files.length === 1) {
          const { uploadInvoicePdfFile } =
            await import("../lib/pdfImport/declarationPdfImport");
          const r = await uploadInvoicePdfFile(files[0]);
          if (r.ok === false) {
            void message.error(r.message);
            return;
          }
          void message.success("发票 PDF 导入成功");
          window.dispatchEvent(new Event(INVOICE_IMPORTED_EVENT));
          navigate("/invoice-query/full");
          return;
        }
        flushSync(() => {
          setImportProgress({
            done: 0,
            total: files.filter((f) => f.name.toLowerCase().endsWith(".pdf"))
              .length,
            phase: "preparing",
          });
        });
        await runInvoiceBatchImport(files);
      } finally {
        setBusy(false);
        input.value = "";
      }
      return;
    }

    const file = files[0];
    setBusy(true);
    try {
      if (pendingKind === "excel") {
        const { uploadFormDataFromExcelFile } =
          await import("../lib/formDataExcelUpload");
        const r = await uploadFormDataFromExcelFile(file);
        if (r.ok === false) {
          void message.error(r.message);
          return;
        }
        void message.success("Excel 申报表导入成功");
        navigate("/query");
        return;
      }

      if (pendingKind === "invoice-full-excel") {
        const { uploadInvoiceFullExcelBaseline } =
          await import("../lib/invoiceFullExcelBaseline");
        const row = await uploadInvoiceFullExcelBaseline(file);
        void message.success(
          `全量发票信息 Excel 已更新：${row.sheet_count} 个工作表，${row.row_count} 条数据`,
        );
        return;
      }

      if (pendingKind === "invoice-full-excel-increment") {
        const { mergeInvoiceFullExcelBaseline } = await import(
          "../lib/invoiceFullExcelBaseline"
        );
        const result = await mergeInvoiceFullExcelBaseline(file);
        void message.success(
          `全量发票信息 Excel 已增量更新：新增 ${result.added} 条，更新 ${result.updated} 条，当前共 ${result.baseline.row_count} 条数据`,
        );
        return;
      }

      if (pendingKind === "tax-payment-cert-pdf") {
        const { uploadTaxPaymentCertPdfFile } =
          await import("../lib/pdfImport/taxPaymentCertPdfImport");
        const r = await uploadTaxPaymentCertPdfFile(file);
        if (r.ok === false) {
          void message.error(r.message);
          return;
        }
        void message.success("税收完税证明 PDF 导入成功");
        window.dispatchEvent(new Event(TAX_PAYMENT_CERT_IMPORTED_EVENT));
        navigate("/tax-payment-cert/query");
        return;
      }

      const { uploadDeclarationPdfFile } =
        await import("../lib/pdfImport/declarationPdfImport");
      const category =
        pendingKind === "financial-pdf" ? "financial" : "declaration";
      const r = await uploadDeclarationPdfFile(file, category);
      if (r.ok === false) {
        void message.error(r.message);
        return;
      }
      void message.success(
        category === "financial"
          ? "财务报表 PDF 导入成功"
          : "申报 PDF 导入成功",
      );
      window.dispatchEvent(new Event("taxmanager:form-data-pdf-imported"));
      navigate(category === "financial" ? "/financial-query" : "/query");
    } finally {
      setBusy(false);
      input.value = "";
    }
  }

  async function handleFolder(ev: React.ChangeEvent<HTMLInputElement>) {
    const input = ev.currentTarget;
    const picked = input.files;
    // 取消选择，或清空 value 触发的二次 change — 均静默忽略
    if (!picked?.length || folderImportingRef.current) return;

    const files = Array.from(picked);
    const pdfCount = files.filter((file) =>
      file.name.toLowerCase().endsWith(".pdf"),
    ).length;

    folderImportingRef.current = true;
    flushSync(() => {
      setBusy(true);
      setImportProgress({
        done: 0,
        total: pdfCount,
        phase: "preparing",
      });
    });

    try {
      await runInvoiceBatchImport(files);
    } finally {
      folderImportingRef.current = false;
      setBusy(false);
      input.value = "";
    }
  }

  function openPicker(kind: ImportKind) {
    setPendingKind(kind);
    window.setTimeout(() => inputRef.current?.click(), 0);
  }

  const menuItems: MenuProps["items"] = [
    {
      key: "excel",
      label: "导入 Excel 申报表",
      onClick: () => openPicker("excel"),
    },
    {
      key: "invoice-pdf",
      label: "导入 PDF 发票",
      onClick: () => openPicker("invoice-pdf"),
    },
    {
      key: "invoice-pdf-folder",
      label: (
        <label
          className="etax-import-folder-label"
          htmlFor={FOLDER_INPUT_ID}
          onClick={(e) => e.stopPropagation()}
        >
          导入 PDF 发票文件夹
        </label>
      ),
    },
    {
      key: "invoice-full-excel",
      label: "更新全量发票信息excel表格",
      onClick: () => openPicker("invoice-full-excel"),
    },
    {
      key: "invoice-full-excel-increment",
      label: "增量更新全量发票信息excel表格",
      onClick: () => openPicker("invoice-full-excel-increment"),
    },
    {
      key: "invoice-numbers-maintain",
      label: "指定票号批量维护",
      onClick: () => setNumbersMaintainOpen(true),
    },
    {
      key: "tax-payment-cert-pdf",
      label: "导入 PDF 税收完税证明",
      onClick: () => openPicker("tax-payment-cert-pdf"),
    },
    {
      key: "declaration-pdf",
      label: "导入 PDF 月（季）度（申报表",
      onClick: () => openPicker("declaration-pdf"),
    },
    {
      key: "financial-pdf",
      label: "导入 PDF 财务报表",
      onClick: () => openPicker("financial-pdf"),
    },
  ];

  return (
    <>
      {createPortal(
        <input
          id={FOLDER_INPUT_ID}
          ref={folderInputRef}
          type="file"
          className="hidden-file-input hidden-file-input--pickable"
          {...({
            webkitdirectory: "",
            directory: "",
          } as React.InputHTMLAttributes<HTMLInputElement>)}
          multiple
          tabIndex={-1}
          onChange={(e) => void handleFolder(e)}
        />,
        document.body,
      )}
      {importProgress &&
        createPortal(
          <div
            className="invoice-import-overlay"
            role="status"
            aria-live="polite"
            aria-label="发票导入进度"
          >
            <div className="invoice-import-overlay-card">
              <Spin size="large" />
              <p className="invoice-import-overlay-title">
                {importProgress.phase === "preparing"
                  ? "正在准备导入…"
                  : "正在导入发票"}
              </p>
              <p className="invoice-import-overlay-progress">
                {importProgress.phase === "preparing"
                  ? `已识别 ${importProgress.total} 个 PDF 文件`
                  : `${importProgress.done} / ${importProgress.total}`}
              </p>
              <p className="invoice-import-overlay-hint">
                {importProgress.total > 1
                  ? `共 ${importProgress.total} 张，批量导入可能需要 1～3 分钟，请勿关闭页面`
                  : "请勿关闭页面"}
              </p>
            </div>
          </div>,
          document.body,
        )}
      <div className="etax-user-excel-slot">
        <Dropdown
          menu={{ items: menuItems }}
          trigger={["click"]}
          disabled={busy}
        >
          <button
            type="button"
            className={`etax-portal-user-menu-action${busy ? " etax-portal-user-menu-action--busy" : ""}`}
            role="menuitem"
            disabled={busy}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span className="etax-portal-user-menu-action-ic" aria-hidden>
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.75"
                strokeLinecap="round"
              >
                <circle cx="12" cy="8" r="3.5" />
                <path d="M5 20v-1c0-3 3.5-5 7-5s7 2 7 5v1" />
              </svg>
            </span>
            <span>{busy ? "导入中…" : "账户中心"}</span>
          </button>
        </Dropdown>
        <input
          ref={inputRef}
          type="file"
          className="hidden-file-input hidden-file-input--pickable"
          accept={
            acceptByKind[
              pendingKind === "invoice-pdf-folder" ? "invoice-pdf" : pendingKind
            ]
          }
          multiple={pendingKind === "invoice-pdf"}
          aria-hidden
          tabIndex={-1}
          onChange={(e) => void handleFile(e)}
        />
      </div>
      <InvoiceNumbersMaintainModal
        open={numbersMaintainOpen}
        onClose={() => setNumbersMaintainOpen(false)}
      />
    </>
  );
}
