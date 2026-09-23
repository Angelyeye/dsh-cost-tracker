# 更新记录

本文件用中文记录 dsh-cost-tracker 的版本变更。

## v1.9.3(2026-09-24)

**适配 DSH 0.1.7-alpha.2：配置入口内迁到「花费统计」页头齿轮（带返回键），旧插件配置卡片入口保留兼容**

### 一、背景：新宿主上原配置入口已经消失

- DSH `0.1.7-alpha.2` **删除了 `settings.plugin.item` 插槽**（在 0.1.7-alpha.2 全部宿主包的 JS 里该字符串零命中），
  原「设置 → 插件 → 插件配置」页由 `dsh-client-ui-settings-plugins` 承担，现在该分区只托管
  `settings.plugins.tab`，唯一贡献者是**只读清单** `dsh-client-ui-settings-plugin-inventory`
  （只显示完整名称 / 配置状态 / 启用于），**没有任何表单**；
- 同时 `dsh-settings` 的 `installSection` 也已下线（grep 零命中），即 `index.js` 的
  `installSettingsSection()` 现在只会静默返回 false；配置值实际只来自
  `~/.dsh/storages/cost-tracker-config.json` + 插件自己的 `/api/cost-tracker/*` —— 所以修复完全落在客户端；
- 结论：v1.9.2 及更早版本在新宿主上「设置 → 插件 → 插件配置」里**再也看不到本插件的配置卡片**，
  而插件的配置又只在那张卡片里 —— 用户实际上失去了全部设置入口（本次修复的动机）。

### 二、改法：配置 UI 内迁到本插件自己的设置分区

- 新增 `CostSection`（`settings.section` 的渲染函数）：持有 `view`（`dashboard` / `config`）与 `ui` 快照
  （`peak` 轮询 + `UI_EVENT` 监听，从原 `DashGate` 上移，看板与配置页共用同一快照）；
- `Dashboard` 页头 `.cost-h1` 右侧新增**齿轮按钮** `button.cost-gear`（自绘齿轮图标、`aria-label="花费统计设置"`、
  `title` 同文案，不带可见文字）；点击进入配置页；
- 配置页 = `ConfigPanel({ mode: "page" })`：根节点 `div.cost-wrap.cost-cfg-page`，
  页头为 **返回键** `button.cost-back`（‹ 图标 + 「返回」+ `aria-label="返回花费统计看板"`）
  + 标题「花费统计 · 设置」+ 兼容说明；正文**常驻展开**（无外层折叠），
  顶部状态条与七个折叠分组（多机汇总 / 峰谷计价与提示 / 订阅套餐与配额 / 计价与价格目录 /
  历史导入 / 数据与界面 / 安全与凭据）与各分组动作**逐项不变**；
- **为什么是分区内子视图而不是第二个左侧导航项**：宿主设置外壳渲染分区时只传入 `close`
  （`dsh-client-ui-settings-general` 的 `renderSlot('settings.section', { close }, { only: active })`），
  分区没有任何程序化切换导航的能力；`settings.section` 的 label 与 order 也只能在注册时决定；
- **关闭看板不再可能成为死亡入口**：`uiDashboardEnabled=false` 时仍渲染页头 + 齿轮，
  只把统计内容换成「点右上角齿轮 → 数据与界面 → 打开」的指引（原卡片入口在新宿主上已不存在，
  这条护栏是必须的）。

### 三、兼容：`settings.plugin.item` 卡片入口保留

- 注册**原样保留**（`slots.inject(pluginItemKey, ...)` 无条件注入，未声明该插槽时回调不触发 ⇒ 零成本）；
  仍声明它的旧宿主（`dsh < 0.1.7-alpha.2`）照旧显示卡片；
- 两个入口**共用同一个 `ConfigPanel`**（`mode: "card"` 折叠卡片外壳 / `mode: "page"` 配置页外壳），
  正文同一段渲染 ⇒ 字段、字典、校验、写接口不可能漂移；两处的未保存草稿各自独立；
- 卡片外壳（`li.cost-pcard` > `button.cost-pcard-head` > 折叠 body、默认收起、`aria-expanded`）
  与 `.cost-pcard*` 样式**逐字未改**，原有卡片测试原样通过（`client-render` 的 [3] 组断言未动）。

### 四、文案路径统一

- 插件内与 HTTP/Agent 错误里的路径统一为「设置 → 花费统计 → 右上角齿轮 → 分组名」：
  `client.js`（峰谷只读面板、云端同步只读卡、看板关闭提示、云端未配置提示、令牌失效提示）、
  `index.js`（`NOT_CONFIGURED`、共享引导令牌失效）、`sync.js`（`TOKEN_INVALID` message）；
- 注释同步更新（`config.js`、`pricing.js`、`vendor-catalog.js`、`index.js`、`schema.js` 相关段），
  旧宿主兼容路径只在配置页页脚与 README 里说明。

### 五、测试

- `test/client-render.test.js`：新增 **[3b] 齿轮入口**（齿轮存在 / 可访问名 / 图标 / 挂在页头操作位 /
  点击进入配置页 / 页头有返回键 / 七个分组齐 / 两视图互斥 / 点返回回到看板）与
  **[3c] 两入口一致性**（配置页与兼容卡片的分组标题、状态摘要、关键字段集合必须相同）；
  [8] 组新增「关闭态仍渲染齿轮 → 点击进入配置页 → 能重新打开看板」的完整闭环；
  原 [3] 卡片外壳断言保持不变（兼容入口的护栏）；
- `test/ui-display.test.js`：关闭提示断言改为指向齿轮，新增「分区内配置入口不受三个界面开关控制」
  「齿轮挂在页头操作位」两条；[5] 改为断言四个插槽无条件注册（含兼容卡片）；
- `test/client-registration.test.js`：[6] 组扩充为「两种外壳来自同一个 ConfigPanel」
  「齿轮与返回键都在（图标 + 可访问名）」「settings.section 渲染的是 CostSection 而不是直接渲染看板」；
- 全量 18 个测试文件通过。

### 六、行为差异与注意

- **从配置页点「返回」会丢弃未点保存的草稿**（每个分组仍是「改草稿 → 点该组保存」；
  折叠分组之间的切换不丢草稿，与卡片折叠语义一致）；
- 切换左侧设置分区 / 关闭设置面板时组件卸载，下次进入回到看板视图（宿主只挂载当前分区）；
- 本次为**纯客户端 UI 重组**：HTTP 面、配置键、落盘路径、云端契约（`dsh-cost-cloud`）、
  计费/定价/导入/同步逻辑**零改动**，老配置零迁移。

## v1.9.2(2026-09-20)

**定价口径修正：V4-Pro 不再路由到 Flash（官方撤销下线计划）+ 新增「法定节假日全天闲时」**

### 一、修正：`deepseek-v4-pro` 维持自有牌价，取消反向路由

- **现场**：核对官方定价页（2026-09-20 抓取）—— 官方**为 V4-Pro 单列价格**：
  高峰 输入（未命中）9.0 / 输入（命中）0.30 / 输出 27.0，闲时半价，**并发 500**（Flash 为 2500）；
  脚注只把 `deepseek-v4-flash`、`deepseek-v4-flash-vision-exp`、`deepseek-v4.1-flash`
  路由到 `deepseek-flash`，**没有** V4-Pro 的路由条目。
- **为什么之前是反的**：09-10 新闻稿写的是「我们**计划**有序下线 V4 Pro……北京时间
  9 月 14 日 12:00 之后，`deepseek-v4-pro` 的请求将全部路由到 V4.1 Flash，并按 V4.1 Flash
  单价计费」，v1.9.0/1.9.1 据此实现了 `v41pro` 时代；但官方**更新日志**（同一篇的口径其后被改写）
  改为：「为响应广大用户的需求，我们**决定**在 2026 年 9 月 14 日之后**继续提供**
  DeepSeek V4 Pro 的 API 调用服务，**计费方式保持不变**」。以现行价目页 + 更新日志为准。
- **修法**：删除时代 `v41pro` 与导出 `V41_PRO_ROUTE_AT`（`PRICE_ERAS` 回到 2 版：
  `legacy` / `v41`），`v41` 时代保留 V4-Pro 自有牌价且不配任何路由；`cost_prices` 不再输出
  `v41ProRouteAt`，渲染文本改为「deepseek-v4-pro 维持 V4-Pro 自有牌价」。
- **影响**：内置表若继续把 pro 路由到 Flash，会按 Flash 价（输入 2 / 输出 8）计 pro 调用
  （应为 9 / 27），**低估约 3.4～4.5 倍**。本机账本**零影响**：全量回放 4393 次调用，
  `deepseek-v4-pro` **0 次**（默认模型是 `deepseek-flash`）。
- **历史记录的可修复边界**：路由期入库的 pro 记录，模型名已被改写为计费名
  `deepseek-flash`，补账无法反推原始模型；若要订正必须重放会话日志（`import.js` 保留原始名）。

### 二、新增：法定节假日全天计入闲时（官方口径，此前只排除了周末）

- 官方脚注：「北京时间周一至周五（**不含中国法定节假日**）9:00-12:00、14:00-18:00
  为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。」
  旧实现只排除周末 ⇒ 节假日落在工作日时会被按高峰多计 1 倍（下一次是国庆 10-01～10-07）。
- `pricing.js` 新增 `CN_HOLIDAYS`（2026 全年 33 天，来源：国办发明电〔2025〕7 号，
  2025-11-04）与 `setPeakHolidays` / `getPeakHolidays` / `isCnHoliday` / `holidayKeyAt` /
  `normalizeHolidayList`；`isPeak` 与 `peakPhaseAt` 同源判定，节假日全天 `allDayOff`
  （相位另带 `holiday` 标记，真周末仍为 `weekend`）。
- **调休补班的周六/周日不计高峰**：定价规则只看「周一至周五」，调休不改变这一点
  （`2026-05-09`、`2026-10-10` 等补班日仍为闲时）。
- **配置**：新增 `peakHolidays`（配置卡「峰谷计价与提示」分组）—— 空串 = 内置表；
  `none`/`off` = 停用（只按周末判定）；也可写自定义列表（`2027-01-01 2027-02-05`，
  逗号/空白分隔，兼容 `2027/1/1` 写法）。语义防呆：自定义列表**整体替换**内置表而非追加；
  非法条目不被静默吞掉 —— `peak` 快照以 `invalid` 原样报告，配置卡如实回显。
- **文案与相位**：区分「周末全谷」与「节假日全谷」（侧边栏时段条 / 环形表盘 / 档位行），
  同为绿色系；峰谷文案改为「周一至周五 9:00-12:00 · 14:00-18:00（周末与法定节假日全天闲时）」；
  老后端缺 `allDayOff` 字段时回落 `weekend` 判定（向后兼容）。
- **测试**：新增 `test/peak-holidays.test.js`（内置表 / 停用 / 自定义 / 重启持久化 / 工具输出，
  含「配置写入真的改变记账口径」的闭环断言）；`test/pricing.test.js` 新增 [2c]（节假日边界、
  相位、覆盖语义、`holidayKeyAt` 边界）；`test/client-render.test.js` 新增 [10]（节假日/周末/
  老后端三种相位的文案）与配置项渲染断言。

## v1.9.1(2026-09-20)

**修复：云端同步全面失败（405「方法不允许」）+ 明文迁移在凭据服务晚就绪时不再重试**

### 一、修复：safeFetch 丢掉 fetch 原生签名 → POST 退化成 GET（真实故障）

- **现场**：升级到 v1.9.0 后云端同步一直失败，界面显示「最近错误：方法不允许」，
  水位卡在 4013、待上报条数只增不减，`pendingFailures` 持续累加并退避到 5 分钟。
  反代访问日志给出铁证：插件实际发出的是
  `GET /api/v1/ingest/records` → **405**（`{"code":"METHOD_NOT_ALLOWED","error":"方法不允许"}`），
  而同路径的 `POST` 是 200 —— 也就是**请求方法与正文都丢了**。
