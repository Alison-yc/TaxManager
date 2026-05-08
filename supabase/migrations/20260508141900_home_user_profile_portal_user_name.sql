-- 顶部门户用户显示名，支持在用户菜单中双击修改
ALTER TABLE public.home_user_profile
  ADD COLUMN IF NOT EXISTS portal_user_name text NOT NULL DEFAULT '**燕';

COMMENT ON COLUMN public.home_user_profile.portal_user_name IS '门户顶部用户显示名';

UPDATE public.home_user_profile
SET portal_user_name = COALESCE(NULLIF(portal_user_name, ''), '**燕')
WHERE id = 'default';
