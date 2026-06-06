-- 税收完税证明 PDF 导入：表格式查询明细行
CREATE TABLE IF NOT EXISTS public.tax_payment_certificate_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  auth_user_id uuid NOT NULL DEFAULT auth.uid(),
  import_id uuid NOT NULL,
  line_index int NOT NULL DEFAULT 0,
  certificate_no text NOT NULL,
  original_voucher_no text NOT NULL,
  tax_type text,
  item_name text,
  tax_period_start date,
  tax_period_end date,
  payment_date date,
  actual_amount numeric(20, 2),
  taxpayer_name text,
  taxpayer_tax_id text,
  issue_date date,
  tax_authority text,
  total_amount numeric(20, 2),
  remark text,
  source_file_name text NOT NULL,
  storage_path text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.tax_payment_certificate_records IS '税收完税证明 PDF 导入明细，供表格式查询使用';

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_payment_cert_user_import_line
  ON public.tax_payment_certificate_records (auth_user_id, import_id, line_index);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tax_payment_cert_user_certificate_no
  ON public.tax_payment_certificate_records (auth_user_id, certificate_no);

CREATE INDEX IF NOT EXISTS idx_tax_payment_cert_payment_date
  ON public.tax_payment_certificate_records (payment_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_tax_payment_cert_tax_period
  ON public.tax_payment_certificate_records (tax_period_start DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_tax_payment_cert_import_id
  ON public.tax_payment_certificate_records (import_id);

ALTER TABLE public.tax_payment_certificate_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read own tax_payment_certificate_records" ON public.tax_payment_certificate_records;
CREATE POLICY "authenticated read own tax_payment_certificate_records" ON public.tax_payment_certificate_records
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "authenticated insert own tax_payment_certificate_records" ON public.tax_payment_certificate_records;
CREATE POLICY "authenticated insert own tax_payment_certificate_records" ON public.tax_payment_certificate_records
  FOR INSERT TO authenticated WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "authenticated delete own tax_payment_certificate_records" ON public.tax_payment_certificate_records;
CREATE POLICY "authenticated delete own tax_payment_certificate_records" ON public.tax_payment_certificate_records
  FOR DELETE TO authenticated USING (auth_user_id = auth.uid());
