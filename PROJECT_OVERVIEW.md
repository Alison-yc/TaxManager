# TaxManager 项目介绍与开发分析

> 分析日期：2026-11-20。代码基线：`de6546c`。
> 本文根据当前仓库源码、SQL migrations 和调用关系整理，供后续 Agent 快速理解现状、定位增量开发入口。旧文档用于背景参考，其中的历史要求不等于本次用户需求，也不代表当前功能边界。
> 验证范围：静态代码分析和本次三个样本的解析回归；未连接线上 Supabase、未执行导入/删除/修复操作，未验证线上数据和实际部署状态。当前环境没有项目 `node_modules`，未运行完整 `npm build`。

## 1. 项目是什么

TaxManager 是电子税务局视觉风格的税务资料管理与查询原型。核心能力是把用户导入的申报表、财务报表、发票、完税证明整理为可查询记录，并提供预览和下载。

它是 React SPA，浏览器直接访问 Supabase Auth、Postgres 和 Storage，无自建业务后端。当前代码没有对接真实税局申报、缴税、发票查验或风险评估接口。页面上存在较多视觉占位入口，不能把所有菜单文案当作已实现业务。

最关键的业务分流：

```text
登录 → 门户首页 / 顶部账户中心
  ├─ 申报表 Excel → 首工作表网格 + 索引 → form_data → 查询 → 网格预览 → 截图式 PDF
  ├─ 申报/财务 PDF → 文本抽取 + 索引 → form_data + Storage → 查询 → PDF 预览/下载
  ├─ 发票 PDF → 票头 + 明细 → invoice_records + Storage → 发票列表 / PDF 预览
  ├─ 全量发票 Excel → 独立基准文件 + 元数据 → 按日期或票号过滤 → Excel 下载
  └─ 完税证明 PDF → 证明摘要 + 全部明细 → 证明表 + Storage → 查询 / 预览 / 下载
```

**发票 PDF 形成的数据库记录，与全量发票 Excel 基准文件是两套独立数据。上传 Excel 不会自动生成发票列表；上传 PDF 不会自动补入 Excel 基准。**

## 2. 技术栈与目录

| 层次 | 当前实现 |
| --- | --- |
| 页面 | React 18、TypeScript、Ant Design 6、React Router 7 |
| 构建 | Vite 8，`tsc -b && vite build` |
| 数据与登录 | `@supabase/supabase-js`，浏览器直连 |
| 申报 Excel | `xlsx`（SheetJS），读取 `.xls/.xlsx` |
| 发票 Excel | `exceljs`，读取、合并和写出 `.xlsx` |
| PDF 读取 | `pdfjs-dist`，抽取已有文本层，无 OCR |
| 网格转 PDF | `html2canvas` + `jsPDF` |
| PDF 内容修改 | `pdf-lib` + fontkit，用于完税证明日期处理 |
| 部署 | GitHub Actions → GitHub Pages |

```text
src/App.tsx                    登录门禁、懒加载、路由
src/components/                导入菜单、布局、登录、表格、PDF 查看器
src/pages/                     各业务查询页和详情页
src/lib/                       Excel 导入导出、查询、Storage、修复
src/lib/pdfImport/             PDF 解析、批量导入、重解析、指定票号维护
src/constants/                 表种、筛选枚举、事件名、静态资源路径
src/types/database.ts          前端数据结构（不是完整数据库 schema）
supabase/migrations/           数据库增量结构、索引、RLS、Storage 策略
public/assets/templates/       历史发票导出模板
public/assets/etax/             门户视觉静态资源
scripts/                       PDF 解析与字体诊断、回归辅助脚本
src/styles/etax.css             主要门户样式
```

## 3. 当前功能和路由

