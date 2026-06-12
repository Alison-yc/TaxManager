-- 允许用户更新自己的完税证明记录（导出时同步填发日期）
DROP POLICY IF EXISTS "authenticated update own tax_payment_certificate_records" ON public.tax_payment_certificate_records;
CREATE POLICY "authenticated update own tax_payment_certificate_records" ON public.tax_payment_certificate_records
  FOR UPDATE TO authenticated USING (auth_user_id = auth.uid()) WITH CHECK (auth_user_id = auth.uid());
