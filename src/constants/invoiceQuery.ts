export const INVOICE_QUERY_TYPE_OPTIONS = [
  { value: '开具发票', label: '开具发票' },
  { value: '取得发票', label: '取得发票' },
]

export const INVOICE_SOURCE_OPTIONS = [
  { value: '全部', label: '全部' },
  { value: '电子发票服务平台', label: '电子发票服务平台' },
]

export const INVOICE_STATUS_OPTIONS = [
  { value: '全部', label: '全部' },
  { value: '正常', label: '正常' },
]

export const INVOICE_POSITIVE_OPTIONS = [
  { value: '全部', label: '全部' },
  { value: '是', label: '是' },
  { value: '否', label: '否' },
]

export const INVOICE_TYPE_OPTIONS = [
  { value: '全部', label: '全部' },
  { value: '数电发票（增值税专用发票）', label: '数电发票（增值税专用发票）' },
  { value: '数电发票（普通发票）', label: '数电发票（普通发票）' },
]

export const INVOICE_IMPORTED_EVENT = 'taxmanager:invoice-imported'

export const INVOICE_STATS_CARDS = [
  {
    key: 'full',
    title: '全量发票查询',
    desc: '查询纳税人开具、取得、经办的发票和海关缴款书信息',
    icon: '全量发票查询统计.png',
    route: '/invoice-query/full',
  },
  {
    key: 'stats',
    title: '开票数据统计及发票领用查询',
    desc: '查询纳税人各种发票领用存及销项金额、税额等统计资料',
    icon: '开票数据统计及xxx.png',
  },
  {
    key: 'history',
    title: '历史抵扣信息查询',
    desc: '查询多个历史税款所属期抵扣统计确认信息',
    icon: '历史抵扣信息查询.png',
  },
  {
    key: 'unchecked',
    title: '未到勾选日期发票查询',
    desc: '查询各类可抵扣勾选发票和海关缴款书信息',
    icon: '未到勾选日期发票查询.png',
  },
  {
    key: 'unlink',
    title: '自动解除关联凭证记录',
    desc: '查询近30天自动解除的关联凭证记录',
    icon: '自动解除关联凭证记录.png',
  },
  {
    key: 'transfer',
    title: '进项税额转出情况查询',
    desc: '查询应做进项转出的发票、海关缴款书及红字发票信息确认单信息',
    icon: '进项税额转出情况查询.png',
  },
] as const
