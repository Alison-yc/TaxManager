-- 导出统计增加北京时间字段，便于在表里直接查看本地业务时间
ALTER TABLE public.export_click_logs
  ADD COLUMN IF NOT EXISTS created_at_beijing timestamp without time zone;

UPDATE public.export_click_logs
SET created_at_beijing = created_at AT TIME ZONE 'Asia/Shanghai'
WHERE created_at_beijing IS NULL;

ALTER TABLE public.export_click_logs
  ALTER COLUMN created_at_beijing SET DEFAULT (now() AT TIME ZONE 'Asia/Shanghai'),
  ALTER COLUMN created_at_beijing SET NOT NULL;

COMMENT ON COLUMN public.export_click_logs.created_at_beijing IS '导出时间（北京时间，UTC+8）';

CREATE INDEX IF NOT EXISTS idx_export_click_logs_created_at_beijing
  ON public.export_click_logs (created_at_beijing DESC);