- **根因**：`index.js` 把 `safeFetch` 当作 `<typeof fetch>` 传给同步引擎 ——
  `fetchFn: (url, init) => safeFetch(url, Object.assign({}, init, { allowHosts }))`，
  而 `safeFetch` 当时**只读 `opts.init`**，于是 `method` / `body` / 部分头全落到 `undefined`：
  fetch 按默认语义发 **GET**、无正文、无 `content-type`，云端按方法不匹配回 405。
- **修复**：`safeFetch` 同时接受两种入参形状 —— 文档形状 `{ init: {...} }` 与
  **fetch 原生签名**（`method`/`body`/`headers`/`signal` 等在顶层），`opts.init` 优先。
  安全策略不因入参形状变化：顶层签名同样强制 `redirect:'manual'`，跨主机重定向照样拒绝。
- **回归护栏（两层，专治「组合起来才错」）**：
  · `test/credstore.test.js` 新增 [4b]：照抄 index.js 的接线方式，断言实际发出的是
    **POST**、正文与 `content-type` 完整、`redirect` 被强制 manual、跨主机仍被拒；
  · `test/sync.test.js` 新增集成用例：用同一接线形态跑完整 `runOnce`，断言首个请求是
    `POST /api/v1/ingest/records` 且正文含 `syncVer`、授权头带令牌。
  只测 `safeFetch` 或只测引擎都拦不住这个缺陷 —— 必须测两者的**组合**。

### 二、修复：凭据服务晚就绪时，明文迁移不再重试

- 现象：升级后 `secretsMigrated` 一直是 `false`，配置里仍留着明文令牌与 SK。
- 原因：迁移只在启动时跑一次；若那一刻 `ctx.get('credentials')` 还拿不到（凭据服务
  晚于本插件注册），按安全边界会**保留明文**并报告「有悬而未决的明文」，但之后**再没重试**。
- 修复：`runSecretMigration()` 返回 `pending`；为真时用 `ctx.inject(['credentials'], …)`
  等凭据服务就绪后**自动再迁一次** —— 既不丢凭据，也不让「配置文件零明文」永远停在未完成。

### 三、安装方式的坑（已写进 README）

- DSH 的 profile 用 pnpm 管理插件（`profiles/web/package.json` 里写着
  `"@angelyeye/dsh-cost-tracker": "^1.8.15"`）。**手动把新版本文件拷进
  `profiles/web/node_modules/…` 会在下次启动时被市场对账重装回旧版**（真实踩坑：
  拷完 v1.9.0、重启后目录又变回 v1.8.15，只有运行中的进程还带着新代码）。
- 开发/自测请用官方 dev 流程（profile 记成 `link:`，重启不丢）：
  `dsh plugin --profile web add link:<仓库路径>`

## v1.9.0(2026-09-27)

**历史导入 + 凭据外带防护 + 官方价格同步 + 多厂商目录 + Plan/按量双轨开关；
全部设置集中进「插件配置 → 花费统计」并重设计该卡片（配套云端 v1.4.0）**

### 一、新增模块（各自带独立测试，纯逻辑、可单独跑）

| 模块 | 职责 |
| --- | --- |
| `import.js` | 回放宿主会话日志（多 zstd frame 逐帧解压 + 逐帧切片，防大日志 OOM），重建逐次调用 |
| `price-sync.js` | 官方定价页解析器（转置价格表：列 = 模型、行 = 指标 × 时段）→ 计费时代 |
| `vendor-catalog.js` + `docs/provider-pricing.json` | 多厂商价格目录（14 家厂商 / 90 个条目，USD/1M tokens） |
| `credstore.js` | 凭据库封套（`ctx.credentials`）+ 旧明文迁移 + 出站白名单与 `safeFetch` |

### 二、历史导入（`import.js` + 宿主接线）

- **只补「插件不可能记到」的调用**：早于本机最早一条**实时**记录（`source!=='import'`），
  或所在日完全没有实时覆盖（明细 + 日汇总都没有 → 停机缺口）；
- **跨安装点会话按切割线截断**：`min(该会话首条实时记录时刻)` 之后一律不导入，
  与全局安装点取「更早者」，从而既补全安装前那段、又不与实时记录重复；
- **幂等三保险**：① 清单（`cost-tracker-import.json`）按 mtime+size 快跳未变化日志；
  ② 逐调用键 `(sessionId, 事件时刻, 五桶 tokens)` 与已导入明细比对
  ——**刻意不含模型名**，因为入账时模型会被路由改写（`deepseek-v4-pro → deepseek-flash`），
  含模型名会导致重跑重复导入；③ 已被实时覆盖的日子宁可不导入也不重复计数；
- **解析对齐宿主真实格式**：`usage` 取 `assistant/message.data.usage`（按 `(turn, step)`
  去重、最终 message 覆盖流式样本、全零用量即失败尝试不产出）；provider/model 取
  `data.message.source`，回落 `request/header.data.header.config`（实测的嵌套形状）
  与 `request/context`；fork 种子段（`time < createdAt`）跳过；标题生成等辅路请求不计；
- 导入记录标记 `source:'import'`（实时记录 `source:'live'`），覆盖判定只看 live；
- 默认**开机自动导入**（延迟 8s，`ctx.timer` 缺失时用 unref 的原生定时器，不阻塞退出），
  配置卡可关；新增 Agent 工具 `cost_import`（`run: true` 执行一轮）。

### 三、凭据外带防护（`credstore.js` + 全链路接线）

- **密钥零落盘**：新增 `CRED_REFS`（`COST_TRACKER_CLOUD_TOKEN` / `COST_TRACKER_VOLCENGINE_SK`），
  云端令牌与火山 SK 只写 DSH 凭据库；`createCredSeam` 在凭据服务缺席时退化为**内存态**
  并如实标注（UI 显示「仅进程内暂存」），绝不为兼容把明文写回配置文件；
- **启动迁移**：`migrateLegacySecrets()` 把 v1.8.x 明文（含 base64 混淆的 SK）搬进凭据库、
  从配置对象清除并回写净化配置；幂等，凭据库已有值时不覆盖（只提示）；
- **迁移的安全边界**：`save()` 的返回值区分「已持久化」与「只写进了内存」——
  只有凭据库确实可写时才清除配置里的明文；宿主没有凭据服务或凭据只读时，
  明文**原样保留**并在启动日志里说明原因（密钥若只留在内存里，重启后就永久丢了，
  「配置文件零明文」不能以丢凭据为代价），`secretsMigrated` 也只在没有悬而未决的明文时才置位；
- **状态只给布尔**：`sync` / `volcengine-config` 响应只含 `cloudTokenConfigured` /
  `volcengineHasSecret` / `*Backend` / `secretsMigrated`，**永不回显密钥**；
- **出站防护**：`safeFetch` 强制 `redirect:'manual'`（3xx 一律失败并点名去向主机，
  防重定向把 `Authorization` 带去别处）、非 loopback 强制 https、携带凭据的请求必须命中
  主机白名单（DeepSeek / Kimi / 火山管控面 / 配置的云端地址 / 定价页主机），
  且白名单校验在**发请求之前**完成；`httpJson`、云端只读聚合、`sync.js`、火山签名请求
  全部改走它（`sync.js` 顺带支持异步 `getToken` 依赖）。

### 四、官方价格同步（`price-sync.js` + `pricing.js` 时代注入）

- `parsePricingPage`：模型列（`模型` 与 `BASE URL` 之间）× {缓存命中 / 缓存未命中 / 输出}
  × {空闲 / 高峰} 状态机；**校验六组取齐、个数等于模型列数、数值合理、空闲价 ≈ 高峰一半**，
  任一不满足即抛错 —— 页面改版时宁可不同步，也绝不把错价写进账本；
- 脚注解析「旧模型名 … 仍可调用」得到**路由**（旧名 → 现役名），同时支持脚注分行与整行两种排版；
- `buildSyncedEra` → `pricing.setSyncedEras()`：同步时代与内置时代按 `since` 取最近生效者
  （同时刻同步时代优先）；应用时刻 = 生效时刻，**历史记录按自身时间戳选版，口径不回改**；
- 产物存 `storages/cost-tracker-prices.json`；每日自动核对（`priceSyncAutoCheck`，默认开）
  只记录差异，应用始终需手动确认（`prices-sync` 传 `apply:true`）；
- 实测价值：内置 `v41pro` 时代把 `deepseek-v4-pro` 路由到 Flash，而官方页已恢复 V4-Pro
  独立牌价（9.0/27.0/0.30 高峰）—— 同步一次即可修正，且不影响历史记录。

### 五、多厂商目录与手动覆盖价（`vendor-catalog.js` + `pricing.priceFor` 扩展）

- 目录数据改编自 `dsh-cost-meter`（MIT）的已核对官方目录，保留 `sourceUrl` / `checkedAt` 溯源；
  provider 别名归一（`gpt→openai`、`claude→anthropic`、`gemini→google`、`kimi→moonshot`、
  `zhipu/glm/bigmodel→z-ai`、`qwen/dashscope→alibaba` …）；
- 匹配模式 `fuzzy`（默认，归一化包含匹配，长度 ≥4 才参与）| `exact`；跨厂商同名仅在**唯一**时命中；
- USD→CNY 按 `catalogFxRate`（默认 7.2）折算；缓存写入价 = 缓存命中价（官方口径）；
- `priceFor(np, model, ts, opts)` 新增可选第 4 参（保持 3 参兼容）：
  **覆盖价 > 订阅归类 > 内置/同步时代精确价 > 目录 > provider 兜底 > 通用兜底**，
  返回值新增 `source` 字段（`override|plan|synced|exact|catalog|provider|generic`）；
- 订阅归类覆盖（`planOverrides`：`provider/*` 或 `provider/model` → `plan|api`）解决
  「模型 id 带日期后缀、套餐白名单永远追不上」的误标问题。

### 六、Plan 与按量双轨 + 「含 Plan 总额」开关（前后端）

- 服务端 `buildDashboard` 的 `byDay` 新增每天 `sub`（订阅等值）金额，且**不再跳过订阅记录**；
- 客户端工具栏新增「含 Plan 总额」开关：关闭（默认）金额卡只显示按量、订阅以附注展示；
  打开则金额 = 按量 + 订阅等值，图表按天并入「订阅等值」段（峰谷图第 4 段、模型图带「（订阅）」后缀）；
- 取值优先级：本机 `localStorage` → 服务端配置；改一次同时写两处（跨设备一致）；
  **修掉一个真实缺陷**：原先每次 `sync` 轮询都会用服务端值覆盖用户刚切的口径
  （`localStorage` 被禁用时尤其明显），现在用 state 记录「用户已手动改过」后不再覆盖。

### 七、设置集中 + 配置卡片重设计（`client.js`）

- `设置 → 插件 → 插件配置 → 花费统计` 成为**唯一**设置入口，七个折叠分组
  （多机汇总 / 峰谷计价与提示 / 订阅套餐与配额 / 计价与价格目录 / 历史导入 / 数据与界面 / 安全与凭据）
  + 顶部状态摘要条（云端同步 / 已记账 / 待上报 / 上次同步 / 计价时代 / 历史导入 / 金额口径）；
- 约定：**只有「界面显示」三开关勾选即刻生效**，其余分组「改草稿 → 点该组保存」，
  避免误触即写盘；分组折叠只切 CSS 显隐、不卸载内容（展开不重新取数、不丢草稿），
  且不依赖 React 的 `props.children` 注入（配置卡是自绘的，普通函数 + 显式参数更稳）；
- 看板上的「峰谷计价与提示」面板改为**只读**（回显档位与生效配置，保留弹窗预览），
  避免两处都能改造成口径不一致；
- 新增路由：`billing-config`、`import-config`、`import-status`、`import-run`、
  `prices-config`、`prices-sync`、`reset`；`prices` 回显目录、同步状态与覆盖价；
  `sync` 回显计费/导入/同步配置与凭据布尔。

### 八、测试与文档

