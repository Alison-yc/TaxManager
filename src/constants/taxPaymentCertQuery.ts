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

export const TAX_PAYMENT_CERT_COLLECTION_OPTIONS = [{ value: '全部', label: '请选择' }]

export const TAX_PAYMENT_CERT_INSPECTION_OPTIONS = [{ value: '全部', label: '请选择' }]

export const TAX_PAYMENT_CERT_TABS = [
  { key: 'tabular', label: '完税证明（表格式）', info: false, active: true },
  { key: 'document', label: '完税证明（文书式）', info: true, active: false },
  { key: 'batch', label: '开具记录（批量）', info: true, active: false },
] as const
