import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Button,
  Card,
  Col,
  ConfigProvider,
  DatePicker,
  Form,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Table,
  message,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { QuestionCircleOutlined } from '@ant-design/icons'
import zhCN from 'antd/locale/zh_CN'
import dayjs, { type Dayjs } from 'dayjs'
import 'dayjs/locale/zh-cn'
import {
  TAX_PAYMENT_CERT_COLLECTION_OPTIONS,
  TAX_PAYMENT_CERT_E_REFUND_OPTIONS,
  TAX_PAYMENT_CERT_IDENTITY_OPTIONS,
  TAX_PAYMENT_CERT_IMPORTED_EVENT,
  TAX_PAYMENT_CERT_INSPECTION_OPTIONS,
  TAX_PAYMENT_CERT_QUERY_METHOD_OPTIONS,
  TAX_PAYMENT_CERT_REPRINT_OPTIONS,
  TAX_PAYMENT_CERT_TABS,
} from '../constants/taxPaymentCertQuery'
import { downloadPdfFile } from '../lib/pdfStorage'
import { supabase } from '../lib/supabase'
import type { TaxPaymentCertRecordRow } from '../types/database'

dayjs.locale('zh-cn')

type FilterShape = {
  queryMethod: string
  periodFrom?: Dayjs
  periodTo?: Dayjs
  paymentFrom?: Dayjs
  paymentTo?: Dayjs
  isReprint: string
  collectionItem: string
  isElectronicRefund: string
  identity: string
  inspectionItem: string
}