- 新增 4 个测试文件：
  - `test/import.test.js`：用 `zstdCompressSync` 合成**多帧**会话日志，覆盖帧边界扫描、
    截断尾帧、跨帧残行拼接、`(turn,step)` 去重、全零用量丢弃、fork 种子段跳过、
    覆盖判定（安装前 / 跨安装点 / 缺口日 / 已覆盖日）、幂等重跑、日志追加后只补新增，
    以及宿主面 `import-run` / `import-status` 端到端（落库标记、seq、看板读数）；
  - `test/price-sync.test.js`：解析正确性（含同行标签、脚注分行、三列对齐）、
    六类脏数据必须抛错、时代生效与历史隔离、差异比对、抓取入口，
    并在本机留存真实抓取页时额外跑一遍真实数据；
  - `test/vendor-catalog.test.js`：目录数据、别名归一、匹配模式、汇率、跨厂商唯一命中、
    以及目录接入 `priceFor` 的优先级与异常回退；
  - `test/credstore.test.js`：封套后端选择、旧明文迁移（含幂等与不覆盖）、
    出站白名单、`safeFetch` 的 3xx 拒绝与头合并；
- `test/client-render.test.js` 新增「金额口径开关」一节（默认仅按量 → 打开含 Plan → 关回），
  并继续守住「只有 3 个即时提交 checkbox」与卡片分组文案；
- `test/volcengine-host.test.js` 两处断言按新语义更新：SK 不再落配置文件（改落凭据库）、
  来源标记为 `credentials`；
- README（中/英）与 CHANGELOG 增补上述能力；`package.json` 登记 4 个新模块与
  `docs/provider-pricing.json`、版本升到 1.9.0。

## v1.8.15(2026-09-26)

**修复：火山方舟配额面板「没有配置入口」+「拿推理 Key 当 AK」+ 两个失败路径缺陷**

真机现场：用户装了 v1.8.14 后，设置页出现「订阅套餐用量 · 火山方舟 Coding Plan」面板，
但显示 `配额查询不可用：火山方舟凭据无效或无权限访问 GetPersonalPlan（HTTP 401）`，
且面板上**没有任何可填写凭据的地方** —— 只有一句「需要 AK/SK」，无从下手。

### 一、面板自带凭据输入框（用户直接提出的问题）

- 面板内新增一行输入：`AccessKeyID`（明文回显，控制台里本就可见）+ `SecretAccessKey`
  （`type=password`，**从不回显**；已保存过时 placeholder 变为「已保存，留空则不改」）。
- 三个动作：
  - **查询** —— 用输入框里的值直接查一次，**不落盘**，便于先验证凭据对不对；
  - **保存** —— 写入 `~/.dsh/storages/cost-tracker-config.json`，重启不丢；
  - **清除凭据** —— 显式清空（仅在有凭据时出现）。
- 工具栏新增**「火山方舟配额」按钮**作为入口。此前面板只在「存在火山订阅调用」时渲染，
  新用户既看不到面板、也没有入口 —— 等于功能不存在。
- 面板标题旁新增来源徽标：`已保存凭据` / `临时凭据` / `环境变量`，一眼看出当前用的是哪套。

### 二、修复：推理 API Key 被当成 AccessKeyID（401 的真正根因）

配了 baseURL 指向 `ark.cn-beijing.volces.com/api/coding/v3` 的 provider 时，其 `apiKeyEnv`
（如 `BYTEBLUS_CODING_PLAN_CN_API_KEY`）是**推理用的 API Key**，而配额查询要的是 IAM 的
`AccessKeyID + SecretAccessKey` —— 两套完全不同的凭据。

早先 `volcengineEnvCandidates()` 把这个 apiKeyEnv 也塞进 AK 候选，于是出现跨来源拼凑：

```
AK = BYTEBLUS_CODING_PLAN_CN_API_KEY（推理 Key，UUID 形态）
SK = VOLC_SECRETKEY（凭据库里的真 SK）
```

用这对假凭据去签名，服务端必然 401；而 401 在本插件里是「软失败」，只报「凭据无效或
无权限」，**根因完全查不出来**（真机上就表现为那一行误导性报错）。

现在：
- AK 与 SK 必须**同源配对** —— 先按候选名取到 AK，再用**同名推导出的** SECRET 变体取 SK，
  绝不跨来源拼接；
- 用命名识别推理 Key（含 `API_KEY`/`APIKEY`/`TOKEN` 且不含 `ACCESSKEY`/`SECRETKEY`/
  `SECRET`），把这类候选**排除**在 AK 之外，并在提示里点名：
  「你配置的 X 是推理用的 ARK API Key，不是配额凭据，插件不会拿它去签名」；
- 缺凭据时明确区分「都缺 / 缺 AK / 缺 SK」。

### 三、修复：两个失败路径缺陷

- **`ReferenceError`（TDZ）把软失败变成 500**：`keyEnv` 原先声明在 `try` 内却在 `catch`
  里引用。任何一次查询失败（401 / 网络异常 / 结构变化）都会在错误处理里再抛一次
  `keyEnv is not defined`，被路由层兜成 **HTTP 500** —— 恰好把所有失败路径都打穿了。
  现声明在 `try` 之外。（由新增的失败路径断言抓到。）
- **`keyEnv` 永远显示「未知」**：`resolveApiKey()` 只返回 `{ value, source }`，`env` 是
  `resolveAnyEnv()` 才加的字段；误取 `rid.env` 得到 `undefined`，于是面板从不显示
  「该去改哪个环境变量」。现直接用循环变量名。

### 四、防呆：空串不等于清空

因为 SK 从不回显，跨浏览器 / 重开面板时 SK 输入框**必然是空的**。若把空串当作「清空」，
用户只改一下 AK 就会把已存好的 SK 一起写空 —— 静默丢凭据。现在：

| 请求 | 行为 |
| --- | --- |
| `{volcengineAccessKeyId:'新AK'}` | 只改 AK，**SK 原样保留** |
| `{volcengineSecretAccessKey:'新SK'}` | 只改 SK |
| `{volcengineAccessKeyId:'', volcengineSecretAccessKey:''}` | **不动**（空串不是指令） |
| `{clear:true}` | 显式清空两者 |

响应回显 `volcengineAccessKeyId`（非敏感）与 `volcengineHasKeys`，**永不回显 SK**。

### 五、测试

`test/volcengine-host.test.js` 从 36 条扩到 **48 条**，新增四组：
推理 Key 不得被当作 AK（真实故障回归，复刻用户的 provider 配置）/ 空串不覆盖已存 SK /
只改 AK 后仍可用 / `clear` 才清空。全量测试通过。

## v1.8.14(2026-09-26)

**新增：火山方舟 Coding Plan 订阅支持（配额监控 + 等效费用）；并修掉两个此前静默存在的缺陷**

### 一、新增：火山方舟 Coding Plan 配额面板

- **设置页新增「订阅套餐用量 · 火山方舟 Coding Plan」面板**，与既有 Kimi 面板并列，显示 **5 小时 / 周 / 月** 三档窗口的已用百分比、绝对量与重置倒计时，附「刷新配额」按钮。
- **查询走方舟管控面 OpenAPI**，不是推理端点：
  - 端点固定 `https://open.volcengineapi.com/`，`Service=ark`、`Region=cn-beijing`、`Version=2024-01-01`；
  - 认证是 **HMAC-SHA256 签名**（`Credential=AK/日期/区域/服务/request`、`SignedHeaders=host;x-content-sha256;x-date`），**不是 Bearer** —— 这是与 Kimi 那条路径最大的差别；
  - Action 按 `GetCodingPlanUsage → GetAFPUsage → GetUsageDetails → GetPersonalPlan` 顺序兜底。`GetCodingPlanUsage` 是官方 CodingPlan 用量接口，**无参即可返回三档窗口**；`GetAFPUsage` 实为 AgentPlan 接口，账号是 Agent Plan 时自动从它取数；
  - 单个 Action 的 401/403 只表示「该 Action 不可用」（多 Action 变体权限语义不同），继续尝试下一个；200 但解析失败时**优先透出服务端业务信封**（`ResponseMetadata.Error.Code/Message`），因为它比末尾变体的 404 更有诊断价值。
- **凭据发现链**：插件配置卡片（`volcengineAccessKeyId` / `volcengineSecretAccessKey`）→ DSH 凭据库 → `.credentials.yaml` → 环境变量（`VOLC_ACCESSKEY` / `VOLC_SECRETKEY`，兼容 `VOLCENGINE_ACCESS_KEY_ID`、`ARK_ACCESS_KEY_ID` 等变体；也会从指向方舟 coding 端点的 provider 的 `apiKeyEnv` 反查）。
  - 需要 IAM 子用户具备 **`ArkReadOnlyAccess` + `BillingCenterReadOnlyAccess`**。这与推理用的 **ARK API Key（UUID）是两套凭据**，混填只会得到 401/403。
  - **密钥零外泄**：`volcengine-usage` / `volcengine-config` / `sync` 的响应里**永远不含 AK/SK**，只回 `keySource`（`config` / `credentials:…` / `file`）与候选变量名；卡片里的 Secret 字段标了 `role('secret')`。
- **失败一律软降级为中性提示**：无凭据、无订阅、权限不足、接口结构变化、网络异常都只回 `{ok:false, error:'中文原因'}`，HTTP 层仍是 200，**不抛异常、不影响其它路由**。
- **按需出现**：面板只在「存在火山订阅调用（宿主在 `summary` 里回传 `volcengineActive`）或已有窗口数据」时渲染。只跑 DeepSeek / Kimi 的用户界面**完全不变**。
- **百分比精度**：实测 `Percent` 是 0-100 的百分数但数值极小（`0.3938…` / `0.0997…` / `0.0498…`，即 0.39% / 0.1% / 0.05%），故保留**两位小数** —— 只留一位会把月度 0.05% 显示成「0%」，看上去像没统计到。同时**不套用「≤1 视为小数」的规则**（那会把 0.5% 放大成 50%）。`Cap`（实测恒为 100）用于折算绝对量。

### 二、修掉订阅门卫缺陷：按量调用曾被错记成订阅（重要）

- **缺陷**：`priceFor()` 原先只按 **provider 名**判定订阅，对该 provider 的**所有模型**一律套订阅价。
- **为什么此前没暴露**：Kimi 的 provider 下每个模型都走订阅，所以「只看 provider」恰好成立。
- **为什么火山会踩**：同一个 provider 下**套餐内与套餐外的模型混在一起** —— 订阅调用被错记为 `subscription: true` 后，金额会从「真实花费」里消失（计入订阅等效而不是按量），且原始记录已被打标，**无法自动回滚**。这是典型的「静默少算」。
- **现在**：`subscriptionPlanFor(np, model)` 改为「provider 命中 + 模型白名单」双重限定，并区分两类 provider：
  | provider | 判定 |
  | --- | --- |
  | baseURL 指向 `ark.cn-beijing.volces.com/api/coding/v3` 的专属订阅入口（`byteblus-coding-plan-cn`、`byteplus-coding-plan-cn`、`volcengine-coding` 等） | **整档计订阅**，不必追模型日期后缀 |
  | 泛 `volcengine` | **仅白名单内模型计订阅**（豆包系 / GLM 系 / Kimi 系 / DeepSeek / MiniMax，以及 `ark-code-*` 前缀整族）；**接入点 id（`ep-2026xxxx`）一律按量** |
  | `kimi` / `kimi-coding` | `SUBSCRIPTION_MODELS` 登记为 `null` = 整档订阅，**行为逐字节不变** |
- **前缀刻意收窄**：只放行 `ark-code-*`（方舟自动调度名会滚动升级）。按 `deepseek` / `glm` 这类宽前缀整族放行会把套餐外的按量模型一并算成订阅 —— 那正是本门卫要防的方向；宁可漏配（可显式补清单）也不能错配。
- **等效单价口径**：套餐内各模型牌价差异很大，而套餐只有一个固定月费、官方并未给出「套餐内某次调用的等效单价」。故取**单一代表价**（3.0 / 12.0 / 缓存 0.6），与既有 Kimi 订阅（同样一个价位代表整档）口径一致，**仅用于横向比较订阅是否划算，不是真实扣费**；可核实到的第三方报价多为聚合站美元估价，与官方人民币牌价不可直接对照，按本仓库「不编造价格」的约定不收录。

