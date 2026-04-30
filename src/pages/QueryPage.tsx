import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  Alert,
  Button,
  Card,
  Col,
  ConfigProvider,
  DatePicker,
  Form,
  Pagination,
  Row,
  Select,
  Space,
  Spin,
  Table,
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import zhCN from 'antd/locale/zh_CN'
import dayjs, { type Dayjs } from 'dayjs'
import 'dayjs/locale/zh-cn'
import {
  QUERY_CORRECTION_TYPE_OPTIONS,
  QUERY_FORM_KIND_OPTIONS as QUERY_PAGE_FORM_KIND_OPTIONS,
  QUERY_FORM_KIND_SELECTOR_HIDDEN,
  VOID_FLAG_ALL_LABEL,
  QUERY_FORM_KIND_ALL_VALUE,
  getActiveQueryFormKind,
} from '../constants/queryFormKinds'
import {
  DEFAULT_FORM_CODE,
  DEFAULT_FORM_TYPE_LABEL,
  DEFAULT_CORRECTION,
  DEFAULT_VOID_FLAG,
} from '../lib/declarationIndex'
import { FORM_DATA_EXCEL_IMPORTED_EVENT } from '../lib/formDataExcelUpload'
import { supabase } from '../lib/supabase'
import type { FormDataRow } from '../types/database'

dayjs.locale('zh-cn')

type FilterVals = {
  formKind: string
  correctionTypes: string[]
  voidFlag: string
  taxPeriodFrom: string
  taxPeriodTo: string
  declFrom: string
  declTo: string
}

type QueryExportSnapshot = {
  reason: 'record-export-return' | 'record-preview-return'
  savedAt: number
  filters: FilterVals
}

type SelectOption = {
  value: string
  label: string
}

const QUERY_EXPORT_SNAPSHOT_KEY = 'taxmanager:query-export-snapshot'
const QUERY_EXPORT_SNAPSHOT_MAX_AGE_MS = 10 * 60 * 1000

const STATIC_FORM_KIND_OPTIONS = QUERY_PAGE_FORM_KIND_OPTIONS

const VOID_OPTIONS = [
  { value: VOID_FLAG_ALL_LABEL, label: VOID_FLAG_ALL_LABEL },
  { value: DEFAULT_VOID_FLAG, label: '未作废' },
  { value: '已作废', label: '已作废' },
]

const CORRECTION_SELECT_OPTIONS = QUERY_CORRECTION_TYPE_OPTIONS.map((x) => ({ value: x, label: x }))

const defaultCorrectionTypesAll = () => [...QUERY_CORRECTION_TYPE_OPTIONS]

function mergeFormKindOptions(staticOptions: SelectOption[], dbOptions: SelectOption[]): SelectOption[] {
  const seen = new Set<string>()
  const merged: SelectOption[] = []
  for (const option of [...staticOptions, ...dbOptions]) {
    if (seen.has(option.value)) continue
    seen.add(option.value)
    merged.push(option)
  }
  return merged
}

function dbFormKindLabel(code: string, label?: string | null): string {
  const text = label?.trim()
  if (!text) return code
  return text.startsWith(code) ? text : `${code} ${text}`
}

function buildDefaultFilters(): FilterVals {
  const start = dayjs().startOf('month')
  const end = dayjs().endOf('month')
  return {
    formKind: QUERY_FORM_KIND_ALL_VALUE,
    correctionTypes: defaultCorrectionTypesAll(),
    voidFlag: VOID_FLAG_ALL_LABEL,
    taxPeriodFrom: '',
    taxPeriodTo: '',
    declFrom: start.format('YYYY-MM-DD'),
    declTo: end.format('YYYY-MM-DD'),
  }
}

