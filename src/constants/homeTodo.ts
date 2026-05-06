export type HomeTodoTab = 'declare' | 'doc' | 'risk' | 'other'

export type TodoStatusTone = 'pending' | 'done' | 'neutral' | 'warn' | 'muted'

/** 新增待办时的默认标签状态（随当前顶部标签页而定） */
export function defaultTodoStatusForTab(tab: HomeTodoTab): string {
  switch (tab) {
    case 'declare':
      return '未申报'
    case 'doc':
      return '待签收'
    case 'risk':
      return '待核实'
    case 'other':
      return '办理中'
    default:
      return '待处理'
  }
}

/** 首页待办｜下拉可选的标签状态（与库中 status 文案一致以便筛显） */
export const HOME_TODO_STATUS_OPTIONS = [
  '未申报',
  '已申报',
  '待签收',
  '已签收',
  '待核实',
  '处理中',
  '已反馈',
  '办理中',
  '审核中',
  '补正中',
  '待处理',
  '已完成',
] as const

export type HomeTodoStatusOption = (typeof HOME_TODO_STATUS_OPTIONS)[number]

/** 标签状态 → 标签颜色（与原写死口径一致） */
export function todoStatusToneForLabel(status: string): TodoStatusTone {
  switch (status) {
    case '未申报':
    case '补正中':
      return 'pending'
    case '已申报':
    case '已签收':
    case '已反馈':
    case '已完成':
      return 'done'
    case '待签收':
    case '待处理':
      return 'neutral'
    case '待核实':
      return 'warn'
    default:
      return 'muted'
  }
}

/** 右侧操作链接：完全由标签状态决定（不写库） */
export function todoActionsForStatus(status: string): { label: string }[] {
  const map: Record<string, string[]> = {
    未申报: ['填写申报表'],
    已申报: ['更正', '作废'],
    待签收: ['查看', '签收'],
    已签收: ['查看', '下载'],
    待核实: ['去处理'],
    处理中: ['进度'],
    已反馈: ['查看'],
    办理中: ['进度查询'],
    审核中: ['详情'],
    补正中: ['去补正'],
    待处理: ['重签'],
    已完成: ['下载'],
  }
  const labels = map[status]
  return (labels ?? ['查看']).map((label) => ({ label }))
}