### 三、修掉凭据文件读取缺陷：`.credentials.yaml` 兜底一直静默失效（重要）

- **缺陷**：`readCredFile()` 的正则只匹配**行首无缩进**的键，而真实文件是把键**缩进**存放在 `refs:` 段下的：
  ```yaml
  version: 1
  refs:
    VOLC_ACCESSKEY: AKxxxx        # ← 缩进两格，旧正则匹配不到
    VOLC_SECRETKEY: xxxx
  records:
    ...
  ```
  于是所有键都读不出来，这一路兜底**一直静默失效**（装了宿主凭据服务时被掩盖，没有时就直接报「未找到 Key」）。该缺陷同时影响原本的 Kimi / DeepSeek Key 兜底路径。
- **现在**：识别缩进、定位 `refs:` 段（避免误读 `records:` 段里的同名键），并保留对「无缩进的旧版平铺文件」的兼容（段内未命中时回落到段外同名键）。
- **顺带修掉路径硬编码**：原路径写死 `~/.dsh/.credentials.yaml`，`DSH_HOME` 被重定向的部署（含本仓库的沙箱测试）永远读不到；现改为跟随 `DSH_HOME`。

### 四、测试

- 新增 `test/volcengine-plan.test.js`（113 条）：**与火山官方 demo（`volc-openapi-demos/signature/nodejs/sign.js`）逐字节一致的固定签名向量**、查询串排序与严格 RFC3986 转义、四种响应形态（官方 `QuotaUsage[Level/Percent]`、`UsageDetails`、arkcli `items→periods`、AFP 扁平窗口）、**0.5% 不被放大成 50%**、负数百分比判非法而非钳成 0、`ResetTime=-1` 归一为「无重置」、凭据残缺判 null 且不发请求、403 换 Action、业务信封优先于末尾 404。
- 新增 `test/volcengine-host.test.js`（36 条）：宿主面端到端（老配置 + 凭据文件 → 已签名请求 → 可渲染窗口）、**密钥零外泄**（响应 / sync / 卡片写入三处）、配置卡片凭据优先、真机响应形状（0.05% 不被抹成 0%）、五类失败路径软降级、120s 缓存 TTL 与 `force` 绕过。
- `test/pricing.test.js` 新增「订阅门卫 + 火山 Coding Plan」一节（覆盖两个方向：订阅**必须**识别、同 provider 的按量调用**必须不**识别），并钉住 Kimi 既有行为不变。
- `scripts/verify-volcengine-live.mjs`：一次性真机核验脚本（只读接口、不打印密钥）。**已实测通过**：`GetCodingPlanUsage` 返回 `Status: "Running"` 与 session / weekly / monthly 三档真实窗口。

## v1.8.13(2026-09-25)

**新增：可以关掉插件在前端的显示（三个落点各自独立）**

- **背景**：插件的几个前端落点此前都是常驻的、没有开关 —— 输入框上方的「本会话花费」胶囊、侧边栏底部的峰谷时段条、设置页的「花费统计」看板。不想看的人只能忍，或者干脆卸载插件（连带失去记账与云端同步）。
- **现在**：设置 → 插件 → 插件配置 → 花费统计 → **界面显示**，三个开关**各自独立**、**勾选即刻生效**（不需要点上面的「保存」，也不需要重启 dsh）：
  | 开关 | 配置键 | 落点 |
  | --- | --- | --- |
  | 输入框上方的花费胶囊 | `uiDockEnabled` | `conversation.composer.dock` |
  | 侧边栏峰谷时段条 | `uiPeakEnabled` | `sidebar.footer.action` |
  | 设置页「花费统计」看板 | `uiDashboardEnabled` | `settings.section` |
  另有一键「全部显示」恢复默认。
- **只影响渲染**：关掉之后记账、落盘、云端同步与 Agent 工具（`cost_stats` 等）全部照常工作；关掉看板时，设置项仍在，页面里给出一句「如何重新打开」的提示，而不是留一个点不开的空白导航项。
- **插件配置卡片本身不受这三个开关控制** —— 否则关掉看板之后就再没有入口能打开了。
- **安全默认**：显隐的真值与 `peakEnabled` 相反，**只有显式 `false` 才隐藏**，缺省/非布尔一律按「可见」处理。老配置文件里没有这几个键，升级后界面与升级前逐像素一致。
- **实现要点**：
  - 显隐在**渲染期**判定（`uiOn(ui, key)` = `ui[key] !== false`），不是注册期 —— 宿主不会重启插件、插槽注册也无法撤销，只有在渲染期判定才能做到「改完立刻生效」。
  - 配置卡片保存后广播 `dsh-cost-tracker-ui` 事件，已挂载的胶囊 / 时段条 / 看板立刻跟手；另有 30 秒轮询兜底。
  - 新增宿主路由 `ui-config`（写）与 `peak`/`sync` 快照里的 `ui` 字段（读），三个开关与峰谷、云端字段**同存一份配置文件**（`~/.dsh/storages/cost-tracker-config.json`），互不覆盖。
  - 侧边栏时段条关闭时，峰谷切换弹窗与系统通知一并停用（同属一个落点）；只想留提醒不要时段条，用「峰谷计价与提示 → 峰时高价时段显著提示」。
- **测试**：新增 `test/ui-display.test.js`（23 条断言，四层：宿主 HTTP 面读写、落盘不覆盖其它字段、重启后读回、客户端三处判定）；`test/client-render.test.js` 新增 [8][9] 两节（关掉即渲染为空、重新打开即恢复、卡片三个开关各自提交自己的键、client.js 与 config.js 的开关清单逐项对齐）；`test/config.test.js` 新增界面开关一节（默认可见 / 老配置可见 / 非布尔回退）。全量测试通过。
- **顺带修掉一处假红**：`cloud-view-e2e.test.js` 的「热力图不重不漏」用例在**本地兄弟目录 dsh-cost-cloud 还是旧版**（< v1.3.2，`byDay` 无 token 类型拆分）时会硬失败 —— 那与「跨仓库依赖检测不到就跳过」的既定原则不一致。现改为探测到旧云端就明确 skip 并提示升级兄弟目录，不再把一个环境问题伪装成发布闸门红灯（线上真连旧云端时热力图本就会退回本机并在卡片标注口径，属已声明的降级）。

## v1.8.12(2026-09-19)

**修复：①「Token 用量统计」热力图不跟随三态视图（本机+云端下屏内自相矛盾）② `cost_stats scope=cloud|both` 崩溃**

- **① 热力图此前恒为本机**：它的数据源是宿主的 `usage` 路由 → `buildUsageHeat()`，只遍历本地
  store 的 records/rollups，**没有任何云端输入**；而同一屏的卡片走 `viewDash`（本机+云端合并）。
  于是切到「本机+云端」时，热力图说「累计 98.4M · 536 次调用」（纯本机），上方卡片说 955M ——
  同一屏两套口径，用户第一反应就是"统计显示有问题"。
  - 宿主新增 `route=usage` 取数：走云端 `/api/v1/plugin-view`（**只有它的 byDay 带 token 类型
    拆分**）、固定 `range=all`（热力图是全时段累计口径，与页面区间选择无关）、
    「本机+云端」沿用与卡片相同的 `union` 并集（其他整机 ∪ 本机其它 agent），
    并归一成与本地 `buildUsageHeat` 同形的 `{days:[{date,input,output,cacheRead,cacheWrite,...}], total}`。
  - 归一化时两处口径对齐：**tokens 一律按 `input+output+cacheRead+cacheWrite` 重算**（云端
    byDay 的 tokens 含 `reasoning`，直接相加会比两侧之和大一截）；**丢掉云端连续日期轴里的
    补零日**（本地只返回有数据的日期，热力图自己会按 26 周补格）。
  - 客户端新增 `mergeUsageHeat`（`view.js` 与 bundle 内联实现各一份，与 `mergeDash` 同款约定），
    热力图改为消费 `viewUsage`：本机 / 本机+云端 / 仅云端；云端明细取不到时退回本机，
    并在卡片标题右侧标注口径（「本机 + 云端（不重复计数）」/「仅云端」），避免再出现无标注的纯本机数字。
  - **云端前置依赖**：`dsh-cost-cloud ≥ v1.3.2`（`plugin-view` 的 `byDay` 才带
    input/output/cacheRead/cacheWrite）。旧云端下热力图自动退回本机，卡片与其它面板不受影响。
- **② `cost_stats scope=cloud|both` 必崩**：`Cannot read properties of undefined (reading 'realCost')`。
  根因是云端响应形状漂移 —— `/api/v1/overview` 的金额摊在 `summary.{realCost,subEquivalent,…}`，
  而宿主在云端支持 `devicePluginView` 时会**优先用 `/api/v1/plugin-view`**，后者**没有 `summary`**
  （字段直接摊在顶层）。工具只读了 `c.summary`，于是 README 明确文档化的 `scope=both` 一直不可用。
  现两种形状都兼容。
- **测试**：`view.test.js` 新增第 11 节（合并的相加不变量、tokens 重算、容错分支）；
  `cloud-read.test.js` 新增 4 条路径契约（usage 走 plugin-view、固定 range=all、
  union 对 overview/usage 同时生效、cost_stats 兼容两种形状）；`client-render.test.js`
  新增第 7 节（三态下热力图的累计与按天数字，含"云端独有日期必须进入热力图"）；
  `cloud-view-e2e.test.js` 新增真实云端 payload → `cloudUsageHeat` → `mergeUsageHeat` 的端到端不重不漏断言。

## v1.8.11(2026-09-17)

**新增：启动时检测「另一个 dsh 实例正在用同一份记录文件」并直接点名**

- **背景**：v1.8.10 的 EPERM 现场根因就是**上一个 dsh 实例还在跑，用户又起了一个** —— 两个实例写同一份 `cost-tracker-records.json`，互相覆盖，并在 Windows 上撞上 rename 的 EPERM（旧的临时文件名还是固定的 `<file>.tmp`，两实例必然互抢）。此前用户只能对着堆栈猜。
- **现在**：启动时在记录文件旁登记一把**仅用于提示**的实例锁（`cost-tracker-records.json.lock`，内含 pid / 版本 / 时间）。若锁的持有者**仍然存活**（`process.kill(pid, 0)`，Windows 上 EPERM 也算存活），立即打印占用者信息与处理办法：
  ```
  cost tracker: 检测到另一个 dsh 实例（PID 15784 · v1.8.10）正在使用同一份记录文件：
    ~/.dsh/storages/cost-tracker-records.json
    两个实例会互相覆盖对方的记录，并可能在 Windows 上触发 rename EPERM（需要目标文件的删除权限）。
    请只保留一个 dsh 实例：先 Ctrl+C 停掉旧的，再启动新的。
  ```
- **绝不阻断启动**：锁文件不存在 / 损坏 / 持有者已退出（陈旧锁）都静默跳过；退出时只删自己的锁，不碰别人的。
- **实测**（两个真实进程）：holder 登记锁并保持存活 → 第二个实例输出 `{"lockHeldBy":15784,"warned":true}` 且 stderr 打印上面那段；holder 退出后残留的陈旧锁不影响后续启动。
- **测试**：`test/storage.test.js` 第 14 节新增 14 条断言（无锁 / 自己的锁 / 存活占用者 / 陈旧锁 / 不存在的 pid / 只删自己的锁 / 锁文件损坏不炸）。

**文档：两份 README 补齐长期漂移（无功能变更）**

