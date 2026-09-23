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
| ⏰ | **峰谷定价** | 内置单价表,高峰时段(北京时间周一至周五 9:00–12:00、14:00–18:00,**不含中国法定节假日**)与闲时半价自动区分,**周末与法定节假日全天计为闲时**(节假日表 2026 全年 33 天,可在配置页覆盖/停用;调休补班的周六周日不计高峰),本地模型(ollama 等)计 0;**单价表按「计费时代」分版**(`legacy` / `v41`),北京时间 2026-09-10 12:00 起自动切换为 V4.1 Flash 新价(2.0 / 0.04 / 8.0 高峰),并按官方脚注把旧 V4-Flash 系请求路由到 V4.1 Flash 计费;**`deepseek-v4-pro` 维持自有牌价 9.0 / 27.0 / 0.30 不做路由**(官方 2026-09-14 撤销了下线计划) |
| 🔔 | **峰谷计价提示** | **设置 → 花费统计 → 右上角齿轮 → 峰谷计价与提示**(v1.9.0 起设置集中在此,改完即可预览;DSH 0.1.7-alpha.2 起入口在「花费统计」页头的齿轮,v1.9.3):当前档位/距下次切换倒计时时段条、样式切换(**简洁单行·按24h比例** / **环形表盘·相位色点**)、简洁样式可选**双行紧凑**(上下布局,条上文下/文上条下)、「显示时间」开关、峰/谷切换前弹窗提醒与浏览器系统通知、提前提醒分钟、弹窗位置(右下角/屏幕中心)、提醒类型;侧边栏底部常驻显示时段条(窄栏/展开自适应)。看板上的同名面板改为只读回显 |
| 📌 | **六组概览卡** | 设置页顶部六张卡:今日费用 / 本月费用 / 总花费 / API 请求次数 / Tokens / **总余额**。前三个金额卡**不含订阅会员等效费用**,订阅以附注展示 |
| 👁️ | **视觉模型** | 支持 `deepseek-v4-flash-vision-exp`:legacy 时代单价与 flash 一致,2026-09-10 12:00 起随 V4.1 Flash 新价计费(该旧名已下线,请求由 V4.1 Flash 提供);图片按官方规则换算 token(每张上限 384 个,以接口用量计费) |
| 🏷️ | **官方模型名对齐** | 计费支持**官方现役名 `deepseek-flash`**(价格卡脚注 (1):「模型名请使用 `deepseek-flash`」),旧写法 `deepseek-v4.1-flash` 等归一化后命中同一档价,避免因官方改名而落入兜底估算 |
| 📊 | **可视化仪表盘** | 设置页新增「花费统计」:概览卡片、消费柱状图(按峰谷/按模型)、分模型的请求次数与 Tokens 图表,**全部支持鼠标悬停查看明细** |
| 🧭 | **多机汇总(云端同步)** | 可对接**自建云端服务**(独立仓库 `dsh-cost-cloud`,零运行时依赖):多台电脑的用量汇总到一处,看板顶部出现 **本机 / 本机+云端 / 仅云端** 三态开关,并支持**设备 × Agent 矩阵**(行合计 = 列合计 = 总计);上报内容仅 token 数、费用、时间戳与标识符,可选会话脱敏 |
| 🔥 | **用量热力图** | 设置页新增「Token 用量统计」:类 Codex 的 **26 周日用量方格热图**,按天着色(输入 / 缓存 / 输出 / 费用),悬停看当日明细、今天高亮描边,顶部显示全时段累计;**跟随三态视图**——「本机+云端 / 仅云端」下自动并入云端按天用量(卡片标题右侧标注当前口径) |
| 📈 | **订阅配额监控** | Kimi Coding Plan、**火山方舟 Coding Plan** 等订阅套餐:配额进度条、重置倒计时、等效按量费用参考。火山方舟走管控面 OpenAPI(HMAC 签名),需 AccessKeyID + SecretAccessKey |
| 💳 | **余额查询** | 一键查询 DeepSeek 官方账户余额(总余额 / 充值 / 赠送 / 状态) |
| 🤖 | **Agent 工具** | 直接在对话里问:"我现在花了多少钱?"——Agent 会调用 `cost_stats` / `cost_prices` 等工具回答 |
| 🔻 | **状态栏** | 聊天输入框下方实时显示:**本会话花费**(胶囊分段:本会话 / 订阅套餐 / 分模型),按会话实际用到的模型与订阅拆分,**多模型默认折叠只显示 top2,点击展开全部明细**;订阅显示具体套餐名,不再展示配额与调用次数 |
| 👁️ | **界面显示开关** | 输入框上方的花费胶囊、侧边栏峰谷时段条、设置页「花费统计」看板**三个落点各自可关**(设置 → 花费统计 → 右上角齿轮 → 数据与界面 → 界面显示),勾选即刻生效;**只影响显示**,记账、云端同步与 Agent 工具照常,配置入口(齿轮页)本身不受开关控制 |
| 💾 | **本地持久化** | 数据存本机 `~/.dsh/storages/cost-tracker-records.json`,重启不丢、不上传;**明细保留最近 180 天,更早自动压缩为永久日汇总,全时段统计永远精确且内存/磁盘有界** |
| 🕰️ | **历史导入(v1.9.0)** | 回放宿主会话日志,**把装插件之前的对话调用补录进账本**(按各自时间戳的旧价计费);只补插件不可能记到的部分(安装前 / 停机缺口),幂等可重复执行,导入记录标记 `source=import` 以便区分 |
| 🔄 | **官方价格同步(v1.9.0)** | 一键抓取官方定价页、解析各模型峰价并对比差异,应用后构建**新的计费时代**(只影响之后,历史口径不回改);每日可自动核对(只提示、不自动应用),页面改版时宁可不同步也绝不写错价 |
| 🌐 | **多厂商价格目录(v1.9.0)** | 内置 14 家厂商 / 90 个模型条目(USD→CNY 按可配汇率折算),OpenAI / Anthropic / Gemini / Qwen 等内置表之外的模型也能按**精确价**入账;支持宽松/严格匹配与**手动覆盖价** |
| ⚖️ | **Plan 与按量双轨(v1.9.0)** | 工具栏「含 Plan 总额」开关一键切换口径:关闭只算按量真金白银、订阅以附注展示;打开则金额 = 按量 + 订阅等值,图表按天并入「订阅等值」段 |
| 🔐 | **凭据零落盘(v1.9.0)** | 云端令牌与火山 SecretAccessKey 只写 DSH 凭据库(配置文件零明文,旧版明文启动时自动迁移);任何响应只回显布尔;出站请求白名单 + 强制 https + 拒绝跟随重定向(防凭据外带) |
| 📤 | **CSV 导出** | 一键导出明细 + 日汇总(purpose=rollup),方便用 Excel / Numbers 做进一步分析 |

