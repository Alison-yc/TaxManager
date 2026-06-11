-- 允许登录用户更新自己的发票记录（用于从 Storage PDF 重新解析补全字段）
DROP POLICY IF EXISTS "authenticated update own invoice_records" ON public.invoice_records;
CREATE POLICY "authenticated update own invoice_records" ON public.invoice_records
  FOR UPDATE TO authenticated
  USING (auth_user_id = auth.uid())
  WITH CHECK (auth_user_id = auth.uid());
