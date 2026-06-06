-- 一张 PDF 对应一条记录，恢复 certificate_no 唯一约束（若曾执行 180200 改为普通索引）
DROP INDEX IF EXISTS idx_tax_payment_cert_user_certificate_no;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_payment_cert_user_certificate_no
  ON public.tax_payment_certificate_records (auth_user_id, certificate_no);

-- 清理旧版「一行明细一条记录」的重复数据，仅保留每组 import_id 的第一条
DELETE FROM public.tax_payment_certificate_records a
USING public.tax_payment_certificate_records b
WHERE a.import_id = b.import_id
  AND a.auth_user_id = b.auth_user_id
  AND a.line_index > b.line_index;
