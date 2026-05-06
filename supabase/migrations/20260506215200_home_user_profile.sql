-- 首页左上用户卡配置；每个字段可在页面双击后独立修改
CREATE TABLE IF NOT EXISTS public.home_user_profile (
  id text PRIMARY KEY DEFAULT 'default',
  company_name text NOT NULL,
  taxpayer_grade text NOT NULL,
  taxpayer_grade_label text NOT NULL,
  tax_period_status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.home_user_profile IS '门户首页左上用户卡配置';

CREATE OR REPLACE FUNCTION public.home_user_profile_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_home_user_profile_updated_at ON public.home_user_profile;
CREATE TRIGGER tr_home_user_profile_updated_at
  BEFORE UPDATE ON public.home_user_profile
  FOR EACH ROW EXECUTE PROCEDURE public.home_user_profile_set_updated_at();

ALTER TABLE public.home_user_profile ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read home_user_profile" ON public.home_user_profile;
CREATE POLICY "authenticated read home_user_profile" ON public.home_user_profile
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated insert home_user_profile" ON public.home_user_profile;
CREATE POLICY "authenticated insert home_user_profile" ON public.home_user_profile
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated update home_user_profile" ON public.home_user_profile;
CREATE POLICY "authenticated update home_user_profile" ON public.home_user_profile
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

INSERT INTO public.home_user_profile (
  id,
  company_name,
  taxpayer_grade,
  taxpayer_grade_label,
  tax_period_status
)
VALUES (
  'default',
  '河北镁神科技股份有限公司',
  'A',
  '级纳税人',
  '本月征期已结束'
)
ON CONFLICT (id) DO NOTHING;
