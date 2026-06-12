import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  Button,
  Card,
  Col,
  ConfigProvider,
  DatePicker,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { MenuProps } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs, { type Dayjs } from 'dayjs'
import 'dayjs/locale/zh-cn'
import {
  INVOICE_IMPORTED_EVENT,
  INVOICE_POSITIVE_OPTIONS,
  INVOICE_QUERY_TYPE_OPTIONS,
  INVOICE_SOURCE_OPTIONS,
  INVOICE_STATUS_OPTIONS,
  INVOICE_TYPE_OPTIONS,
} from '../constants/invoiceQuery'
import {
  exportInvoiceFullExcelByDigitalNos,
  exportInvoiceFullExcelByIssueDateRange,
  exportOriginalInvoiceFullExcelBaseline,
} from '../lib/invoiceBaselineExcelExport'
import {
  fetchAllInvoiceDigitalInvoiceNosForExport,
  fetchInvoiceDigitalInvoiceNosByIds,
  fetchInvoiceRecordsForDisplay,
  INVOICE_QUERY_DISPLAY_LIMIT,
} from '../lib/invoiceRecordQuery'
import { supabase } from '../lib/supabase'
import type { InvoiceRecordRow } from '../types/database'

dayjs.locale('zh-cn')

type FilterShape = {
  queryType: string
  invoiceSource: string
  invoiceType: string
  invoiceStatus: string
  isPositive: string
  digitalNo: string
  invoiceCode: string
  invoiceNumber: string
  counterpartyTaxId: string
  counterpartyName: string
  amountFrom?: number
  amountTo?: number
  issueFrom?: Dayjs
  issueTo?: Dayjs
}

function fmtMoney(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  return v.slice(0, 10)
}

function partyName(row: InvoiceRecordRow, queryType: string): string {
  return queryType === '取得发票' ? row.seller_name ?? '—' : row.buyer_name ?? '—'
}

function partyTaxId(row: InvoiceRecordRow, queryType: string): string {
  return queryType === '取得发票' ? row.seller_tax_id ?? '—' : row.buyer_tax_id ?? '—'
}

function invoiceRiskTagClass(level?: string | null): string {
  const v = (level ?? '正常').trim()
  if (v === '正常') return 'etax-invoice-risk-tag etax-invoice-risk-tag--normal'
  if (v.includes('疑') || v.includes('风险')) return 'etax-invoice-risk-tag etax-invoice-risk-tag--warn'
  return 'etax-invoice-risk-tag etax-invoice-risk-tag--muted'
}

function hasDateFilter(filters: FilterShape): boolean {
  return Boolean(filters.issueFrom || filters.issueTo)
}

function hasNonDateExportFilter(filters: FilterShape): boolean {
  return (
    filters.invoiceSource !== '全部' ||
    filters.invoiceType !== '全部' ||
    filters.invoiceStatus !== '全部' ||
    filters.isPositive !== '全部' ||
    Boolean(filters.digitalNo.trim()) ||
    Boolean(filters.invoiceCode.trim()) ||
    Boolean(filters.invoiceNumber.trim()) ||
    Boolean(filters.counterpartyTaxId.trim()) ||
    Boolean(filters.counterpartyName.trim()) ||
    filters.amountFrom != null ||
    filters.amountTo != null
  )
}