## 界面展示

**在对话中直接查询**——Agent 自带花费/余额/单价工具,边聊边查:

![对话中查询花费与余额,输入框下方显示实时花费状态栏](docs/screenshots/chat-tools.png)

**订阅套餐与账户余额**——配额进度条、重置倒计时、余额一目了然:

![Kimi Coding Plan 配额监控与 DeepSeek 账户余额](docs/screenshots/subscription-balance.png)

**分模型明细**——每个模型的请求趋势、Token 构成,悬停显示每日明细:

![单个模型的请求次数面积图与 Tokens 堆叠图,悬停提示显示完整日期与分段数值](docs/screenshots/model-detail.png)

> 📸 截图取自 v1.8.x 的看板;v1.9.0 起工具栏多了「含 Plan 总额」开关、配置面板改为七个折叠分组(见「设置入口」一节),v1.9.3 起配置页由「花费统计」页头右上角齿轮进入(带返回键),概览卡与图表本身不变。

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

> ⚠️ **插件市场安装过本插件的机器,不要用「手动拷文件」升级**(v1.9.1 的真实踩坑):
> profile 用 pnpm 管理插件(`~/.dsh/profiles/web/package.json` 里记着
> `"@angelyeye/dsh-cost-tracker": "^1.8.15"`),下次启动时市场对账会**按依赖重装回旧版**,
> 你拷进去的新文件会被覆盖 —— 现象是"升级了、重启后又变回旧版本"。
> 这类机器请用官方 dev 流程把目录**链接**进 profile(重启不会丢,改代码重启即生效):
>
> ```bash
> dsh plugin --profile web add link:/path/to/dsh-cost-tracker
> ```
>
> 发布版本则走正常升级:`dsh plugin --profile web update`(或市场里点更新)。

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
- **Token 用量统计热力图**:类 Codex 的 26 周每日用量方格,颜色深浅按当日 token 相对最大值分档;悬停任一格看该日明细(输入 / 缓存 / 输出 / 费用),今天高亮描边;**口径跟随三态开关**:「本机」只统计本机,「本机+云端」把云端按天用量并入(与上方卡片同一并集口径、不重复计数),「仅云端」只看云端,标题右侧标注当前口径。云端按天明细需要 `dsh-cost-cloud ≥ v1.3.2`,旧云端下自动退回本机口径;
- **峰谷计价与提示**:时段条样式可选(**简洁单行·按 24h 比例**(白色实时进度线) / **环形表盘·相位色点**),简洁样式可选**双行紧凑**(条上文下 / 文上条下),可开关「显示时间」刻度(00:00–21:00),设置峰/谷切换前的弹窗提醒提前量(1–30 分钟)、提醒类型(两者 / 进入高峰 / 进入闲时)、弹窗位置(右下角 / 屏幕中心)与浏览器系统通知。**v1.9.0 起这些设置统一在「设置 → 花费统计 → 右上角齿轮 → 峰谷计价与提示」里改**(v1.9.3 起入口为页头齿轮;看板上的同名面板改为只读回显,只保留弹窗预览);侧边栏底部常驻时段条显示当前档位与下次切换倒计时;
- **含 Plan 总额开关(v1.9.0)**:工具栏右侧一个开关,决定金额卡与图表的口径 —— 关闭(默认)只算按量真金白银、订阅以附注展示;打开则金额 = 按量 + 订阅等值,图表按天并入「订阅等值」一段。选择存浏览器本地并回写服务端配置(跨设备一致);
- **导出 CSV**:导出明细记录(近 180 天)+ 日汇总行(`purpose=rollup`)。

### 对话中的 Agent 工具

| 工具 | 作用 | 你可以这样问 |
| --- | --- | --- |
| `cost_stats` | 查询花费与用量统计（`scope=local`（默认，仅本机）/ `cloud`（云端多机汇总）/ `both`） | "我今天花了多少钱?" · "我所有电脑加起来花了多少?" |
| `cost_prices` | 查看内置单价表与峰谷规则 | "现在 deepseek-v4-flash 什么价?" |
| `cost_peak` | 查询当前峰谷档位与下次切换倒计时 | "现在是不是高峰时段?" |
| `cost_recompute` | **按计费时代重算已入库记录的费用(一次性补账)**,默认只试算 | "把价格调整前的记录按新价重算一下" |
| `cost_import` | **历史导入**：查看导入状态 / 执行一轮（补录装插件之前的对话） | "把装插件之前的花费也统计进来" |
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

