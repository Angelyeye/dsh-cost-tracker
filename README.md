# DSH Cost Tracker · 花费统计插件

一个 [DeepSeek Harness (DSH)](https://github.com/deepseek-ai/dsh) 静态插件：实时统计每一次 LLM 调用的 token 用量与花费（人民币计价），内置峰谷定价、订阅套餐等效估算、设置页可视化仪表盘（带悬停提示的图表）、Agent 工具与 HTTP API，数据本地持久化，重启不丢。

A static plugin for DeepSeek Harness that tracks per-call LLM token usage and cost (CNY), with peak/off-peak pricing, subscription-equivalent estimates, a settings dashboard (hover-tooltipped charts), agent tools, an HTTP API and durable local storage.

---

## 功能特性

- **自动采集**：通过 `llm/stream` Waterfall 拦截记录每次调用的输入/输出/缓存读写 tokens 与费用，按量计费模型与订阅套餐（如 kimi-coding，等效估算）分开统计。
- **峰谷定价**：内置单价表（CNY / 百万 tokens），高峰时段 9:00–12:00、14:00–18:00（北京时间），闲时半价；未知 provider 走估算兜底价，本地模型（ollama/local）计 0。
- **设置页仪表盘**：在 DSH Web 设置页新增「花费统计」面板——今日/累计概览、按日消费柱状图（按峰谷或按模型分段）、分模型的请求次数面积图与 Tokens 堆叠图，全部支持鼠标悬停提示（日期、总量、分段明细）。
- **状态栏**：聊天输入框下方显示今日花费状态条。
- **Agent 工具**（所有会话可见）：
  - `cost_stats` — 查询花费与用量统计（可按天数过滤）
  - `cost_prices` — 查看内置单价表与峰谷规则
  - `cost_reset` — 清空全部统计数据（不可恢复）
- **HTTP API**（只读 + 导出，POST JSON，监听本机）：
  - `POST /api/cost-tracker/summary` / `dashboard` / `kimi-usage` / `balance` / `prices`
  - `POST /api/cost-tracker/export` — 导出全部记录（CSV）
- **持久化**：数据写入 `~/.dsh/storages/cost-tracker-records.json`（防抖 1.5s，tmp+rename 原子写入，上限 5000 条，损坏文件自动备份为 `.corrupt-<ts>`），重启后自动恢复。

## 安装

> 需要 DSH Web profile（`dsh web`）。以下路径中的 `~/.dsh` 即 `${DSH_HOME:-$HOME/.dsh}`。

1. 将本仓库复制到 profile 的 `node_modules` 下，**目录名必须与 package.json 的 `name` 一致**：

   ```bash
   mkdir -p ~/.dsh/profiles/node_modules
   git clone https://github.com/Angelyeye/dsh-cost-tracker.git \
     ~/.dsh/profiles/node_modules/dsh-cost-tracker
   ```

2. 编辑 `~/.dsh/profiles/web/cordis.patch.yml`（顶层是 YAML 数组），追加一行 insert：

   ```yaml
   - insert:
       - id: cost-tracker
         name: dsh-cost-tracker
   ```

3. 重启 DSH：

   ```bash
   dsh web
   ```

4. 打开 Web GUI → 设置 → 「花费统计」，即应看到仪表盘；输入框下方出现花费状态条。

### 验证

```bash
dsh --profile web --dump-config   # 确认组合树中出现 cost-tracker 行
curl -X POST http://127.0.0.1:3080/api/cost-tracker/summary -d '{}'
```

### 热更新客户端

插件 Client 半端由 `dsh-client-modules` 直接按磁盘文件提供（`/plugins/<name>/client.js?rev=<sha1-12>`）。修改 `client.js` 后无需重启，**硬刷新浏览器**（Cmd/Ctrl+Shift+R）即可。

## 卸载 / 回滚

1. 删除 `~/.dsh/profiles/web/cordis.patch.yml` 中的 `cost-tracker` insert 行（或给该行加 `disabled: true`），重启 `dsh web`。
2. 可选：删除 `~/.dsh/profiles/node_modules/dsh-cost-tracker/` 与数据文件 `~/.dsh/storages/cost-tracker-records.json`。

## 数据与隐私

- 所有数据仅保存在本机 `~/.dsh/storages/cost-tracker-records.json`，不上传。
- HTTP 路由监听本机地址、无会话鉴权，面向单用户本地使用场景；请勿将 DSH 端口暴露到公网。
- `cost_stats` / `cost_prices` / `cost_reset` 工具对**所有会话**的 Agent 可见。

## 仓库结构

| 文件 | 说明 |
| --- | --- |
| `index.js` | Host 半端（ES module，`export default { name, inject, apply }`）：用量采集、聚合、持久化、HTTP 路由、Agent 工具 |
| `client.js` | Client 半端（`window.__ModuleLoader__.load` 包装）：设置页仪表盘与状态条 UI |
| `package.json` | 含 `dsh.client` 声明，供 `dsh-client-modules` 发现并注入浏览器 |

## License

[MIT](./LICENSE)