| 模块 | 路由 / 入口 | 已实现行为 |
| --- | --- | --- |
| 登录 | 未登录时显示 LoginPage | 企业业务账号密码登录、会话持久化、退出；账号可自动拼邮箱后缀 |
| 门户首页 | `/` | 首页资料展示和编辑、我的待办增删改、各业务入口 |
| 申报查询 | `/query` | 表种、更正类型、作废标志、所属期和申报日期筛选；分页、详情、PDF 导出、删除 |
| 申报详情 | `/record/:id` | Excel 网格预览 / PDF 原文件预览；导出 |
| 财务报表 | `/financial-query`、`/financial-record/:id` | 复用申报列表和详情，固定 `variant=financial` |
| 发票查询统计 | `/invoice-query/stats` | 功能入口卡片页；不是独立统计分析计算引擎 |
| 全量发票查询 | `/invoice-query/full` | 多条件查询、分页展示、金额汇总、勾选/全部导出 Excel、删除 |
| 发票详情 | `/invoice-query/record/:id` | Storage PDF 预览和下载 |
| 完税证明查询 | `/tax-payment-cert/query` | 按属期/缴退款日期、征收项目筛选；勾选下载、详情、删除 |
| 完税证明详情 | `/tax-payment-cert/record/:id` | 预览 PDF，尝试更新填发日期，下载 |
| 账户中心 | `UserImportMenuItem.tsx` | 各类上传、全量 Excel 替换/增量、指定票号批量维护、历史申报 Excel 修复预览/执行 |

补充边界：

- 登录表单第一项税号只是展示字段，不参与认证；仅企业业务登录真正可提交。账号无 `@` 时默认拼 `@qq.com`，可由 `VITE_AUTH_EMAIL_SUFFIX` 修改。
- 首页展示资料来自共享 `home_user_profile`，不能据此推断当前用户真实纳税主体；`home_todos` 也采用已登录共享策略。
- 发票列表目前最多拉取 1000 条，再做页面分页；页面金额汇总基于已拉取记录，并非数据库全量聚合。按复杂条件导出会按每批 1000 条继续拉取全部匹配票号。
- 发票“取得/开具”会影响对方信息展示，但 `applyInvoiceRecordFilters` 没有用 `queryType` 筛选数据库。导入 PDF 的 `query_type` 固定为“开具发票”。
- 完税证明存在多个表单选项，但实际筛选主要为日期和 `collection_items`；不能把所有控件当成有效查询条件。当前整表读取后前端过滤，没有显式循环分页，可能受 Supabase 返回上限影响。

## 4. 上传入口与分流

当前生效入口为 `src/components/UserImportMenuItem.tsx`，顶栏“账户中心”展开菜单。

| 上传种类 | 允许文件 / 批量方式 | 处理入口 | 数据落点 |
| --- | --- | --- | --- |
| Excel 申报表 | `.xls/.xlsx`，单文件 | `formDataExcelUpload.ts` | `form_data.content` + 平面索引 |
| 发票 PDF | 单选、多选、文件夹（含子目录 PDF） | `invoicePdfBatchImport.ts` → `declarationPdfImport.ts:uploadInvoicePdfFile` | `invoice_records` + `invoices/` |
| 全量发票 Excel 替换 | `.xlsx`，单文件 | `invoiceFullExcelBaseline.ts:uploadInvoiceFullExcelBaseline` | 基准表 + 固定路径文件 |
| 全量发票 Excel 增量 | `.xlsx`，单文件，需要已有基准 | `invoiceFullExcelBaseline.ts:mergeInvoiceFullExcelBaseline` | 合并后覆盖基准 |
| 完税证明 PDF | 单选、多选 | `taxPaymentCertPdfImport.ts` / BatchImport | 证明表 + `tax-proofs/` |
| 申报 PDF | `.pdf`，单文件 | `declarationPdfImport.ts:uploadDeclarationPdfFile` | `form_data` + `declarations/` |
| 财务 PDF | `.pdf`，单文件，用户指定分类 | 同上，`category=financial` | `form_data` + `financial/` |

分类首先由用户选择菜单决定，并非把所有文件交给统一智能分类器。后续才由各解析器做格式/内容检查。`accept` 只是文件选择提示，处理函数主要按扩展名判断，再交给解析库读取，不是统一的文件内容签名校验。

发票批量和完税证明批量默认并发数均为 4；界面显示进度，结果分成功、重复跳过、失败。批次不是数据库事务，允许部分成功。

## 5. Excel 申报表：如何识别、入库、去重

调用链：