- 英文 README 更新记录补齐 v1.8.7–v1.8.10（此前停在 v1.8.6）并补上缺失的 v1.3.0；「本机+云端」口径由过时的「服务端排除本机，因此不重复计数」更正为**并集**（其他整机 ∪ 本机上的非 dsh 来源）；补「多机汇总(云端同步)」功能行与 `sync.js` / `view.js` / `schema.js`。
- 中文 README 设置页说明补「六组概览卡」「峰谷计价与提示」两条（此前只有英文版有）；FAQ「重启会丢数据吗」补落盘遇瞬时占用的处理；同样补「多机汇总」功能行与三个源文件。
- 两份 README 的版本徽标改为 **npm 动态徽标**（不再是硬编码的 v1.6.0），以后发版自动跟随；更新记录标题下注明「只列重要版本，完整逐版记录见 `CHANGELOG.md`」。

## v1.8.10(2026-09-17)

**修复：Windows 上落盘偶发 `EPERM`（rename 被瞬时占用），启动日志甩出吓人的堆栈**

- **现场**（v1.8.9 重启时）：
  ```
  cost tracker persist failed Error: EPERM: operation not permitted,
    rename '...cost-tracker-records.json.tmp' -> '...cost-tracker-records.json'
      at renameSync (node:fs:1012:11)
      at Object.persist (.../store.js:307:7)
  ```
- **根因**：`persist()` 是「写临时文件 → rename 覆盖」，但**只尝试一次**。Windows 上 rename 需要**目标文件的删除权限**，以下都会瞬时失败：杀毒 / 搜索索引器刚扫过刚写完的临时文件；资源管理器预览、备份/同步工具正在读它；**上一个 dsh 实例还没退干净**（或同时跑了两个实例）。失败后数据仍在内存、下次写入会重试（本次实测 2 分钟后自动写成功、未丢数据），但用户看到的是完整堆栈，且这段时间磁盘上是旧数据。
- **修法**：
  1. 临时文件名带 **pid**（`<file>.<pid>.tmp`）——旧实现固定用 `<file>.tmp`，两个实例必然抢同一个临时文件；
  2. `renameSync` 遇 `EPERM/EACCES/EBUSY` **退避重试**（20/40/80/160ms，共 5 次 ≈ 0.35s）；`ENOENT` 等代码类错误不重试；
  3. 仍失败**不做**「直接覆盖写」——那会让并发读方看到半个 JSON，而 `load()` 一旦读到半个 JSON 会把文件改名为 `.corrupt-*` 并清空，损失远大于「晚几秒落盘」；改为数据留在内存，由调用方重试；
  4. `index.js` 再排 **3 次延迟重试**（2s/4s/6s），覆盖「杀毒扫描持续数秒」这类同步重试兜不住的情况；重试链走完之前**不打日志**（quiet 模式），彻底放弃时才打印一次带「原因 + 影响」的说明；
  5. 退出前最后一次落盘给足重试（10 次 ≈ 2s），避免被瞬时占用就丢掉本次会话的记录。
- **实测**（真实 Windows 文件锁：`[System.IO.File]::Open(..., FileShare.Read)` 持锁）：
  - 持续占用 → 重试 5 次后放弃，**原文件字节不变**、无残留临时文件，日志变成三行可读说明；
  - 持锁 120ms 后释放 → 第 3 次尝试成功落盘（`{ok:true, ms:82}`），**无需人工干预**；
  - quiet 模式失败 → stderr 为空（由调用方决定何时报）。
- **测试**：`test/storage.test.js` 新增第 13 节（17 条断言）：一次成功、退避重试、持续占用不覆盖目标且清理临时文件、非占用类错误只试一次、错误分类、真实落盘往返。

## v1.8.9(2026-09-17)

**修正档位文案：「平峰」→「不分峰谷」，且为 0 时不再占图例**

- **问题**：按峰谷图的图例第三项写作「平峰」（内部 `period='flat'` 的直译）。官方定价**只有两档**——高峰（工作日 9:00-12:00、14:00-18:00）与闲时（高峰 × 0.5，周末全天闲时）；`flat` 的真实含义是「**这笔计价不分峰谷**」（`price.tiered === false`：订阅套餐、非 DeepSeek provider 的兜底价、未识别模型的通用兜底价）。而中文电价语境里「平峰/平段」指峰谷之间的**第三个时段**，放在这里会让人以为 DeepSeek 有三档价。
- **另一层误导**：该项常驻图例，即使全区间为 0 也占一个色块（只跑 DeepSeek 按量调用时恒为 0），进一步强化「存在第三个时段」的错觉。
- **修法**：`client.js` 图例与 `periodText()`（最近记录「时段」列）、`index.js` 的 `cost_peak` 查询输出统一改为「**不分峰谷**」；图例与柱状图**仅在该窗口内 flat 合计 > 0 时**才带上第三项（其余情况只留 高峰 / 闲时 两项）。
- **未改口径**：`flat` 字段与计费逻辑不动，仅改措辞与显示条件。
- **测试**：`test/client-render.test.js` 新增 `[6]` 段——断言渲染文本含「不分峰谷」、不含「平峰」；把样本 `flat` 置 0 后，图例不得再出现第三项，而高峰/闲时仍在。

## v1.8.8(2026-09-15)

**修复：「仅云端」视图只有请求次数、费用整列为 ¥0.0000（字段名未映射）**

- **现场**：看板切到「仅云端」后，三张金额卡与底部汇总全为 `¥0.0000`，而「API 请求次数 / Tokens」正常（如 4,271 次、712.6M）。这个「次数对、金额 0」的组合直接指向字段名不匹配。
- **根因**：云端 `/api/v1/overview` 的按量金额字段是 **`realCost`**、订阅等效是 **`subEquivalent`**，而本地 `buildDashboard` 与所有卡片读的是 **`real` / `sub`**。客户端的 `normalizeCloudDash`（与内联兜底 `vNormalizeCloudDash`）当时只把 `today/month/all` 原样透传，`summary` 更是整个丢掉 —— 于是金额全 0，`calls/tokens` 因两边同名而幸存。**测试里那份云端假数据误用了 `real/sub`，把缺陷掩盖了**（已改为与线上一致的 `realCost` 形状）。
- **修法**：`view.js` 新增 `cloudSlices()` 做**逐项字段映射**（同时接受 `realCost/real`、`subCost/subEquivalent/sub` 三种写法，向后兼容旧云端），客户端内联兜底同步实现；`summary` 行按 `realCost → real`、`subEquivalent → sub` 映射，缺字段时回退到 `all` 的对应值。归一化后同时保证 `real + sub` 与 `calls + subCalls` 口径与本地一致。

**新增：云端「插件形状」只读接口，仅云端的图表不再为空**

- 客户端要画消费柱状图、分模型明细与最近记录，需要 `byDay / byModel / byModelDay / recent`，而 `/api/v1/overview` 只给概览卡片 —— 「仅云端」的图表此前注定为空。
- 云端新增 **`GET /api/v1/plugin-view`**（设备令牌可读，`caps.devicePluginView=true` 声明），字段名与本地 `buildDashboard` **逐项一致**，从根上消除这层适配；同时支持 `union` 并集（「本机+云端」）。
- 插件探测 `/api/v1/health` 的 caps 后**优先走 plugin-view**，旧云端自动回退 `overview`（卡片可用、图表为空，不再整体不可用）；带 `union` 时仍走 overview（其卡片保持全网口径，与并集相加语义一致）。
- 顺带修掉云端既有的**同源缺陷**：`pluginView()` 的 today/month/all 原取自 `totalsUnfiltered`（无条件下全表），会**绕过 `excludeDevice`** —— 「本机+云端」相加时本机被计入两次。现改为按同一过滤条件取切片，且 `calls/tokens` 只含按量、订阅另计（`subCalls/subTokens`），与本地口径对齐。

**测试**

- 插件 `test/client-render.test.js` 的云端假数据改为**线上真实形状**，新增 `[5] 仅云端金额映射`用例：断言今日 ¥0.50、总花费 ¥2.00、不再出现 `¥0.0000`、汇总行按 `realCost` 口径，且内联兜底与 `view.js` 结果逐字一致。
- 新增 `test/cloud-view-e2e.test.js`：真实启动 `dsh-cost-cloud` 实例 → 设备令牌读 `plugin-view` → 过 `view.js` 归一化 → 断言卡片字段（含向后兼容旧概览口径）。
- 新增 `test/cloud-read.test.js` 契约断言：概览优先 plugin-view、并集仍走 overview、不得回退到 `/api/admin`。
- 云端新增 `test/plugin-view.test.js`（6 项）：caps 声明、字段形状、三切片受过滤约束、union 不重复计数、鉴权与开关、`range=all` 日期轴覆盖数据起点。

**兼容**：无数据格式变更。云端需部署 **1.2.0** 及以上才有 `plugin-view`（未部署时插件自动回退，金额修复本身不依赖云端升级）。

## v1.8.7(2026-09-15)

**修复：`cost_recompute` 的默认范围只覆盖「最近一个价格时代」，更早的陈旧记录被静默跳过**

- **现场**：v1.8.6 修复后按提示执行补账，854 条被订正，但另有 **750 条 `deepseek-flash` 记录（seq 611–1360，北京时间 09-10 21:24 ～ 09-14 02:36）仍标着「估算」**。逐条核对发现它们**完全落在默认扫描范围之外**：旧默认 `since` = **最近一个价格时代的生效时刻**（本机为 `v41pro` = 09-14 12:00），该时刻之前的记录一条都没进扫描。补账只做了一半，提示却是「没有需要重算的记录」——**默认值本身就是陷阱**。
- **修法**：默认改为 **全时段扫描（`since = 0`）**。补账幂等、明细量级有限（本机 1600+ 条耗时毫秒级），全扫代价可忽略，收益是「调用一次必然覆盖全部历史」。
  - 显式传入 `since`（ISO 或 epoch ms）仍可限定时段；`since: 0` 现在被正确识别为「全时段」，此前因 `> 0` 判断会被当成缺省值而回落到最近时代。
  - `since === 0` 时返回值 `era` 为 `null`（全时段不存在单一时代），避免旧版误报 `era=legacy`；工具输出把范围显示为「全时段」。
- **实测（本机 2231 条明细）**：全时段扫描 `scanned=1642 / changed=772 / estimatedFlips=750 / delta=0.0000`，落盘后再跑一次 `changed=0`（幂等）。**全部 1643 条 `deepseek-flash` 记录的「估算」标记清零，金额一分未变**；仅剩 5 条 `k3-256k`（Kimi 订阅等效口径，本就应为估算）。

**加固**

- `test/client-registration.test.js` 新增 **[7] 版本号一致性**断言：`package.json` 的 `version` 必须等于 `index.js` 的 `PLUGIN_VERSION`。v1.8.6 发布时两处曾漂移（包 1.8.6 / 常量 1.8.5），而该常量会随上报信封发给云端用于排查设备版本，漂移会让云端看到错误版本。现已把它变成发布闸门。
- `test/recompute.test.js` 断言默认范围改为「全时段扫描 + `era=null` + 覆盖全部 5 条样本」。

**兼容**：无数据格式变更；`cost_recompute` 入参向后兼容（显式 `since` 行为不变，仅缺省值与 `since: 0` 的解析被修正）。

## v1.8.6(2026-09-15)

**修复：计费规则与 DeepSeek 官方定价的两处口径偏差（金额口径 + 标记口径）**

核查基准：官方价格卡 <https://api-docs.deepseek.com/zh-cn/quick_start/pricing> 与发布通告 <https://api-docs.deepseek.com/zh-cn/news/news260910>。核查方法：用独立脚本按官方牌价重算全部已入库记录，与插件记账逐条比对（1985 条记录金额差额 `0.000000`，说明**数值本来就是对的一分不差**；以下两处修复的是口径与标记）。

