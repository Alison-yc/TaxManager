-- 导出 PDF 点击统计；仅由前端在线上环境写入
CREATE TABLE IF NOT EXISTS public.export_click_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  auth_user_id uuid NOT NULL DEFAULT auth.uid(),
  action text NOT NULL DEFAULT 'pdf_export',
  trigger text NOT NULL,
  form_data_record_id text,
  document_name text NOT NULL,
  source_file_name text,
  form_code text,
  form_type_label text,
  taxpayer_name text,
  credit_code text,
  tax_period_start date,
  tax_period_end date,
  declaration_date date,
  tax_amount_due numeric(20, 2),
  page_path text,
  page_url text,
  user_agent text
);

COMMENT ON TABLE public.export_click_logs IS '导出 PDF 点击统计日志';
COMMENT ON COLUMN public.export_click_logs.auth_user_id IS '触发导出的登录用户 ID';
COMMENT ON COLUMN public.export_click_logs.trigger IS '导出触发来源：query_auto 列表导出自动触发；preview_button 详情页按钮触发';
COMMENT ON COLUMN public.export_click_logs.form_data_record_id IS '对应 form_data.id，使用 text 避免依赖上游主键类型';
COMMENT ON COLUMN public.export_click_logs.document_name IS '导出的 PDF 文档名';
COMMENT ON COLUMN public.export_click_logs.source_file_name IS '来源 Excel 文件名';

CREATE INDEX IF NOT EXISTS idx_export_click_logs_created_at
  ON public.export_click_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_export_click_logs_auth_user_id
  ON public.export_click_logs (auth_user_id);

CREATE INDEX IF NOT EXISTS idx_export_click_logs_form_data_record_id
  ON public.export_click_logs (form_data_record_id);

ALTER TABLE public.export_click_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read export_click_logs" ON public.export_click_logs;
CREATE POLICY "authenticated read export_click_logs" ON public.export_click_logs
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "authenticated insert export_click_logs" ON public.export_click_logs;
CREATE POLICY "authenticated insert export_click_logs" ON public.export_click_logs
  FOR INSERT TO authenticated WITH CHECK (auth_user_id = auth.uid());