```text
UserImportMenuItem.handleFile
→ uploadFormDataFromExcelFile
→ parseExcelFile
→ extractDeclarationIndexFromGrid
→ 税号检查 / 修复 → 重复检查 → form_data.insert
→ taxmanager:form-data-excel-import → 列表刷新
```

### 5.1 读取和保存的内容

`excelImport.ts` 用 `XLSX.read(..., {type:'array', cellDates:true, cellStyles:true})` 读取文件，**只取第一张工作表**。

保存 `importVersion: 2` 的 JSON；当前还会记录 `previewHeaderRows`，让不同导出器的顶部信息区使用正确行数：

- `excel`：文件名、首表名、解析后的对象行、对象行数量。
- `grid`：二维单元格网格，供预览重新排版；数字优先读取显示值 `cell.w`，其次原值。
- `merges`：合并区域；`colWidths`：可用列宽；`previewHeaderRows`：预览顶部信息区行数；`summary`：简短摘要。
- `declaration_index`：检索字段快照。

这不是原工作簿无损归档。原 Excel 二进制不上传 Storage；全部工作表、原始公式、完整样式、行高等没有作为可恢复工作簿完整保存。显示值优先也无法恢复 Excel 在数值存储时已经损失的长税号精度。

### 5.2 识别规则

核心函数：`declarationIndex.ts:extractDeclarationIndexFromGrid`。

- 表名扫描前 4 行所有单元格，缺失时用默认标题。
- 增值税主表默认识别为 `BDA0610606`；如果顶部文本明确带有 `BDA...` 编码则优先使用该编码，当前上传入口仍面向申报表 Excel。
- 更正类型和作废标志默认分别为“新产生申报表”“未作废”；如果新模板顶部带有对应标签，会提取已知枚举值。
- 纳税人名称先扫描前 14 行“纳税人名称”标签及其右侧值，再回退 `C6`。
- 税号使用标签扫描、固定单元格及数字串兜底。
- 识别当前已验证的三类版式：
  1. `combined_period_in_cell`：23 年、24 年样本中的“税款所属时间/期间：自/直接日期 … 至 …”，填表日期可与期间同格或在其他单元格。
  2. `compact_main_table`：26.9 镁神 HTML Excel，只有 3 行顶部元信息，第 4 行直接进入“项目/栏次”表头。
  3. `official_split_cells`：保留旧版“起/止/填表日期”分列的兼容路径，并优先扫描顶部同一行的日期，避免依赖固定行号。
- 期间识别支持“时间/期间”“自”“至/到”、中英文日期分隔符以及日期缺少“日”的常见写法。
- 应补退税额：找“本期应补（退）税额”行，忽略 `34＝24-28-29`、`0C02=...` 等栏次公式，只读取严格的金额单元格，避免把栏次编号误记成税额。

**支持下拉中列出的表种，不等于 Excel 解析器已支持这些表种。** 当前解析器已扩展为增值税主表的三类真实样本，并保留对后续版式的文本扫描兜底；其他税种仍需单独增加字段规则和样本回归。

### 5.3 税号校验与修复

- `repairUnifiedSocialCreditCode` 含已确认错值的硬编码映射，主要处理特定样本因数字精度丢失造成的错号。
- 对恰好 18 位的税号检查字符集和校验位；**空税号和非 18 位目前在 `isValidUnifiedSocialCreditCode` 中直接返回 true**，不是严格必填校验。
- 入库前调用该校验，失败时提示改为文本格式重传；已确认映射修复也会尝试回填预览网格。
- `formDataExcelRepair.ts` 可从历史网格重算 JSON 快照和平面字段，提供只读影响预览和实际修复；原文件未归档，不能承诺任意错误税号可自动恢复。

### 5.4 入库与去重

`flattenDeclarationForInsert` 把 JSON 和索引字段同时写入 `form_data`，依赖数据库默认值把来源/类别补为 `excel/declaration`。

去重先按表编码、更正类型、作废标志、税号、所属期、申报日期、税额查最多 10 条候选，再对整个 `content` 做键排序后的稳定序列化比较。由于 JSON 含文件名，改文件名可能绕过完全相同内容判断；超过 10 条候选也可能漏判；不是文件哈希去重或数据库唯一约束。

## 6. 全量发票 Excel：如何保存与增量合并

