import type { CSSProperties } from 'react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { Dayjs } from 'dayjs'
import {
  ConfigProvider,
  DatePicker,
  Input,
  Modal,
  Select,
  message,
} from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import { ETAX_PUBLIC } from '../constants/assetBase'
import {
  HOME_TODO_STATUS_OPTIONS,
  type TodoStatusTone,
  defaultTodoStatusForTab,
  todoActionsForStatus,
  todoStatusToneForLabel,
} from '../constants/homeTodo'
import { supabase } from '../lib/supabase'

dayjs.locale('zh-cn')

const homeAsset = `${ETAX_PUBLIC}home/`

const hotServiceItems = [
  { label: '新办纳税人开业', icon: 'service-new-taxpayer.png' },
  { label: '代开增值税发票', icon: 'service-invoice.png' },
  { label: '印花税申报', icon: 'service-stamp-tax.png' },
  { label: '车船税申报', icon: 'service-vehicle-tax.png' },
  { label: '开具税收完税证明', icon: 'service-tax-proof.png' },
  { label: '开具无欠税证明', icon: 'service-no-arrears.png' },
  { label: '跨境相关人员关联关系', icon: 'service-cross-border.png' },
]

const recommendLeft = [
  { t: '国家税务总局关于啤酒计征消费税有关问题的公告', d: '2026/4/1' },
  { t: '国家税务总局 工业和信息化部关于发布（免征车辆购置税的...', d: '2026/3/13' },
  { t: '国家税务总局关于调整增值税纳税申报有关事项的公告', d: '2026/2/1' },
  { t: '国家税务总局关于发布《出口业务增值税和消费税退（免）税...', d: '2026/1/30' },
  { t: '国家税务总局关于起征点标准等增值税征管事项的公告', d: '2026/1/30' },
]

const recommendRight = [
  { t: '国家税务总局关于土地增值税若干征管口径的公告', d: '2026/1/1' },
  { t: '国家税务总局关于增值税一般纳税人登记管理有关事项的公告', d: '2026/1/1' },
  { t: '国家税务总局关于废止《增值税一般纳税人登记管理办法》的决定', d: '2026/1/1' },
  { t: '国家税务总局 工业和信息化部关于发布（免征车辆购置税的没有...', d: '2025/12/26' },
  { t: '国家税务总局 最高人民法院关于企业破产程序中若干税费征管事...', d: '2025/11/27' },
]

/** 提醒文案固定，日期相对于「今天」回推，视觉上常新 */
const reminderTextsFixed = [
  '出口应征税台账新增报关单提醒',
  '增值税专用发票即将逾期认证提醒',
  '残疾人就业保障金申报期临近提醒',
  '更正申报后需重新打开税款缴纳界面',
]

/** 相对今天回推天数（可自行调整间隔） */
const reminderDaysAgoPattern = [2, 4, 7, 11]

function buildRollingReminders(): { text: string; date: string }[] {
  const today = dayjs()
  return reminderTextsFixed.map((text, i) => ({
    text,
    date: today
      .subtract(reminderDaysAgoPattern[i % reminderDaysAgoPattern.length], 'day')
      .format('YYYY-MM-DD'),
  }))
}

export type TodoTabId = 'declare' | 'doc' | 'risk' | 'other'

/** 表头双击新增占位 id（不入库）；保存时执行 insert */
const NEW_HOME_TODO_ID = '__home_todo_new__'

function nextTodoSortOrder(rows: HomeTodoDb[]): number {
  if (rows.length === 0) return 0
  let max = rows[0].sort_order
  for (let i = 1; i < rows.length; i += 1) {
    max = Math.max(max, rows[i].sort_order)
  }
  return max + 1
}

type HomeTodoDb = {
  id: string
  tab: TodoTabId
  sort_order: number
  matter: string
  deadline: string
  status: string
  /** ISO 时间戳，列表按此项倒序（最新在上） */
  created_at: string
}

const TAB_ORDER: TodoTabId[] = ['declare', 'doc', 'risk', 'other']

const HOME_PROFILE_ID = 'default'

type HomeProfileField =
  | 'company_name'
  | 'tax_id'
  | 'taxpayer_grade'
  | 'taxpayer_grade_label'
  | 'tax_period_status'

type HomeProfileDb = {
  id: string
  company_name: string
  tax_id: string
  taxpayer_grade: string
  taxpayer_grade_label: string
  tax_period_status: string
  taxpayer_grade_bg_color: string
  taxpayer_grade_text_color: string
  taxpayer_grade_label_bg_color: string
  taxpayer_grade_label_text_color: string
}