**在每台设备上配置**：打开 **设置 → 花费统计 → 右上角齿轮** → 「多机汇总（云端同步）」，填写：

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

**隐私**：只上报 token 数量、费用、时间戳与标识符（不涉及 prompt / 回复 / 文件内容）；可在配置页开启「会话脱敏」（`sessionId` 上报前替换为不可逆哈希）与「不含 purpose」。

### 界面显示（v1.8.12，可选）

不想在界面上看到插件？**设置 → 花费统计 → 右上角齿轮 → 数据与界面 → 界面显示**里三个开关**各自独立**、**勾选即刻生效**（无需点「保存」，也无需重启 dsh）：

| 开关 | 关掉之后 |
| --- | --- |
| 输入框上方的花费胶囊 | 会话输入区不再显示本会话花费与模型明细 |
| 侧边栏峰谷时段条 | 侧边栏底部的档位 / 倒计时消失（峰谷切换弹窗与系统通知一并停用；只想留提醒不想要时段条，请改用「峰谷计价与提示」里的提示开关） |
| 设置页「花费统计」看板 | 设置页左侧的该入口只留一句重新打开的指引（记账与云端同步照常） |

- **只影响显示**：记账、落盘、云端同步与 Agent 工具（`cost_stats` 等）全部照常工作；
- **配置入口本身不受这三个开关控制** —— 页头齿轮始终在（旧宿主还有插件配置卡片），否则关掉之后就没有入口能再打开了；
- 取值为「只有显式 `false` 才隐藏」，缺省即显示。老配置文件里没有这几个键，**升级后界面与升级前一致**；
- 落盘在同一份 `~/.dsh/storages/cost-tracker-config.json`（键名 `uiDockEnabled` / `uiPeakEnabled` / `uiDashboardEnabled`），与峰谷、云端字段互不覆盖。

### 设置入口（v1.9.3：花费统计页头齿轮；新宿主上的唯一入口）

**设置 → 花费统计 → 页头右上角齿轮**（图标按钮，悬浮提示「花费统计设置」）→ 配置页，左上角**返回键**回到看板。

| 入口 | 适用宿主 | 形态 |
| --- | --- | --- |
| **页头齿轮 → 配置页**（v1.9.3 起，推荐） | 全部版本 | 设置 → 花费统计 → 齿轮；配置页整页常驻展开，左上角返回键 |
| **插件配置卡片**（v1.9.0，兼容保留） | 仅仍声明 `settings.plugin.item` 的旧宿主（`dsh < 0.1.7-alpha.2`） | 设置 → 插件 → 插件配置 → 花费统计；卡片默认收起，点标题展开 |

> DSH `0.1.7-alpha.2` 删除了 `settings.plugin.item` 插槽（「内置插件」分区改为只读清单），卡片在新宿主上不显示；
> 插件侧的注册**保留**（插槽不存在时回调不触发，零成本），旧宿主照旧可用。两个入口**共用同一个配置组件**，
> 字段、校验、写接口完全一致，只是外壳不同；未保存草稿各自独立，就近改一处即可。

配置页承载**全部**设置，按折叠分组排列，顶部一条状态摘要（云端同步 / 已记账条数 / 待上报 / 上次同步 / 计价时代 / 历史导入 / 金额口径）：

| 分组 | 内容 |
| --- | --- |
| **多机汇总（云端同步）** | 设备名、启用开关、服务地址、共享令牌、同步间隔、单批条数、会话脱敏、上报 purpose、上报日汇总、补传窗口、默认视图 + 保存 / 测试连接 / 立即同步 / 全量补传 + 设备 ID / 水位 / 最近错误 |
| **峰谷计价与提示** | 峰谷开关、显著提示、时段条样式（简洁 / 环形表盘）、时间刻度 / 双行紧凑、切换提醒（提前量 / 类型 / 位置 / 系统通知）+ **改完即可预览**（时段条与弹窗预览） |
| **订阅套餐与配额** | 火山方舟 `AccessKeyID` / `SecretAccessKey`（后者只进凭据库）、配额查询与百分比条、**订阅归类覆盖**表（`provider/*` 或 `provider/model` → 订阅 / 按量） |
| **计价与价格目录** | 「含 Plan 总额」、目录匹配模式（宽松 / 严格）、USD→CNY 汇率、**手动覆盖价**表、**官方价格同步**（核对 / 应用 / 上次差异 / 当前时代 / 已同步时代）、**多厂商目录概览**（厂商与条目数、数据日期、指纹） |
| **历史导入** | 自动导入开关、立即导入、累计导入条数与已处理日志数、三条口径说明 |
| **数据与界面** | 界面显示三开关（勾选即刻生效）、导出 CSV、重算费用（试算 / 写回）、清空数据（两步确认） |
| **安全与凭据** | 云端令牌 / 火山 SK 的「是否已配置 + 存储位置」徽章、旧版明文迁移状态、清除按钮与出站防护说明 |

约定：**只有「界面显示」三开关是勾选即刻生效**（要立刻看到显隐结果），其余分组都是「改草稿 → 点该组保存」，避免误触即写盘；分组折叠只切显隐、不卸载内容，展开任一分组都不会重新取数或丢草稿。**从配置页点「返回」会丢弃未点保存的草稿**（点该组「保存」即落盘），各组之间互不影响。

