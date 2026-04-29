-- 申报列表检索与展示字段（从 Excel 首表结构化抽取后与 content 冗余存储）
ALTER TABLE public.form_data
  ADD COLUMN IF NOT EXISTS form_code text,
  ADD COLUMN IF NOT EXISTS form_type_label text,
  ADD COLUMN IF NOT EXISTS correction_type text DEFAULT '新产生申报表',
  ADD COLUMN IF NOT EXISTS void_flag text DEFAULT '未作废',
  ADD COLUMN IF NOT EXISTS taxpayer_name text,
  ADD COLUMN IF NOT EXISTS credit_code text,
  ADD COLUMN IF NOT EXISTS tax_period_start date,
  ADD COLUMN IF NOT EXISTS tax_period_end date,
  ADD COLUMN IF NOT EXISTS declaration_date date,
  ADD COLUMN IF NOT EXISTS tax_amount_due numeric(20, 2);

COMMENT ON COLUMN public.form_data.form_code IS '申报表编码，如 BDA0610606';
COMMENT ON COLUMN public.form_data.tax_amount_due IS '本期应补（退）税额（主表行提取）';

CREATE INDEX IF NOT EXISTS idx_form_data_declaration_date ON public.form_data (declaration_date DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_form_data_tax_period_start ON public.form_data (tax_period_start);
