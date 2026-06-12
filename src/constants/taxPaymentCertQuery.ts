export const TAX_PAYMENT_CERT_IMPORTED_EVENT = 'taxmanager:tax-payment-cert-imported'

export const TAX_PAYMENT_CERT_QUERY_METHOD_OPTIONS = [
  { value: '税（费）属期', label: '税（费）属期' },
  { value: '缴（退）款时间', label: '缴（退）款时间' },
]

export const TAX_PAYMENT_CERT_REPRINT_OPTIONS = [
  { value: '全部', label: '请选择' },
  { value: '是', label: '是' },
  { value: '否', label: '否' },
]

export const TAX_PAYMENT_CERT_E_REFUND_OPTIONS = [
  { value: '否', label: '否' },
  { value: '是', label: '是' },
]

export const TAX_PAYMENT_CERT_IDENTITY_OPTIONS = [
  { value: '全部', label: '请选择' },
  { value: '本企业/本人', label: '本企业/本人' },
]

/** 查询页「征收项目」展示用（不参与实际筛选） */
export const TAX_PAYMENT_CERT_COLLECTION_ITEMS = [
  '增值税',
  '消费税',
  '企业所得税',
  '个人所得税',
  '资源税',
  '城市维护建设税',
  '教育费附加',
  '地方教育附加',
  '房产税',
  '印花税',
  '城镇土地使用税',
  '土地增值税',
  '车船税',
  '船舶吨税',
  '车辆购置税',
  '关税',
  '耕地占用税',
  '契税',
  '环境保护税',
  '文化事业建设费',
] as const

export const TAX_PAYMENT_CERT_COLLECTION_OPTIONS = TAX_PAYMENT_CERT_COLLECTION_ITEMS.map((label) => ({
  value: label,
  label,
}))

export const TAX_PAYMENT_CERT_INSPECTION_OPTIONS = [{ value: '全部', label: '请选择' }]

export const TAX_PAYMENT_CERT_TABS = [
  { key: 'tabular', label: '完税证明（表格式）', info: false, active: true },
  { key: 'document', label: '完税证明（文书式）', info: true, active: false },
  { key: 'batch', label: '开具记录（批量）', info: true, active: false },
] as const