### 历史导入（v1.9.0）

装上插件之前的对话也能补进账本：插件回放宿主会话日志（`$DSH_HOME/sessions/<项目>/<会话>/session.v3.jsonl.zstd`，多 zstd frame 逐帧解压、逐帧切片），把其中的模型调用按**当时时间戳**的计费口径入账。

- 默认**开机自动导入**（延迟 8 秒，不阻塞启动），也可在配置页点「立即导入」或关掉自动（`autoImport`）；
- **只补「插件不可能记到」的调用**：早于本机最早一条实时记录，或所在日完全没有实时覆盖（停机缺口）；
- 跨安装点的会话按切割线截断：安装前那段补录，安装后那段以实时记录为准；
- **幂等三保险**：清单按文件 mtime + size 快跳、逐调用键 `(sessionId, 时间戳, 五桶 tokens)` 去重、已被实时覆盖的日子宁可不导入也不重复计数；
- 导入记录标记 `source=import`（实时记录 `source=live`）；fork 出的子会话只计 `createdAt` 之后的部分，标题生成等辅路请求不计。

### 官方价格同步与多厂商目录（v1.9.0）

- **官方价格同步**：配置页里点「核对官方价」抓取官方定价页（中文页直接给出人民币价），解析出各模型峰价并与当前生效价对比；点「应用新价」把结果构建为**新的计费时代** —— 只对生效时刻**之后**的记录生效，历史记录按各自时间戳选版，口径不回改。每日可自动核对（默认开，只提示差异，**绝不自动应用**）。解析器对页面改版 / 数字缺失 / 「空闲价 ≠ 高峰一半」一律抛错，宁可不同步也绝不写错价；
- **多厂商模型价格目录**：内置 14 家厂商 / 90 个模型条目（OpenAI / Anthropic / Google / Moonshot / z-ai / xAI / Alibaba / MiniMax / Tencent / Xiaomi / Upstage / NVIDIA / Mistral / OpenCode；数据改编自 `dsh-cost-meter` 的已核对官方目录，MIT），按 USD→CNY 汇率（默认 7.2，可改）折算。内置表之外的模型命中目录即记**精确价**（不再标「估算」）；匹配模式可选宽松（归一化包含）或严格（名称全等）；
- **手动覆盖价**：`provider/model` → 输入 / 输出 / 缓存价，优先级最高，用于自建端点或议价套餐；
- **计费优先级**：手动覆盖价 > 订阅归类（Plan）> 内置 / 同步时代精确价 > 多厂商目录 > provider 兜底 > 通用兜底。`cost_prices` 工具与 `/api/cost-tracker/prices` 会一并回显当前时代、同步时代、目录指纹与覆盖价；
- 云端（`dsh-cost-cloud ≥ v1.4.0`）有同源实现与对应的管理端点，两边口径可对照（`/api/v1/protocol` 回显云端实际使用的价格版本与目录指纹）。

### 凭据安全（v1.9.0）

- **密钥零落盘**：云端共享令牌与火山 `SecretAccessKey` 只写入 DSH 凭据库（`~/.dsh/.credentials.yaml`，由宿主凭据服务托管），配置文件里只保留「是否已配置」。老版本（≤ v1.8.15）写在 `cost-tracker-config.json` 里的明文会在启动时**自动迁移**进凭据库并从配置清除（幂等；凭据库已有值时不覆盖）。**安全边界**：只有凭据库确实可写时才清除配置里的明文 —— 宿主没有凭据服务、或凭据服务只读时，明文会**原样保留**并在启动日志里提示，因为密钥若只留在内存里，重启后就永久丢了；
- **任何响应都不回显密钥**：状态接口只给布尔与「存储位置」（凭据库 / 进程内存），`AccessKeyID` 属非敏感标识才会回显以便预填；
- **出站防护**：携带凭据的请求必须命中主机白名单（DeepSeek / Kimi / 火山管控面 / 配置的云端地址 / 定价页主机），非本机地址强制 https，`redirect: 'manual'` —— 3xx 一律按失败处理，防止重定向把 `Authorization` 头带去别处。

### HTTP API(供其他工具调用)

全部为 `POST` + JSON,监听本机地址:

```
POST /api/cost-tracker/summary      概览(含本会话按模型拆分 / 订阅)
POST /api/cost-tracker/dashboard    仪表盘数据
POST /api/cost-tracker/usage        用量热力图(全时段累计 + 按天 token 聚合)
POST /api/cost-tracker/peak         峰谷相位快照(当前档位/下次切换/配置/界面显示开关)
POST /api/cost-tracker/peak-config  保存峰谷计价提示配置
POST /api/cost-tracker/ui-config    保存界面显示开关(胶囊/时段条/看板,可只传要改的键)
POST /api/cost-tracker/sync         云端同步状态(设备 ID/水位/待上报/最近错误/界面显示开关)
POST /api/cost-tracker/sync-now     立即同步(传 {"full":true} 全量补传)
POST /api/cost-tracker/sync-test    测试云端连接
POST /api/cost-tracker/sync-config  保存云端同步配置
POST /api/cost-tracker/cloud        云端只读聚合(route/days/excludeSelf/devices/sources)
POST /api/cost-tracker/kimi-usage   Kimi 订阅配额
POST /api/cost-tracker/volcengine-usage  火山方舟 Coding Plan 配额(5 小时/周/月窗口)
POST /api/cost-tracker/volcengine-config 保存火山方舟 AK/SK(只回显「是否已配置」,不回显密钥)
POST /api/cost-tracker/balance      账户余额
POST /api/cost-tracker/prices       单价表(按计费时代分版 + 同步时代 + 多厂商目录 + 覆盖价)
POST /api/cost-tracker/recompute    按计费时代重算已入库记录(默认只试算,传 {"apply":true} 落盘)
POST /api/cost-tracker/billing-config  双轨计费与目录配置(金额口径/订阅归类/匹配与汇率/覆盖价)
POST /api/cost-tracker/prices-sync  官方价格同步(默认只核对,传 {"apply":true} 应用新价)
POST /api/cost-tracker/prices-config 价格同步设置(定价页地址 / 每日自动核对开关)
POST /api/cost-tracker/import-status 历史导入状态
POST /api/cost-tracker/import-run   执行一轮历史导入(幂等)
POST /api/cost-tracker/import-config 历史导入设置(开机自动开关)
POST /api/cost-tracker/reset        清空全部记录(配置页两步确认后调用)
POST /api/cost-tracker/export       导出 CSV
```

