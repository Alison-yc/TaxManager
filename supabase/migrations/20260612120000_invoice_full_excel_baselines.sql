-- 全量发票 Excel 基准文件：用于从官方导出的完整 Excel 过滤生成下载结果
CREATE TABLE IF NOT EXISTS public.invoice_full_excel_baselines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  auth_user_id uuid NOT NULL DEFAULT auth.uid(),
  storage_path text NOT NULL,
  source_file_name text NOT NULL,
  sheet_count int NOT NULL DEFAULT 0,
  row_count int NOT NULL DEFAULT 0,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (auth_user_id)
);

COMMENT ON TABLE public.invoice_full_excel_baselines IS '全量发票查询官方 Excel 基准文件，导出时按日期或数电发票号码过滤';

ALTER TABLE public.invoice_full_excel_baselines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read own invoice_full_excel_baselines" ON public.invoice_full_excel_baselines;
CREATE POLICY "authenticated read own invoice_full_excel_baselines" ON public.invoice_full_excel_baselines
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "authenticated insert own invoice_full_excel_baselines" ON public.invoice_full_excel_baselines;
CREATE POLICY "authenticated insert own invoice_full_excel_baselines" ON public.invoice_full_excel_baselines
  FOR INSERT TO authenticated WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "authenticated update own invoice_full_excel_baselines" ON public.invoice_full_excel_baselines;
CREATE POLICY "authenticated update own invoice_full_excel_baselines" ON public.invoice_full_excel_baselines
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "authenticated delete own invoice_full_excel_baselines" ON public.invoice_full_excel_baselines;
CREATE POLICY "authenticated delete own invoice_full_excel_baselines" ON public.invoice_full_excel_baselines
  FOR DELETE TO authenticated USING (auth_user_id = auth.uid());

-- imported-docs 原本只允许 PDF；这里追加 Excel MIME，并放开 invoice-full-excel 目录。
UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel'
]::text[]
WHERE id = 'imported-docs';

DROP POLICY IF EXISTS "authenticated read own imported docs" ON storage.objects;
CREATE POLICY "authenticated read own imported docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial', 'tax-proofs', 'invoice-full-excel')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "authenticated insert own imported docs" ON storage.objects;
CREATE POLICY "authenticated insert own imported docs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial', 'tax-proofs', 'invoice-full-excel')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "authenticated update own imported docs" ON storage.objects;
CREATE POLICY "authenticated update own imported docs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial', 'tax-proofs', 'invoice-full-excel')
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial', 'tax-proofs', 'invoice-full-excel')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "authenticated delete own imported docs" ON storage.objects;
CREATE POLICY "authenticated delete own imported docs" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial', 'tax-proofs', 'invoice-full-excel')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
