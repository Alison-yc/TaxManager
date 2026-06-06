-- Storage：允许 tax-proofs 目录存放完税证明 PDF
DROP POLICY IF EXISTS "authenticated read own imported docs" ON storage.objects;
CREATE POLICY "authenticated read own imported docs" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial', 'tax-proofs')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "authenticated insert own imported docs" ON storage.objects;
CREATE POLICY "authenticated insert own imported docs" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial', 'tax-proofs')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "authenticated update own imported docs" ON storage.objects;
CREATE POLICY "authenticated update own imported docs" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial', 'tax-proofs')
    AND (storage.foldername(name))[2] = auth.uid()::text
  )
  WITH CHECK (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial', 'tax-proofs')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );

DROP POLICY IF EXISTS "authenticated delete own imported docs" ON storage.objects;
CREATE POLICY "authenticated delete own imported docs" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'imported-docs'
    AND (storage.foldername(name))[1] IN ('invoices', 'declarations', 'financial', 'tax-proofs')
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