示例:`curl -X POST http://127.0.0.1:3080/api/cost-tracker/summary -d '{}'`

---

## 更新记录

> 这里只列重要版本;逐版完整记录见 [`CHANGELOG.md`](./CHANGELOG.md)。

### v1.9.3(2026-09-24)

**适配 DSH 0.1.7-alpha.2：配置入口内迁到「花费统计」页头齿轮（旧卡片入口保留兼容）**

- **背景**：DSH `0.1.7-alpha.2` 删除了 `settings.plugin.item` 插槽（原来的「设置 → 插件 → 插件配置」），
  「内置插件」分区改成**只读清单**（只显示完整名称 / 配置状态 / 启用于），`dsh-settings` 的
  `installSection` 也一并下线 —— 本插件原先挂在那里的配置卡片在新宿主上**永远不会显示**；
- **改法**：配置 UI 内迁到本插件自己的设置分区 —— **设置 → 花费统计 → 页头右上角齿轮**（齿轮为图标按钮，
  带 `花费统计设置` 可访问名）→ 配置页，左上角**返回键**回到看板。七个折叠分组、顶部状态摘要、
  各分组的保存 / 测试连接 / 立即同步 / 用价同步 / 历史导入等动作**逐项不变**；
- **为什么是「页内跳转」而不是第二个左侧导航项**：宿主设置外壳渲染分区时只传入 `close`
  （`renderSlot('settings.section', { close }, { only: active })`），分区没有任何程序化切换导航的能力；
- **兼容**：`settings.plugin.item` 注册**保留**。0.1.7+ 上该插槽不存在 → 回调不触发即自动失效（零成本）；
  仍声明它的旧宿主照旧显示卡片。两种入口**共用同一个 `ConfigPanel`**（只有外壳不同），字段、校验、
  写接口完全一致 —— 就近改一处即可，两处的未保存草稿互相独立；
- **不再可能关掉后打不开**：看板被关掉时页头与齿轮仍在，只有统计内容换成一句「点右上角齿轮 →
  数据与界面 → 打开」的指引（原「插件配置」入口在新宿主上已经不存在，这条护栏是必须的）；
- **文案**：插件内所有指引（峰谷只读面板、云端同步只读卡、令牌失效提示、云端未配置提示）与
  Agent 工具 / HTTP 错误里的路径统一改为「设置 → 花费统计 → 右上角齿轮 → 分组名」。

### v1.9.2(2026-09-20)

**定价口径修正：V4-Pro 不再路由到 Flash（官方撤销下线计划）+ 新增「法定节假日全天闲时」**

- **修正**：官方现行价目页仍为 `deepseek-v4-pro` **单列价格**（高峰 9 / 27 / 0.30，闲时半价，并发 500），
  更新日志也已改为「决定在 2026-09-14 之后**继续提供** V4 Pro 服务，**计费方式保持不变**」。
  内置表此前按 09-10 新闻稿的**预告**（「9-14 12:00 后 pro 全部路由到 Flash」）实现了 `v41pro` 时代，
  会把 pro 调用按 Flash 价计（输入 2 / 输出 8），**低估约 3.4～4.5 倍**。现删除该时代与路由，
  V4-Pro 一律按自有牌价计费（`PRICE_ERAS` 回到 `legacy` / `v41` 两版）。
  本机账本零影响（4393 次调用中 `deepseek-v4-pro` 0 次）；**注意**：路由期已入库的 pro 记录模型名
  已被改写为 `deepseek-flash`，补账无法反推，需重放会话日志才能订正。
- **新增**：官方把**中国法定节假日**全天计入闲时（此前只排除了周末，节假日落在工作日会多计 1 倍）。
  内置 2026 全年 33 天（[国办发明电〔2025〕7 号](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm)），
  配置卡「峰谷计价与提示」新增 `peakHolidays`：空 = 内置表、`none` = 停用、也可自定列表；
  **调休补班的周六/周日不计高峰**；相位文案区分「周末全谷」与「节假日全谷」。

### v1.9.1(2026-09-20)

**修复：云端同步报「方法不允许」（405）—— `safeFetch` 丢掉 fetch 原生签名，POST 退化成 GET**