const DEFAULT_HOME_PROFILE: HomeProfileDb = {
  id: HOME_PROFILE_ID,
  company_name: '河北镁神科技股份有限公司',
  tax_id: '911305316610547945',
  taxpayer_grade: 'A',
  taxpayer_grade_label: '级纳税人',
  tax_period_status: '本月征期已结束',
  taxpayer_grade_bg_color: '#20a455',
  taxpayer_grade_text_color: '#ffffff',
  taxpayer_grade_label_bg_color: '#e8f7f1',
  taxpayer_grade_label_text_color: '#16a464',
}

function normalizeHexColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback
}

/** 同一标签内：创建时间新的在前；同一天再按办理期限倒序 */
function todoDisplaySort(a: HomeTodoDb, b: HomeTodoDb): number {
  const ta = Number.isFinite(Date.parse(a.created_at)) ? Date.parse(a.created_at) : 0
  const tb = Number.isFinite(Date.parse(b.created_at)) ? Date.parse(b.created_at) : 0
  if (ta !== tb) return tb - ta
  const da = Number.isFinite(Date.parse(`${a.deadline}T00:00:00`))
    ? Date.parse(`${a.deadline}T00:00:00`)
    : 0
  const db = Number.isFinite(Date.parse(`${b.deadline}T00:00:00`))
    ? Date.parse(`${b.deadline}T00:00:00`)
    : 0
  if (da !== db) return db - da
  return a.sort_order - b.sort_order
}

function todoStatusClass(tone: TodoStatusTone): string {
  switch (tone) {
    case 'pending':
      return 'etx-ph-status-tag pending'
    case 'done':
      return 'etx-ph-status-tag done'
    case 'neutral':
      return 'etx-ph-status-tag neutral'
    case 'warn':
      return 'etx-ph-status-tag warn'
    case 'muted':
      return 'etx-ph-status-tag muted'
  }
}

function isTodoTab(v: string): v is TodoTabId {
  return v === 'declare' || v === 'doc' || v === 'risk' || v === 'other'
}

function groupTodosByTab(rows: HomeTodoDb[]): Record<TodoTabId, HomeTodoDb[]> {
  const next: Record<TodoTabId, HomeTodoDb[]> = {
    declare: [],
    doc: [],
    risk: [],
    other: [],
  }
  const sorted = [...rows].sort((a, b) => {
    const tabDiff = TAB_ORDER.indexOf(a.tab) - TAB_ORDER.indexOf(b.tab)
    if (tabDiff !== 0) return tabDiff
    return todoDisplaySort(a, b)
  })
  for (const r of sorted) {
    if (isTodoTab(r.tab)) next[r.tab].push(r)
  }
  return next
}

/**
 * 首页：门户版式；待办取自 Supabase `home_todos`；双击数据行可编辑／删除；
 * 双击列表表头在当前标签页新增一行；提醒日期按当天回推刷新。
 */