export function FullInvoiceQueryPage() {
  const navigate = useNavigate()
  const [form] = Form.useForm<FilterShape>()
  const [rows, setRows] = useState<InvoiceRecordRow[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [filtersExpanded, setFiltersExpanded] = useState(true)
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const pageSize = 20
  const [applied, setApplied] = useState<FilterShape>(() => ({
    queryType: '开具发票',
    invoiceSource: '全部',
    invoiceType: '全部',
    invoiceStatus: '全部',
    isPositive: '全部',
    digitalNo: '',
    invoiceCode: '',
    invoiceNumber: '',
    counterpartyTaxId: '',
    counterpartyName: '',
  }))

  const loadRef = useRef<() => Promise<void>>(async () => {})

  const loadRows = useCallback(async () => {
    setLoading(true)
    const { data, error } = await fetchInvoiceRecordsForDisplay(applied)
    if (error) {
      void message.error(error.message)
      setRows([])
    } else {
      setRows(data)
    }
    setLoading(false)
  }, [applied])

  useEffect(() => {
    loadRef.current = loadRows
  }, [loadRows])

  useEffect(() => {
    queueMicrotask(() => {
      void loadRows()
    })
  }, [loadRows])

  useEffect(() => {
    const onImported = () => {
      setPage(1)
      void loadRef.current()
    }
    window.addEventListener(INVOICE_IMPORTED_EVENT, onImported)
    return () => window.removeEventListener(INVOICE_IMPORTED_EVENT, onImported)
  }, [])

  const pagedRows = useMemo(() => {
    const from = (page - 1) * pageSize
    return rows.slice(from, from + pageSize)
  }, [page, pageSize, rows])

  const totals = useMemo(() => {
    const amount = rows.reduce((sum, r) => sum + (r.amount ?? 0), 0)
    const tax = rows.reduce((sum, r) => sum + (r.tax_amount ?? 0), 0)
    return { amount, tax }
  }, [rows])

  const exportRows = useCallback(
    (mode: 'selected' | 'all') => {
      void (async () => {
        setExporting(true)
        const progressRef: { hide?: () => void } = {}
        const showProgress = (text: string) => {
          progressRef.hide?.()
          const closer = message.loading(text, 0)
          progressRef.hide = () => {
            closer()
          }
        }
        const clearProgress = () => {
          progressRef.hide?.()
          progressRef.hide = undefined
        }

        if (mode === 'selected') {
          if (selectedRowKeys.length === 0) {
            void message.warning('没有可导出的发票')
            setExporting(false)
            return
          }
          try {
            showProgress('正在读取选中发票号码…')
            const { data: digitalNos, error } = await fetchInvoiceDigitalInvoiceNosByIds(selectedRowKeys)
            if (error) throw error
            if (digitalNos.length === 0) {
              void message.warning('没有可导出的发票')
              return
            }
            showProgress(`正在从全量 Excel 筛选 ${digitalNos.length} 张发票…`)
            const result = await exportInvoiceFullExcelByDigitalNos(digitalNos)
            clearProgress()
            void message.success(`已导出 ${result.rowCount} 条 Excel 数据`)
          } catch (e: unknown) {
            clearProgress()
            void message.error(e instanceof Error ? e.message : String(e))
          } finally {
            clearProgress()
            setExporting(false)
          }
          return
        }

        try {
          const dateOnly = hasDateFilter(applied) && !hasNonDateExportFilter(applied)
          const noExportFilters = !hasDateFilter(applied) && !hasNonDateExportFilter(applied)

          if (noExportFilters) {
            showProgress('正在下载全量发票 Excel…')
            await exportOriginalInvoiceFullExcelBaseline()
            clearProgress()
            void message.success('已导出全量发票 Excel')
            return
          }

          if (dateOnly) {
            showProgress('正在按开票日期筛选全量 Excel…')
            const result = await exportInvoiceFullExcelByIssueDateRange({
              issueFrom: applied.issueFrom,
              issueTo: applied.issueTo,
            })
            clearProgress()
            void message.success(`已导出 ${result.rowCount} 条 Excel 数据`)
            return
          }

          showProgress('正在按查询条件读取发票号码…')
          const digitalNos = await fetchAllInvoiceDigitalInvoiceNosForExport(applied, {
            onProgress: (loaded) => {
              showProgress(`正在读取 ${loaded} 个发票号码…`)
            },
          })
          if (digitalNos.length === 0) {
            void message.warning('没有可导出的发票')
            return
          }

          showProgress(`正在从全量 Excel 筛选 ${digitalNos.length} 张发票…`)
          const result = await exportInvoiceFullExcelByDigitalNos(digitalNos)
          clearProgress()
          void message.success(`已导出 ${result.rowCount} 条 Excel 数据`)
        } catch (e: unknown) {
          clearProgress()
          void message.error(e instanceof Error ? e.message : String(e))
        } finally {
          clearProgress()
          setExporting(false)
        }
      })()
    },
    [applied, selectedRowKeys],
  )

  const handleDeleteRecord = useCallback(
    (row: InvoiceRecordRow) => {
      Modal.confirm({
        title: '确认删除这条发票数据？',
        content: `删除后可重新导入同一张 PDF。数电发票号码：${row.digital_invoice_no}`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        async onOk() {
          const { error } = await supabase.from('invoice_records').delete().eq('id', row.id)
          if (error) {
            message.error(error.message)
            throw error
          }
          message.success('已删除')
          setSelectedRowKeys((keys) => keys.filter((k) => k !== row.id))
          if (rows.length === 1 && page > 1) {
            setPage((p) => Math.max(1, p - 1))
            return
          }
          await loadRef.current()
        },
      })
    },
    [page, rows.length],
  )

  const exportMenu: MenuProps['items'] = [
    { key: 'selected', label: '导出选中', onClick: () => exportRows('selected') },
    { key: 'all', label: '导出全部', onClick: () => exportRows('all') },
  ]

  const columns: ColumnsType<InvoiceRecordRow> = useMemo(
    () => [
      {
        title: '序号',
        width: 70,
        align: 'center',
        render: (_v, _r, i) => (page - 1) * pageSize + (i ?? 0) + 1,
      },
      { title: '票种', dataIndex: 'invoice_type', width: 180, ellipsis: true },
      { title: '发票状态', dataIndex: 'invoice_status', width: 90 },
      { title: '数电发票号码', dataIndex: 'digital_invoice_no', width: 210 },
      { title: '发票代码', dataIndex: 'invoice_code', width: 110, render: (v) => v || '—' },
      { title: '发票号码', dataIndex: 'invoice_number', width: 110, render: (v) => v || '—' },
      { title: '发票风险等级', dataIndex: 'risk_level', width: 110, render: (v) => (
        <span className={invoiceRiskTagClass(v)}>{v || '正常'}</span>
      ) },
      {
        title: '购/销方名称',
        width: 180,
        ellipsis: true,
        render: (_v, row) => partyName(row, applied.queryType),
      },
      {
        title: '购/销方识别号',
        width: 180,
        ellipsis: true,
        render: (_v, row) => partyTaxId(row, applied.queryType),
      },
      {
        title: '金额',
        dataIndex: 'amount',
        width: 110,
        align: 'right',
        render: (v) => fmtMoney(v),
      },
      {
        title: '税额',
        dataIndex: 'tax_amount',
        width: 100,
        align: 'right',
        render: (v) => fmtMoney(v),
      },
      {
        title: '价税合计',
        dataIndex: 'total_amount',
        width: 110,
        align: 'right',
        render: (v) => fmtMoney(v),
      },
      { title: '特定业务类型', dataIndex: 'business_type', width: 120, render: (v) => v || '—' },
      {
        title: '开票日期',
        dataIndex: 'issue_date',
        width: 160,
        render: (v) => fmtDate(v),
      },
      { title: '查询类型', width: 100, render: () => applied.queryType },
      { title: '发票来源', dataIndex: 'invoice_source', width: 140, ellipsis: true },
      {
        title: '开票人',
        dataIndex: 'issuer',
        width: 90,
        render: (v, row) => (
          <button
            type="button"
            className="etax-q-void-delete-trigger"
            title="双击删除该条发票数据"
            onDoubleClick={() => handleDeleteRecord(row)}
          >
            {v || '—'}
          </button>
        ),
      },
      {
        title: '操作',
        fixed: 'right',
        width: 160,
        render: (_v, row) => (
          <Space size={8}>
            <Link className="etax-q-table-link" to={`/invoice-query/record/${row.id}`}>
              详情
            </Link>
            <Link className="etax-q-table-link" to={`/invoice-query/record/${row.id}?preview=1`}>
              预览
            </Link>
            <button type="button" className="etax-q-table-link etax-q-table-link-btn" disabled>
              交付
            </button>
          </Space>
        ),
      },
    ],
    [applied.queryType, handleDeleteRecord, page, pageSize],
  )

  return (
    <ConfigProvider locale={zhCN}>
      <div className="etax-query-page etax-invoice-query-page etax-query-antd">
        <div className="etax-query-bc-bar">
          <button type="button" className="etax-query-back" onClick={() => navigate('/invoice-query/stats')}>
            ← 返回
          </button>
          <nav className="etax-query-bc" aria-label="面包屑">
            <Link to="/" className="etax-bc-link">
              税务数字账户
            </Link>
            <span className="etax-bc-sep">&gt;</span>
            <span className="etax-bc-plain">发票业务</span>
            <span className="etax-bc-sep">&gt;</span>
            <Link to="/invoice-query/stats" className="etax-bc-link">
              发票查询统计
            </Link>
            <span className="etax-bc-sep">&gt;</span>
            <span className="etax-bc-plain etax-bc-current">全量发票查询</span>
          </nav>
        </div>

        <section className="etax-query-workbench-panel">
          <Card className="etax-query-filters-card" title="查询条件">
            <Form
              form={form}
              layout="horizontal"
              labelCol={{ flex: '0 0 142px' }}
              wrapperCol={{ flex: '1 1 0' }}
              initialValues={{
                queryType: '开具发票',
                invoiceSource: '全部',
                invoiceType: '全部',
                invoiceStatus: '全部',
                isPositive: '全部',
              }}
              onFinish={(v) => {
                setPage(1)
                setApplied({
                  queryType: v.queryType ?? '开具发票',
                  invoiceSource: v.invoiceSource ?? '全部',
                  invoiceType: v.invoiceType ?? '全部',
                  invoiceStatus: v.invoiceStatus ?? '全部',
                  isPositive: v.isPositive ?? '全部',
                  digitalNo: v.digitalNo ?? '',
                  invoiceCode: v.invoiceCode ?? '',
                  invoiceNumber: v.invoiceNumber ?? '',
                  counterpartyTaxId: v.counterpartyTaxId ?? '',
                  counterpartyName: v.counterpartyName ?? '',
                  amountFrom: v.amountFrom,
                  amountTo: v.amountTo,
                  issueFrom: v.issueFrom,
                  issueTo: v.issueTo,
                })
              }}
            >
              <Row gutter={[28, 18]}>
                <Col xs={24} lg={8}>
                  <Form.Item name="queryType" label="查询类型" rules={[{ required: true }]}>
                    <Select options={INVOICE_QUERY_TYPE_OPTIONS} />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={8}>
                  <Form.Item name="invoiceSource" label="发票来源">
                    <Select options={INVOICE_SOURCE_OPTIONS} />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={8}>
                  <Form.Item name="invoiceType" label="票种">
                    <Select options={INVOICE_TYPE_OPTIONS} />
                  </Form.Item>
                </Col>
              </Row>
              <div className={filtersExpanded ? undefined : 'etax-query-filters-extra--collapsed'}>
                <Row gutter={[28, 18]}>
                  <Col xs={24} lg={8}>
                    <Form.Item name="invoiceStatus" label="发票状态">
                      <Select options={INVOICE_STATUS_OPTIONS} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={8}>
                    <Form.Item name="isPositive" label="是否正数发票">
                      <Select options={INVOICE_POSITIVE_OPTIONS} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={8}>
                    <Form.Item name="digitalNo" label="数电发票号码">
                      <Input allowClear />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={[28, 18]}>
                  <Col xs={24} lg={8}>
                    <Form.Item name="invoiceCode" label="发票代码">
                      <Input allowClear />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={8}>
                    <Form.Item name="invoiceNumber" label="发票号码">
                      <Input allowClear />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={8}>
                    <Form.Item name="counterpartyTaxId" label="对方纳税人识别号">
                      <Input allowClear />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={[28, 18]}>
                  <Col xs={24} lg={8}>
                    <Form.Item name="counterpartyName" label="对方纳税人名称">
                      <Input allowClear />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={8}>
                    <Form.Item label="发票金额（起）" name="amountFrom">
                      <InputNumber style={{ width: '100%' }} min={0} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={8}>
                    <Form.Item label="发票金额（止）" name="amountTo">
                      <InputNumber style={{ width: '100%' }} min={0} />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={[28, 18]}>
                  <Col xs={24} lg={8}>
                    <Form.Item name="issueFrom" label="开票日期（起）">
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} lg={8}>
                    <Form.Item name="issueTo" label="开票日期（止）">
                      <DatePicker style={{ width: '100%' }} />
                    </Form.Item>
                  </Col>
                </Row>
              </div>
              <div className="etax-query-filter-actions">
                <Space>
                  <Button onClick={() => form.resetFields()}>重置</Button>
                  <Button type="primary" htmlType="submit">
                    查询
                  </Button>
                  <Button type="link" onClick={() => setFiltersExpanded((v) => !v)}>
                    {filtersExpanded ? '收起' : '展开'}
                  </Button>
                </Space>
              </div>
            </Form>
          </Card>

          <Card className="etax-query-result-card">
            <div className="etax-invoice-query-toolbar">
              <Space>
                <Dropdown menu={{ items: exportMenu }} disabled={exporting}>
                  <Button type="primary" loading={exporting}>
                    导出
                  </Button>
                </Dropdown>
              </Space>
              <div className="etax-invoice-query-summary">
                查询结果：合计金额：{fmtMoney(totals.amount)}元 合计税额：{fmtMoney(totals.tax)}元
                {rows.length >= INVOICE_QUERY_DISPLAY_LIMIT ? (
                  <span className="etax-invoice-query-summary-hint">
                    （列表最多显示 {INVOICE_QUERY_DISPLAY_LIMIT} 条，导出全部可获取完整数据）
                  </span>
                ) : null}
              </div>
            </div>
            <Spin spinning={loading}>
              <Table
                rowKey="id"
                size="small"
                scroll={{ x: 2200 }}
                dataSource={pagedRows}
                columns={columns}
                rowSelection={{
                  selectedRowKeys,
                  onChange: (keys) => setSelectedRowKeys(keys as string[]),
                }}
                pagination={{
                  current: page,
                  pageSize,
                  total: rows.length,
                  showSizeChanger: false,
                  onChange: setPage,
                  showTotal: (t) => `共 ${t} 条`,
                }}
              />
            </Spin>
          </Card>
        </section>
      </div>
    </ConfigProvider>
  )
}
