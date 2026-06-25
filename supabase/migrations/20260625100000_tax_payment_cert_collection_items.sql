-- 完税证明：每张 PDF 汇总明细行税种（征收项目），供查询页多选筛选
ALTER TABLE public.tax_payment_certificate_records
  ADD COLUMN IF NOT EXISTS collection_items text[] NOT NULL DEFAULT '{}'::text[];

COMMENT ON COLUMN public.tax_payment_certificate_records.collection_items IS
  '明细行税种（征收项目）去重列表，一张完税证明可含多项';

CREATE INDEX IF NOT EXISTS idx_tax_payment_cert_collection_items
  ON public.tax_payment_certificate_records USING GIN (collection_items);

-- 可选：从已导入记录的 content.lines 回填 tax_type（重新导入前可跑一次）
UPDATE public.tax_payment_certificate_records r
SET collection_items = sub.items
FROM (
  SELECT
    id,
    COALESCE(
      array_agg(DISTINCT line->>'tax_type') FILTER (WHERE coalesce(line->>'tax_type', '') <> ''),
      '{}'::text[]
    ) AS items
  FROM public.tax_payment_certificate_records,
       LATERAL jsonb_array_elements(content->'lines') AS line
  GROUP BY id
) sub
WHERE r.id = sub.id
  AND r.collection_items = '{}'::text[];
