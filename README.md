<div align="center">

# <img src="./docs/icon-mark.svg" width="30" valign="bottom" alt="icon"> DSH Cost Tracker · 花费统计

**DEEPSEEK HARNESS LLM 花费与用量统计插件**

**简体中文** | [English](./README.en.md)

![version](https://img.shields.io/badge/version-v1.4.1-blue?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![status](https://img.shields.io/badge/status-stable-brightgreen?style=flat-square)
![platform](https://img.shields.io/badge/platform-DSH%20Web-blueviolet?style=flat-square)
[![GitHub stars](https://img.shields.io/github/stars/Angelyeye/dsh-cost-tracker?style=flat-square)](https://github.com/Angelyeye/dsh-cost-tracker/stargazers)

</div>

---

> 一个为 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 打造的 LLM 花费统计插件:自动记录每一次 API 调用的 Token 用量与费用(人民币),**原生支持 DeepSeek 官方峰值价格计费(高峰 / 闲时半价自动区分)与 Kimi Coding Plan 订阅套餐的用量及等效费用统计**。设置页可视化仪表盘、图表悬停明细、对话内 Agent 查询、账户余额与订阅配额监控,数据全部本地持久化——重启不丢、卸载无痕。

> An LLM cost-tracking plugin for [DeepSeek Harness](https://github.com/deepseek-ai/dsh): records token usage and cost (CNY) for every API call, with **native support for DeepSeek's official peak/off-peak pricing and Kimi Coding Plan subscription usage & equivalent-cost statistics**. Visual settings dashboard with hover tooltips, in-chat agent queries, balance & quota monitoring — all persisted locally.

![花费统计仪表盘:概览卡片 + 按峰谷分段的消费柱状图,悬停显示明细](docs/screenshots/dashboard-overview.png)

---

## 它能做什么?

| | 功能 | 说明 |
| --- | --- | --- |
| 💰 | **花费统计** | 每一次 API 调用自动记账:输入 / 输出 / 缓存命中 / 缓存写入 Tokens 与费用(缓存写入按缓存命中价计),按天、按模型聚合 |
| ⏰ | **峰谷定价** | 内置单价表,高峰时段(北京时间周一至周五 9:00–12:00、14:00–18:00)与闲时半价自动区分,**周末全天计为闲时**,本地模型(ollama 等)计 0 |
| 🔔 | **峰谷计价提示** | 设置页「峰谷计价与提示」面板:当前档位/距下次切换倒计时时段条、样式切换(简洁/经典)、峰/谷切换前弹窗提醒与浏览器系统通知、提前提醒分钟、弹窗位置(右下角/屏幕中心)、提醒类型;侧边栏底部常驻显示时段条(窄栏/展开自适应)。对齐 `dsh-cost-meter` 交互 |
| 📌 | **六组概览卡** | 设置页顶部六张卡:今日费用 / 本月费用 / 总花费 / API 请求次数 / Tokens / **总余额**。前三个金额卡**不含订阅会员等效费用**,订阅以附注展示 |
| 👁️ | **视觉模型** | 支持 `deepseek-v4-flash-vision-exp`:单价与 flash 一致,图片按官方规则换算 token(每张上限 384 个,以接口用量计费) |
| 📊 | **可视化仪表盘** | 设置页新增「花费统计」:概览卡片、消费柱状图(按峰谷/按模型)、分模型的请求次数与 Tokens 图表,**全部支持鼠标悬停查看明细** |
| 🔥 | **用量热力图** | 设置页新增「Token 用量统计」:类 Codex 的 **26 周日用量方格热图**,按天着色(输入 / 缓存 / 输出 / 费用),悬停看当日明细、今天高亮描边,顶部显示全时段累计 |
| 📈 | **订阅配额监控** | Kimi Coding Plan 等订阅套餐:本周配额、5 小时滚动窗口限额、等效按量费用参考 |
| 💳 | **余额查询** | 一键查询 DeepSeek 官方账户余额(总余额 / 充值 / 赠送 / 状态) |
| 🤖 | **Agent 工具** | 直接在对话里问:"我现在花了多少钱?"——Agent 会调用 `cost_stats` / `cost_prices` 等工具回答 |
| 🔻 | **状态栏** | 聊天输入框下方实时显示:**本会话花费**(胶囊分段:本会话 / 订阅套餐 / 分模型),按会话实际用到的模型与订阅拆分,**多模型默认折叠只显示 top2,点击展开全部明细**;订阅显示具体套餐名,不再展示配额与调用次数 |
| 💾 | **本地持久化** | 数据存本机 `~/.dsh/storages/cost-tracker-records.json`,重启不丢、不上传;**明细保留最近 180 天,更早自动压缩为永久日汇总,全时段统计永远精确且内存/磁盘有界** |
| 📤 | **CSV 导出** | 一键导出明细 + 日汇总(purpose=rollup),方便用 Excel / Numbers 做进一步分析 |

## 界面展示

**在对话中直接查询**——Agent 自带花费/余额/单价工具,边聊边查:

![对话中查询花费与余额,输入框下方显示实时花费状态栏](docs/screenshots/chat-tools.png)

**订阅套餐与账户余额**——配额进度条、重置倒计时、余额一目了然:

![Kimi Coding Plan 配额监控与 DeepSeek 账户余额](docs/screenshots/subscription-balance.png)

**分模型明细**——每个模型的请求趋势、Token 构成,悬停显示每日明细:

![单个模型的请求次数面积图与 Tokens 堆叠图,悬停提示显示完整日期与分段数值](docs/screenshots/model-detail.png)

---

## 安装(二选一)

> 前提:你已经在用 `dsh web`(DSH 的 Web 模式)。`~/.dsh` 即 DSH 的数据目录(如设置了 `DSH_HOME` 环境变量则指向该目录)。

### 方式一:让 DSH 帮你装(推荐,不懂命令行也能用)

打开 DSH 的任意会话,把下面这段话**原样粘贴**发送给 Agent 即可:

```
请帮我安装 DSH 插件 dsh-cost-tracker:
1. git clone https://github.com/Angelyeye/dsh-cost-tracker.git 到 ~/.dsh/profiles/node_modules/dsh-cost-tracker(目录名必须叫 dsh-cost-tracker)
2. 在 ~/.dsh/profiles/web/cordis.patch.yml 顶层数组追加一行:
   - insert:
       - id: cost-tracker
         name: dsh-cost-tracker
3. 完成后告诉我,我自己重启 dsh web
```

看到提示后,在终端按 `Ctrl+C` 停掉 `dsh web`,再重新运行 `dsh web`,刷新浏览器即可。

### 方式二:手动安装(3 条命令)

```bash
# 1. 下载插件(目录名必须与包名一致)
mkdir -p ~/.dsh/profiles/node_modules
git clone https://github.com/Angelyeye/dsh-cost-tracker.git ~/.dsh/profiles/node_modules/dsh-cost-tracker

# 2. 注册插件(往 patch 文件里追加配置)
cat >> ~/.dsh/profiles/web/cordis.patch.yml <<'EOF'
- insert:
    - id: cost-tracker
      name: dsh-cost-tracker
EOF

# 3. 重启 DSH(先 Ctrl+C 停掉当前 dsh web,再执行)
dsh web
```

### 验证安装成功

1. 浏览器打开 DSH Web GUI → 左下角 **设置** → 侧边栏出现 **「花费统计」**;
2. 聊天输入框下方出现一行花费状态条;
3. 对 Agent 说一句"查一下我现在的花费",能正常回答即全部就绪。

> ⚠️ 如果 `~/.dsh/profiles/web/cordis.patch.yml` 里已有其他内容,请保留原有行,只追加上面那段;该文件顶层必须是 YAML 数组(每行以 `- ` 开头)。

---

## 使用说明

### 设置页「花费统计」

- **时间范围**:右上角可切换近 7 天 / 近 30 天 / 全部;
- **消费金额图**:支持「按峰谷」「按模型」两种分段方式,鼠标悬停查看当日明细;
- **配色切换**:「按模型」视图下,消费金额标题旁有三套装色款条(橙→黄 / 蓝→紫 / 蓝→浅蓝)可切换;模型按总消费降序排名取色(第 1 名最深夜底、逐级变浅,不循环不撞色),选择保存在浏览器本地;
- **分模型区块**:每个模型一张请求次数图 + 一张 Tokens 构成图(输入/缓存写入/输出/缓存命中);
- **Token 用量统计热力图**:类 Codex 的 26 周每日用量方格,颜色深浅按当日 token 相对最大值分档;悬停任一格看该日明细(输入 / 缓存 / 输出 / 费用),今天高亮描边;
- **导出 CSV**:导出明细记录(近 180 天)+ 日汇总行(`purpose=rollup`)。

### 对话中的 Agent 工具

| 工具 | 作用 | 你可以这样问 |
| --- | --- | --- |
| `cost_stats` | 查询花费与用量统计 | "我今天花了多少钱?" |
| `cost_prices` | 查看内置单价表与峰谷规则 | "现在 deepseek-v4-flash 什么价?" |
| `cost_peak` | 查询当前峰谷档位与下次切换倒计时 | "现在是不是高峰时段?" |
| `cost_reset` | **清空全部统计数据(不可恢复)** | "把花费统计清零" |

### HTTP API(供其他工具调用)

全部为 `POST` + JSON,监听本机地址:

```
POST /api/cost-tracker/summary      概览(含本会话按模型拆分 / 订阅)
POST /api/cost-tracker/dashboard    仪表盘数据
POST /api/cost-tracker/usage        用量热力图(全时段累计 + 按天 token 聚合)
POST /api/cost-tracker/peak         峰谷相位快照(当前档位/下次切换/配置)
POST /api/cost-tracker/peak-config  保存峰谷计价提示配置
POST /api/cost-tracker/kimi-usage   Kimi 订阅配额
POST /api/cost-tracker/balance      账户余额
POST /api/cost-tracker/prices       单价表
POST /api/cost-tracker/export       导出 CSV
```

示例:`curl -X POST http://127.0.0.1:3080/api/cost-tracker/summary -d '{}'`

---

## 更新记录

### v1.4.1(2026-08-23)

**修复缓存写入计价并补充 reasoning 计费(对齐官方规则与 dsh-cost-meter)**

- **修复缓存写入(cache write)计价 bug**:原先 `cacheWrite` 被按「缓存未命中价」计费(flash 3.0 / pro 9.0),导致缓存写入量大的会话费用被严重高估。官方规则(及 `dsh-cost-meter`)约定**缓存写入与缓存命中同价**,现统一为 `(cacheRead + cacheWrite) × 缓存命中价`(flash 0.10 / pro 0.30)。
- `computeCost()` 改为 `输入×未命中价 + 输出×输出价 + (缓存读+缓存写)×命中价`,与官方/参考口径完全一致。
- **补充 reasoning(推理)token 计费**:`normalizeTokens()` 新增 `reasoning` 桶(读 `usage.reasoningTokens`),模型单价含 `reasoning` 时按单独单价计费(DeepSeek 当前模型未单独列 reasoning 价,计 0)。
- 同步 `EXACT_MODELS` / `SUBSCRIPTION_RATES` / `PROVIDER_RATES` / `GENERIC_RATES` 的 cacheWrite 值(均改为命中价)。
- 更新 `cost_prices` 工具文案与单元测试(新增「缓存写入按命中价」与「reasoning 计费」用例)。

> 说明:本版只修正**单模型计价规则**;不同插件间「调用次数 / 累计用量」的差异源自统计口径(实时 `llm/stream` 与 DSH 会话投影 `(turn,step)` 粒度不同),不属于计价 bug。

### v1.4.0(2026-08-23)

**新增**
- **峰谷计价提示(对标 dsh-cost-meter)**:设置页新增「峰谷计价与提示」面板——启用峰谷时段价格、峰时高价时段显著提示、时段条样式(简洁/经典)、峰/谷切换前弹窗提醒、提前提醒分钟(1–30)、提醒类型(峰和谷/进入峰/进入谷)、弹窗位置(右下角/屏幕中心)、同步发送系统通知;全部设置即时保存到 `~/.dsh/storages/cost-tracker-config.json`。侧边栏底部常驻显示时段条(当前档位 + 距下次切换倒计时),窄栏(rail)自适应为短词。新增 `POST /api/cost-tracker/peak` 与 `POST /api/cost-tracker/peak-config`,以及 Agent 工具 `cost_peak`。
- **六组概览卡**:设置页顶部改版为六张卡——今日费用 / 本月费用 / 总花费 / API 请求次数 / Tokens / **总余额**。今日、本月、总花费三个金额卡**不含订阅会员等效费用**(订阅以附注展示),本月按北京日历月统计,总花费为全时段累计(明细 + 永久日汇总,永远精确)。

**改进**
- **同步 DeepSeek 最新定价规则**:高峰时段限定为北京时间**周一至周五 9:00–12:00、14:00–18:00**,**周末全天计为闲时(闲时半价)**;`isPeak()` 不再忽略星期几,修复周末被误判为高峰价的问题。
- 峰谷面板时段条对齐参考项目样式:两段轨道(左橙右蓝)+ 标记线 + 单行着色 chip。

**修复**
- 预览弹窗此前强制居中,现已**跟随用户配置的弹窗位置**(右下角/屏幕中心)。

### v1.3.0(2026-08-23)

**新增**
- **Token 用量统计热力图**:设置页新增「Token 用量统计」面板,类 Codex 的 **26 周每日用量方格热图**,颜色深浅按当日 token 相对最大值分 4 档;悬停任一格显示当日明细(输入 / 缓存 / 输出 / 费用),今天高亮描边;顶部显示全时段累计(`累计 X tokens · 输入 · 缓存 · 输出 · N 次调用`)。新增 `POST /api/cost-tracker/usage` 端点。数据日期键统一按北京时间(UTC+8),与服务端口径完全一致。
- **本会话按模型拆分**:状态栏新增按会话实际使用的模型拆分,订阅与按量分开统计。

**改进**
- **状态栏改版**:改为**胶囊分段**布局(本会话 / 订阅套餐 / 分模型),信息清晰、竖线分隔、基线对齐;只显示**本会话花费**,不再显示累计与当前峰/闲时价。
- **订阅去重**:订阅只显示一个着色徽标(具体套餐名 + 总等效费用),不再在模型区重复出现。
- **多模型折叠**:默认只显示消耗 top2 模型 + 数量,点击 `▸` 展开全部模型明细;订阅模型不再混入模型区。
- **显示精简**:去掉配额(周配额剩)与模型调用次数(`×N`)等噪音信息;金额字重与配色统一。

**修复**
- 状态栏不再依赖"当前选中的模型"判定显示,而是**按会话实际用到的模型 / 订阅**决定,修复多会话切换时显示错误、订阅会话显示为 ¥0 的问题。

---

## 常见问题

**Q:数据存在哪里?安全吗?**
全部数据只存在你本机的 `~/.dsh/storages/cost-tracker-records.json`,不会上传到任何服务器。API 只监听本机回环地址,但无鉴权——**不要把 DSH 端口暴露到公网**。

**Q:重启 DSH 数据会丢吗?**
不会。记录防抖写入磁盘(原子写入),重启后自动恢复;文件损坏时自动备份为 `.corrupt-<时间戳>` 并从头开始。

**Q:历史记录会保留多久?统计有上限吗?**
明细记录保留最近 **180 天**;更早的记录自动按「天 + 模型」压缩为**永久日汇总**(只保留聚合数字:调用数 / 各段 tokens / 费用,不再保留单次调用)。因此「全部」时间的总花费、分模型统计**永远精确**,且内存、磁盘、写入量有界,跑多久都不会膨胀。按天图表日期轴最长 730 天。数据文件支持旧版格式自动迁移;可用环境变量 `DSH_COST_TRACKER_STORE` 覆盖存储路径(默认 `$DSH_HOME/storages`,未设 `DSH_HOME` 时为 `~/.dsh`)。

**Q:启动日志怎么开启/关闭?**
插件默认**静默启动**,不打印日志。设置环境变量 `DSH_COST_TRACKER_LOG=1`(或 `true` / `yes` / `on`)可启用启动日志:nav-icon 自检结果、数据恢复报告(`restored N detail records ...`)、就绪标记。**错误日志**(持久化失败、文件损坏等)始终打印,不受此开关影响。

**Q:订阅套餐(kimi-coding)的"等效费用"是什么意思?**
订阅制不按量扣费。插件按内置单价估算出"如果这些调用走按量计费会花多少钱",仅供你评估订阅是否划算,**不是真实扣费**。

**Q:金额和官方账单对不上?**
插件在本地按内置单价表估算,可能与官方实际计费存在细微差异(如官方价格调整、阶梯定价)。精确金额请以官方账单为准。余额以「余额查询」实时拉取的官方数据为准。

**Q:如何卸载?**
1. 打开 `~/.dsh/profiles/web/cordis.patch.yml`,删除 `cost-tracker` 那段 `- insert:`(共 4 行),或直接让 DSH Agent 帮你删;
2. 重启 `dsh web`;
3. 可选:删除插件目录 `~/.dsh/profiles/node_modules/dsh-cost-tracker` 和数据文件 `~/.dsh/storages/cost-tracker-records.json`。

**Q:如何更新插件?**
进入插件目录执行 `git pull`,然后:只改了界面(client.js)的话**硬刷新浏览器**(Cmd/Ctrl+Shift+R)即可;改了 index.js 则需要重启 `dsh web`。

## 仓库结构

```
├── index.js        Host 半端:用量采集、聚合、HTTP API、Agent 工具
├── store.js        存储层:明细保留 + 永久日汇总 + 持久化(纯逻辑,可独立测试)
├── pricing.js      定价与 Token 层:单价表、峰谷计价、视觉模型、峰值相位(纯逻辑,可独立测试)
├── config.js       配置层:峰谷计价提示的默认值与规范化(纯逻辑,可独立测试)
├── client.js       Client 半端:设置页仪表盘、状态栏与峰谷提示 UI
├── package.json    插件清单(含 dsh.client 声明)
├── README.md       中文说明文档
├── README.en.md    英文说明文档
├── CHANGELOG.md    更新记录(中文)
├── test/           存储层单元测试(node test/storage.test.js)
└── docs/           README 截图
```

## License

[MIT](./LICENSE) · 欢迎 Issue 与 PR