function isFilterVals(value: unknown): value is FilterVals {
  if (!value || typeof value !== 'object') return false
  const f = value as Partial<FilterVals>
  return (
    typeof f.formKind === 'string' &&
    Array.isArray(f.correctionTypes) &&
    f.correctionTypes.every((x) => typeof x === 'string') &&
    typeof f.voidFlag === 'string' &&
    typeof f.taxPeriodFrom === 'string' &&
    typeof f.taxPeriodTo === 'string' &&
    typeof f.declFrom === 'string' &&
    typeof f.declTo === 'string'
  )
}

function readExportQuerySnapshot(): FilterVals | null {
  const params = new URLSearchParams(window.location.search)
  const restoreReason = params.get('restoreQuery')
  if (restoreReason !== 'export' && restoreReason !== 'preview') return null

  const raw = window.sessionStorage.getItem(QUERY_EXPORT_SNAPSHOT_KEY)
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Partial<QueryExportSnapshot>
    if (restoreReason === 'export' && parsed.reason !== 'record-export-return') return null
    if (restoreReason === 'preview' && parsed.reason !== 'record-preview-return') return null
    if (typeof parsed.savedAt !== 'number') return null
    if (Date.now() - parsed.savedAt > QUERY_EXPORT_SNAPSHOT_MAX_AGE_MS) return null
    return isFilterVals(parsed.filters) ? parsed.filters : null
  } catch {
    return null
  }
}

function writeQueryReturnSnapshot(
  filters: FilterVals,
  reason: QueryExportSnapshot['reason'],
) {
  const snapshot: QueryExportSnapshot = {
    reason,
    savedAt: Date.now(),
    filters,
  }
  window.sessionStorage.setItem(QUERY_EXPORT_SNAPSHOT_KEY, JSON.stringify(snapshot))
}

function filterValsToFormShape(f: FilterVals): QueryFormShape {
  return {
    formKind: f.formKind || undefined,
    correctionTypes: f.correctionTypes.length ? [...f.correctionTypes] : defaultCorrectionTypesAll(),
    voidFlag: f.voidFlag,
    taxPeriodFrom: f.taxPeriodFrom ? dayjs(f.taxPeriodFrom) : undefined,
    taxPeriodTo: f.taxPeriodTo ? dayjs(f.taxPeriodTo) : undefined,
    declFrom: dayjs(f.declFrom),
    declTo: dayjs(f.declTo),
  }
}

function formShapeToFilterVals(v: QueryFormShape): FilterVals {
  return {
    formKind: QUERY_FORM_KIND_SELECTOR_HIDDEN ? getActiveQueryFormKind(v.formKind ?? '') : (v.formKind ?? ''),
    correctionTypes: v.correctionTypes?.length ? [...v.correctionTypes] : [],
    voidFlag: v.voidFlag,
    taxPeriodFrom: v.taxPeriodFrom ? v.taxPeriodFrom.format('YYYY-MM-DD') : '',
    taxPeriodTo: v.taxPeriodTo ? v.taxPeriodTo.format('YYYY-MM-DD') : '',
    declFrom: v.declFrom.format('YYYY-MM-DD'),
    declTo: v.declTo.format('YYYY-MM-DD'),
  }
}

type QueryFormShape = {
  formKind?: string
  correctionTypes: string[]
  voidFlag: string
  taxPeriodFrom?: Dayjs
  taxPeriodTo?: Dayjs
  declFrom: Dayjs
  declTo: Dayjs
}

type EmbeddedIndex = {
  form_code?: string
  form_type_label?: string
  correction_type?: string
  void_flag?: string
  taxpayer_name?: string
  declaration_date?: string | null
  tax_period_start?: string | null
  tax_period_end?: string | null
  tax_amount_due?: number | null
}

