# TaxManager

电子税务局风格的申报查询原型，基于 Vite + React + TypeScript 构建，部署目标为 GitHub Pages。

## 常用命令

```bash
npm run dev
npm run lint
npm run build
```

## 部署说明

GitHub Pages 子路径部署时通过 `VITE_BASE=/仓库名/` 构建，项目内的 `BrowserRouter`、静态资源路径和 `404.html` SPA fallback 都会跟随该 base 工作。

生产构建由 `.github/workflows/deploy-pages.yml` 执行，需要配置：

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 功能概览

- 登录页按电子税务局视觉还原，首屏图片已压缩并预加载。
- 登录后门户首页、查询页、详情页按路由拆包加载。
- 查询页使用 Supabase `form_data` 数据，并支持 Excel 导入后的结构化查询。
- 详情页可基于导入 Excel 的网格数据预览并导出 PDF。
