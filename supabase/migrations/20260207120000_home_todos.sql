-- 首页「我的待办」四分类数据；登录用户在 RLS 下可读写（与 form_data 同策略时可按需收紧）
CREATE TABLE IF NOT EXISTS public.home_todos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tab text NOT NULL CHECK (tab IN ('declare', 'doc', 'risk', 'other')),
  sort_order integer NOT NULL DEFAULT 0,
  matter text NOT NULL,
  deadline date NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.home_todos IS '门户首页「我的待办」行项目';
CREATE INDEX IF NOT EXISTS idx_home_todos_tab_order ON public.home_todos (tab, sort_order);

CREATE OR REPLACE FUNCTION public.home_todos_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tr_home_todos_updated_at ON public.home_todos;
CREATE TRIGGER tr_home_todos_updated_at
  BEFORE UPDATE ON public.home_todos
  FOR EACH ROW EXECUTE PROCEDURE public.home_todos_set_updated_at();

ALTER TABLE public.home_todos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "authenticated read home_todos" ON public.home_todos;
CREATE POLICY "authenticated read home_todos" ON public.home_todos
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "authenticated insert home_todos" ON public.home_todos;
CREATE POLICY "authenticated insert home_todos" ON public.home_todos
  FOR INSERT TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated update home_todos" ON public.home_todos;
CREATE POLICY "authenticated update home_todos" ON public.home_todos
  FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "authenticated delete home_todos" ON public.home_todos;
CREATE POLICY "authenticated delete home_todos" ON public.home_todos
  FOR DELETE TO authenticated USING (true);

-- 初始占位数据（可自行在页面修改）
INSERT INTO public.home_todos (tab, sort_order, matter, deadline, status)
SELECT * FROM (
  VALUES
    ('declare', 0::int, '居民企业（查账征收）企业所得税月（季）度预缴纳税申报'::text, DATE '2026-05-31', '未申报'::text),
    ('declare', 1, '财务报表报送（年报）', DATE '2026-05-31', '已申报'),
    ('declare', 2, '居民企业（查账征收）企业所得税月（季）度预缴纳税申报', DATE '2026-04-20', '已申报'),
    ('declare', 3, '通用申报（工会经费）', DATE '2026-04-20', '已申报'),
    ('declare', 4, '财务报表报送（季报）', DATE '2026-04-20', '已申报'),

    ('doc', 0, '《税务事项通知书》（石高税通〔2026〕12号）', DATE '2026-04-28', '待签收'),
    ('doc', 1, '《责令限期改正通知书》', DATE '2026-04-26', '待签收'),
    ('doc', 2, '《行政处罚事项告知书》送达回证', DATE '2026-04-22', '已签收'),
    ('doc', 3, '《纳税评估约谈通知书》', DATE '2026-04-19', '待签收'),
    ('doc', 4, '《风险提示函》', DATE '2026-04-15', '已签收'),

    ('risk', 0, '进项税额转出比例与行业均值偏离疑点提示', DATE '2026-05-15', '待核实'),
    ('risk', 1, '单月开票金额环比波动超阈值提醒', DATE '2026-04-30', '待核实'),
    ('risk', 2, '跨省迁出涉税事项衔接提醒', DATE '2026-04-21', '处理中'),
    ('risk', 3, '关联交易同期资料报送期限提醒', DATE '2026-04-18', '已反馈'),
    ('risk', 4, '企业所得税税前扣除凭证存疑提示', DATE '2026-04-10', '已反馈'),

    ('other', 0, '增值税专用发票（中文三联无金额限制版）票种核定', DATE '2026-04-29', '办理中'),
    ('other', 1, '增值税留抵退税申请（制造业）', DATE '2026-04-27', '审核中'),
    ('other', 2, '办税人员实名信息变更', DATE '2026-04-24', '补正中'),
    ('other', 3, '三方协议账号验证失败', DATE '2026-04-20', '待处理'),
    ('other', 4, '历史申报表批量导出申请', DATE '2026-04-12', '已完成')
) AS v(tab, sort_order, matter, deadline, status)
WHERE NOT EXISTS (SELECT 1 FROM public.home_todos LIMIT 1);
