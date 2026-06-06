-- Supabase Storage：导入 PDF 私有桶
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'imported-docs',
  'imported-docs',
  false,
  52428800,
  ARRAY['application/pdf']::text[]
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "authenticated read own imported docs" ON storage.objects;
CREATE POLICY "authenticated read own imported docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "authenticated insert own imported docs" ON storage.objects;
CREATE POLICY "authenticated insert own imported docs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "authenticated update own imported docs" ON storage.objects;
CREATE POLICY "authenticated update own imported docs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial')
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "authenticated delete own imported docs" ON storage.objects;
CREATE POLICY "authenticated delete own imported docs" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