function fmtMoney(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDate(v?: string | null): string {
  if (!v) return '—'
  return v.slice(0, 10)
}

export function TaxPaymentCertQueryPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [form] = Form.useForm<FilterShape>()
  const queryMethod = Form.useWatch('queryMethod', form) ?? '税（费）属期'
  const [rows, setRows] = useState<TaxPaymentCertRecordRow[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedRowKeys, setSelectedRowKeys] = useState<string[]>([])
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)
  const [exporting, setExporting] = useState(false)
  const [applied, setApplied] = useState<FilterShape>(() => ({
    queryMethod: '税（费）属期',
    isReprint: '全部',
    collectionItem: '全部',
    isElectronicRefund: '否',
    identity: '本企业/本人',
    inspectionItem: '全部',
  }))

  const loadRef = useRef<() => Promise<void>>(async () => {})

  const loadRows = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('tax_payment_certificate_records')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) {
      void message.error(error.message)
      setRows([])
      setLoading(false)
      return
    }

    let list = (data ?? []) as TaxPaymentCertRecordRow[]

    if (applied.queryMethod === '税（费）属期') {
      if (applied.periodFrom) {
        const from = applied.periodFrom.format('YYYY-MM-DD')
        list = list.filter((r) => !r.tax_period_end || r.tax_period_end >= from)
      }
      if (applied.periodTo) {
        const to = applied.periodTo.format('YYYY-MM-DD')
        list = list.filter((r) => !r.tax_period_start || r.tax_period_start <= to)
      }
    } else {
      if (applied.paymentFrom) {
        const from = applied.paymentFrom.format('YYYY-MM-DD')
        list = list.filter((r) => !r.payment_date || r.payment_date >= from)
      }
      if (applied.paymentTo) {
        const to = applied.paymentTo.format('YYYY-MM-DD')
        list = list.filter((r) => !r.payment_date || r.payment_date <= to)
      }
    }

    setRows(list)
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
    window.addEventListener(TAX_PAYMENT_CERT_IMPORTED_EVENT, onImported)
    return () => window.removeEventListener(TAX_PAYMENT_CERT_IMPORTED_EVENT, onImported)
  }, [])

  useEffect(() => {
    const restore = searchParams.get('restoreQuery')
    if (restore !== 'preview' && restore !== 'export') return
    const raw = sessionStorage.getItem('taxmanager:tax-payment-cert-query-snapshot')
    if (!raw) return
    try {
      const snap = JSON.parse(raw) as FilterShape & { page?: number }
      queueMicrotask(() => {
        form.setFieldsValue({
          ...snap,
          periodFrom: snap.periodFrom ? dayjs(snap.periodFrom as unknown as string) : undefined,
          periodTo: snap.periodTo ? dayjs(snap.periodTo as unknown as string) : undefined,
          paymentFrom: snap.paymentFrom ? dayjs(snap.paymentFrom as unknown as string) : undefined,
          paymentTo: snap.paymentTo ? dayjs(snap.paymentTo as unknown as string) : undefined,
        })
        setApplied(snap)
        if (snap.page) setPage(snap.page)
      })
    } catch {
      /* ignore */
    }
  }, [form, searchParams])

  const pagedRows = useMemo(() => {
    const from = (page - 1) * pageSize
    return rows.slice(from, from + pageSize)
  }, [page, pageSize, rows])

  const saveQuerySnapshot = useCallback(() => {
    sessionStorage.setItem(
      'taxmanager:tax-payment-cert-query-snapshot',
      JSON.stringify({ ...applied, page }),
    )
  }, [applied, page])

  const exportSelected = useCallback(async () => {
    const selected = rows.filter((r) => selectedRowKeys.includes(r.id))
    if (selected.length === 0) {
      void message.warning('请先勾选要导出的记录')
      return
    }
    setExporting(true)
    try {
      for (const row of selected) {
        await downloadPdfFile(row.storage_path, row.source_file_name)
      }
      void message.success(`已导出 ${selected.length} 份完税证明 PDF`)
    } catch (e: unknown) {
      void message.error(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }, [rows, selectedRowKeys])

  const handleDeleteRecord = useCallback(
    (row: TaxPaymentCertRecordRow) => {
      Modal.confirm({
        title: '确认删除这条完税证明数据？',
        content: `删除后可重新导入同一份 PDF。完税证明号码：${row.certificate_no}`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        async onOk() {
          const { error } = await supabase
            .from('tax_payment_certificate_records')
            .delete()
            .eq('id', row.id)
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

  const columns: ColumnsType<TaxPaymentCertRecordRow> = useMemo(() => {
    const dateColumns =
      applied.queryMethod === '缴（退）款时间'
        ? [
            {
              title: '缴（退）款时间',
              dataIndex: 'payment_date' as const,
              width: 140,
              render: (v: string | null) => fmtDate(v),
            },
          ]
        : [
            {
              title: '税款所属期起',
              dataIndex: 'tax_period_start' as const,
              width: 130,
              render: (v: string | null) => fmtDate(v),
            },
            {
              title: '税款所属期止',
              dataIndex: 'tax_period_end' as const,
              width: 130,
              render: (v: string | null) => fmtDate(v),
            },
          ]

    return [
      {
        title: '序号',
        width: 70,
        align: 'center' as const,
        render: (_v: unknown, _r: TaxPaymentCertRecordRow, i?: number) =>
          (page - 1) * pageSize + (i ?? 0) + 1,
      },
      { title: '原凭证号', dataIndex: 'original_voucher_no', width: 180, ellipsis: true },
      ...dateColumns,
      {
        title: '实缴（退）金额',
        dataIndex: 'actual_amount',
        width: 140,
        align: 'right' as const,
        render: (v: number | null, row: TaxPaymentCertRecordRow) => (
          <button
            type="button"
            className="etax-q-void-delete-trigger"
            title="双击删除该条完税证明数据"
            onDoubleClick={() => handleDeleteRecord(row)}
          >
            {fmtMoney(v)}
          </button>
        ),
      },
      {
        title: '操作',
        fixed: 'right' as const,
        width: 120,
        render: (_v: unknown, row: TaxPaymentCertRecordRow) => (
          <Link
            className="etax-q-table-link"
            to={`/tax-payment-cert/record/${row.id}?return=query&restoreQuery=preview`}
            onClick={saveQuerySnapshot}
          >
            预览
          </Link>
        ),
      },
    ]
  }, [applied.queryMethod, handleDeleteRecord, page, pageSize, saveQuerySnapshot])

  const dateByMethod =
    queryMethod === '缴（退）款时间'
      ? {
          fromLabel: '缴退款时间起',
          toLabel: '缴退款时间止',
          fromName: 'paymentFrom' as const,
          toName: 'paymentTo' as const,
        }
      : {
          fromLabel: '税款所属期起',
          toLabel: '税款所属期止',
          fromName: 'periodFrom' as const,
          toName: 'periodTo' as const,
        }

  return (
    <ConfigProvider locale={zhCN}>
      <div className="etax-query-page etax-tax-payment-cert-page etax-query-antd">
        <div className="etax-query-bc-bar">
          <button type="button" className="etax-query-back" onClick={() => navigate('/')}>
            ← 返回
          </button>
          <nav className="etax-query-bc" aria-label="面包屑">
            <Link to="/" className="etax-bc-link">
              首页
            </Link>
            <span className="etax-bc-sep">&gt;</span>
            <span className="etax-bc-plain etax-bc-current">开具税收完税证明</span>
          </nav>
        </div>

        <section className="etax-query-workbench-panel">
          <div className="etax-tax-payment-cert-tabs" role="tablist" aria-label="完税证明类型">
            {TAX_PAYMENT_CERT_TABS.map((tab) => (
              <div
                key={tab.key}
                className={`etax-tax-payment-cert-tab${tab.active ? ' etax-tax-payment-cert-tab--active' : ' etax-tax-payment-cert-tab--disabled'}`}
                role="tab"
                aria-selected={tab.active}
              >
                <span>{tab.label}</span>
                {tab.info && (
                  <QuestionCircleOutlined className="etax-tax-payment-cert-tab-info" aria-label="说明" />
                )}
              </div>
            ))}
          </div>

          <Card className="etax-query-filters-card" title="查询条件">
            <Form
              form={form}
              layout="horizontal"
              labelCol={{ flex: '0 0 142px' }}
              wrapperCol={{ flex: '1 1 0' }}
              initialValues={{
                queryMethod: '税（费）属期',
                isReprint: '全部',
                collectionItem: '全部',
                isElectronicRefund: '否',
                identity: '本企业/本人',
                inspectionItem: '全部',
              }}
              onFinish={(v) => {
                setPage(1)
                setApplied({
                  queryMethod: v.queryMethod,
                  periodFrom: v.periodFrom,
                  periodTo: v.periodTo,
                  paymentFrom: v.paymentFrom,
                  paymentTo: v.paymentTo,
                  isReprint: v.isReprint,
                  collectionItem: v.collectionItem,
                  isElectronicRefund: v.isElectronicRefund,
                  identity: v.identity,
                  inspectionItem: v.inspectionItem,
                })
              }}
            >
              <Row gutter={[28, 18]}>
                <Col xs={24} lg={8}>
                  <Form.Item name="queryMethod" label="查询方式" rules={[{ required: true }]}>
                    <Select options={TAX_PAYMENT_CERT_QUERY_METHOD_OPTIONS} />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={8}>
                  <Form.Item name={dateByMethod.fromName} label={dateByMethod.fromLabel}>
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={8}>
                  <Form.Item name={dateByMethod.toName} label={dateByMethod.toLabel}>
                    <DatePicker style={{ width: '100%' }} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={[28, 18]}>
                <Col xs={24} lg={8}>
                  <Form.Item name="isReprint" label="是否补打">
                    <Select options={TAX_PAYMENT_CERT_REPRINT_OPTIONS} />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={8}>
                  <Form.Item name="collectionItem" label="征收项目">
                    <Select options={TAX_PAYMENT_CERT_COLLECTION_OPTIONS} />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={8}>
                  <Form.Item name="isElectronicRefund" label="是否电子退税">
                    <Select options={TAX_PAYMENT_CERT_E_REFUND_OPTIONS} />
                  </Form.Item>
                </Col>
              </Row>
              <Row gutter={[28, 18]}>
                <Col xs={24} lg={8}>
                  <Form.Item name="identity" label="企业/个人身份">
                    <Select options={TAX_PAYMENT_CERT_IDENTITY_OPTIONS} />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={8}>
                  <Form.Item name="inspectionItem" label="报验项目选择">
                    <Select options={TAX_PAYMENT_CERT_INSPECTION_OPTIONS} />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={8}>
                  <div className="etax-query-filter-actions etax-query-filter-actions--inline">
                    <Space>
                      <Button onClick={() => form.resetFields()}>重置</Button>
                      <Button type="primary" htmlType="submit">
                        查询
                      </Button>
                    </Space>
                  </div>
                </Col>
              </Row>
            </Form>
          </Card>

          <Card className="etax-query-result-card">
            <div className="etax-invoice-query-toolbar">
              <Space>
                <Button type="primary" loading={exporting} onClick={() => void exportSelected()}>
                  导出
                </Button>
              </Space>
            </div>
            <Spin spinning={loading}>
              <Table
                rowKey="id"
                size="small"
                scroll={{ x: 980 }}
                dataSource={pagedRows}
                columns={columns}
                locale={{ emptyText: '暂无数据' }}
                rowSelection={{
                  selectedRowKeys,
                  onChange: (keys) => setSelectedRowKeys(keys as string[]),
                }}
                pagination={{
                  current: page,
                  pageSize,
                  total: rows.length,
                  showSizeChanger: true,
                  pageSizeOptions: ['5', '10', '20'],
                  onChange: (p, ps) => {
                    setPage(p)
                    if (ps && ps !== pageSize) {
                      setPageSize(ps)
                      setPage(1)
                    }
                  },
                  showTotal: (t) => `共 ${t} 项数据`,
                  showQuickJumper: true,
                }}
              />
            </Spin>
          </Card>
        </section>
      </div>
    </ConfigProvider>
  )
}