- **V4-Pro 路由生效时刻提前了 4 天（金额口径，会低估花费）**
  - 旧实现把 `deepseek-v4-pro → V4.1 Flash` 的路由与 Flash 调价合并成同一时刻（北京时间 2026-09-10 12:00），但官方通告的措辞是：「北京时间 **2026 年 9 月 14 日 12:00** 之后……用户访问 `deepseek-v4-pro` 的请求将全部路由到 V4.1 Flash，并按 V4.1 Flash 单价计费」（价格卡脚注 (2) 同口径）。
  - 影响：2026-09-10 12:00 ～ 09-14 12:00 之间的 V4-Pro 调用会被**低估约 4.5 倍**（9/27/0.30 → 2/8/0.04）。本机记录该窗口内无 V4-Pro 调用，故无历史金额损失，但属潜伏缺陷。
  - 修法：新增 `V41_PRO_ROUTE_AT`（`2026-09-14T04:00:00Z`）与时代 `v41pro`，把路由从 `v41` 拆出来；`v41` 时代保留 V4-Pro 自有牌价（9/27/0.30），避免这 4 天落入 provider 兜底而被误标「估算」。

- **官方现役模型名 `deepseek-flash` 不在精确单价表内（标记口径，已在真实数据中触发）**
  - 官方脚注 (1)：「模型名请使用 `deepseek-flash`」。旧实现的规范名是 `deepseek-v4.1-flash`（官方文档中并不可调用的写法），于是宿主实际上报的 `deepseek-flash` 落入 provider 兜底分支——**金额恰好相同，但被标记为「估算」**。本机 1402 条 `deepseek-flash` 记录 100% 命中该问题，云端 `cost_basis` 也随之为 `estimated`，污染「估算占比 / 口径漂移」统计。
  - 修法：`V41_FLASH_MODEL` 改为 `deepseek-flash`（官方现役名），并新增 `MODEL_ALIASES` 别名归一表，使 `deepseek-v4.1-flash` / `deepseek-v4-1-flash` / `deepseek-v41-flash` / `deepseek_flash` 等等价写法解析到同一规范名（单价表本身不重复列项）。路由目标与入账名统一为 `deepseek-flash`。

**修复：`cost_recompute` 不再漏判「仅标记变化」的记录**
- 变更判定此前只看费用 / 模型名 / 档位，于是「模型名从兜底升为精确档、金额分毫不变」的记录不会被订正。现纳入 `estimated` / `subscription` 标记比对，返回值新增 `estimatedFlips` 计数，工具输出会明确写出「其中 N 条仅订正『估算』标记，金额不变」，避免补账看起来「改了 0 条」。

**变更**
- `export const V41_FLASH_MODEL = 'deepseek-flash'`（原 `'deepseek-v4.1-flash'`）；新增导出 `V41_PRO_ROUTE_AT` / `MODEL_ALIASES`。
- `PRICE_ERAS` 由 2 版增至 3 版：`legacy` / `v41`（09-10 12:00 起，含 V4-Pro 自有牌价）/ `v41pro`（09-14 12:00 起，含 V4-Pro 路由）；`v41` 时代新增 `proRouteSince` 说明字段。
- `cost_prices` 的 `eras` / 渲染文本同步展示 V4-Pro 路由时刻与官方现役名口径。

**测试**
- `test/pricing.test.js`：新增 V4-Pro 路由时刻边界用例（`12:00:00.000` 前一毫秒仍按自有牌价、整点起路由）、`deepseek-flash` 精确命中与别名归一用例。
- `test/recompute.test.js`：补账样本改为覆盖「路由前窗口金额不变」「路由后改写为 `deepseek-flash`」「误标估算记录被订正」三类，新增 `estimatedFlips` 断言。

**计费影响**
- **已入库记录金额零变化**（数值本即正确）；仅 `estimated` 标记、V4-Pro 在 9/10–9/14 窗口的口径、以及历史 `deepseek-v4.1-flash` 记录（本机 22 条）与 `deepseek-flash` 的桶名归并发生变化。
- 涉及历史桶名/标记的机器建议执行一次 `cost_recompute`（默认试算，`apply: true` 落盘），幂等可重复执行。

## v1.8.5(2026-09-15)

**修复**
- **v1.8.4 的自动回填会中途短路,只补一批就宣告完成**:`runOnce` 推进游标时采信的是**服务端返回的水位**,而服务端 `/api/v1/ingest/records` 回的是它库里该设备明细的 `MAX(client_seq)` —— **整体最大值**,含更早已上传、序号更高的记录,不是"本批"的最大值。于是在**它本来要修的那个场景**里(本机缺 1..723、云端已有 724..1457):第一轮补发 1..500 后服务端回 `maxClientSeq=1457`,游标一步跨到顶,下一批为空,`break` —— 501..723 照样补不回来。现改为游标只推进到**本批实际送达**的 `maxClientSeq`,多轮循环才能真正逐段覆盖全部历史。实测现场:17:16 那次回填只发出 1 批 500 条,预期的 3 批只完成 1 批。
- **回填算法加版本号**:状态文件新增 `backfillVer`。v1.8.4 已经跑过(有缺陷的)回填的部署,`legacySent` 已是 `true` 而缺口仍在,靠布尔量无法区分"补过且补全"与"补过但短路"。现在低于当前算法版本(2)的部署会**再补跑一次**;`cost_sync action=now full=true` 同样会强制重新回填一轮。

**测试**
- `test/sync.test.js` 新增 8d 组:复现「服务端水位 = 整体最大值 + 云端只有最新的 500 条」这一真实故障现场,断言一轮同步必须把 1..1200 全部送达、云端不留空洞、版本号落盘。**该组在 v1.8.4 代码上报 5 条红**(只发出第一批、留下 650 个空洞),修复后全绿。
- 断言回填成功后必须落 `backfillVer=2`,中途失败时不得落(否则缺口会被永久放过)。全量 `npm test` 通过;无数据迁移、无破坏性变更。

## v1.8.4(2026-09-15)

**修复**
- **云端「全时段」缺失最早一段历史**:`sync.js` 的 `buildRecordsPayload()` 从**最新**记录往回取批,首批装满 `syncBatchSize`(默认 500)后水位立刻跳到最新 seq,而跳过条件是 `seq <= watermark` —— 比首批更旧的记录被判成"已上报",**再也不会被发送**。凡是"先攒下一批本地明细、之后才开启云端同步"的部署都会中招,且 `cost_sync action=now full=true` 也救不回来:全量只是把水位归零,选片方向照旧从最新开始,重复发同一批后水位又跳回顶端。实测现场:本机 1456 条明细,云端只收到 722 条(最早 `2026-08-24 22:53:57`,正好是首轮 500 条批次的起点),**缺 723 条、¥36.68**。现改为**由旧到新**取批,水位逐批连续推进,每轮最多 40 批,多轮即可覆盖全部历史。
- **已上线部署自动补齐**:启用状态文件里一直闲置的 `legacySent` 标记做**一次性历史回填** —— 升级后的第一轮同步把水位归零、由旧到新重发全部历史(服务端按内容哈希幂等,已存在的记录只计 `duplicates`);该标记**只在明细阶段真正跑完一轮后才置位**,中途失败保持 `false`,下次同步继续补,绝不漏发。

**测试**
- `test/sync.test.js` 新增 3 组护栏共 21 条断言:
  - **取片方向**:批上限截断时必须取**最旧**的若干条(≤1.8.3 返回最新的,断言立即报红);
  - **现场复现**:1200 条明细 + 水位被推到 1100 + `legacySent=false`,一轮同步必须完整送达 1200 条(升序、无重复、水位推进到 1200、置位 `legacySent`);置位后只发增量;
  - **失败可恢复**:中途 500 时不得置位 `legacySent`,下一次同步仍能把 1200 条全部补齐。
- 上述 11 条断言在 v1.8.3 代码上全部报红,修复后全绿;全量 `npm test` 通过;无数据迁移、无破坏性变更。

## v1.8.3(2026-09-15)

**修复**
- **三态视图在浏览器里从未生效**:`client.js` 通过 `requireLocal("./view", 兜底桩)` 取三视图与云端合并逻辑,而宿主的客户端模块加载器**只加载本插件的客户端 bundle** —— `view.js` 是宿主侧 ESM,浏览器里永远取不到,于是静默退回只含「本机」的空桩:**三态开关只剩一个按钮**,而且 `normalizeCloudDash` / `mergeDash` 被空实现顶掉,**云端数据即便取回来也永远合并不进来**(这是「只有本机这个选项」的直接原因)。现把 view.js 的纯逻辑**完整内联**进 bundle(保留 `require("./view")` 作为可选覆盖),客户端 bundle 从此自包含。

**测试**
- `test/client-render.test.js` 新增两条针对性护栏:
  - **三态按钮断言**:`本机 / 本机+云端 / 仅云端` 必须全部渲染出来 —— 旧断言只查 `includes("本机")`,空桩也能蒙混过关;
  - **一致性断言**:分别构造「取到 / 取不到 view 模块」两个模块实例,渲染结果必须**逐字一致**;内联实现一旦与 `view.js` 漂移立刻报红。
  - 另断言「本机+云端」确实把云端数字并了进来(总花费 7.81 而非 5.81),防止合并逻辑退化成直通。
- 测试脚手架修正:`renderAsync` 改为多轮 —— 切视图 → 再拉云端 → 合并是**链式** effect,只跑两轮会停在"已切视图但云端还没并进来"的中间态;结尾显式 `process.exit`(组件里的 `setInterval` 会挂住测试进程)。
- 全量 `npm test` 通过;无数据迁移、无破坏性变更。

## v1.8.2(2026-09-15)

**修复**
- **「配置完云端一点保存,插件界面整体消失」**:`client.js` 里的 `timeLabel()` 被引用 3 次却从未定义(v1.8.0 引入)。三处调用都写成 `st.lastSyncAt ? timeLabel(...) : "从未"`,因此**只有首次同步成功之后**才会执行到 —— 一保存配置、同步一成功,客户端渲染立刻抛 `ReferenceError`,`「花费统计」页与「插件配置」卡片同时消失`(实为渲染崩溃,宿主半端仍在正常运行、上报也没断)。现补上定义:一天内给「刚刚 / N 分钟前 / N 小时前」,更早给 `MM-DD HH:mm`。
- **「仅云端 / 本机+云端」始终拿不到云端数据**:插件的云端聚合读取走 `/api/admin/*` 并用**设备令牌**鉴权,而管理接口只认管理员会话 cookie,必然 `401 UNAUTHORIZED`。现改走设备令牌可读的只读接口 `/api/v1/overview|matrix|devices`(需 dsh-cost-cloud ≥ 支持该接口的版本);命中 404 时提示「云端版本过旧」并给出升级指引,不再只回一个 `HTTP 404`。

**测试**
- `test/client-render.test.js` 的 fetch 桩改为返回**真实形态的「已配置且已同步」响应**(含 `lastSyncAt`/`watermark`/`deviceId`),并新增「上次同步时间标签必须渲染出来」断言 —— 原先喂空对象会走 `"从未"` 分支,恰好绕开了这条崩溃路径。该护栏在已发布的 1.8.0 / 1.8.1 上都会报红(`timeLabel is not defined`)。
- 新增 `test/cloud-read.test.js`(6 项):钉住云端只读路径必须是 `/api/v1/*`、不得用设备令牌读 `/api/admin/*`、404 必须带可操作提示。
- 全量 `npm test` 通过;无数据迁移、无破坏性变更。

## v1.8.1(2026-09-15)

**修复(均为 v1.8.0 的原生缺陷,建议所有 1.8.0 用户升级)**
- **「花费统计」页白屏**:`Dashboard` 把 `sync` 作为 prop 传给 `PeakPanel`,而 `PeakPanel` 内部误用了裸 `sync`(未从 props 解构),渲染期抛 `ReferenceError: sync is not defined`,整块面板被卸载成空白 —— 1.8.0 的主页面等于完全不可用。
- **插件配置卡片永不显示**:客户端用 `slots.entries("settings.plugin.item").length > 0` 当「宿主是否声明了该插槽」的探测。`entries` 数的是**已经注册进该插槽的条目**,而条目恰恰由各插件在插槽声明之后才注册,所以该判断在插件 apply 阶段恒为假,卡片永远注册不上(也就没有地方填写云端地址)。改为**无条件** `slots.inject`,与宿主官方卡片及 `dsh-context` 的写法一致。
- **宿主侧命名空间注册时序**:`ctx.get('settings')` 只探一次,服务晚一步就绪时命名空间永不注册。改为 `ctx.inject(['settings'], …)` 等它就绪再注册(服务始终缺席时保持 inert,不阻断启动);`installSettingsSection` 增加幂等守卫,避免二次注册触发宿主 `already registered`。