function indexFromRow(row: FormDataRow): EmbeddedIndex {
  const raw = row.content
  let emb: EmbeddedIndex | undefined
  if (raw && typeof raw === 'object' && raw !== null && 'declaration_index' in raw) {
    emb = (raw as { declaration_index?: EmbeddedIndex }).declaration_index
  }

  return {
    form_code: row.form_code ?? emb?.form_code ?? DEFAULT_FORM_CODE,
    form_type_label: row.form_type_label ?? emb?.form_type_label ?? DEFAULT_FORM_TYPE_LABEL,
    correction_type: row.correction_type ?? emb?.correction_type,
    void_flag: row.void_flag ?? emb?.void_flag,
    taxpayer_name: row.taxpayer_name ?? emb?.taxpayer_name,
    declaration_date: row.declaration_date ?? emb?.declaration_date ?? null,
    tax_period_start: row.tax_period_start ?? emb?.tax_period_start ?? null,
    tax_period_end: row.tax_period_end ?? emb?.tax_period_end ?? null,
    tax_amount_due: row.tax_amount_due ?? emb?.tax_amount_due ?? null,
  }
}

function declarationKind(row: FormDataRow): string {
  return indexFromRow(row).form_type_label?.trim() || DEFAULT_FORM_TYPE_LABEL
}

function formLinkLabel(row: FormDataRow): string {
  const s = declarationKind(row).trim()
  if (s.startsWith('《')) return s
  return `《${s.replace(/^《|》$/g, '')}》`
}

function cnDateDash(iso?: string | null): string {
  if (!iso) return '—'
  const [y, m, d] = iso.split('-')
  if (!y || !m || !d) return iso
  return `${y}-${m}-${d}`
}

function formatMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  return n.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtDeclDate(row: FormDataRow): string {
  const idx = indexFromRow(row)
  const v = row.declaration_date ?? idx.declaration_date ?? undefined
  return cnDateDash(v ?? null)
}

function fmtPeriodStart(row: FormDataRow): string {
  return cnDateDash(row.tax_period_start ?? indexFromRow(row).tax_period_start ?? null)
}

function fmtPeriodEnd(row: FormDataRow): string {
  return cnDateDash(row.tax_period_end ?? indexFromRow(row).tax_period_end ?? null)
}

function fmtAmount(row: FormDataRow): string {
  const n = row.tax_amount_due ?? indexFromRow(row).tax_amount_due
  return formatMoney(n)
}

function corrLabel(row: FormDataRow): string {
  return row.correction_type ?? indexFromRow(row).correction_type ?? DEFAULT_CORRECTION
}

function voidLabel(row: FormDataRow): string {
  return row.void_flag ?? indexFromRow(row).void_flag ?? DEFAULT_VOID_FLAG
}

/** 与税局列表页常见宽度对齐：标签区略宽避免折行不齐 */
const FORM_ITEM_HORIZONTAL = {
  labelCol: { flex: '0 0 142px' },
  wrapperCol: { flex: '1 1 0', style: { minWidth: 0 } },
}

/** 检索区栅格：横向略放大、纵向拉开行距（对照参考页） */
const QUERY_FILTER_ROW_GUTTER: [number, number] = [28, 18]

function getQueryPopupContainer(trigger: HTMLElement): HTMLElement {
  const page = trigger.closest('.etax-query-page')
  return page instanceof HTMLElement ? page : document.body
}

/**
 * 申报信息查询列表：antd 表单 + 表格；折叠仅收起第 2、3 行条件；申报日期必填。
 */
