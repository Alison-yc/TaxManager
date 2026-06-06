import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dropdown, message } from "antd";
import type { MenuProps } from "antd";
import { TAX_PAYMENT_CERT_IMPORTED_EVENT } from "../constants/taxPaymentCertQuery";

type ImportKind =
  | "excel"
  | "invoice-pdf"
  | "declaration-pdf"
  | "financial-pdf"
  | "tax-payment-cert-pdf";

/**
 * 顶栏用户下拉「账户中心」：支持 Excel 申报表与 PDF 导入。
 */
export function UserImportMenuItem() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [pendingKind, setPendingKind] = useState<ImportKind>("excel");

  const acceptByKind: Record<ImportKind, string> = {
    excel:
      ".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel",
    "invoice-pdf": ".pdf,application/pdf",
    "declaration-pdf": ".pdf,application/pdf",
    "financial-pdf": ".pdf,application/pdf",
    "tax-payment-cert-pdf": ".pdf,application/pdf",
  };

  async function handleFile(ev: React.ChangeEvent<HTMLInputElement>) {
    const file = ev.target.files?.[0];
    ev.target.value = "";
    if (!file) return;
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

      if (pendingKind === "invoice-pdf") {
        const { uploadInvoicePdfFile } =
          await import("../lib/pdfImport/declarationPdfImport");
        const r = await uploadInvoicePdfFile(file);
        if (r.ok === false) {
          void message.error(r.message);
          return;
        }
        void message.success("发票 PDF 导入成功");
        window.dispatchEvent(new Event("taxmanager:invoice-imported"));
        navigate("/invoice-query/full");
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
          className="hidden-file-input"
          accept={acceptByKind[pendingKind]}
          aria-hidden
          tabIndex={-1}
          onChange={(e) => void handleFile(e)}
        />
      </div>
    </>
  );
}