核心：`invoiceFullExcelBaseline.ts`，使用 ExcelJS，支持多张工作表。

### 6.1 替换上传

- 检查 `.xlsx`，加载工作簿并统计各表行列数。
- 保留上传的工作簿二进制，写入私有桶：`invoice-full-excel/<当前用户UUID>/latest.xlsx`。
- `invoice_full_excel_baselines` 按 `auth_user_id` upsert，一人一条，记录原文件名、表数、数据行数、更新时间等。
- 新上传覆盖旧基准，没有业务层历史版本。
- 统计行数是每表 `rowCount - 1` 相加，不是去重发票张数；替换上传没有强制验证后续导出必需表头，因此可能上传成功、导出才报缺列。

### 6.2 增量合并

- 先下载当前用户的基准，逐张按**工作表同名**匹配增量工作表；基准缺少同名表时报错。
- 每表只在第 1 行找“数电发票号码”，比较前去除表头空白。
- 票号转成字符串并删除非数字字符，建立“票号 → 行号”映射。
- 票号存在则整行覆盖，不存在则追加；空票号跳过。复制单元格值、样式、数值格式和行高。
- **按列位置复制，不按字段名称重新映射**；两个工作簿列顺序必须一致。
- 同一表里同票号多条商品明细会映射到同一行，不能按一对多明细安全合并。新增/更新统计也是处理行数，不一定是唯一票数。
- 写回同一路径并更新元数据，不会同步 `invoice_records`。

## 7. PDF 上传：识别规则与边界

### 7.1 通用文本提取

`loadPdfDocument.ts` 初始化 PDF.js Worker；读取异常时尝试禁用字体重读。`extractPdfText.ts` 遍历全部页，调用 `getTextContent()`，把文字项目用空格拼接。

没有图像 OCR，也没有调用大模型识别。扫描件不保证可用；部分发票可依赖文件名补出少量字段，但不代表成功识别了扫描图像。

### 7.2 申报和财务 PDF

- 财务分类由入口直接设为 `CWBB001`，没有逐种财务报表模板分类或完整报表结构化。
- 申报主要依据文件名和正文规则识别企业所得税：月季度 `BDA0640110`（如 A200000）、年度 `BDA0640530`（如 A100000）；不匹配则报错。
- 正文用正则提取纳税人、税号、属期、填表日期、税额。申报日期缺失时取 `new Date().toISOString().slice(0,10)`，即 UTC 日期兜底，不能当成文件中真实申报日。
- 去重先对同分类 PDF 查 SHA-256，再按业务索引组合判断。字段大量缺失时不同文件有被误判重复的可能。
- 上传原 PDF 到 `declarations/<uid>/<记录UUID>.pdf` 或 `financial/<uid>/<记录UUID>.pdf`。
- `form_data.content` 为 `importVersion:3/importSource:'pdf'`，含文件名、路径、页数、哈希、索引和摘要；平面字段再次冗余写入。

### 7.3 发票 PDF

解析器 `invoicePdfImport.ts` 约 1650 行，包含多种排版规则，是当前维护成本较高的模块。

- 同时使用正文标签/文本块和文件名提示（如 `dzfp_...`、数电发票名称模式）提取票号、购销双方、日期、发票类型等。
- 处理数字被空格拆开的情况、购销方方向、金额三元组、规格/单位/数量/单价、税率、备注、开票人、红字/负数发票。
- 明细识别失败时可以退回一条占位/摘要明细，导入成功不意味着每个商品字段都准确。
- 发票状态、风险等级等有固定默认值“正常”，来源默认“电子发票服务平台”，不是外部查验结果。解析器还包含特定销售方名称提示，扩展其他企业时应检查泛化效果。
- `uploadInvoicePdfFile` 上传 `invoices/<uid>/<票号>.pdf`，然后查重并插入 `invoice_records`；数据库唯一键为 `(auth_user_id,digital_invoice_no)`。
- **先上传且 `upsert:true`、再查数据库重复**：重复票号可能覆盖 Storage 文件却拒绝新增数据库记录，造成文件与结构化字段不一致。

### 7.4 完税证明 PDF

