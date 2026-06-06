-- form_data 扩展：支持 PDF 申报/财务报表导入
ALTER TABLE public.form_data
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'excel',
  ADD COLUMN IF NOT EXISTS import_category text NOT NULL DEFAULT 'declaration',
  ADD COLUMN IF NOT EXISTS storage_path text;

COMMENT ON COLUMN public.form_data.source_type IS 'excel | pdf';
COMMENT ON COLUMN public.form_data.import_category IS 'declaration | financial';
COMMENT ON COLUMN public.form_data.storage_path IS 'Supabase Storage 中原始 PDF 路径';

CREATE INDEX IF NOT EXISTS idx_form_data_import_category
  ON public.form_data (import_category);

CREATE INDEX IF NOT EXISTS idx_form_data_source_type
  ON public.form_data (source_type);
