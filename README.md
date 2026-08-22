<div align="center">

# <img src="./docs/icon-mark.svg" width="30" valign="bottom" alt="icon"> DSH Cost Tracker · 花费统计

**DEEPSEEK HARNESS LLM 花费与用量统计插件**

**简体中文** | [English](./README.en.md)

![version](https://img.shields.io/badge/version-v1.2.0-blue?style=flat-square)
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
| 💰 | **花费统计** | 每一次 API 调用自动记账:输入 / 输出 / 缓存命中 / 缓存写入 Tokens 与费用,按天、按模型聚合 |
| ⏰ | **峰谷定价** | 内置单价表,高峰时段(北京时间 9:00–12:00、14:00–18:00)与闲时半价自动区分,本地模型(ollama 等)计 0 |
| 👁️ | **视觉模型** | 支持 `deepseek-v4-flash-vision-exp`:单价与 flash 一致,图片按官方规则换算 token(每张上限 384 个,以接口用量计费) |
| 📊 | **可视化仪表盘** | 设置页新增「花费统计」:概览卡片、消费柱状图(按峰谷/按模型)、分模型的请求次数与 Tokens 图表,**全部支持鼠标悬停查看明细** |
| 📈 | **订阅配额监控** | Kimi Coding Plan 等订阅套餐:本周配额、5 小时滚动窗口限额、等效按量费用参考 |
| 💳 | **余额查询** | 一键查询 DeepSeek 官方账户余额(总余额 / 充值 / 赠送 / 状态) |
| 🤖 | **Agent 工具** | 直接在对话里问:"我现在花了多少钱?"——Agent 会调用 `cost_stats` / `cost_prices` 等工具回答 |
| 🔻 | **状态栏** | 聊天输入框下方实时显示:本会话花费、累计花费、当前峰/闲时价 |
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
- **导出 CSV**:导出明细记录(近 180 天)+ 日汇总行(`purpose=rollup`)。

### 对话中的 Agent 工具

| 工具 | 作用 | 你可以这样问 |
| --- | --- | --- |
| `cost_stats` | 查询花费与用量统计 | "我今天花了多少钱?" |
| `cost_prices` | 查看内置单价表与峰谷规则 | "现在 deepseek-v4-flash 什么价?" |
| `cost_reset` | **清空全部统计数据(不可恢复)** | "把花费统计清零" |

### HTTP API(供其他工具调用)

全部为 `POST` + JSON,监听本机地址:

```
POST /api/cost-tracker/summary      概览
POST /api/cost-tracker/dashboard    仪表盘数据
POST /api/cost-tracker/kimi-usage   Kimi 订阅配额
POST /api/cost-tracker/balance      账户余额
POST /api/cost-tracker/prices       单价表
POST /api/cost-tracker/export       导出 CSV
```

示例:`curl -X POST http://127.0.0.1:3080/api/cost-tracker/summary -d '{}'`

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
├── pricing.js      定价与 Token 层:单价表、峰谷计价、视觉模型(纯逻辑,可独立测试)
├── client.js       Client 半端:设置页仪表盘与状态栏 UI
├── package.json    插件清单(含 dsh.client 声明)
├── test/           存储层单元测试(node test/storage.test.js)
└── docs/           README 截图
```

## License

[MIT](./LICENSE) · 欢迎 Issue 与 PR