- `taxPaymentCertPdfImport.ts` 用文本正则识别证明号码、填发日期、税务机关、纳税人、总额及表格式明细；无号码或无有效明细会报错。
- 按证明号码查重后上传 `tax-proofs/<uid>/<证明号码>.pdf`。
- **一份 PDF 一条数据库记录**。首条明细的凭证号、税种、属期、缴款日期成为平面字段；金额优先总额。
- 全部明细放 `content.lines`；各行税种去重后放 `collection_items`，支持征收项目多选筛选。
- 因为日期取第一行，多明细不同属期/缴款日期的证明不能等同于逐行检索。

## 8. 导出逻辑（实际生效调用链）

### 8.1 Excel 申报记录 → PDF

`RecordPreview.tsx` → `VatFormGrid.tsx` → `excelExport.ts`。

网格和合并单元格被重新渲染为 HTML 表格，按模板列宽/样式展示，再由 html2canvas 截图、jsPDF 写为纵向 A4 **单页缩放** PDF。它不是把原 Excel 转成可编辑/可选中文本 PDF，也不自动分页；大表可能整体缩小。

列表导出通过 `?pdf=1` 进入详情自动执行；查询返回参数和 sessionStorage 快照用于恢复筛选/页码。生产公网环境下会调用 `recordExportClick` 写出日志；日志失败不阻断下载。

当前申报详情没有“下载 Excel”按钮。旧 `docs/PROJECT_PROMPT.md` 中关于下载 Excel 的描述不能当成现成功能。

### 8.2 申报/财务 PDF 和发票 PDF

直接从私有 Storage 读取既有 PDF，生成预览链接/二进制，下载时使用 Blob URL，不根据数据库字段重新绘制整份文件。通用签名链接默认有效期 3600 秒。

### 8.3 全量发票列表 → Excel

当前页面使用 **`invoiceBaselineExcelExport.ts`**：

| 操作 | 实际数据来源和过滤方式 |
| --- | --- |
| 导出勾选 | 按选中数据库记录取票号集合，在基准工作簿每张表按“数电发票号码”保留行 |
| 导出全部，无日期/非日期过滤 | 直接下载当前基准文件，即使其中某些票没有 PDF 列表记录 |
| 导出全部，仅日期过滤 | 直接按基准各表“开票日期”过滤，不要求对应 PDF 已入库 |
| 导出全部，包含其他过滤 | 从数据库分页取得全部匹配票号，再据此过滤基准工作簿 |

- 表头在首行识别，忽略空白；缺少必要列直接报错。
- 日期支持 Excel Date 对象、数值序列日期和可解析文本。
- 从底部删除不匹配行，保留工作簿剩余结构；发生删除时重排“序号”。每处理 400 行让出主线程，文件读写本身仍在浏览器中进行。
- 返回 `rowCount` 为所有表保留行数合计，不是唯一发票数量。
- 数据库有记录但基准缺票时无法导出对应 Excel 行；基准有票但数据库没有记录时，无过滤/仅日期导出仍可能导出。
- `invoiceExcelExport.ts` 中还有基于数据库明细和静态模板生成工作簿的旧实现，但当前 `FullInvoiceQueryPage` 未使用它。不要修改旧文件后误以为当前页面已生效。

### 8.4 完税证明 PDF

**预览存在写操作**：`TaxPaymentCertRecordPreview` → `refreshTaxPaymentCertIssueDate`。

- 若数据库填发日期不是本地当天，下载文件并调用 `taxPaymentCertIssueDatePatch.ts` 尝试替换日期。
- 成功后覆盖 Storage 同一路径，再更新数据库 `issue_date`；当天则直接用已有文件。
- 失败会返回原下载 Blob 供预览并显示 warning。但文件上传与数据库更新没有事务：文件已覆盖、数据库更新失败时，不能认为远端文件一定未变化。
- 详情导出下载已准备的 PDF；列表勾选导出则逐份调用 `downloadTaxPaymentCert`，直接下载桶内当前文件，不触发日期刷新、不打 ZIP。
- `taxPaymentCertPdfExport.ts` / `TaxPaymentCertPdfDocument.tsx` 中仍有重新排版生成 PDF 的辅助实现，但当前查询/预览主链路使用存储的 PDF。

