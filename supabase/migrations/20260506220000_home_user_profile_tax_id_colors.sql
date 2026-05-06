-- 首页用户卡补充税号与纳税人等级颜色配置
ALTER TABLE public.home_user_profile
  ADD COLUMN IF NOT EXISTS tax_id text NOT NULL DEFAULT '911305316610547945',
  ADD COLUMN IF NOT EXISTS taxpayer_grade_bg_color text NOT NULL DEFAULT '#20a455',
  ADD COLUMN IF NOT EXISTS taxpayer_grade_text_color text NOT NULL DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS taxpayer_grade_label_bg_color text NOT NULL DEFAULT '#e8f7f1',
  ADD COLUMN IF NOT EXISTS taxpayer_grade_label_text_color text NOT NULL DEFAULT '#16a464';

COMMENT ON COLUMN public.home_user_profile.tax_id IS '统一社会信用代码 / 纳税人识别号';
COMMENT ON COLUMN public.home_user_profile.taxpayer_grade_bg_color IS '纳税评级字母区域背景色';
COMMENT ON COLUMN public.home_user_profile.taxpayer_grade_text_color IS '纳税评级字母区域文字色';
COMMENT ON COLUMN public.home_user_profile.taxpayer_grade_label_bg_color IS '纳税评级文案区域背景色';
COMMENT ON COLUMN public.home_user_profile.taxpayer_grade_label_text_color IS '纳税评级文案区域文字色';

UPDATE public.home_user_profile
SET
  tax_id = COALESCE(NULLIF(tax_id, ''), '911305316610547945'),
  taxpayer_grade_bg_color = COALESCE(NULLIF(taxpayer_grade_bg_color, ''), '#20a455'),
  taxpayer_grade_text_color = COALESCE(NULLIF(taxpayer_grade_text_color, ''), '#ffffff'),
  taxpayer_grade_label_bg_color = COALESCE(NULLIF(taxpayer_grade_label_bg_color, ''), '#e8f7f1'),
  taxpayer_grade_label_text_color = COALESCE(NULLIF(taxpayer_grade_label_text_color, ''), '#16a464')
WHERE id = 'default';