- 反代日志显示插件发出的是 `GET /api/v1/ingest/records`（应为 POST）→ 云端 405，同步全废、水位不前进；
- 根因：`index.js` 以 **fetch 原生签名**接线 `(url, init) => safeFetch(url, {...init})`，而 `safeFetch` 只读 `opts.init`，`method` / `body` 全部丢失；
- 修复：`safeFetch` 同时接受两种入参形状（`opts.init` 优先），安全策略不变；并补两层回归护栏（单测接线形状 + 引擎集成 `runOnce` 断言真的发出 POST）；
- 另修：凭据服务晚就绪时明文迁移不再只试一次 —— 用 `ctx.inject(['credentials'])` 等它就绪后自动重迁，`secretsMigrated` 不会永远停在 false；
- **安装提醒**：DSH 的 profile 用 pnpm 管理插件，**手动拷文件会在下次启动被市场对账重装回旧版**（真实现场）。开发/自测请用 `dsh plugin --profile web add link:<仓库路径>`（详见「安装」一节）。

### v1.9.0(2026-09-27)

**五个新能力 + 设置集中到插件配置卡 + 凭据零落盘（配套云端 `dsh-cost-cloud` v1.4.0）**

- **历史导入**：回放宿主会话日志（多 zstd frame 逐帧解压），补录「装插件之前」的调用。幂等三保险（清单快跳 + 逐调用键去重 + 覆盖判定），跨安装点会话按切割线截断，导入记录标记 `source=import`。默认开机自动执行（延迟 8 秒，不阻塞启动），新 Agent 工具 `cost_import`；
- **凭据外带防护**：令牌与火山 SK 只写 DSH 凭据库（配置文件零明文），启动时自动迁移旧版明文；所有出站请求走白名单 + 强制 https + `redirect:'manual'`（拒绝跟随 3xx，防重定向把 `Authorization` 带走）；任何响应只回显布尔与存储位置；
- **价格同步**：解析官方定价页（转置价格表：列 = 模型、行 = 指标 × 时段）→ 构建新计费时代，只影响生效时刻之后的记录，历史口径不回改；页面改版 / 数字不齐 / 空闲价非半价一律抛错。每日自动核对只提示差异，应用需手动确认；
- **多厂商模型价格目录**：14 家厂商 / 90 个模型条目（USD/1M tokens → 按汇率折 CNY），内置表之外的模型命中即记精确价；匹配模式宽松 / 严格可选；另有手动覆盖价表；
- **Plan 与按量双轨 + 「含 Plan 总额」开关**：金额卡与图表口径一键切换（关闭只算按量、订阅以附注展示；打开则按量 + 订阅等值并入，图表出现「订阅等值」段），选择存浏览器并回写服务端；
- **设置集中 + 卡片重设计**：`设置 → 插件 → 插件配置 → 花费统计` 成为唯一设置入口，按「多机汇总 / 峰谷计价与提示 / 订阅套餐与配额 / 计价与价格目录 / 历史导入 / 数据与界面 / 安全与凭据」七个折叠分组排列，顶部状态摘要条；看板上的峰谷面板改为只读回显；
- **测试**：新增 `test/import.test.js`（合成多帧 zstd 会话日志，37 条断言）、`test/price-sync.test.js`（含真实页面回归）、`test/vendor-catalog.test.js`、`test/credstore.test.js`，`client-render` 增加金额口径开关与卡片分组断言 —— 共 17 个测试文件全绿。

### v1.8.15(2026-09-26)

**修复：火山方舟配额面板「没有配置入口」与「拿推理 Key 当 AK」两个缺陷**

- **面板自带凭据输入框（主要修复）**：此前只能去「设置 → 插件 → 插件配置」卡片或手写环境变量，面板上**根本没有填写的地方** —— 用户看到的只有一句「凭据无效」，无从下手。现在面板内直接提供 `AccessKeyID` / `SecretAccessKey` 输入框与「查询」（先验证、不落盘）/「保存」（落盘持久化）/「清除凭据」三个动作；AK 明文回显便于确认，SK 从不回显（已保存时输入框提示「留空则不改」）。工具栏另加「火山方舟配额」按钮作为入口 —— 否则面板默认不显示，用户永远找不到。
- **修复：把「推理 API Key」当成 AccessKeyID 去签名（静默 401 的真正原因）**。配了 baseURL 指向方舟 coding 端点的 provider 时，其 `apiKeyEnv` 是**推理用** API Key，而配额查询要的是 IAM 的 AK/SK。早先的候选链把它也塞进 AK 候选，于是出现「推理 Key 当 AK + 凭据库里的 SK」这种**跨来源拼凑**的假凭据：签名必然 401，报错却只说「凭据无效或无权限」，根因完全查不出来。现在 AK 与 SK 必须**同源配对**，且按命名识别推理 Key（含 `API_KEY`/`TOKEN` 且不含 `ACCESSKEY`/`SECRETKEY`）并明确提示「这条是推理 Key，不是配额凭据」。
- **修复：失败路径抛 `ReferenceError`（TDZ）导致 500**。`keyEnv` 原先声明在 `try` 内却在 `catch` 里引用，任何一次查询失败（401 / 网络异常 / 结构变化）都会把「软失败」升级成 HTTP 500。现声明在 `try` 之外。
- **修复：`keyEnv` 永远显示「未知」**。`resolveApiKey()` 只返回 `{value, source}`，误取了 `rid.env`（那是 `resolveAnyEnv` 才加的字段），于是面板从不显示该去改哪个环境变量。现正确回传真实变量名。
- **防呆：空串不等于清空**。因为从不回显 SK，重开面板时 SK 输入框必然是空的；若把空串当作「清空」，用户只改一下 AK 就会把已存好的 SK 一起抹掉（静默丢凭据）。现在只有 **非空** SK 才覆盖，清空必须显式传 `clear:true`。
- 测试：`test/volcengine-host.test.js` 扩到 48 条断言，新增「推理 Key 不得被当作 AK（真实故障回归）」「空串不覆盖已存 SecretAccessKey」「只改 AK 后仍可用」「clear 才清空」四组。

