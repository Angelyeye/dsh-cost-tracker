<div align="center">

# <img src="./docs/icon-mark.svg" width="30" valign="bottom" alt="icon"> DSH Cost Tracker · 花费统计

**DEEPSEEK HARNESS LLM 花费与用量统计插件**

**简体中文** | [English](./README.en.md)

[![version](https://img.shields.io/npm/v/@angelyeye/dsh-cost-tracker?label=version&style=flat-square)](https://www.npmjs.com/package/@angelyeye/dsh-cost-tracker)
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
| ⏰ | **峰谷定价** | 内置单价表,高峰时段(北京时间周一至周五 9:00–12:00、14:00–18:00)与闲时半价自动区分,**周末全天计为闲时**,本地模型(ollama 等)计 0;**单价表按「计费时代」分版**,北京时间 2026-09-10 12:00 起自动切换为 V4.1 Flash 新价(2.0 / 0.04 / 8.0 高峰),并按官方规则把旧 V4-Flash 系请求路由到 V4.1 Flash 计费;**V4-Pro 自 2026-09-14 12:00 起才路由**(此前仍按自有牌价 9.0 / 27.0 / 0.30) |
| 🔔 | **峰谷计价提示** | 设置页「峰谷计价与提示」面板:当前档位/距下次切换倒计时时段条、样式切换(**简洁单行·按24h比例** / **环形表盘·相位色点**)、简洁样式可选**双行紧凑**(上下布局,条上文下/文上条下)、「显示时间」开关、峰/谷切换前弹窗提醒与浏览器系统通知、提前提醒分钟、弹窗位置(右下角/屏幕中心)、提醒类型;侧边栏底部常驻显示时段条(窄栏/展开自适应)。对齐 `dsh-cost-meter` 交互 |
| 📌 | **六组概览卡** | 设置页顶部六张卡:今日费用 / 本月费用 / 总花费 / API 请求次数 / Tokens / **总余额**。前三个金额卡**不含订阅会员等效费用**,订阅以附注展示 |
| 👁️ | **视觉模型** | 支持 `deepseek-v4-flash-vision-exp`:legacy 时代单价与 flash 一致,2026-09-10 12:00 起随 V4.1 Flash 新价计费(该旧名已下线,请求由 V4.1 Flash 提供);图片按官方规则换算 token(每张上限 384 个,以接口用量计费) |
| 🏷️ | **官方模型名对齐** | 计费支持**官方现役名 `deepseek-flash`**(价格卡脚注 (1):「模型名请使用 `deepseek-flash`」),旧写法 `deepseek-v4.1-flash` 等归一化后命中同一档价,避免因官方改名而落入兜底估算 |
| 📊 | **可视化仪表盘** | 设置页新增「花费统计」:概览卡片、消费柱状图(按峰谷/按模型)、分模型的请求次数与 Tokens 图表,**全部支持鼠标悬停查看明细** |
| 🧭 | **多机汇总(云端同步)** | 可对接**自建云端服务**(独立仓库 `dsh-cost-cloud`,零运行时依赖):多台电脑的用量汇总到一处,看板顶部出现 **本机 / 本机+云端 / 仅云端** 三态开关,并支持**设备 × Agent 矩阵**(行合计 = 列合计 = 总计);上报内容仅 token 数、费用、时间戳与标识符,可选会话脱敏 |
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

## 安装(三选一)

> 前提:你已经在用 `dsh web`(DSH 的 Web 模式)。`~/.dsh` 即 DSH 的数据目录(如设置了 `DSH_HOME` 环境变量则指向该目录)。
>
> 走方式一时请注意:插件市场本身要求 `dsh web ≥ 0.1.0-rc.6`,更旧的宿主里根本不会出现「插件市场」这一项——那种情况请用方式二或方式三。

### 方式一:从插件市场安装(推荐)

本插件已收录于 [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 精选列表(分类 `usage`)。在 DSH 里打开 **设置 → 插件市场**,搜索 `dsh-cost-tracker` 点安装即可;市场展示的等价命令行是:

```bash
dsh plugin --profile web add @angelyeye/dsh-cost-tracker
```

> 也可以直接按仓库安装:`dsh plugin --profile web add github:Angelyeye/dsh-cost-tracker`。装出来是同一个包——包名以包自己声明的 `package.json` 为准,所以图行 id、以及随之而来的客户端注册要求,两种装法完全一致。

市场会把插件装进当前 profile 并自动写好 loader 配置,**装的是市场上架的最新版本**,装完按提示重启 `dsh web`、刷新浏览器,无需手工 `git clone`,也不用自己改 patch 文件。

### 方式二:让 DSH 帮你装(不懂命令行也能用)

打开 DSH 的任意会话,把下面这段话**原样粘贴**发送给 Agent 即可:

```
请帮我安装 DSH 插件 @angelyeye/dsh-cost-tracker:
1. git clone https://github.com/Angelyeye/dsh-cost-tracker.git 到 ~/.dsh/profiles/node_modules/@angelyeye/dsh-cost-tracker(目录名必须与包名一致)
2. 在 ~/.dsh/profiles/web/cordis.patch.yml 顶层数组追加一行:
   - insert:
       - id: dsh-cost-tracker
         name: "@angelyeye/dsh-cost-tracker"
3. 完成后告诉我,我自己重启 dsh web
```

看到提示后,在终端按 `Ctrl+C` 停掉 `dsh web`,再重新运行 `dsh web`,刷新浏览器即可。

### 方式三:手动安装(3 条命令)

```bash
# 1. 下载插件(目录名必须与包名一致)
mkdir -p ~/.dsh/profiles/node_modules/@angelyeye
git clone https://github.com/Angelyeye/dsh-cost-tracker.git ~/.dsh/profiles/node_modules/@angelyeye/dsh-cost-tracker

# 2. 注册插件(往 patch 文件里追加配置)
cat >> ~/.dsh/profiles/web/cordis.patch.yml <<'EOF'
- insert:
    - id: dsh-cost-tracker
      name: "@angelyeye/dsh-cost-tracker"
EOF

# 3. 重启 DSH(先 Ctrl+C 停掉当前 dsh web,再执行)
dsh web
```

### 验证安装成功

1. 浏览器打开 DSH Web GUI → 左下角 **设置** → 侧边栏出现 **「花费统计」**;
2. 聊天输入框下方出现一行花费状态条;
3. 对 Agent 说一句"查一下我现在的花费",能正常回答即全部就绪。

> ⚠️ 如果 `~/.dsh/profiles/web/cordis.patch.yml` 里已有其他内容,请保留原有行,只追加上面那段;该文件顶层必须是 YAML 数组(每行以 `- ` 开头)。

### 从旧包名迁移(仅 v1.6.0 及更早的安装需要)

v1.7.0 起包名由 `dsh-cost-tracker` 改为 `@angelyeye/dsh-cost-tracker` —— 因为 npm 上原名已被他人占用,而市场的 npm 映射要求「已发布的包名 = 仓库 `package.json` 的 `name`」。

> ⚠️ **v1.7.0 的迁移指引已更正**:v1.7.0 存在客户端注册名缺陷(详见 [`CHANGELOG.md`](./CHANGELOG.md) 的 v1.7.1 条目),**任何安装方式装出来的 v1.7.0 都无法加载客户端**。请直接装 **v1.7.1 或更高版本**,不要用重装 v1.7.0 的方式排障 —— 按仓库装同样不行(包名一样,图行 id 一样,问题出在 bundle 内部)。

⚠️ **不要只是"再装一次新版"**:新旧两份的 `cordis.patch.yml` 用的是**同一个 loader id**(`dsh-cost-tracker`),叠加安装会让**两份同时被加载** —— 表现为重复的 HTTP 路由、Agent 工具与 UI 插槽。必须先清掉旧的:

**市场安装的**(用 `dsh plugin add` 装的):

```bash
dsh plugin --profile web remove dsh-cost-tracker
dsh plugin --profile web add @angelyeye/dsh-cost-tracker
```

**手工 clone 装的**:

```bash
# 1. 编辑 ~/.dsh/profiles/web/cordis.patch.yml,删除 id 为 dsh-cost-tracker 的那段 - insert:(共 4 行)
# 2. 删除旧目录
rm -rf ~/.dsh/profiles/node_modules/dsh-cost-tracker
# 3. 再按上面的「方式一」重新安装一次
```

> 提示:清理旧目录后,如果 `cordis.patch.yml` 里那段 `- insert:` 没删掉,DSH 启动时会因为找不到模块名 `dsh-cost-tracker` 而解析失败。两者要一起处理。

**数据不会丢**:用量记录在 `~/.dsh/storages/cost-tracker-records.json`,与插件目录、包名、安装方式全都无关。

---

## 使用说明

### 设置页「花费统计」

- **时间范围**:右上角可切换近 7 天 / 近 30 天 / 全部;
- **六组概览卡**:今日费用 / 本月费用 / 总花费 / API 请求次数 / Tokens / **总余额**。前三个金额卡**不含订阅会员等效费用**,订阅以附注展示;
- **消费金额图**:支持「按峰谷」「按模型」两种分段方式,鼠标悬停查看当日明细;
- **配色切换**:「按模型」视图下,消费金额标题旁有三套装色款条(橙→黄 / 蓝→紫 / 蓝→浅蓝)可切换;模型按总消费降序排名取色(第 1 名最深夜底、逐级变浅,不循环不撞色),选择保存在浏览器本地;
- **分模型区块**:每个模型一张请求次数图 + 一张 Tokens 构成图(输入/缓存写入/输出/缓存命中);
- **Token 用量统计热力图**:类 Codex 的 26 周每日用量方格,颜色深浅按当日 token 相对最大值分档;悬停任一格看该日明细(输入 / 缓存 / 输出 / 费用),今天高亮描边;
- **峰谷计价与提示**:时段条样式可选(**简洁单行·按 24h 比例**(白色实时进度线) / **环形表盘·相位色点**),简洁样式可选**双行紧凑**(条上文下 / 文上条下),可开关「显示时间」刻度(00:00–21:00),设置峰/谷切换前的弹窗提醒提前量(1–30 分钟)、提醒类型(两者 / 进入高峰 / 进入闲时)、弹窗位置(右下角 / 屏幕中心)与浏览器系统通知;全部自动保存。侧边栏底部常驻时段条显示当前档位与下次切换倒计时;
- **导出 CSV**:导出明细记录(近 180 天)+ 日汇总行(`purpose=rollup`)。

### 对话中的 Agent 工具

| 工具 | 作用 | 你可以这样问 |
| --- | --- | --- |
| `cost_stats` | 查询花费与用量统计（`scope=local`（默认，仅本机）/ `cloud`（云端多机汇总）/ `both`） | "我今天花了多少钱?" · "我所有电脑加起来花了多少?" |
| `cost_prices` | 查看内置单价表与峰谷规则 | "现在 deepseek-v4-flash 什么价?" |
| `cost_peak` | 查询当前峰谷档位与下次切换倒计时 | "现在是不是高峰时段?" |
| `cost_recompute` | **按计费时代重算已入库记录的费用(一次性补账)**,默认只试算 | "把价格调整前的记录按新价重算一下" |
| `cost_sync` | **云端同步**：查看状态 / 立即同步 / 测试连接 / 改配置 | "把花费同步到云端" · "云端同步正常吗?" |
| `cost_reset` | **清空全部统计数据(不可恢复)** | "把花费统计清零" |

### 多机汇总（云端同步，v1.8.0）

在多台电脑上使用时，把用量汇总到**自建云端服务**，即可在任一机器上查看全网合计，并按「设备 × Agent」拆分。

**部署云端服务**（独立仓库，零运行时依赖）：

```bash
git clone <你的仓库地址> dsh-cost-cloud && cd dsh-cost-cloud
cp .env.example .env      # 填 SESSION_SECRET 与 ADMIN_PASSWORD_HASH（node scripts/hash-password.js "口令"）
docker compose up -d      # 打开 http://<服务器>:8787 ，在「设置」页生成共享引导令牌
```

**在每台设备上配置**：打开 **设置 → 插件 → 插件配置 → 花费统计**，填写：

| 字段 | 说明 |
| --- | --- |
| 设备名 | 该机器在看板上显示的名字（如「办公台式机」） |
| 服务地址 | 云端地址，如 `https://cost.example.com` |
| 共享令牌 | 云端「设置」页生成的 `dshc_...` |
| 同步间隔 | 默认 60 秒 |

然后点 `测试连接` → `立即同步`。回到 **设置 → 花费统计**，顶部会出现三态开关：

| 视图 | 含义 |
| --- | --- |
| **本机** | 只统计这台电脑（与未启用云端时完全一致） |
| **本机+云端** | 本机 + **其他整机的全部** + **本机上其它 agent**（服务端并集口径，不重复计数） |
| **仅云端** | 以云端记录为准（含本机已同步部分） |

> 「本机+云端」的服务端口径是**并集**：`其他整机` ∪ `本机上的非 dsh 来源`。
> 因此多机 + 多 agent 混用时，本机的 DSH 数字来自本地，本机上的 ZCode/Codex 等来自云端，其他电脑全部来自云端 —— 三者相加恰好等于全网，不重不漏。

配合「维度」下拉还能看 **按机器 / 按 Agent / 按模型** 的拆分，以及**设备 × Agent 矩阵**（行合计 = 列合计 = 总计）。

**其它 agent 也能接入**：云端的上报协议是开放的，任何 agent 的统计插件按 `dsh-cost-cloud` 仓库的 `docs/INGEST-API.md` 实现即可接入，云端无需改动，看板会自动出现新的 Agent 列。
**关键约定**：同一台机器上的所有 agent 必须共用同一个 `machineId`（共享文件 `~/.dsh-cost/device.json`），否则会被统计成多台设备。

**隐私**：只上报 token 数量、费用、时间戳与标识符（不涉及 prompt / 回复 / 文件内容）；可在配置卡开启「会话脱敏」（`sessionId` 上报前替换为不可逆哈希）与「不含 purpose」。

### HTTP API(供其他工具调用)

全部为 `POST` + JSON,监听本机地址:

```
POST /api/cost-tracker/summary      概览(含本会话按模型拆分 / 订阅)
POST /api/cost-tracker/dashboard    仪表盘数据
POST /api/cost-tracker/usage        用量热力图(全时段累计 + 按天 token 聚合)
POST /api/cost-tracker/peak         峰谷相位快照(当前档位/下次切换/配置)
POST /api/cost-tracker/peak-config  保存峰谷计价提示配置
POST /api/cost-tracker/sync         云端同步状态(设备 ID/水位/待上报/最近错误)
POST /api/cost-tracker/sync-now     立即同步(传 {"full":true} 全量补传)
POST /api/cost-tracker/sync-test    测试云端连接
POST /api/cost-tracker/sync-config  保存云端同步配置
POST /api/cost-tracker/cloud        云端只读聚合(route/days/excludeSelf/devices/sources)
POST /api/cost-tracker/kimi-usage   Kimi 订阅配额
POST /api/cost-tracker/balance      账户余额
POST /api/cost-tracker/prices       单价表(按计费时代分版)
POST /api/cost-tracker/recompute    按计费时代重算已入库记录(默认只试算,传 {"apply":true} 落盘)
POST /api/cost-tracker/export       导出 CSV
```

示例:`curl -X POST http://127.0.0.1:3080/api/cost-tracker/summary -d '{}'`

---

## 更新记录

> 这里只列重要版本;逐版完整记录见 [`CHANGELOG.md`](./CHANGELOG.md)。

### v1.8.10(2026-09-17)

**修复：Windows 上落盘偶发 `EPERM`（rename 被瞬时占用），启动日志出现吓人的堆栈**

- **现场**：重启 `dsh web` 时打印 `cost tracker persist failed Error: EPERM: operation not permitted, rename '...cost-tracker-records.json.tmp' -> '...cost-tracker-records.json'`，附完整调用栈。**数据没丢**（内存里还在、随后自动写成功），但这段堆栈看起来像崩溃。
- **根因**：`persist()` 是「写临时文件 → rename 覆盖」，但**只尝试一次**。Windows 上 rename 需要**目标文件的删除权限**，以下情况都会瞬时失败：杀毒 / 搜索索引器刚扫过临时文件；资源管理器预览或备份/同步工具正在读它；**上一个 dsh 实例还没退干净**（或同时跑了两个实例）。旧实现还固定用 `<file>.tmp` 作临时文件名，两个实例必然抢同一个名字。
- **修法**：
  - 临时文件名带 **pid**；rename 遇 `EPERM/EACCES/EBUSY` **退避重试**（20/40/80/160ms，共 5 次 ≈ 0.35s），`ENOENT` 等代码类错误不重试；
  - 应用层（`index.js`）再排 **3 次延迟重试**（2s/4s/6s），覆盖「杀毒扫描持续数秒」这种同步重试兜不住的情况；**重试链走完之前不打日志**，彻底放弃时才打印一次「原因 + 影响」说明；
  - 仍失败**不做**「直接覆盖写」：那会让并发读方看到半个 JSON，而 `load()` 读到半个 JSON 会把文件改名为 `.corrupt-*` 并清空，损失远大于晚几秒落盘；数据留在内存，等下一次写入自动重试；
  - 退出前最后一次落盘给足重试（10 次 ≈ 2s），避免被瞬时占用就丢掉本次会话的记录。
- **实测**（真实 Windows 文件锁）：持续占用 → 重试后放弃、**原文件字节不变**、无残留临时文件、日志为三行可读说明；持锁 120ms 后释放 → 第 3 次尝试成功落盘，**无需人工干预**。

### v1.8.9(2026-09-17)

**修正档位文案：「平峰」→「不分峰谷」，且为 0 时不再占图例**

- **问题**：按峰谷图的图例第三项写作「平峰」（内部 `period='flat'` 的直译）。官方定价**只有两档**——高峰（工作日 9:00-12:00、14:00-18:00）与闲时（高峰 × 0.5，周末全天闲时）；`flat` 的真实含义是「**这笔计价不分峰谷**」（`price.tiered === false`：订阅套餐、非 DeepSeek provider 的兜底价、未识别模型的通用兜底价）。中文电价语境里「平峰/平段」指峰谷之间的**第三个时段**，放在这里会让人以为 DeepSeek 有三档价。
- **另一层误导**：该项常驻图例，即使全区间恒为 0（只跑 DeepSeek 按量调用时的真实情况）也要占一个色块，进一步强化「存在第三个时段」的错觉。
- **修法**：图例、最近记录「时段」列（`periodText()`）与 `cost_peak` 查询输出统一改为「**不分峰谷**」；图例与柱状图**仅在该窗口内 flat 合计 > 0 时**才带上第三项，其余情况只留 高峰 / 闲时 两项。计费口径与 `flat` 字段不动，只改措辞与显示条件。
- **测试**：`test/client-render.test.js` 新增 `[6]` 段（6 条断言）——渲染文本必须含「不分峰谷」且不含「平峰」；把样本 `flat` 置 0 后图例不得再出现第三项，而高峰 / 闲时仍在。样本 `recent` 同时补成两条真实记录（`peak` / `flat` 各一），否则「时段」列根本不会被渲染 —— 这正是该文案长期没被测到的原因。

### v1.8.8(2026-09-15)

**修复：「仅云端」视图只有次数、费用整列 ¥0.0000**

- 云端按量金额字段是 `realCost`、订阅等效是 `subEquivalent`，本地卡片读的是 `real` / `sub`；客户端归一化只透传原字段（`summary` 甚至整个丢掉），于是金额全 0、`calls/tokens` 因同名而正常。**测试里的云端假数据误用了 `real/sub`，把缺陷掩盖了**，现已改为线上真实形状。
- `view.js` 新增 `cloudSlices()` 逐项映射（兼容 `realCost/real`、`subCost/subEquivalent/sub` 三种写法），`summary` 行同步映射。

**新增：云端 `GET /api/v1/plugin-view`（设备令牌可读），让「仅云端」也能画图**

- 该接口返回与本地 `buildDashboard` **同字段名**的完整形状（`today/month/all` + `byDay/byModel/byModelDay/recent`），并支持 `union` 并集。插件探测 `/api/v1/health` 的 caps 后优先使用，旧云端自动回退 `overview`（金额可用、图表为空）。
- 顺带修掉云端同源缺陷：`pluginView` 的今日/本月/总花费原取自全表无过滤统计，**绕过了 `excludeDevice`**（「本机+云端」会把本机算两次）；现按同一过滤条件取切片，`calls/tokens` 只含按量、订阅另计。
- 需云端 **1.2.0+** 才有该接口；未部署时插件自动回退，金额修复不依赖云端升级。

### v1.8.7(2026-09-15)

**修复：`cost_recompute` 默认只扫描「最近一个价格时代」，更早的陈旧记录被静默跳过**

- v1.8.6 补账后本机仍有 **750 条 `deepseek-flash` 记录停留在「估算」标记**（时间落在 09-10 21:24 ～ 09-14 02:36）：旧默认 `since` 取**最近一个价格时代的生效时刻**（`v41pro` = 09-14 12:00），该时刻之前的记录一条都没进扫描，而提示却是「没有需要重算的记录」。
- 默认改为**全时段扫描（`since = 0`）**；`since: 0` 现被正确识别为全时段（旧版因 `> 0` 判断会回落），全时段时 `era` 返回 `null` 不再误报单一时代。补账幂等，全扫代价可忽略。
- 本机实测：`scanned=1642 / changed=772 / estimatedFlips=750 / delta=0.0000`，再跑一次 `changed=0`；**1643 条 `deepseek-flash` 的「估算」标记清零、金额未变**（仅 Kimi 订阅的 5 条仍为估算，属正常）。
- 加固：`client-registration.test.js` 新增版本号一致性断言（`package.json` 版本必须等于 `index.js` 的 `PLUGIN_VERSION`，v1.8.6 发布时二者曾漂移）。

### v1.8.6(2026-09-15)

**修复：计费规则与官方定价的两处口径偏差**（核查基准：官方[价格卡](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) + [V4.1 Flash 发布通告](https://api-docs.deepseek.com/zh-cn/news/news260910)）

- **V4-Pro 路由时刻提前了 4 天（会低估花费）**：旧实现把 `deepseek-v4-pro → V4.1 Flash` 的路由与 Flash 调价合并为同一时刻（09-10 12:00），而官方口径是「北京时间 **2026-09-14 12:00** 之后」才路由。这 4 天内的 V4-Pro 调用会被低估约 4.5 倍。现拆出时代 `v41pro`（`V41_PRO_ROUTE_AT = 2026-09-14T04:00:00Z`），`v41` 时代保留 V4-Pro 自有牌价 9/27/0.30。
- **官方现役名 `deepseek-flash` 未进精确表（会被误标「估算」）**：官方要求使用 `deepseek-flash`，旧代码的规范名却是不可调用的 `deepseek-v4.1-flash`，导致现役名走 provider 兜底——金额分毫不差，但记录被标 `estimated: true`（本机 1402 条全部中招）。现以 `deepseek-flash` 为规范名，并加别名归一表（`MODEL_ALIASES`）。
- **`cost_recompute` 不再漏判「仅标记变化」**：返回值新增 `estimatedFlips`，输出会写明「其中 N 条仅订正『估算』标记，金额不变」。
- **已入库记录金额零变化**：仅 `estimated` 标记、V4-Pro 在 09-10～09-14 的口径、以及历史 `deepseek-v4.1-flash` 记录（22 条）与 `deepseek-flash` 的桶名归并变化；建议执行一次 `cost_recompute`（默认试算，`apply: true` 落盘）。

### v1.6.0(2026-09-10)

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

### v1.5.2(2026-08-25)

**新增**
- **「简洁」时段条新增「双行紧凑(上下布局)」选项**:时段条样式为「简洁(单行紧凑)」时可勾选,勾选后由左右单行改为上下两行,并可进一步选择「时段条在上·文字在下」(默认)或「文字在上·时段条在下」;侧边栏与设置页预览同步生效。
- 新增 `peakCompactStack`(默认 `false`)与 `peakCompactOrder`(`bar-first` / `text-first`,默认 `bar-first`)配置项,纳入 `defaultPeakConfig` / `normalizePeakConfig` 与配置层单元测试。

**修复**
- 双行紧凑下轨道的 `flex-basis(72px)` 落到纵轴,时段条被拉成 72px 高;已覆盖为 `flex: 0 0 auto`,保持与单行一致的 6px 细条。

### v1.5.1(2026-08-24)

**修复**
- **侧边栏底部(sidebar.footer.action)与多插件 UI 兼容**:DSH 渲染器把该槽锚点设为 `display:contents`,多个插件内容会被并进同一行(如与 `linxin666/dsh-web-ui-all` 冲突);改为纵向堆叠后,本插件的时段条与其它 footer 插件共存不重叠。

### v1.5.0(2026-08-24)

**新增**
- **峰谷「时段条样式」新增「环形表盘(24h 中空圆环)」**(替代原「经典(两行)」):按 24h 划分(0:00 顶部、6:00 右、12:00 底、18:00 左),橙色 = 高峰时段(9:00–12:00、14:00–18:00)、蓝色 = 平价时段,周末整环无橙色(全天谷价);共 12 档「当前时刻」指针式样可选,默认采用**相位色点**(峰橙 / 平蓝 / 周末绿),不再使用从圆心连到边缘的长指针;圆心显示当前相位词 + 距下次切换倒计时。
- **「显示时间」开关**(仅环形表盘):控制是否显示 00:00–21:00 小时刻度,默认开启。
- **「简洁(单行紧凑)」时段条改为按 24h 比例划分**:蓝色平价底条铺满 24h,橙色高峰段按窗口比例定位(9:00–12:00 → 37.5%–50%,14:00–18:00 → 58.33%–75%),白色分割线标出「当前时间」实时进度;周末仅蓝底 + 白线。

**改进**
- 后端 `peakSnapshot()` 新增下发结构化窗口数组 `peakHours`(`PEAK_HOUR_WINDOWS`),前端据此绘制比例轨道/圆弧,与 `isPeak`/`peakPhaseAt` 计费口径一致;前端内置兜底窗口 `[9,12]` / `[14,18]`。
- 新增 `peakShowTickLabels` 配置项(默认 `true`),纳入 `defaultPeakConfig` / `normalizePeakConfig`。
- 新增设计文档 `docs/peak-dial-design.md` 与可交互预览页 `docs/peak-dial-preview.html`(含 12 档指针式样对比)。

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
不会。记录防抖写入磁盘(临时文件 + rename 原子替换),重启后自动恢复;文件损坏时自动备份为 `.corrupt-<时间戳>` 并从头开始。
落盘遇到**瞬时占用**(Windows 上杀毒 / 索引器 / 备份工具正在读该文件,或上一个 `dsh` 实例还没退干净)时会**退避重试**;重试仍失败则数据留在内存、稍后自动重试,**不会写坏原文件**。若反复出现,请确认没有同时运行两个 DSH 实例。

**Q:历史记录会保留多久?统计有上限吗?**
明细记录保留最近 **180 天**;更早的记录自动按「天 + 模型」压缩为**永久日汇总**(只保留聚合数字:调用数 / 各段 tokens / 费用,不再保留单次调用)。因此「全部」时间的总花费、分模型统计**永远精确**,且内存、磁盘、写入量有界,跑多久都不会膨胀。按天图表日期轴最长 730 天。数据文件支持旧版格式自动迁移;可用环境变量 `DSH_COST_TRACKER_STORE` 覆盖存储路径(默认 `$DSH_HOME/storages`,未设 `DSH_HOME` 时为 `~/.dsh`)。

**Q:启动日志怎么开启/关闭?**
插件默认**静默启动**,不打印日志。设置环境变量 `DSH_COST_TRACKER_LOG=1`(或 `true` / `yes` / `on`)可启用启动日志:nav-icon 自检结果、数据恢复报告(`restored N detail records ...`)、就绪标记。**错误日志**(持久化失败、文件损坏等)始终打印,不受此开关影响。

**Q:订阅套餐(kimi-coding)的"等效费用"是什么意思?**
订阅制不按量扣费。插件按内置单价估算出"如果这些调用走按量计费会花多少钱",仅供你评估订阅是否划算,**不是真实扣费**。

**Q:金额和官方账单对不上?**
插件在本地按内置单价表估算,可能与官方实际计费存在细微差异(如官方价格调整、阶梯定价)。精确金额请以官方账单为准。余额以「余额查询」实时拉取的官方数据为准。

**Q:如何卸载?**
1. **先摘掉 loader 条目**——市场安装的:打开 **设置 → 插件市场 → 已安装** 点卸载;手工安装的:打开 `~/.dsh/profiles/web/cordis.patch.yml`,删除 `dsh-cost-tracker` 那段 `- insert:`(共 4 行),或直接让 DSH Agent 帮你删;
2. 重启 `dsh web`;
3. 可选:删除插件目录 `~/.dsh/profiles/node_modules/@angelyeye/dsh-cost-tracker` 和数据文件 `~/.dsh/storages/cost-tracker-records.json`。

**Q:如何更新插件?**
- **市场安装的**:打开 **设置 → 插件市场 → 更新**,或重新执行 `dsh plugin --profile web add @angelyeye/dsh-cost-tracker`;
- **手工安装的**:进入插件目录执行 `git pull`。

两种情况更新后:只改了界面(client.js)的话**硬刷新浏览器**(Cmd/Ctrl+Shift+R)即可;改了 index.js 则需要重启 `dsh web`。

## 仓库结构

```
├── index.js        Host 半端:用量采集、聚合、HTTP API、Agent 工具
├── store.js        存储层:明细保留 + 永久日汇总 + 原子落盘(含占用重试,纯逻辑可独立测试)
├── pricing.js      定价与 Token 层:单价表、峰谷计价、视觉模型、峰值相位(纯逻辑,可独立测试)
├── config.js       配置层:峰谷计价提示 + 云端同步的默认值与规范化(纯逻辑,可独立测试)
├── sync.js         云端同步引擎:设备身份、增量水位、幂等批次、退避重试
├── schema.js       宿主设置空间的 schema(插件配置卡片字段)
├── view.js         三态视图合并:本机 / 本机+云端 / 仅云端的口径归一化(浏览器与测试共用)
├── client.js       Client 半端:设置页仪表盘、状态栏与峰谷提示 UI
├── package.json    插件清单:声明 dsh.bundle(插件可被安装的关键)与 dsh.client(前端 UI)
├── cordis.patch.yml Bundle 补丁:把本插件注册进 DSH 的 loader,由 dsh.bundle 指向
├── screenshots.json 插件市场详情页的截图清单(相对路径,1-8 张)
├── README.md       中文说明文档
├── README.en.md    英文说明文档
├── CHANGELOG.md    更新记录(中文)
├── test/           单元测试(storage / pricing / config / recompute / 渲染 / 云端读取,node test/*.test.js)
└── docs/           README 截图与设计文档
```

## License

[MIT](./LICENSE) · 欢迎 Issue 与 PR