export function QueryPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [form] = Form.useForm<QueryFormShape>()
  const [restoredExportFilters] = useState<FilterVals | null>(() => readExportQuerySnapshot())

  const defaultFilters = useMemo(() => restoredExportFilters ?? buildDefaultFilters(), [restoredExportFilters])
  const [appliedFilters, setAppliedFilters] = useState<FilterVals>(() => ({ ...defaultFilters }))
  const [rows, setRows] = useState<FormDataRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [formKindOptions, setFormKindOptions] = useState<SelectOption[]>(STATIC_FORM_KIND_OPTIONS)

  /** true = 展开第 2、3 行；false = 仅展示第一行（种类 / 更正 / 作废） */
  const [filtersExpanded, setFiltersExpanded] = useState(true)
  const [page, setPage] = useState(1)
  const pageSize = 10

  useEffect(() => {
    const restoreReason = searchParams.get('restoreQuery')
    if (restoreReason !== 'export' && restoreReason !== 'preview') return
    window.sessionStorage.removeItem(QUERY_EXPORT_SNAPSHOT_KEY)
    const next = new URLSearchParams(searchParams)
    next.delete('restoreQuery')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const loadFormKindOptions = useCallback(async () => {
    const { data, error: qErr } = await supabase
      .from('form_data')
      .select('form_code, form_type_label')
      .not('form_code', 'is', null)
      .order('form_code', { ascending: true })

    if (qErr) return

    const dbOptions = ((data ?? []) as Pick<FormDataRow, 'form_code' | 'form_type_label'>[])
      .map((row) => {
        const code = row.form_code?.trim()
        if (!code) return null
        return {
          value: code,
          label: dbFormKindLabel(code, row.form_type_label),
        }
      })
      .filter((x): x is SelectOption => x !== null)

    setFormKindOptions(mergeFormKindOptions(STATIC_FORM_KIND_OPTIONS, dbOptions))
  }, [])

  const loadInner = useCallback(async () => {
    setLoading(true)
    setError(null)
    const filters = appliedFilters
    try {
      let q = supabase
        .from('form_data')
        .select('*')
        .order('declaration_date', { ascending: false })
        .order('created_at', { ascending: false })

      if (filters.correctionTypes.length > 0) {
        q = q.in('correction_type', filters.correctionTypes)
      }

      if (filters.voidFlag !== VOID_FLAG_ALL_LABEL) {
        q = q.eq('void_flag', filters.voidFlag)
      }

      if (filters.formKind && filters.formKind !== QUERY_FORM_KIND_ALL_VALUE) {
        q = q.or(`form_code.eq.${filters.formKind},form_code.is.null`)
      }

      if (filters.taxPeriodFrom) q = q.gte('tax_period_start', filters.taxPeriodFrom)

      if (filters.taxPeriodTo) q = q.lte('tax_period_end', filters.taxPeriodTo)

      if (filters.declFrom) q = q.gte('declaration_date', filters.declFrom)

      if (filters.declTo) q = q.lte('declaration_date', filters.declTo)

      const { data, error: qErr } = await q

      if (qErr) {
        const fb = await supabase.from('form_data').select('*').order('created_at', { ascending: false })
        if (fb.error) {
          setError(`${qErr.message}（若缺少列请先执行 migrations）`)
          setRows([])
        } else {
          const merged = filterRowsLegacy((fb.data ?? []) as FormDataRow[], filters)
          setRows(merged)
          setError(
            '检测到尚未迁移结构化列：已仅用 JSON 快照（content.declaration_index）参与筛选展示。请在 Supabase 执行 supabase/migrations 中的 SQL。',
          )
        }
      } else {
        setRows(filterRowsLegacy((data ?? []) as FormDataRow[], filters))
        setError(null)
      }
    } catch {
      setError('加载失败')
      setRows([])
    }
    setLoading(false)
    setPage(1)
  }, [appliedFilters])

  const loadRef = useRef(loadInner)
  useEffect(() => {
    loadRef.current = loadInner
  }, [loadInner])

  useEffect(() => {
    queueMicrotask(() => {
      void loadInner()
      void loadFormKindOptions()
    })
  }, [loadInner, loadFormKindOptions])

  useEffect(() => {
    const onImported = () => {
      void loadRef.current()
      void loadFormKindOptions()
    }
    window.addEventListener(FORM_DATA_EXCEL_IMPORTED_EVENT, onImported)
    return () => window.removeEventListener(FORM_DATA_EXCEL_IMPORTED_EVENT, onImported)
  }, [loadFormKindOptions])

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize))
  const currentPage = Math.min(Math.max(1, page), totalPages)
  const pageRows = useMemo(() => {
    const from = (currentPage - 1) * pageSize
    return rows.slice(from, from + pageSize)
  }, [rows, currentPage, pageSize])

  const initialFormValues = useMemo(() => filterValsToFormShape(defaultFilters), [defaultFilters])

  const handleReset = () => {
    const next = buildDefaultFilters()
    form.setFieldsValue(filterValsToFormShape(next))
    setAppliedFilters(next)
  }

  const columns: ColumnsType<FormDataRow> = useMemo(
    () => [
      {
        title: '序号',
        key: 'idx',
        width: 70,
        align: 'center',
        render: (_v, _r, i) => (currentPage - 1) * pageSize + (i ?? 0) + 1,
      },
      {
        title: '申报表种类',
        dataIndex: 'id',
        ellipsis: true,
        render: (_id, row) => (
          <Link
            className="etax-q-table-link"
            to={`/record/${row.id}?return=query&restoreQuery=preview`}
            onClick={() => writeQueryReturnSnapshot(appliedFilters, 'record-preview-return')}
          >
            {formLinkLabel(row)}
          </Link>
        ),
      },
      {
        title: '申报日期',
        key: 'decl',
        width: 120,
        render: (_v, row) => fmtDeclDate(row),
      },
      {
        title: '税款所属期起',
        key: 'ps',
        width: 130,
        render: (_v, row) => fmtPeriodStart(row),
      },
      {
        title: '税款所属期止',
        key: 'pe',
        width: 130,
        render: (_v, row) => fmtPeriodEnd(row),
      },
      {
        title: '应补退税额',
        key: 'amt',
        width: 120,
        align: 'right',
        className: 'etax-td-money',
        render: (_v, row) => fmtAmount(row),
      },
      {
        title: '更正类型',
        key: 'corr',
        width: 200,
        ellipsis: true,
        render: (_v, row) => corrLabel(row),
      },
      {
        title: '作废标志',
        key: 'vf',
        width: 100,
        render: (_v, row) => voidLabel(row),
      },
      {
        title: '操作',
        key: 'act',
        width: 88,
        fixed: 'right',
        render: (_v, row) => (
          <Link
            className="etax-q-table-link"
            to={`/record/${row.id}?pdf=1&return=query&restoreQuery=export`}
            onClick={() => writeQueryReturnSnapshot(appliedFilters, 'record-export-return')}
          >
            导出
          </Link>
        ),
      },
    ],
    [appliedFilters, currentPage, pageSize],
  )

  return (
    <ConfigProvider
      locale={zhCN}
      theme={{
        token: {
          colorPrimary: '#1976ff',
          borderRadius: 4,
          controlHeight: 34,
          zIndexPopupBase: 3000,
        },
      }}
    >
      <div className="etax-query-page etax-query-antd">
        <div className="etax-query-bc-bar">
          <button type="button" className="etax-query-back" onClick={() => navigate('/')}>
            ← 返回
          </button>
          <nav className="etax-query-bc" aria-label="面包屑">
            <Link to="/" className="etax-bc-link">
              税务数字账户
            </Link>
            <span className="etax-bc-sep">&gt;</span>
            <span className="etax-bc-plain">账户查询</span>
            <span className="etax-bc-sep">&gt;</span>
            <span className="etax-bc-plain">申报信息查询</span>
            <span className="etax-bc-sep">&gt;</span>
            <span className="etax-bc-plain etax-bc-current">申报信息查询</span>
          </nav>
        </div>

        <section className="etax-query-workbench-panel">
          <div className="etax-query-filters-wrap" aria-labelledby="etax-query-filter-heading">
          <Card
            className="etax-query-filters-card"
            title={
              <h2 id="etax-query-filter-heading" className="etax-query-panel-title etax-query-panel-title--card">
                查询条件
              </h2>
            }
          >
            <Form<QueryFormShape>
              form={form}
              layout="horizontal"
              labelAlign="right"
              requiredMark
              colon={false}
              {...FORM_ITEM_HORIZONTAL}
              initialValues={initialFormValues}
              className="etax-query-antd-form etax-query-antd-form--horizontal"
              onFinish={(v) => {
                const shape: QueryFormShape = {
                  ...v,
                  formKind: QUERY_FORM_KIND_SELECTOR_HIDDEN ? getActiveQueryFormKind(v.formKind ?? '') : v.formKind,
                }
                setAppliedFilters(formShapeToFilterVals(shape))
              }}
            >
              <Row gutter={QUERY_FILTER_ROW_GUTTER} wrap className="etax-query-filter-row-primary">
                <Col
                  xs={24}
                  lg={8}
                  style={{ display: QUERY_FORM_KIND_SELECTOR_HIDDEN ? 'none' : undefined }}
                  aria-hidden={QUERY_FORM_KIND_SELECTOR_HIDDEN ? true : undefined}
                >
                  <Form.Item name="formKind" label="申报表种类">
                    <Select
                      showSearch
                      allowClear
                      optionFilterProp="label"
                      options={formKindOptions}
                      placeholder="请选择"
                      getPopupContainer={getQueryPopupContainer}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={8}>
                  <Form.Item
                    name="correctionTypes"
                    label="更正类型"
                    rules={[{ required: true, message: '请至少选择一项更正类型' }]}
                  >
                    <Select
                      mode="multiple"
                      allowClear
                      maxTagCount="responsive"
                      options={CORRECTION_SELECT_OPTIONS}
                      placeholder="请选择"
                      optionFilterProp="label"
                      getPopupContainer={getQueryPopupContainer}
                    />
                  </Form.Item>
                </Col>
                <Col xs={24} lg={8}>
                  <Form.Item name="voidFlag" label="作废标志">
                    <Select
                      allowClear
                      options={VOID_OPTIONS}
                      placeholder="请选择"
                      getPopupContainer={getQueryPopupContainer}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <div
                className="etax-query-filter-rows-secondary"
                style={{ display: filtersExpanded ? undefined : 'none' }}
                aria-hidden={!filtersExpanded}
              >
                <Row gutter={QUERY_FILTER_ROW_GUTTER}>
                  <Col xs={24} md={12} xl={8}>
                    <Form.Item name="taxPeriodFrom" label="税款所属期起">
                      <DatePicker
                        style={{ width: '100%' }}
                        allowClear
                        format="YYYY-MM-DD"
                        placeholder="请选择"
                        getPopupContainer={getQueryPopupContainer}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12} xl={8}>
                    <Form.Item name="taxPeriodTo" label="税款所属期止">
                      <DatePicker
                        style={{ width: '100%' }}
                        allowClear
                        format="YYYY-MM-DD"
                        placeholder="请选择"
                        getPopupContainer={getQueryPopupContainer}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12} xl={8}>
                    <Form.Item
                      name="declFrom"
                      label="申报日期起"
                      rules={[{ required: true, message: '请选择申报日期起' }]}
                    >
                      <DatePicker
                        style={{ width: '100%' }}
                        allowClear
                        format="YYYY-MM-DD"
                        placeholder="请选择"
                        getPopupContainer={getQueryPopupContainer}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={QUERY_FILTER_ROW_GUTTER}>
                  <Col xs={24} md={12} xl={8}>
                    <Form.Item
                      name="declTo"
                      label="申报日期止"
                      dependencies={['declFrom']}
                      rules={[
                        { required: true, message: '请选择申报日期止' },
                        ({ getFieldValue }) => ({
                          validator(_, value) {
                            const from = getFieldValue('declFrom') as Dayjs | undefined
                            if (!value || !from) return Promise.resolve()
                            if (value.isBefore(from, 'day')) {
                              return Promise.reject(new Error('申报日期止不能早于申报日期起'))
                            }
                            return Promise.resolve()
                          },
                        }),
                      ]}
                    >
                      <DatePicker
                        style={{ width: '100%' }}
                        allowClear
                        format="YYYY-MM-DD"
                        placeholder="请选择"
                        getPopupContainer={getQueryPopupContainer}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </div>

              <Row className="etax-query-form-actions-row" justify="end">
                <Col>
                  <Form.Item label={null} style={{ marginBottom: 0 }}>
                    <Space size="middle">
                      <Button onClick={() => void handleReset()}>重置</Button>
                      <Button type="primary" htmlType="submit" loading={loading}>
                        查询
                      </Button>
                      <button
                        type="button"
                        className="etax-query-collapse-toggle"
                        onClick={() => setFiltersExpanded((v) => !v)}
                        aria-expanded={filtersExpanded}
                      >
                        {filtersExpanded ? '收起 ^' : '展开 v'}
                      </button>
                    </Space>
                  </Form.Item>
                </Col>
              </Row>
            </Form>
          </Card>
          </div>

          {error ? <Alert className="etax-query-alert-warn" type="warning" showIcon message={error} /> : null}

          <section className="etax-query-result-panel etax-query-result-antd" aria-labelledby="etax-query-result-title">
          <h2 id="etax-query-result-title" className="etax-query-panel-title">
            查询结果
          </h2>

          <Spin spinning={loading} description="加载中…">
            <Table<FormDataRow>
              className="etax-query-table-antd"
              rowKey="id"
              columns={columns}
              dataSource={loading ? [] : pageRows}
              pagination={false}
              locale={{
                emptyText:
                  rows.length === 0
                    ? '暂无数据'
                    : '无匹配记录，请调整条件',
              }}
              scroll={{ x: 1100 }}
            />

            {!loading && rows.length > 0 ? (
              <div className="etax-query-pagination etax-query-pagination-antd">
                <span className="muted">共 {rows.length} 项数据</span>
                <Pagination
                  size="small"
                  current={currentPage}
                  pageSize={pageSize}
                  total={rows.length}
                  showSizeChanger={false}
                  onChange={(p) => setPage(p)}
                />
              </div>
            ) : null}
          </Spin>
          </section>
        </section>
      </div>
    </ConfigProvider>
  )
}