export function HomePage() {
  const [favTab, setFavTab] = useState<'fav' | 'scene'>('fav')
  const [todoTab, setTodoTab] = useState<TodoTabId>('declare')
  const [todosGrouped, setTodosGrouped] = useState<Record<TodoTabId, HomeTodoDb[]> | null>(
    null,
  )
  const [loadingTodos, setLoadingTodos] = useState(true)
  const [homeProfile, setHomeProfile] = useState<HomeProfileDb>(DEFAULT_HOME_PROFILE)
  const [loadingHomeProfile, setLoadingHomeProfile] = useState(true)
  const [editingHomeProfileField, setEditingHomeProfileField] =
    useState<HomeProfileField | null>(null)
  const [homeProfileDraft, setHomeProfileDraft] = useState('')
  const [homeProfileColorDraft, setHomeProfileColorDraft] = useState({
    taxpayer_grade_bg_color: DEFAULT_HOME_PROFILE.taxpayer_grade_bg_color,
    taxpayer_grade_text_color: DEFAULT_HOME_PROFILE.taxpayer_grade_text_color,
    taxpayer_grade_label_bg_color: DEFAULT_HOME_PROFILE.taxpayer_grade_label_bg_color,
    taxpayer_grade_label_text_color: DEFAULT_HOME_PROFILE.taxpayer_grade_label_text_color,
  })

  /** 编辑中行的草稿（双击整行进入） */
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draft, setDraft] = useState<{
    matter: string
    deadline: Dayjs
    status: string
  } | null>(null)

  const rollingReminders = buildRollingReminders()

  const loadHomeProfile = useCallback(async () => {
    setLoadingHomeProfile(true)
    const { data, error } = await supabase
      .from('home_user_profile')
      .select(
        [
          'id',
          'company_name',
          'tax_id',
          'taxpayer_grade',
          'taxpayer_grade_label',
          'tax_period_status',
          'taxpayer_grade_bg_color',
          'taxpayer_grade_text_color',
          'taxpayer_grade_label_bg_color',
          'taxpayer_grade_label_text_color',
        ].join(', '),
      )
      .eq('id', HOME_PROFILE_ID)
      .maybeSingle()
    setLoadingHomeProfile(false)
    if (error) {
      message.error(`用户信息加载失败：${error.message}`)
      setHomeProfile(DEFAULT_HOME_PROFILE)
      return
    }
    if (!data) {
      setHomeProfile(DEFAULT_HOME_PROFILE)
      return
    }
    const row = data as Partial<Record<keyof HomeProfileDb, unknown>>
    setHomeProfile({
      id: typeof row.id === 'string' && row.id ? row.id : HOME_PROFILE_ID,
      company_name:
        typeof row.company_name === 'string' && row.company_name
          ? row.company_name
          : DEFAULT_HOME_PROFILE.company_name,
      tax_id:
        typeof row.tax_id === 'string' && row.tax_id ? row.tax_id : DEFAULT_HOME_PROFILE.tax_id,
      taxpayer_grade:
        typeof row.taxpayer_grade === 'string' && row.taxpayer_grade
          ? row.taxpayer_grade
          : DEFAULT_HOME_PROFILE.taxpayer_grade,
      taxpayer_grade_label:
        typeof row.taxpayer_grade_label === 'string' && row.taxpayer_grade_label
          ? row.taxpayer_grade_label
          : DEFAULT_HOME_PROFILE.taxpayer_grade_label,
      tax_period_status:
        typeof row.tax_period_status === 'string' && row.tax_period_status
          ? row.tax_period_status
          : DEFAULT_HOME_PROFILE.tax_period_status,
      taxpayer_grade_bg_color: normalizeHexColor(
        row.taxpayer_grade_bg_color,
        DEFAULT_HOME_PROFILE.taxpayer_grade_bg_color,
      ),
      taxpayer_grade_text_color: normalizeHexColor(
        row.taxpayer_grade_text_color,
        DEFAULT_HOME_PROFILE.taxpayer_grade_text_color,
      ),
      taxpayer_grade_label_bg_color: normalizeHexColor(
        row.taxpayer_grade_label_bg_color,
        DEFAULT_HOME_PROFILE.taxpayer_grade_label_bg_color,
      ),
      taxpayer_grade_label_text_color: normalizeHexColor(
        row.taxpayer_grade_label_text_color,
        DEFAULT_HOME_PROFILE.taxpayer_grade_label_text_color,
      ),
    })
  }, [])

  const loadTodos = useCallback(async () => {
    setLoadingTodos(true)
    const { data, error } = await supabase
      .from('home_todos')
      .select('id, tab, sort_order, matter, deadline, status, created_at')
      .order('created_at', { ascending: false })
    setLoadingTodos(false)
    if (error) {
      message.error(`待办加载失败：${error.message}`)
      setTodosGrouped({
        declare: [],
        doc: [],
        risk: [],
        other: [],
      })
      return
    }
    const rows =
      (data ?? []) as {
        id: string
        tab: string
        sort_order: number
        matter: string
        deadline: string
        status: string
        created_at: string
      }[]
    const normalized: HomeTodoDb[] = rows.map((r) => ({
      id: r.id,
      tab: isTodoTab(r.tab) ? r.tab : 'other',
      sort_order: r.sort_order,
      matter: r.matter,
      deadline: typeof r.deadline === 'string' ? r.deadline : String(r.deadline).slice(0, 10),
      status: r.status,
      created_at:
        typeof r.created_at === 'string' && r.created_at
          ? r.created_at
          : '1970-01-01T00:00:00.000Z',
    }))
    setTodosGrouped(groupTodosByTab(normalized))
  }, [])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadTodos()
    }, 0)
    return () => window.clearTimeout(id)
  }, [loadTodos])

  useEffect(() => {
    const id = window.setTimeout(() => {
      void loadHomeProfile()
    }, 0)
    return () => window.clearTimeout(id)
  }, [loadHomeProfile])

  const declareNotDeclaredCount = useMemo(() => {
    if (!todosGrouped) return 0
    return todosGrouped.declare.filter((r) => r.status === '未申报').length
  }, [todosGrouped])

  const todoTabs = useMemo(
    (): { id: TodoTabId; label: string; badge?: number }[] => [
      {
        id: 'declare',
        label: '本期应申报',
        badge: declareNotDeclaredCount > 0 ? declareNotDeclaredCount : undefined,
      },
      { id: 'doc', label: '待签收文书' },
      { id: 'risk', label: '风险疑点' },
      { id: 'other', label: '其它' },
    ],
    [declareNotDeclaredCount],
  )

  const currentRows = todosGrouped?.[todoTab] ?? []

  const newRowSkeleton: HomeTodoDb | null =
    editingId === NEW_HOME_TODO_ID
      ? {
          id: NEW_HOME_TODO_ID,
          tab: todoTab,
          sort_order: nextTodoSortOrder(currentRows),
          matter: '',
          deadline: draft?.deadline.format('YYYY-MM-DD') ?? dayjs().format('YYYY-MM-DD'),
          status: draft?.status ?? defaultTodoStatusForTab(todoTab),
          /** 占位行始终手动置顶 */
          created_at: new Date().toISOString(),
        }
      : null

  const rowsForTable =
    editingId === NEW_HOME_TODO_ID && newRowSkeleton ? [newRowSkeleton, ...currentRows] : currentRows

  const showTodoEmptyHint =
    !loadingTodos && currentRows.length === 0 && editingId !== NEW_HOME_TODO_ID

  const beginEdit = useCallback((row: HomeTodoDb) => {
    if (row.id === NEW_HOME_TODO_ID) return
    setEditingId(row.id)
    setDraft({
      matter: row.matter,
      deadline: dayjs(row.deadline),
      status: row.status,
    })
  }, [])

  const beginCreateRow = useCallback(() => {
    if (loadingTodos) return
    setEditingId(NEW_HOME_TODO_ID)
    setDraft({
      matter: '',
      deadline: dayjs(),
      status: defaultTodoStatusForTab(todoTab),
    })
  }, [loadingTodos, todoTab])

  const cancelEdit = useCallback(() => {
    setEditingId(null)
    setDraft(null)
  }, [])

  const beginEditHomeProfileField = useCallback(
    (field: HomeProfileField) => {
      if (loadingHomeProfile) return
      setEditingHomeProfileField(field)
      setHomeProfileDraft(homeProfile[field])
      setHomeProfileColorDraft({
        taxpayer_grade_bg_color: homeProfile.taxpayer_grade_bg_color,
        taxpayer_grade_text_color: homeProfile.taxpayer_grade_text_color,
        taxpayer_grade_label_bg_color: homeProfile.taxpayer_grade_label_bg_color,
        taxpayer_grade_label_text_color: homeProfile.taxpayer_grade_label_text_color,
      })
    },
    [homeProfile, loadingHomeProfile],
  )

  const cancelHomeProfileEdit = useCallback(() => {
    setEditingHomeProfileField(null)
    setHomeProfileDraft('')
    setHomeProfileColorDraft({
      taxpayer_grade_bg_color: DEFAULT_HOME_PROFILE.taxpayer_grade_bg_color,
      taxpayer_grade_text_color: DEFAULT_HOME_PROFILE.taxpayer_grade_text_color,
      taxpayer_grade_label_bg_color: DEFAULT_HOME_PROFILE.taxpayer_grade_label_bg_color,
      taxpayer_grade_label_text_color: DEFAULT_HOME_PROFILE.taxpayer_grade_label_text_color,
    })
  }, [])

  const saveHomeProfileField = useCallback(async () => {
    if (!editingHomeProfileField) return
    const valueTrim = homeProfileDraft.trim()
    if (!valueTrim) {
      message.warning('请填写内容')
      return
    }
    const nextProfile = {
      ...homeProfile,
      id: HOME_PROFILE_ID,
      [editingHomeProfileField]: valueTrim,
    }
    if (editingHomeProfileField === 'taxpayer_grade') {
      nextProfile.taxpayer_grade_bg_color = homeProfileColorDraft.taxpayer_grade_bg_color
      nextProfile.taxpayer_grade_text_color = homeProfileColorDraft.taxpayer_grade_text_color
    }
    if (editingHomeProfileField === 'taxpayer_grade_label') {
      nextProfile.taxpayer_grade_label_bg_color =
        homeProfileColorDraft.taxpayer_grade_label_bg_color
      nextProfile.taxpayer_grade_label_text_color =
        homeProfileColorDraft.taxpayer_grade_label_text_color
    }
    const { error } = await supabase.from('home_user_profile').upsert(nextProfile, {
      onConflict: 'id',
    })
    if (error) {
      message.error(error.message)
      return
    }
    setHomeProfile(nextProfile)
    setEditingHomeProfileField(null)
    setHomeProfileDraft('')
    message.success('已保存')
  }, [editingHomeProfileField, homeProfile, homeProfileColorDraft, homeProfileDraft])

  const renderHomeProfileColorFields = useCallback(
    (field: HomeProfileField) => {
      if (field !== 'taxpayer_grade' && field !== 'taxpayer_grade_label') return null
      const bgKey =
        field === 'taxpayer_grade' ? 'taxpayer_grade_bg_color' : 'taxpayer_grade_label_bg_color'
      const textKey =
        field === 'taxpayer_grade'
          ? 'taxpayer_grade_text_color'
          : 'taxpayer_grade_label_text_color'
      return (
        <span className="etx-ph-user-color-fields">
          <label>
            背景
            <input
              type="color"
              value={homeProfileColorDraft[bgKey]}
              onChange={(e) =>
                setHomeProfileColorDraft((prev) => ({
                  ...prev,
                  [bgKey]: e.target.value,
                }))
              }
              onClick={(e) => e.stopPropagation()}
            />
          </label>
          <label>
            文字
            <input
              type="color"
              value={homeProfileColorDraft[textKey]}
              onChange={(e) =>
                setHomeProfileColorDraft((prev) => ({
                  ...prev,
                  [textKey]: e.target.value,
                }))
              }
              onClick={(e) => e.stopPropagation()}
            />
          </label>
        </span>
      )
    },
    [homeProfileColorDraft],
  )

  const renderHomeProfileField = useCallback(
    (
      field: HomeProfileField,
      value: string,
      className: string,
      title: string,
    ) => {
      const editing = editingHomeProfileField === field
      return (
        <span
          className={`${className} etx-ph-user-editable${
            editing ? ' etx-ph-user-inline-edit' : ''
          }`}
          onDoubleClick={() => beginEditHomeProfileField(field)}
          title={loadingHomeProfile ? '用户信息加载中…' : title}
        >
          {editing ? (
            <>
              <Input
                size="small"
                className="etx-ph-user-edit-input"
                value={homeProfileDraft}
                autoFocus
                onChange={(e) => setHomeProfileDraft(e.target.value)}
                onPressEnter={() => void saveHomeProfileField()}
                onClick={(e) => e.stopPropagation()}
              />
              {renderHomeProfileColorFields(field)}
              <button
                type="button"
                className="etx-ph-user-edit-action fake"
                onClick={(e) => {
                  e.stopPropagation()
                  void saveHomeProfileField()
                }}
              >
                保存
              </button>
              <button
                type="button"
                className="etx-ph-user-edit-action fake"
                onClick={(e) => {
                  e.stopPropagation()
                  cancelHomeProfileEdit()
                }}
              >
                取消
              </button>
            </>
          ) : (
            value
          )}
        </span>
      )
    },
    [
      beginEditHomeProfileField,
      cancelHomeProfileEdit,
      editingHomeProfileField,
      homeProfileDraft,
      loadingHomeProfile,
      renderHomeProfileColorFields,
      saveHomeProfileField,
    ],
  )

  const deleteTodo = useCallback(() => {
    if (!editingId || editingId === NEW_HOME_TODO_ID) return
    Modal.confirm({
      title: '确认删除本条待办？',
      content: '删除后无法恢复，可从表头双击再新增。',
      okText: '删除',
      okType: 'danger',
      cancelText: '返回',
      async onOk() {
        const { error } = await supabase.from('home_todos').delete().eq('id', editingId)
        if (error) {
          message.error(error.message)
          throw error
        }
        message.success('已删除')
        setEditingId(null)
        setDraft(null)
        await loadTodos()
      },
    })
  }, [editingId, loadTodos])

  const saveEdit = useCallback(async () => {
    if (!editingId || !draft) return
    const matterTrim = draft.matter.trim()
    if (!matterTrim) {
      message.warning('请填写事项名称')
      return
    }
    const deadlineStr = draft.deadline.format('YYYY-MM-DD')
    const statusTrim = draft.status.trim()

    if (editingId === NEW_HOME_TODO_ID) {
      const tabRows = todosGrouped?.[todoTab] ?? []
      const sortOrder = nextTodoSortOrder(tabRows)
      const { error } = await supabase.from('home_todos').insert({
        tab: todoTab,
        sort_order: sortOrder,
        matter: matterTrim,
        deadline: deadlineStr,
        status: statusTrim,
      })
      if (error) {
        message.error(error.message)
        return
      }
      message.success('已新增')
    } else {
      const { error } = await supabase
        .from('home_todos')
        .update({
          matter: matterTrim,
          deadline: deadlineStr,
          status: statusTrim,
        })
        .eq('id', editingId)
      if (error) {
        message.error(error.message)
        return
      }
      message.success('已保存')
    }
    setEditingId(null)
    setDraft(null)
    await loadTodos()
  }, [draft, editingId, loadTodos, todosGrouped, todoTab])

  useEffect(() => {
    if (!editingId && !editingHomeProfileField) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') cancelEdit()
      if (e.key === 'Escape') cancelHomeProfileEdit()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editingId, editingHomeProfileField, cancelEdit, cancelHomeProfileEdit])

  const recommendBannerStyle = {
    '--etax-home-recommend-bg': `url(${ETAX_PUBLIC}home-recommend.optimized.jpg)`,
  } as CSSProperties

  const userBadgeStyle = {
    '--etx-ph-user-grade-bg':
      editingHomeProfileField === 'taxpayer_grade'
        ? homeProfileColorDraft.taxpayer_grade_bg_color
        : homeProfile.taxpayer_grade_bg_color,
    '--etx-ph-user-grade-text':
      editingHomeProfileField === 'taxpayer_grade'
        ? homeProfileColorDraft.taxpayer_grade_text_color
        : homeProfile.taxpayer_grade_text_color,
    '--etx-ph-user-grade-label-bg':
      editingHomeProfileField === 'taxpayer_grade_label'
        ? homeProfileColorDraft.taxpayer_grade_label_bg_color
        : homeProfile.taxpayer_grade_label_bg_color,
    '--etx-ph-user-grade-label-text':
      editingHomeProfileField === 'taxpayer_grade_label'
        ? homeProfileColorDraft.taxpayer_grade_label_text_color
        : homeProfile.taxpayer_grade_label_text_color,
  } as CSSProperties

  return (
    <ConfigProvider locale={zhCN}>
      <div className="etax-portal-home">
        <div className="etax-portal-home-inner">
          <section className="etax-ph-row etx-ph-top" aria-label="用户与待办">
            <div className="etx-ph-col">
              <div className="etx-ph-card etx-ph-usercard">
                <div className="etx-ph-user-line1">
                  {renderHomeProfileField(
                    'company_name',
                    homeProfile.company_name,
                    'etx-ph-user-name',
                    '双击修改企业名称',
                  )}
                  <span className="etx-ph-user-badge" style={userBadgeStyle}>
                    {renderHomeProfileField(
                      'taxpayer_grade',
                      homeProfile.taxpayer_grade,
                      'etx-ph-user-badge-ic',
                      '双击修改纳税人评级字母',
                    )}
                    {renderHomeProfileField(
                      'taxpayer_grade_label',
                      homeProfile.taxpayer_grade_label,
                      'etx-ph-user-badge-text',
                      '双击修改纳税人评级文案',
                    )}
                  </span>
                </div>
                <div className="etx-ph-user-line2">
                  {renderHomeProfileField(
                    'tax_id',
                    homeProfile.tax_id,
                    'etx-ph-user-id',
                    '双击修改统一社会信用代码',
                  )}
                  {renderHomeProfileField(
                    'tax_period_status',
                    homeProfile.tax_period_status,
                    'etx-ph-user-period',
                    '双击修改征期状态',
                  )}
                </div>
              </div>
              <div className="etx-ph-card etx-ph-subcard">
                <div className="etx-ph-reminder-titlebar">
                  <span>我的提醒</span>
                  <button type="button" className="etx-ph-card-more fake" aria-label="更多">
                    &gt;
                  </button>
                </div>
                <ul className="etx-ph-reminder-list">
                  {rollingReminders.map((item, index) => (
                    <li
                      key={`reminder-${index}-${item.date}`}
                      className="etx-ph-reminder-row"
                    >
                      <span className="etx-ph-reminder-ic" aria-hidden>
                        i
                      </span>
                      <span className="etx-ph-reminder-text">{item.text}</span>
                      <span className="etx-ph-reminder-date">{item.date}</span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <div className="etx-ph-col etx-ph-col-wide">
              <div className="etx-ph-card etx-ph-todo">
                <div className="etx-ph-todo-head">
                  <div className="etx-ph-todo-titlebar">
                    <span>我的待办</span>
                    <button type="button" className="etx-ph-card-more fake" aria-label="更多">
                      &gt;
                    </button>
                  </div>
                  <div className="etx-ph-todo-tabs" role="tablist" aria-label="待办分类">
                    {todoTabs.map((tab) => (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={todoTab === tab.id}
                        className={`etx-ph-todo-tab${todoTab === tab.id ? ' active' : ''}${
                          tab.badge != null ? ' has-badge' : ''
                        }`}
                        onClick={() => {
                          setTodoTab(tab.id)
                          cancelEdit()
                        }}
                      >
                        <span className="etx-ph-todo-tab-label">{tab.label}</span>
                        {tab.badge != null ? (
                          <span className="etx-ph-todo-tab-badge" aria-label={`${tab.badge} 条`}>
                            {tab.badge}
                          </span>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="etx-ph-todo-panel">
                  <div
                    className="etx-ph-todo-colhead etx-ph-todo-colhead--newable"
                    role="row"
                    onDoubleClick={() => beginCreateRow()}
                    title={
                      loadingTodos
                        ? '待办加载中…'
                        : '双击此处为当前标签页新增一行待办（与双击数据行修改相同字段）'
                    }
                  >
                    <span className="etx-ph-todo-th etx-ph-todo-th-matter" role="columnheader">
                      事项名称
                    </span>
                    <span className="etx-ph-todo-th etx-ph-todo-th-deadline" role="columnheader">
                      办理期限
                    </span>
                    <span className="etx-ph-todo-th etx-ph-todo-th-status" role="columnheader">
                      标签状态
                    </span>
                    <span className="etx-ph-todo-th etx-ph-todo-th-op" role="columnheader">
                      操作
                    </span>
                  </div>
                  <div className="etx-ph-todo-table">
                    {loadingTodos ? (
                      <div className="etx-ph-todo-loading" role="status">
                        加载待办…
                      </div>
                    ) : showTodoEmptyHint ? (
                      <div className="etx-ph-todo-empty" role="status">
                        <p>
                          暂无待办；可<strong>双击表头</strong>新增一行。
                        </p>
                        <p className="etx-ph-todo-empty-tip">
                          若已执行迁移仍无数据，请检查 RLS 与表 home_todos。
                        </p>
                      </div>
                    ) : null}
                    {rowsForTable.map((row) => {
                      const editing = editingId === row.id
                      const displayStatus = editing ? (draft?.status ?? row.status) : row.status
                      const tone = todoStatusToneForLabel(displayStatus)
                      const actions = todoActionsForStatus(displayStatus)

                      return (
                        <div
                          key={row.id}
                          className={`etx-ph-todo-row${editing ? ' etx-ph-todo-row--editing' : ''}`}
                          role="row"
                          onDoubleClick={(ev) => {
                            const el = ev.target
                            if (
                              !(el instanceof Element)
                            )
                              return
                            if (
                              el instanceof HTMLInputElement ||
                              el instanceof HTMLTextAreaElement ||
                              el instanceof HTMLSelectElement ||
                              el instanceof HTMLButtonElement
                            )
                              return
                            if (el.closest('.ant-picker, .ant-select, .ant-input')) return
                            beginEdit(row)
                          }}
                          title={
                            editing
                              ? undefined
                              : row.id === NEW_HOME_TODO_ID
                                ? '填写后点「保存」写入当前标签页'
                                : '双击本行修改事项名称、办理期限与标签状态'
                          }
                        >
                          <span className="etx-ph-todo-td etx-ph-todo-td-matter" role="cell">
                            {editing && draft ? (
                              <Input
                                size="small"
                                className="etx-ph-todo-field"
                                value={draft.matter}
                                onChange={(e) => setDraft({ ...draft, matter: e.target.value })}
                              />
                            ) : (
                              <span title={row.matter}>{row.matter}</span>
                            )}
                          </span>
                          <span className="etx-ph-todo-td etx-ph-todo-td-deadline" role="cell">
                            {editing && draft ? (
                              <DatePicker
                                size="small"
                                className="etx-ph-todo-field"
                                style={{ width: '100%', minWidth: 0 }}
                                value={draft.deadline}
                                onChange={(d) =>
                                  setDraft({
                                    ...draft,
                                    deadline: d ?? dayjs(),
                                  })
                                }
                                format="YYYY-MM-DD"
                                allowClear={false}
                              />
                            ) : (
                              row.deadline
                            )}
                          </span>
                          <span className="etx-ph-todo-td etx-ph-todo-td-status" role="cell">
                            {editing && draft ? (
                              <Select
                                size="small"
                                className="etx-ph-todo-field"
                                style={{ width: '100%', minWidth: 0 }}
                                value={draft.status}
                                onChange={(v) => setDraft({ ...draft, status: v })}
                                options={HOME_TODO_STATUS_OPTIONS.map((s) => ({
                                  label: s,
                                  value: s,
                                }))}
                                showSearch
                                optionFilterProp="label"
                              />
                            ) : (
                              <span className={todoStatusClass(tone)}>{row.status}</span>
                            )}
                          </span>
                          <span className="etx-ph-todo-td etx-ph-todo-td-op" role="cell">
                            {editing ? (
                              <span className="etx-ph-todo-edit-actions">
                                <button
                                  type="button"
                                  className="etx-ph-op-link fake"
                                  onClick={() => void saveEdit()}
                                >
                                  保存
                                </button>
                                <span className="etx-ph-op-sep">|</span>
                                <button
                                  type="button"
                                  className="etx-ph-op-link fake"
                                  onClick={cancelEdit}
                                >
                                  取消
                                </button>
                                {editingId !== NEW_HOME_TODO_ID ? (
                                  <>
                                    <span className="etx-ph-op-sep">|</span>
                                    <button
                                      type="button"
                                      className="etx-ph-op-link etx-ph-op-link--danger fake"
                                      onClick={deleteTodo}
                                    >
                                      删除
                                    </button>
                                  </>
                                ) : null}
                              </span>
                            ) : (
                              actions.map((a, i) => (
                                <span key={`${a.label}-${i}`}>
                                  {i > 0 ? <span className="etx-ph-op-sep">|</span> : null}
                                  <button type="button" className="etx-ph-op-link fake">
                                    {a.label}
                                  </button>
                                </span>
                              ))
                            )}
                          </span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section className="etx-ph-card etx-ph-hot" aria-label="热门服务">
            <div className="etx-ph-card-head etx-ph-card-head-plain">
              <span>热门服务</span>
            </div>
            <div className="etx-ph-carousel">
              <button type="button" className="etx-ph-carousel-btn fake" aria-label="上一屏">
                ‹
              </button>
              <div className="etx-ph-carousel-track">
                {hotServiceItems.map((item) => (
                  <div key={item.label} className="etx-ph-hot-item">
                    <img
                      className="etx-ph-hot-icon"
                      src={`${homeAsset}${item.icon}`}
                      alt=""
                      aria-hidden
                    />
                    <span>{item.label}</span>
                  </div>
                ))}
              </div>
              <button type="button" className="etx-ph-carousel-btn fake" aria-label="下一屏">
                ›
              </button>
            </div>
          </section>

          <section className="etx-ph-card etx-ph-fav" aria-label="收藏与场景办税">
            <div className="etx-ph-fav-tabs">
              <button
                type="button"
                className={`etx-ph-fav-tab${favTab === 'fav' ? ' active' : ''}`}
                onClick={() => setFavTab('fav')}
              >
                我的收藏
              </button>
              <span className="etx-ph-fav-sep" aria-hidden>
                |
              </span>
              <button
                type="button"
                className={`etx-ph-fav-tab${favTab === 'scene' ? ' active' : ''}`}
                onClick={() => setFavTab('scene')}
              >
                场景办税
              </button>
            </div>
            <div className="etx-ph-fav-body">
              <button
                type="button"
                className="etx-ph-fav-arrow etx-ph-fav-arrow-left fake"
                aria-label="上一屏"
              >
                ‹
              </button>
              <button type="button" className="etx-ph-add-fav fake">
                <span className="etx-ph-add-plus" aria-hidden />
                <span>添加收藏</span>
              </button>
              <button
                type="button"
                className="etx-ph-fav-arrow etx-ph-fav-arrow-right fake"
                aria-label="下一屏"
              >
                ›
              </button>
            </div>
          </section>

          <section className="etx-ph-recommend" aria-label="为你推荐">
            <div className="etx-ph-rec-banner" style={recommendBannerStyle}>
              <div className="etx-ph-rec-banner-overlay">
                <span className="etx-ph-rec-banner-title">为你推荐</span>
              </div>
            </div>
            <div className="etx-ph-rec-list">
              <ul className="etx-ph-rec-col">
                {recommendLeft.map((item) => (
                  <li key={item.t}>
                    <a
                      className="etx-ph-rec-link fake"
                      href="#n"
                      onClick={(e) => e.preventDefault()}
                    >
                      <span className="etx-ph-rec-dot" aria-hidden />
                      <span className="etx-ph-rec-text">{item.t}</span>
                      <span className="etx-ph-rec-date">{item.d}</span>
                    </a>
                  </li>
                ))}
              </ul>
              <ul className="etx-ph-rec-col">
                {recommendRight.map((item) => (
                  <li key={item.t}>
                    <a
                      className="etx-ph-rec-link fake"
                      href="#n"
                      onClick={(e) => e.preventDefault()}
                    >
                      <span className="etx-ph-rec-dot" aria-hidden />
                      <span className="etx-ph-rec-text">{item.t}</span>
                      <span className="etx-ph-rec-date">{item.d}</span>
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          </section>

          <footer className="etx-ph-footer" aria-label="页面页脚">
            <div className="etx-ph-footer-main">
              <div className="etx-ph-footer-left">
                <p>主办单位：国家税务总局河北省税务局</p>
                <p>版权所有：国家税务总局</p>
                <p>地址：石家庄市平安南大街35号</p>
              </div>
              <img
                className="etx-ph-footer-seal"
                src={`${ETAX_PUBLIC}gov-badge.png`}
                alt="政府网站找错"
              />
            </div>
            <div className="etx-ph-footer-bottom">
              <span>网站标识码：bm29030010</span>
              <span>冀ICP备13002433号-1</span>
              <span className="etx-ph-footer-police">
                <img
                  className="etx-ph-police-ic"
                  src={`${ETAX_PUBLIC}beian-badge.png`}
                  alt=""
                  aria-hidden
                />
                冀公网安备 13010402001756号
              </span>
            </div>
          </footer>
        </div>
      </div>
    </ConfigProvider>
  )
}
