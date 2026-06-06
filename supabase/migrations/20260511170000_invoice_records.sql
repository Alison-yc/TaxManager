-- 全量发票查询：PDF 发票导入记录
CREATE TABLE IF NOT EXISTS public.invoice_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  auth_user_id uuid NOT NULL DEFAULT auth.uid(),
  digital_invoice_no text NOT NULL,
  invoice_code text,
  invoice_number text,
  query_type text NOT NULL DEFAULT '开具发票',
  invoice_source text,
  invoice_type text,
  invoice_status text DEFAULT '正常',
  is_positive text DEFAULT '是',
  risk_level text DEFAULT '正常',
  seller_name text,
  seller_tax_id text,
  buyer_name text,
  buyer_tax_id text,
  issue_date timestamptz,
  amount numeric(20, 2),
  tax_amount numeric(20, 2),
  total_amount numeric(20, 2),
  business_type text,
  issuer text,
  remark text,
  source_file_name text NOT NULL,
  storage_path text NOT NULL,
  content jsonb NOT NULL DEFAULT '{}'::jsonb
);

COMMENT ON TABLE public.invoice_records IS '数电发票 PDF 导入记录，供全量发票查询使用';

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoice_records_user_digital_no
  ON public.invoice_records (auth_user_id, digital_invoice_no);

CREATE INDEX IF NOT EXISTS idx_invoice_records_issue_date
  ON public.invoice_records (issue_date DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_invoice_records_created_at
  ON public.invoice_records (created_at DESC);

ALTER TABLE public.invoice_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read own invoice_records" ON public.invoice_records;
CREATE POLICY "authenticated read own invoice_records" ON public.invoice_records
  FOR SELECT TO authenticated USING (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "authenticated insert own invoice_records" ON public.invoice_records;
CREATE POLICY "authenticated insert own invoice_records" ON public.invoice_records
  FOR INSERT TO authenticated WITH CHECK (auth_user_id = auth.uid());

DROP POLICY IF EXISTS "authenticated delete own invoice_records" ON public.invoice_records;
CREATE POLICY "authenticated delete own invoice_records" ON public.invoice_records
  FOR DELETE TO authenticated USING (auth_user_id = auth.uid());
