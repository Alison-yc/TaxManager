import { useMemo, useRef, useState } from 'react'
import { Button, Input, Modal, Space, Typography, message } from 'antd'
import { INVOICE_IMPORTED_EVENT } from '../constants/invoiceQuery'
import {
  deleteInvoiceRecordsByNumbers,
  downloadInvoicePdfsByNumbers,
  formatInvoiceNumbersBatchSummary,
  importInvoicePdfsForNumbers,
  parseInvoiceNumbersInput,
  reparseInvoiceRecordsByNumbers,
} from '../lib/pdfImport/invoiceBatchByNumbers'

type InvoiceNumbersMaintainModalProps = {
  open: boolean
  onClose: () => void
}

export function InvoiceNumbersMaintainModal({
  open,
  onClose,
}: InvoiceNumbersMaintainModalProps) {
  const [numbersText, setNumbersText] = useState('')
  const [busy, setBusy] = useState(false)
  const importInputRef = useRef<HTMLInputElement>(null)

  const parsedNumbers = useMemo(
    () => parseInvoiceNumbersInput(numbersText),
    [numbersText],
  )

  function requireNumbers(): string[] | null {
    if (parsedNumbers.length === 0) {
      void message.warning('请先输入至少一个 20 位数电发票号码')
      return null
    }
    return parsedNumbers
  }

  function notifyBatchResult(
    label: string,
    summary: string,
    failedMessages: string[],
  ) {
    if (failedMessages.length === 0) {
      void message.success(`${label}：${summary}`)
      return
    }
    const preview = failedMessages.slice(0, 3).join('；')
    void message.warning(
      `${label}：${summary}${preview ? `；${preview}${failedMessages.length > 3 ? '…' : ''}` : ''}`,
      8,
    )
  }

  async function runDownload() {
    const numbers = requireNumbers()
    if (!numbers) return

    setBusy(true)
    const progressRef: { hide?: () => void } = {}
    try {
      progressRef.hide = message.loading(`正在下载 0/${numbers.length}…`, 0)
      const result = await downloadInvoicePdfsByNumbers(numbers, {
        onProgress: (done, total) => {
          progressRef.hide?.()
          progressRef.hide = message.loading(`正在下载 ${done}/${total}…`, 0)
        },
      })
      progressRef.hide?.()
      notifyBatchResult(
        '下载 PDF',
        formatInvoiceNumbersBatchSummary(result),
        result.items
          .filter((item) => item.status === 'failed')
          .map((item) => `${item.digital_invoice_no}：${item.message ?? '失败'}`),
      )
    } catch (error: unknown) {
      progressRef.hide?.()
      void message.error(error instanceof Error ? error.message : '下载失败')
    } finally {
      progressRef.hide?.()
      setBusy(false)
    }
  }

  async function runDelete() {
    const numbers = requireNumbers()
    if (!numbers) return

    Modal.confirm({
      title: '确认删除指定发票记录？',
      content: `将删除 ${numbers.length} 个票号对应的数据库记录（PDF 文件仍保留在存储中，可重新导入）。`,
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        setBusy(true)
        try {
          const result = await deleteInvoiceRecordsByNumbers(numbers)
          notifyBatchResult(
            '删除记录',
            formatInvoiceNumbersBatchSummary(result),
            result.items
              .filter((item) => item.status === 'failed')
              .map((item) => `${item.digital_invoice_no}：${item.message ?? '失败'}`),
          )
          if (result.success > 0) {
            window.dispatchEvent(new Event(INVOICE_IMPORTED_EVENT))
          }
        } catch (error: unknown) {
          void message.error(error instanceof Error ? error.message : '删除失败')
        } finally {
          setBusy(false)
        }
      },
    })
  }

  async function runReparse() {
    const numbers = requireNumbers()
    if (!numbers) return

    setBusy(true)
    const progressRef: { hide?: () => void } = {}
    try {
      const { resetReparseFailureLog } = await import('../lib/pdfImport/reparseFailureLog')
      resetReparseFailureLog()
      progressRef.hide = message.loading(`正在重解析 0/${numbers.length}…`, 0)
      const { batch, reparseItems } = await reparseInvoiceRecordsByNumbers(numbers, {
        mode: 'full',
        onProgress: (done, total) => {
          progressRef.hide?.()
          progressRef.hide = message.loading(`正在重解析 ${done}/${total}…`, 0)
        },
      })
      progressRef.hide?.()

      const failures = reparseItems.filter((item) => item.status === 'failed')
      if (failures.length > 0) {
        const { downloadReparseFailureLog, getReparseFailureLog } =
          await import('../lib/pdfImport/reparseFailureLog')
        const logEntries = getReparseFailureLog()
        if (logEntries.length > 0) downloadReparseFailureLog(logEntries)
      }

      notifyBatchResult(
        '重解析',
        formatInvoiceNumbersBatchSummary(batch),
        failures.map(
          (item) =>
            `${item.digital_invoice_no}${item.source_file_name ? `（${item.source_file_name}）` : ''}：${item.message ?? '失败'}`,
        ),
      )

      if (batch.success > 0) {
        window.dispatchEvent(new Event(INVOICE_IMPORTED_EVENT))
      }
    } catch (error: unknown) {
      progressRef.hide?.()
      void message.error(error instanceof Error ? error.message : '重解析失败')
    } finally {
      progressRef.hide?.()
      setBusy(false)
    }
  }

  function openImportPicker() {
    if (!requireNumbers()) return
    importInputRef.current?.click()
  }

  async function handleImportFiles(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = ev.currentTarget.files
    ev.currentTarget.value = ''
    if (!files?.length) return

    const numbers = requireNumbers()
    if (!numbers) return

    setBusy(true)
    const progressRef: { hide?: () => void } = {}
    try {
      progressRef.hide = message.loading('正在导入…', 0)
      const result = await importInvoicePdfsForNumbers(Array.from(files), numbers, {
        replaceExisting: true,
        onProgress: (done, total) => {
          progressRef.hide?.()
          progressRef.hide = message.loading(`正在导入 ${done}/${total}…`, 0)
        },
      })
      progressRef.hide?.()

      const summary = [
        result.success > 0 ? `成功 ${result.success} 张` : '',
        result.skipped > 0 ? `跳过 ${result.skipped} 张` : '',
        result.failed > 0 ? `失败 ${result.failed} 张` : '',
      ]
        .filter(Boolean)
        .join('，')

      if (result.failed === 0 && result.success > 0) {
        void message.success(`重新导入完成：${summary}`)
      } else if (result.success > 0) {
        void message.warning(`重新导入完成：${summary}`)
      } else {
        void message.error(`重新导入失败：${summary || '未处理任何文件'}`)
      }

      const failures = result.items.filter((item) => item.status === 'failed')
      if (failures.length > 0) {
        const preview = failures
          .slice(0, 3)
          .map((item) => `${item.fileName}：${item.message ?? '未知错误'}`)
          .join('；')
        void message.error(`${preview}${failures.length > 3 ? '…' : ''}`, 8)
      }

      if (result.success > 0) {
        window.dispatchEvent(new Event(INVOICE_IMPORTED_EVENT))
      }
    } catch (error: unknown) {
      progressRef.hide?.()
      void message.error(error instanceof Error ? error.message : '导入失败')
    } finally {
      progressRef.hide?.()
      setBusy(false)
    }
  }

  return (
    <Modal
      title="指定票号批量维护"
      open={open}
      onCancel={onClose}
      footer={null}
      width={640}
      destroyOnClose
    >
      <Typography.Paragraph type="secondary" style={{ marginBottom: 12 }}>
        输入多个数电发票号码，用于样本下载、删除后重导、或单独重解析字段。支持换行、逗号、空格、分号分隔。
      </Typography.Paragraph>

      <Input.TextArea
        value={numbersText}
        onChange={(e) => setNumbersText(e.target.value)}
        placeholder={'25132000000004482819\n25132000000056597615\n25132000000117465784'}
        autoSize={{ minRows: 6, maxRows: 14 }}
        disabled={busy}
      />

      <Typography.Paragraph style={{ marginTop: 8, marginBottom: 16 }}>
        已识别 <strong>{parsedNumbers.length}</strong> 个票号
        {parsedNumbers.length > 0 && parsedNumbers.length <= 5
          ? `：${parsedNumbers.join('、')}`
          : null}
      </Typography.Paragraph>

      <Space wrap>
        <Button disabled={busy} onClick={() => void runDownload()}>
          下载 PDF
        </Button>
        <Button danger disabled={busy} onClick={() => void runDelete()}>
          删除记录
        </Button>
        <Button type="primary" disabled={busy} onClick={() => void runReparse()}>
          重解析字段
        </Button>
        <Button disabled={busy} onClick={openImportPicker}>
          选择 PDF 重新导入
        </Button>
      </Space>

      <Typography.Paragraph type="secondary" style={{ marginTop: 16, marginBottom: 0 }}>
        「选择 PDF 重新导入」会先删除同票号旧记录再导入，仅处理票号在上方列表中的 PDF。
      </Typography.Paragraph>

      <input
        ref={importInputRef}
        type="file"
        accept=".pdf,application/pdf"
        multiple
        className="hidden-file-input"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => void handleImportFiles(e)}
      />
    </Modal>
  )
}