/** 旧数据或未迁移列时在客户端再收紧条件（读取 content.declaration_index） */
function filterRowsLegacy(list: FormDataRow[], f: FilterVals): FormDataRow[] {
  return list.filter((row) => {
    const idx = indexFromRow(row)
    const fc = row.form_code ?? idx.form_code
    if (f.formKind && f.formKind !== QUERY_FORM_KIND_ALL_VALUE && fc && fc !== f.formKind) return false

    const corr = row.correction_type ?? idx.correction_type
    if (f.correctionTypes.length > 0) {
      const c = corr ?? DEFAULT_CORRECTION
      if (!f.correctionTypes.includes(c)) return false
    }

    const vf = row.void_flag ?? idx.void_flag
    if (f.voidFlag !== VOID_FLAG_ALL_LABEL && f.voidFlag) {
      const eff = vf ?? DEFAULT_VOID_FLAG
      if (eff !== f.voidFlag) return false
    }

    const tpS = row.tax_period_start ?? idx.tax_period_start
    const tpE = row.tax_period_end ?? idx.tax_period_end

    if (f.taxPeriodFrom && tpS && tpS < f.taxPeriodFrom) return false

    if (f.taxPeriodTo && tpE && tpE > f.taxPeriodTo) return false

    const d = row.declaration_date ?? idx.declaration_date ?? null
    if (f.declFrom && (!d || d < f.declFrom)) return false

    if (f.declTo && (!d || d > f.declTo)) return false

    return true
  })
}