## 9. 数据模型、隔离与部署依赖

| 表 / 桶 | 作用 | 隔离现状（以仓库 SQL 为准） |
| --- | --- | --- |
| `form_data` | Excel/PDF 申报及财务记录，content + 查询字段 | 仓库只有扩展列 migration，没有基础建表/RLS；无法据此确认线上隔离 |
| `invoice_records` | PDF 发票票头 + content.line_items | auth_user_id 默认 auth.uid，按用户 RLS；票号在用户内唯一 |
| `invoice_full_excel_baselines` | 当前用户 Excel 基准元数据 | 用户内唯一，按用户 RLS |
| `tax_payment_certificate_records` | 一 PDF 一证明记录，content.lines | 按用户 RLS；证明号在用户内唯一 |
| `home_user_profile` | 首页/顶栏展示资料 | 默认 id=default，已登录共享读写 |
| `home_todos` | 首页待办 | 已登录共享读写 |
| `export_click_logs` | Excel 申报 PDF 导出日志 | 不覆盖所有业务的导出审计 |
| `imported-docs` | PDF 和发票 Excel 原文件 | 私有桶，路径第二段须为当前 auth.uid；配置文件上限 50 MiB |

通用文件路径形如 `<category>/<uid>/<filename>`，分类包括 `invoices/declarations/financial/tax-proofs/invoice-full-excel`。

不要仅靠前端是否带 user_id 判断隔离。发票/完税证明查询主要依赖 RLS；`form_data` 的真实权限必须单独核对线上策略。数据库查询与 Storage 必须同时按一致的用户/主体隔离，否则可能出现记录可见、文件不可读。

仓库 migrations 是增量，不构成可从零复现全部数据库的完整初始化。日期排序执行前应审阅具体 SQL：其中完税证明“一 PDF 一条”迁移含历史明细删除操作，不能作为纯只读初始化看待。本次未执行任何 SQL。

## 10. 维护、删除和一致性

- 历史 Excel 修复：从已存 grid 重算索引并同步预览顶部行数，先预览，再按用户意图执行；并非重新读取原 Excel。
- 发票重解析：`reparseInvoiceRecords.ts` 下载现存 PDF，用当前解析器重算字段，与旧记录合并后更新；提供 full/missing 模式。
- 指定票号批量维护：`InvoiceNumbersMaintainModal.tsx` / `invoiceBatchByNumbers.ts`，支持按票号下载 PDF、删除数据库记录、重解析、重新导入（可选择替换已有）。
- 指定票号替换是先删除旧记录再重新导入；失败时旧数据库记录可能已丢失，没有事务回滚。
- 当前列表删除通常只删除数据库记录，没有联动清除 Storage，也不删除 Excel 基准中的同票号行。不要把列表删除理解为全链路删除。
- 上传文件与数据库写入分两步，失败可能产生孤立文件或不同步。全量基准替换也会先覆盖文件再 upsert 元数据，无历史恢复逻辑。

## 11. 新增功能时从哪里改

| 需求 | 优先修改位置 | 需要一起检查 |
| --- | --- | --- |
| 新增 Excel 申报模板/税种 | `excelImport.ts`、`declarationIndex.ts` | 独立模板检测、表编码、必填校验、查询枚举、旧数据兼容、预览列宽 |
| 支持多工作表申报 | `parseExcelFile` 和 content 类型 | 一个文件多记录还是一记录多表、去重粒度、详情切换、导出分页 |
| 申报原 Excel 下载 | 上传和 Storage 层 | 先归档原二进制，再提供下载；现有 grid 不等于原文件 |
| 新增 PDF 申报/财务表种 | `declarationPdfImport.ts`、`extractPdfText.ts` | 分类优先级、正则样本、缺字段策略、查询枚举 |
| 提升发票识别 | `invoicePdfImport.ts` | 不同排版回归、税额/金额/红字、长票号精度、购销方方向、占位明细 |
| 上传 Excel 同步发票列表 | 当前没有此流程，需要新增 | 字段映射、一票多明细、与 PDF 数据的合并优先级、删除/重解析一致性 |
| 改发票 Excel 导出 | `invoiceBaselineExcelExport.ts`、`FullInvoiceQueryPage.tsx` | 四种导出分支、基准缺票、多 sheet、日期类型、表头约束 |
| 改发票增量合并 | `invoiceFullExcelBaseline.ts` | 以票号分组的一对多明细、列名映射、版本备份、并发更新 |
| 完税证明新增字段/筛选 | `taxPaymentCertPdfImport.ts`、QueryPage、types 和 migration | 首行摘要 vs 全部明细、collection_items、既有数据回填 |
| 完税证明日期处理 | `taxPaymentCertExport.ts`、`taxPaymentCertIssueDatePatch.ts` | 预览写副作用、保留原件、字体处理、失败一致性 |
| 账号/企业隔离 | SQL RLS、Storage policy、Auth、首页资料 | 不用装饰税号决定权限；补齐 form_data 基础 schema |
| 新页面 | `App.tsx`、`AppShell.tsx`、门户菜单/首页入口 | BASE_URL、懒加载、查询返回状态、静态占位和实际能力边界 |

