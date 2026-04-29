import { DEFAULT_FORM_CODE } from '../lib/declarationIndex'

/**
 * 「全部」不传 form_code 条件；其余 value 与 `form_data.form_code` / 导入写入一致。
 * 条目为常见电子税务局申报表代码示例，可按实际业务增减。
 */
export const QUERY_FORM_KIND_ALL_VALUE = ''

export const QUERY_FORM_KIND_OPTIONS: { value: string; label: string }[] = [
  // { value: QUERY_FORM_KIND_ALL_VALUE, label: '全部' },
  { value: 'BDA0610606', label: 'BDA0610606 《增值税及附加税费申报表（一般纳税人适用）》' },
  { value: 'BDA0610610', label: 'BDA0610610 《增值税及附加税费申报表（小规模纳税人适用）》' },
  { value: 'BDA0610630', label: 'BDA0610630 《增值税及附加税费申报表（预缴）》' },
  { value: 'BDA0640110', label: 'BDA0640110 《企业所得税预缴申报表（A类）》' },
  { value: 'BDA0640220', label: 'BDA0640220 《企业所得税预缴申报表（B类）》' },
  { value: 'BDA0640530', label: 'BDA0640530 《企业所得税年度纳税申报表（A类）》' },
  { value: 'BDA0661110', label: 'BDA0661110 《财产和行为税纳税申报表》（合并）》' },
  { value: 'BDA0620810', label: 'BDA0620810 《消费税纳税申报表》' },
  { value: 'BDA0630210', label: 'BDA0630210 《文化事业建设费申报表》' },
  { value: 'BDA0670310', label: 'BDA0670310 《资源税申报表》' },
  { value: 'BDA0680410', label: 'BDA0680410 《环境保护税申报表》' },
  { value: 'BDA0690510', label: 'BDA0690510 《土地增值税预缴申报表》' },
  { value: 'BDA0610700', label: 'BDA0610700 《附加税费申报表（附加税信息）》' },
  { value: 'BDA0610800', label: 'BDA0610800 《代扣代缴、代收代缴明细报告表》' },
  { value: 'BDA0610900', label: 'BDA0610900 《增值税预缴税款表》' },
]

/** 为 true 时隐藏「申报表种类」下拉，按 {@link getActiveQueryFormKind} 固定编码检索 */
export const QUERY_FORM_KIND_SELECTOR_HIDDEN = false

/** 与图1一致：更正类型多选项（含一条兼容旧 Excel「更正申报」） */
export const QUERY_CORRECTION_TYPE_OPTIONS = [
  '新产生申报表',
  '被更正的申报表',
  '更正后新产生的申报表（全量模式）',
  '更正申报',
] as const

/** 作废标志：含「全部」不设列条件 */
export const VOID_FLAG_ALL_LABEL = '全部'

export function getActiveQueryFormKind(selectedFromForm: string): string {
  if (QUERY_FORM_KIND_SELECTOR_HIDDEN) {
    const firstConcrete = QUERY_FORM_KIND_OPTIONS.find((o) => o.value !== QUERY_FORM_KIND_ALL_VALUE)
    return firstConcrete?.value ?? DEFAULT_FORM_CODE
  }
  return selectedFromForm
}

export function getDefaultQueryFormKind(): string {
  return QUERY_FORM_KIND_OPTIONS[0]?.value ?? QUERY_FORM_KIND_ALL_VALUE
}