### v1.8.14(2026-09-26)

**新增：火山方舟 Coding Plan 订阅支持（配额监控 + 等效费用）**

- **配额面板**：设置页新增「订阅套餐用量 · 火山方舟 Coding Plan」，经方舟**管控面 OpenAPI**（`open.volcengineapi.com`，`Action=GetCodingPlanUsage`，HMAC-SHA256 签名）拉取 **5 小时 / 周 / 月**三档窗口，显示已用百分比、绝对量（Cap 折算）与重置倒计时。Action 按 `GetCodingPlanUsage → GetAFPUsage → GetUsageDetails → GetPersonalPlan` 顺序兜底，Agent Plan 账号自动回落 AFP 取数；
- **等效费用**：火山套餐内的调用计入「订阅等效按量费用」，不再被误标为「按量计费 · 价格为估算」；
- **修掉订阅门卫缺陷（重要）**：原先只按 provider 名判定订阅，对该 provider 的**所有**模型一律套订阅价。火山方舟的套餐内 / 套餐外模型混在同一个 provider 下，这会把按量调用错记成订阅、使其金额从「真实花费」里消失。现改为「provider 命中 + 模型白名单」双重限定，并区分**专属订阅端点**（baseURL 指向 `/api/coding/v3`，整档计订阅）与**泛 `volcengine`**（仅白名单内模型计订阅，接入点 `ep-*` 一律按量）。Kimi 的既有行为逐字节不变；
- **修掉凭据文件读取缺陷（重要）**：`.credentials.yaml` 实际把键**缩进**存放在 `refs:` 段下，而原解析器只匹配行首无缩进的键 —— 这一路兜底一直静默失效（有宿主凭据服务时被掩盖）。现已支持缩进与 `refs` 段定位，并跟随 `DSH_HOME`；顺带修掉硬编码 `~/.dsh` 导致重定向部署下永远读不到的问题；
- **凭据发现链**：配置卡片 AK/SK → DSH 凭据库 → `.credentials.yaml`（`VOLC_ACCESSKEY` / `VOLC_SECRETKEY` 及多种变体名）→ 环境变量。**密钥永不出现在任何响应里**，`volcengine-config` 只回「是否已配置」；
- **失败一律中性提示**：无凭据、无订阅、权限不足（需 `ArkReadOnlyAccess` + `BillingCenterReadOnlyAccess`）、接口结构变化都只回中性提示，不影响记账 / 同步 / 其它功能；只跑 DeepSeek 或 Kimi 的用户界面**完全不变**（面板按需出现）；
- 新增 `volcengine.js`（签名 / 解析 / 查询，纯函数可独立测试）与两个测试文件：签名与火山官方 demo 逐字节一致的固定向量、四种响应形态、**0.5% 不被放大成 50%**、密钥零外泄、缓存 TTL、失败路径软降级。真机核验通过（`GetCodingPlanUsage` 返回 `Status: Running` 与三档窗口）。

### v1.8.13(2026-09-25)

**新增：可以关掉插件在前端的显示（三个落点各自独立）**

- 设置 → 插件 → 插件配置 → 花费统计 → **界面显示**：输入框上方的花费胶囊、侧边栏峰谷时段条、设置页「花费统计」看板三个落点**各自可关**，勾选即刻生效（无需点「保存」、无需重启 dsh），另有「全部显示」一键恢复。
- **只影响显示**：记账、云端同步与 Agent 工具照常；配置卡片本身不受这三个开关控制（否则关掉就没入口再打开）。
- **安全默认**：只有显式 `false` 才隐藏，缺省即显示 —— 老配置升级后界面与升级前一致。详见上方「界面显示」一节。

### v1.8.12(2026-09-19)

**修复：热力图不跟随三态视图（本机+云端下屏内自相矛盾）+ `cost_stats scope=cloud|both` 崩溃**

- 「Token 用量统计」热力图此前只读本地 store，切到「本机+云端」时仍显示纯本机累计（现场：热力图 98.4M / 536 次调用，同屏卡片 955M）。现在按视图取数：宿主走云端 `plugin-view` 拿**带 token 类型拆分的按天明细**（`range=all` 全时段口径，「本机+云端」沿用与卡片相同的 `union` 并集），客户端 `mergeUsageHeat` 合并；云端明细不可用时退回本机并在标题右侧标注口径。**需要 `dsh-cost-cloud ≥ v1.3.2`**。
- 修掉 `cost_stats scope=cloud|both` 必崩的 `Cannot read properties of undefined (reading 'realCost')`：云端响应有 `overview.summary` 与 `plugin-view` 顶层两种形状，此前只读前者。
- 新增护栏：`view.test.js` 第 11 节、`cloud-read.test.js` 4 条契约、`client-render.test.js` 第 7 节、`cloud-view-e2e.test.js` 真实云端端到端合并断言。

### v1.8.11(2026-09-17)

**新增：启动时检测「另一个 dsh 实例正在用同一份记录文件」并直接点名**