新增业务字段的完整链路通常是：`数据库 migration → types → 解析结果 → 入库 payload → 查询字段/条件 → UI → 导出 → 历史数据回填`。JSON 快照和平面索引要保持一致。

建议增量开发前先确定：输入样本及异常样本、目标数据粒度、重复与覆盖策略、历史兼容、是否保留原文件、输出格式。再修改当前生效调用链，并在变更后同步本文。

## 12. 本地运行和验证

```bash
npm ci
npm run dev
npm run lint
npm run build
npm run preview
```

在项目根目录自行创建 `.env`（不要写入真实密钥到文档）：

```dotenv
VITE_SUPABASE_URL=<项目地址>
VITE_SUPABASE_ANON_KEY=<公开 anon key>
# 可选，不含 @，默认 qq.com
VITE_AUTH_EMAIL_SUFFIX=qq.com
```

App 中提示参考 `.env.example`，但当前仓库没有该文件。`supabase.ts` 在模块初始化时就创建 client，因此不能保证缺失环境变量时一定能正常显示友好提示，需要实际运行验证。

CI `.github/workflows/deploy-pages.yml` 在 main push 或手动触发后执行 `npm ci`、`npm run build` 并发布 GitHub Pages。Node 配为 20，构建通过 `VITE_BASE=/<仓库名>/` 适配子路径；BrowserRouter、静态资源和 404 页面需共同检查。

当前没有 `npm test`；`scripts/` 下为辅助脚本，部分写了开发者本机 `/Users/mac/Downloads/...` 默认样本路径，有些复制了解析逻辑，不能直接等同于对生产 TS 函数的自动化测试。改解析器时应使用真实对应样本验证当前导出函数，并检查脚本是否需要同步。

推荐按变更范围验证：

1. 解析：两种申报 Excel 版式、不同发票 PDF 排版、文本缺失、长税号/票号、红字/免税、多明细。
2. 上传：首次/重复、覆盖失败、部分批量失败、两个用户隔离。
3. 发票 Excel：勾选、无条件全部、仅日期、复杂条件四条分支；同时验证数据库与基准不一致的情况。
4. 预览/PDF：网格列宽、合并、长表缩放、原件下载、完税证明日期处理和失败回退。
5. 查询返回：预览/导出返回后筛选条件与页码恢复；数据量超过 1000 条时的行为。

## 13. 后续 Agent 的最短阅读顺序

1. 本文 → `package.json` → `src/App.tsx` → `src/types/database.ts`。
2. 上传需求读 `UserImportMenuItem.tsx`，再沿对应解析/入库函数追踪。
3. 查询/导出需求直接读目标 page 引用的库，避免修改未接入的旧导出实现。
4. 数据变更读相关 migrations，核对真实 Supabase schema/RLS 后再设计迁移。
5. 旧 `README.md`、`docs/PROJECT_PROMPT.md`、交付说明用于历史背景；若与当前源码冲突，以核实后的代码和最新用户需求为准，不自动沿用旧需求约束。

维护本文时请同时更新分析日期/代码基线，并区分“已实现”“已知局限”“新增计划”，避免把计划写成现有能力。