**改进**
- **插件配置卡片改用宿主同款外壳**:`li.cost-pcard` > 可点击 header(标题 / 副标题 / 旋转箭头) + 折叠 body,逐条照搬宿主 `PluginCard.module.css` 的设计 token(边框、圆角、hover、展开态配色、focus-visible、过渡时长),默认收起、点击展开,与「插件市场 / 上下文 / 终端」等卡片视觉一致。样式用 `.cost-pcard` 前缀,避免与「花费统计」页既有的 `.cost-card`(概览数字卡)冲突。

**测试**
- 新增 `test/client-render.test.js`:用零依赖的极小 React 替身在 Node 里真实执行 `client.js`(函数组件被真正调用、`useState` 可持久化以模拟交互、`useEffect` 会执行并等微任务落地),覆盖:apply 完整、两个插槽都注册、花费统计页渲染无异常、配置卡片默认折叠 / 点击展开 / 展开后表单字段渲染。该护栏在 1.8.0 的原始代码上会红(正是上面两个缺陷)。
- `test/client-registration.test.js` 新增「插件配置卡片注册方式」3 项断言(必须无条件 inject、条目键必须等于命名空间、必须与宿主 `installSection` 的 ns 一致)。

## v1.8.0(2026-09-15)

**新功能：云端同步（多机汇总）**
- 新增 `sync.js` 同步引擎：把本机用量**增量、幂等、可离线补偿**地上报到自建云端服务。本地先记账 → 异步上报 → 失败指数退避（5s→10s→…→300s）→ 断网恢复后自动补齐。**上报失败绝不影响本地记账与看板**。
- 去重采用**内容哈希**（与云端契约 `docs/INGEST-API.md` §6 逐位一致）：`sha256(canonical)`，重放/乱序/游标丢失后的全量重发都不会重复计数。
- 明细带单调 `seq`（随文件持久化），云端以此推进水位；`cost_reset` 会使 `resetEpoch +1`，避免「清空后重新导入」被判为重复。
- 明细超期折叠为日汇总时，会记录被吸收明细的 `absorbed` 键，随快照上报，云端据此把这些明细移出统计 —— 因此**全时段合计在折叠前后完全一致**。
- 设备身份：共享文件 `~/.dsh-cost/device.json`（`machineId` / `deviceName`），可由环境变量 `DSH_COST_HOME` 覆盖目录。**同一台机器上的所有 agent 共用同一 `machineId`**，看板才会把它显示成一台设备。

**新功能：看板三态视图 + 维度切换**
- 「设置 → 花费统计」顶部新增三态开关：**本机 / 本机+云端 / 仅云端**。
  - `本机`：与升级前逐项一致（完全走原有代码路径）；
  - `本机+云端`：本地聚合 + 云端聚合（服务端 `excludeDevice` 排除本机后相加），恰好等于全网合计，**不重复计数**；
  - `仅云端`：以云端记录为准；未配置或不可用时回落本机并给出横幅与数据时间戳。
- 维度切换：合计 / 按机器 / 按 Agent / 按模型 / 按项目；`本机+云端` 下自动包含「设备 × Agent 矩阵」，行合计 = 列合计 = 总计。
- 同步状态可见：待上报条数、水位、上次同步、错误与退避；本机有未同步记录时提示「云端数字会偏小」并提供「立即同步」。

**新功能：插件配置卡（设置 → 插件 → 插件配置）**
- 在「插件配置」标签页注册本插件卡片（`settings.plugin.item` 插槽，键为 `cost-tracker` 命名空间）：设备名、服务地址、共享令牌（写-only，浏览器拿不到明文）、同步间隔、会话脱敏、是否上报 purpose、默认视图，以及 `测试连接` / `立即同步` / `全量补传`。
- 令牌通过 settings 的 `role('secret')` 机制脱敏（`redactSecrets: true` 派发），前端只知「是否已配置」。
- **双保险**：「设置 → 花费统计」页保留只读回显卡（设备名/设备 ID/服务地址/同步状态），卡片未注册时功能不丢。
- 零依赖 schema（`schema.js`）：自建与宿主 schemastery 同形状的 schema（可调用 + `.meta` + `.toJSON()`），不引入任何 npm 依赖。

**新功能：Agent 工具与隐私开关**
- 新增工具 `cost_sync`：`action = status | now | test | config`。
- `cost_stats` 新增 `scope = local | cloud | both`（默认 `local`），避免 AI 把本机数字当成全网回答；原有输出字段保持不变。
- 新增 `POST /api/cost-tracker/sync`、`sync-now`、`sync-test`、`sync-config`、`cloud` 路由。
- 隐私：`会话脱敏`（`sessionId` 上报前替换为不可逆哈希）、`不含 purpose` 两个开关。

**修复**
- `store.js` 的保留期折叠现在会记录 `absorbed` 键（此前折叠后无法向云端证明"这些明细已计入快照"，会导致云端重复计数）。
- 备份：`store.add()` 分配 `seq` 时不再依赖调用方，旧文件（无 `seq`）加载后按时间升序补配并透明落盘。

**测试**
- 新增 `test/sync.test.js`（89 项）与 `test/view.test.js`（56 项）：契约向量、身份文件、配置规范化、schema 形状、增量/批量/窗口裁剪、快照 absorbed、退避与错误分类、三态视图相加不变量，以及与 `dsh-cost-cloud` 真实实现的跨仓库端到端（本地清空后重导、全量补传去重）。
- 既有 218 项测试全部保持通过。

**兼容与升级**
- 数据文件自动升级为 `{ v:2, seq, resetEpoch, details, rollups }`，旧文件加载时补配序号，**不影响既有数字**。
- 配置新增字段均有默认值；未配置云端时行为与 v1.7.1 完全一致（不产生任何网络请求）。
- 云端服务在独立仓库 `dsh-cost-cloud`，可选部署；不装也能正常使用本机统计。

## v1.7.1(2026-09-14)

**修复(严重,影响所有 v1.7.0 的干净安装)**
- **修复客户端半端加载失败**:`client.js` 向浏览器端 `__ModuleLoader__.load()` 注册时用的 id 仍是旧裸名 `dsh-cost-tracker`,而加载器持有的图行 id 已是包名全称 `@angelyeye/dsh-cost-tracker`(v1.7.0 改包名时漏改了这一处手写字符串)。两者不等,加载器判定「bundle 已执行但没有以该 id 注册」并抛错:

  ```
  client-modules: bundle /plugins/??…@angelyeye/dsh-cost-tracker/client.js… loaded without
  registering "@angelyeye/dsh-cost-tracker" via __ModuleLoader__.load
  ```

  表现为 `HARNESS / Failed to load plugins`:插件的服务端部分正常(Agent 工具仍可用),但客户端整半端(设置页「花费统计」、输入框花费状态条、侧边栏峰谷条)全部不出现。
- **影响范围**:`npm` / 插件市场 / `github:Angelyeye/dsh-cost-tracker` / 手工 clone —— **所有**安装路径下的干净安装都会命中。图行 id 由包自己声明的 `name` 推导,与安装方式无关;v1.7.0 是此前唯一已发布版本,因此本修复针对的就是全部现存安装。

**加固(防回归)**
- `client.js` 末尾新增注册名护栏:以单一事实源常量表述注册 id,执行时自检「实际写入 `factories` 的 id」是否等于包名。**一致时不介入**(不会安装对 `loader.load` 的包装);不一致时在控制台直接点名根因 —— 若注册的是历史裸名,会明确说明这是 v1.7.0 的缺陷及改法,而不是只留加载器那句难以定位的报错。
- 新增 `test/client-registration.test.js`(11 项断言):在 `node:vm` 沙箱里按宿主的真实注册语义运行 bundle,断言注册名严格等于 `package.json` 的 `name`、允许尾部 `/client` 写法(会被宿主的 `stripClientSuffix` 去掉)、并**反向验证**注册名不一致时护栏必须报错。已接入 `npm test`。

**文档**
- **更正 v1.7.0 条目里的迁移指引**:原文让人用 `dsh plugin --profile web add github:Angelyeye/dsh-cost-tracker` 重装 —— 该写法在 v1.7.0 上**同样无法修复**客户端加载失败(包名不变、图行 id 不变,问题在 bundle 内部)。已装坏的用户正确出路是**升级到 1.7.1**,不需要重装。中英文 README 同步更正。
- 明确一条开发约定:**客户端 bundle 注册的 id 必须与 `package.json` 的 `name` 逐字一致**(允许尾部带 `/client`)。包名带 scope 时尤其容易漏。

**升级**
- 1.7.0 → 1.7.1 直接升级即可,**无需**先卸载;`cordis.patch.yml` 的 loader id 未变,不会产生重复注册。功能、数据格式、存储路径均无变化。

## v1.7.0(2026-09-12)

**变更(破坏性,仅影响安装方式,不影响功能与数据)**
- **包名由 `dsh-cost-tracker` 改为 `@angelyeye/dsh-cost-tracker`**:npm 上原名已被他人占用,而插件市场的 npm 映射要求「已发布包名 = 仓库 `package.json` 的 `name`」并且该包的 `repository` 指回本仓库。改名后市场才能建立 npm 映射(下载量、宿主兼容徽章、版本化更新)。
- `cordis.patch.yml` 的 bundle 补丁同步改为新包名。**注意 scoped 名在 YAML 里必须加引号**(`name: "@angelyeye/dsh-cost-tracker"`)——`@` 是 YAML 的保留起始字符,不加引号会导致整个 bundle 层解析失败。
- **迁移**:旧安装必须**先清掉旧的、再装新的**,不能直接叠加安装 —— 新旧两份 `cordis.patch.yml` 用的是**同一个 loader id**(`dsh-cost-tracker`),叠加会让两份同时加载,表现为重复的 HTTP 路由、Agent 工具与 UI 插槽。
  - 市场安装的(用 `dsh plugin add` 装的):`dsh plugin --profile web remove dsh-cost-tracker`,再 `dsh plugin --profile web add @angelyeye/dsh-cost-tracker`;
  - 手工 clone 装的:删掉 `~/.dsh/profiles/web/cordis.patch.yml` 里 id 为 `dsh-cost-tracker` 的那段 `- insert:`,并 `rm -rf ~/.dsh/profiles/node_modules/dsh-cost-tracker`,然后重装一次。
  - ~~按仓库安装的写法 `dsh plugin --profile web add github:Angelyeye/dsh-cost-tracker` 改名后依然可用(包名以包自己声明的为准)。~~ **【v1.7.1 更正】** 该写法在 v1.7.0 上同样无法修复客户端加载失败(包名不变、图行 id 不变,故障在 bundle 内部),且会让人误以为排障成功。已装坏的用户请直接升级到 v1.7.1。详见 README「从旧包名迁移」。
- README(中/英)安装章节同步更新。

**不变**
- 功能与数据格式无变化;用量记录、日汇总、配置与存储路径均保持原样。

## v1.6.0(2026-09-10)

