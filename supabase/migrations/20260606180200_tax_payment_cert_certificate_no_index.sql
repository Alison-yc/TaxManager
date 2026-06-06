-- 一张完税证明 PDF 对应多行明细，certificate_no 不能设唯一约束
DROP INDEX IF EXISTS idx_tax_payment_cert_user_certificate_no;

CREATE INDEX IF NOT EXISTS idx_tax_payment_cert_user_certificate_no
  ON public.tax_payment_certificate_records (auth_user_id, certificate_no);