- v1.8.10 的 EPERM 现场根因就是**上一个 dsh 实例还在跑、又起了一个** —— 两个实例写同一份记录文件、互相覆盖，并在 Windows 上撞 rename 的 EPERM。此前只能对着堆栈猜。
- 现在启动时会在记录文件旁登记一把**仅用于提示**的实例锁（`.lock`，含 pid / 版本）；若持有者仍存活，直接打印占用者与处理办法（先 Ctrl+C 停掉旧的，再启动新的）。**绝不阻断启动**：陈旧锁、损坏锁、自己的锁都静默跳过，退出时只删自己的锁。
- 实测（两个真实进程）：第二个实例启动即报 `检测到另一个 dsh 实例（PID 15784 · v1.8.10）…`。

**文档：两份 README 补齐长期漂移（无功能变更）**

- 英文 README 更新记录补齐 v1.8.7–v1.8.10（此前停在 v1.8.6）并补 v1.3.0；**修正过时口径**：「本机+云端」原写作「服务端排除本机」——那是旧语义，实际是**并集**（其他整机 ∪ 本机上的非 dsh 来源）；补「多机汇总(云端同步)」功能行与 `sync.js`/`view.js`/`schema.js`。
- 中文 README 补「六组概览卡」「峰谷计价与提示」两条设置页说明；FAQ 补落盘遇瞬时占用的处理。
- 两份 README 的版本徽标改为 **npm 动态徽标**（不再硬编码 v1.6.0，发版自动跟随）。

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

**Q:火山方舟 Coding Plan 的配额怎么接?需要哪种凭据?**
配额查询走的是方舟**管控面** OpenAPI(`open.volcengineapi.com`,HMAC-SHA256 签名),需要的是一对**火山引擎访问密钥**:

1. 火山引擎控制台 → **IAM → 用户 → 密钥**,创建 AccessKeyID / SecretAccessKey;
2. 给该子用户授予 **`ArkReadOnlyAccess`** 与 **`BillingCenterReadOnlyAccess`**(只读,足够查询用量);
3. 让插件拿到这对密钥(任选其一,按优先级):
   - **设置 → 花费统计 → 右上角齿轮 → 订阅套餐与配额** 里填 `火山引擎 AccessKeyID` / `SecretAccessKey`(密钥不回显);或
   - 写进 `~/.dsh/.credentials.yaml` 的 `refs:` 段,键名 `VOLC_ACCESSKEY` / `VOLC_SECRETKEY`(也兼容 `VOLCENGINE_ACCESS_KEY_ID`、`ARK_ACCESS_KEY_ID` 等写法);或
   - 设为同名环境变量。

> ⚠️ 这与**推理用的 ARK API Key**(形如 UUID、配在 provider 的 `apiKey` / `apiKeyEnv`)是**两套完全不同的凭据**,不能混填。推理 Key 无法查询配额,会得到 401/403。

面板显示 5 小时 / 周 / 月三档窗口的已用百分比与重置倒计时。Coding Plan 的用量口径是**百分比**(实测长期在 0.05%–0.4% 量级),所以数值保留两位小数,避免显示成 0%。若账号实际是 Agent Plan,插件会自动回落到 `GetAFPUsage` 接口取数。没有订阅、没有凭据、权限不足都属于**中性提示**,不影响记账、同步与其它功能。

**Q:为什么火山方舟的模型有的算「订阅」、有的算「按量」?**
同一个 provider 下套餐内外模型可能混在一起:凡是 **baseURL 指向 `ark.cn-beijing.volces.com/api/coding/v3`** 的 provider(专属订阅入口),其全部调用都计为订阅;而泛 `volcengine` provider 下,只有套餐内模型(豆包系、GLM 系、Kimi 系、DeepSeek 系、MiniMax 系及各档 `ark-code-*`)算订阅,**接入点 id(形如 `ep-2026xxxx`)一律按量**。这样按量调用不会被误记成订阅而让真实花费缩水。

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
├── pricing.js      定价与 Token 层:单价表、峰谷计价、视觉模型、峰值相位、订阅门卫(纯逻辑,可独立测试)
├── config.js       配置层:峰谷计价提示 + 云端同步 + 界面显示 + 火山凭据的默认值与规范化(纯逻辑,可独立测试)
├── volcengine.js   火山方舟配额查询:HMAC-SHA256 签名、响应解析、凭据归一(纯逻辑,可独立测试)
├── sync.js         云端同步引擎:设备身份、增量水位、幂等批次、退避重试
├── schema.js       宿主设置空间的 schema(配置面板字段;旧宿主兼容)
├── view.js         三态视图合并:本机 / 本机+云端 / 仅云端的口径归一化(浏览器与测试共用)
├── client.js       Client 半端:设置页仪表盘、状态栏与峰谷提示 UI
├── package.json    插件清单:声明 dsh.bundle(插件可被安装的关键)与 dsh.client(前端 UI)
├── cordis.patch.yml Bundle 补丁:把本插件注册进 DSH 的 loader,由 dsh.bundle 指向
├── screenshots.json 插件市场详情页的截图清单(相对路径,1-8 张)
├── README.md       中文说明文档
├── README.en.md    英文说明文档
├── CHANGELOG.md    更新记录(中文)
├── test/           单元测试(storage / pricing / volcengine / config / recompute / 渲染 / 云端读取,node test/*.test.js)
└── docs/           README 截图与设计文档
```

## License

[MIT](./LICENSE) · 欢迎 Issue 与 PR

第三方成果与数据来源声明见 [`docs/THIRD-PARTY-NOTICES.md`](./docs/THIRD-PARTY-NOTICES.md)（多厂商价格目录数据改编自 `dsh-cost-meter`，MIT）。