**新增**
- **适配 V4.1 Flash 新计费规则(北京时间 2026-09-10 12:00 起生效)**:单价表改为**按「计费时代」分版**(`PRICE_ERAS`),按**每条记录自身的时间戳**选版计费,因此历史记录口径不变、切换点自动生效,无需重启或改配置。
  - 新增时代 `v41`(北京时间 2026-09-10 12:00 = `2026-09-10T04:00:00Z`):V4.1 Flash 高峰价 **输入(缓存命中)0.04 / 输入(缓存未命中)2 / 输出 8**(元/百万 tokens),空闲时段仍为高峰半价(0.02 / 1 / 4)。**峰谷窗口不变**,故时段条与倒计时逻辑无需调整。
  - 新增**模型路由**(时代内的 `routes`):V4.1 Pro 上线前,V4-Pro 的请求全部路由到 V4.1 Flash 并按 V4.1 Flash 单价计费;旧 V4-Flash 系(含 `deepseek-v4-flash-vision-exp`)已被 V4.1 Flash 取代,一并按新价计费。**记录以实际计费模型名入账**(如 `deepseek-v4-pro` → `deepseek-v4.1-flash`),按模型聚合看到的就是真实计费口径。
  - 新增导出 `V41_EFFECTIVE_AT` / `V41_FLASH_MODEL` / `PRICE_ERAS` / `eraAt()` / `exactModelsAt()` / `resolveModelInEra()` / `normalizeModelName()`。
- **模型名归一化匹配**:小写并剔除分隔符,使 `deepseek-v4.1-flash` / `deepseek-v4-1-flash` / `deepseek-v41-flash` / `DeepSeek-V4.1-Flash` 等等价写法命中同一档价,避免官方模型 ID 措辞变化导致漏计而落入兜底估算。
- `cost_prices` 工具与 HTTP `/prices` 接口改为**按版本渲染**:逐时代列出生效时刻、单价与路由规则,并标出当前生效版本(`era` / `eraLabel` / `eras` / `v41EffectiveAt`)。

- **新增 `cost_recompute` 一次性补账工具**(同时开放 HTTP `/api/cost-tracker/recompute`):按记录自身时间戳重算已入库记录的费用与计费模型名。用于「价格时代已切换、但宿主尚未重启」期间按旧价入库的记录;**默认只试算不落盘**,传 `apply: true` 才写回,幂等可重复执行。只重算明细(明细保留最近 180 天;更早的记录已折叠进日汇总,其时间段远早于任何价格切换窗口)。

**变更**
- `priceFor(np, model, ts)` 新增第三个参数 `ts`(调用发生时刻),缺省为当前时间;返回值新增 `model`(**计费模型规范名**,命中路由时为被路由到的模型)与 `era` 字段。记账链路改为传入记录时间戳。
- DeepSeek provider 兜底单价同步至 V4.1 Flash 档(`2.0 / 8.0 / 0.04`),未知 deepseek 模型不再按旧价高估。
- `EXACT_MODELS` 语义收敛为 **legacy(旧价)时代的单价表**,保留导出以兼容既有调用与历史口径。

**测试**
- `test/pricing.test.js` 新增计费时代分版与模型路由用例(切换边界 11:59:59 / 12:00:00、V4-Pro 路由、旧 V4-Flash 系路由、别名归一化、空闲半价、悬空路由防护)。
- 所有涉及单价的断言改为**显式传入时间戳**,不再随运行时刻漂移(否则跨 12:00 切换后必然误报)。

**计费影响(同一调用对比,高峰价)**
- V4-Pro(10 万输入未命中 + 6 千输出 + 2 万缓存命中):旧 **¥1.068** → 新 **¥0.2488**(约 **-76.7%**)。
- 旧 V4-Flash 同量:旧 **¥0.356** → 新 **¥0.2488**(约 **-30.1%**)。

## v1.5.2(2026-08-25)

### 新增
- **「简洁」时段条新增「双行紧凑（上下布局）」选项**:设置页当时段条样式为「简洁（单行紧凑）」时出现该复选项,勾选后时段条由左右单行改为上下两行布局,并可进一步选择「时段条在上·文字在下」(默认)或「文字在上·时段条在下」;侧边栏与设置页预览同步生效。
- 新增 `peakCompactStack`(默认 `false`)与 `peakCompactOrder`(`bar-first` / `text-first`,默认 `bar-first`)配置项,纳入 `defaultPeakConfig` / `normalizePeakConfig` 与配置层单元测试。

---

## v1.5.1(2026-08-24)

### 修复
- **侧边栏底部(sidebar.footer.action)与多插件 UI 兼容**:DSH 渲染器把该槽锚点设为 `display:contents`(见 `dsh-client-ui-renderer` 的 `ANCHOR_STYLE`),导致多个往此槽注册内容的插件(如 `linxin666/dsh-web-ui-all`)被并进同一行、互相挤压。现通过覆盖样式把该锚点改为**纵向堆叠**(`display:flex; flex-direction:column`),使本插件的时段条与其它 footer 插件共存不重叠(思路与 `dsh-footer-order` 一致)。采用稳定 `data-slot` 选择器,收起(rail)态仅显示短词、天然不受影响。

---

## v1.5.0(2026-08-24)

### 新增
- **峰谷「时段条样式」新增「环形表盘(24h 中空圆环)」**(替代原「经典(两行)」):
  - 12 档「当前时刻」指针式样可选,默认采用**相位色点**(圆点颜色随相位变化:高峰橙 / 平价蓝 / 周末绿),不再使用从圆心连到边缘的长指针;
  - 圆环按 24h 划分(0:00 顶部、6:00 右、12:00 底、18:00 左),橙色 = 高峰时段(9:00–12:00、14:00–18:00),蓝色 = 平价时段,周末整环无橙色(全天谷价);
  - 圆心展示当前相位词 + 距下次切换倒计时;
  - 新增「显示时间」开关(仅环形表盘)控制是否显示 00:00–21:00 小时刻度。
- **「简洁(单行紧凑)」时段条改为按 24h 比例划分**:蓝色平价底条铺满 24h,橙色高峰段按窗口比例定位(9:00–12:00 → 37.5%–50%,14:00–18:00 → 58.33%–75%),白色分割线标出「当前时间」实时进度;周末仅蓝底 + 白线。

### 改进
- 后端 `peakSnapshot()` 新增下发结构化窗口数组 `peakHours`(`PEAK_HOUR_WINDOWS`),前端据此绘制比例轨道 / 圆弧,与 `isPeak`/`peakPhaseAt` 计费口径一致;前端内置兜底窗口 `[9,12]`/`[14,18]`。
- 新增 `peakShowTickLabels` 配置项(默认 `true`),纳入 `defaultPeakConfig` / `normalizePeakConfig`。
- 新增设计文档 `docs/peak-dial-design.md` 与可交互预览页 `docs/peak-dial-preview.html`(含 12 档指针式样对比)。

---

## v1.4.1(2026-08-23)

### 修复
- **修复缓存写入(cache write)计价 bug**:原先 `cacheWrite` 被按「缓存未命中价」计费(flash 3.0 / pro 9.0),导致缓存写入量大的会话费用被严重高估。官方规则(及 `dsh-cost-meter`)约定**缓存写入与缓存命中同价**,现统一为 `(cacheRead + cacheWrite) × 缓存命中价`(flash 0.10 / pro 0.30)。
- `computeCost()` 改为 `输入×未命中价 + 输出×输出价 + (缓存读+缓存写)×命中价`,与官方/参考口径完全一致。
- **补充 reasoning(推理)token 计费**:`normalizeTokens()` 新增 `reasoning` 桶(读 `usage.reasoningTokens`),模型单价含 `reasoning` 时按单独单价计费(DeepSeek 当前模型未单独列 reasoning 价,计 0)。

### 改进
- 同步 `EXACT_MODELS` / `SUBSCRIPTION_RATES` / `PROVIDER_RATES` / `GENERIC_RATES` 的 cacheWrite 值(均改为命中价)。
- 更新 `cost_prices` 工具文案与单元测试(新增「缓存写入按命中价」与「reasoning 计费」用例)。

> 说明:本版只修正**单模型计价规则**;不同插件间「调用次数 / 累计用量」的差异源自统计口径(实时 `llm/stream` 与 DSH 会话投影 `(turn,step)` 粒度不同),不属于计价 bug。

---

## v1.4.0(2026-08-23)

### 新增
- **峰谷计价提示(对标 dsh-cost-meter)**:
  - 设置页新增「峰谷计价与提示」面板:启用 DeepSeek 峰谷时段价格、峰时高价时段显著提示、时段条样式(简洁/经典)、峰/谷切换前弹窗提醒、提前提醒分钟(1–30)、提醒类型(峰和谷/进入峰/进入谷)、弹窗位置(右下角/屏幕中心)、同步发送系统通知;全部设置即时保存到 `~/.dsh/storages/cost-tracker-config.json`;
  - 侧边栏底部常驻显示时段条(当前档位 + 距下次切换倒计时),窄栏(rail)自适应为短词;悬停可见完整说明;
  - 峰/谷切换前弹窗:距下次切换不足设定提前量时弹出,同一切换点只提醒一次;可一键预览(进入峰 / 进入谷);
  - 浏览器系统通知:开启且有通知授权时,同一切换点额外发一条;
  - 新增 `POST /api/cost-tracker/peak`(峰谷相位快照)与 `POST /api/cost-tracker/peak-config`(保存配置),以及 Agent 工具 `cost_peak`。
- **六组概览卡**:设置页顶部改版为六张卡——今日费用 / 本月费用 / 总花费 / API 请求次数 / Tokens / **总余额**。今日、本月、总花费三个金额卡**不含订阅会员等效费用**(订阅以附注展示);本月按北京日历月统计;总花费为全时段累计(明细 + 永久日汇总,永远精确)。

### 改进
- **同步 DeepSeek 最新定价规则**:高峰时段限定为北京时间**周一至周五 9:00–12:00、14:00–18:00**,**周末全天计为闲时(闲时半价)**;`isPeak()` 不再忽略星期几,修复周末高峰窗口内被误判为高峰价的问题。
- 时段条对齐参考项目样式:两段轨道(左橙右蓝)+ 标记线 + 单行着色 chip,窄栏自适应;倒计时文案改为紧凑格式(`5小时56分后进入高峰`)。

### 修复
- 预览弹窗此前强制居中显示,现已**跟随用户配置的弹窗位置**(右下角/屏幕中心)。

---

## v1.3.0(2026-08-23)

### 新增
- **Token 用量统计热力图**:
  - 设置页新增「Token 用量统计」面板,类 Codex 的 **26 周每日用量方格热图**;
  - 颜色深浅按当日 token 相对最大值分 4 档,网格自动铺满设置页宽度;
  - 悬停任一格显示当日明细(日期 / 输入 / 缓存 / 输出 / 费用),今天高亮描边;
  - 顶部显示全时段累计(`累计 X tokens · 输入 · 缓存 · 输出 · N 次调用`);
  - 新增 `POST /api/cost-tracker/usage` 端点,返回全时段累计 + 按天 token 聚合;
  - 日期键统一按北京时间(UTC+8)生成,与服务端口径完全一致。
- **本会话按模型拆分**:状态栏新增按会话实际使用的模型拆分,订阅与按量分开统计。

### 改进
- **状态栏改版**:改为**胶囊分段**布局(本会话 / 订阅套餐 / 分模型),信息清晰、竖线分隔、基线对齐。
- **只显示本会话花费**:不再显示累计金额,也不再显示当前峰/闲时价。
- **订阅去重**:订阅只显示一个着色徽标(具体套餐名 + 总等效费用),不再在模型区重复出现。
- **多模型折叠**:默认只显示消耗 top2 模型 + 数量,点击 `▸` 展开全部模型明细;订阅模型不再混入模型区。
- **显示精简**:去掉配额(周配额剩)与模型调用次数(`×N`)等噪音信息。
- **视觉统一**:金额字重与配色统一,与整体主题一致。

### 修复
- 状态栏不再依赖"当前选中的模型"判定显示,而是**按会话实际用到的模型 / 订阅**决定,修复多会话切换时显示错误、订阅会话显示为 ¥0 的问题。
- 热力图悬停浮层在格子靠近左 / 右 / 顶边界时自适应定位,不再被容器裁剪。

---

## v1.2.0(此前)

- 支持视觉模型 (`deepseek-v4-flash-vision-exp`) 定价;
- 订阅计费修复;
- 新增启动日志开关;
- 新增三套图表配色(橙→黄 / 蓝→紫 / 蓝→浅蓝)。
