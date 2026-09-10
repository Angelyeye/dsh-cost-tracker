<div align="center">

# <img src="./docs/icon-mark.svg" width="30" valign="bottom" alt="icon"> DSH Cost Tracker

**LLM COST & USAGE TRACKING PLUGIN FOR DEEPSEEK HARNESS**

[简体中文](./README.md) | **English**

![version](https://img.shields.io/badge/version-v1.5.1-blue?style=flat-square)
![license](https://img.shields.io/badge/license-MIT-green?style=flat-square)
![status](https://img.shields.io/badge/status-stable-brightgreen?style=flat-square)
![platform](https://img.shields.io/badge/platform-DSH%20Web-blueviolet?style=flat-square)
[![GitHub stars](https://img.shields.io/github/stars/Angelyeye/dsh-cost-tracker?style=flat-square)](https://github.com/Angelyeye/dsh-cost-tracker/stargazers)

</div>

---

> An LLM cost-tracking plugin for [DeepSeek Harness](https://github.com/deepseek-ai/dsh): automatically records token usage and cost (CNY) for every API call, with **native support for DeepSeek's official peak/off-peak pricing (half-price off-peak) and Kimi Coding Plan subscription usage & equivalent-cost statistics**. Visual settings dashboard with hover tooltips, in-chat agent queries, balance & quota monitoring — all persisted locally, survives restarts, and uninstalls cleanly.

> 一个为 [DeepSeek Harness](https://github.com/deepseek-ai/dsh) 打造的 LLM 花费统计插件:自动记录每一次 API 调用的 Token 用量与费用,**原生支持 DeepSeek 官方峰值价格计费与 Kimi Coding Plan 订阅套餐的用量及等效费用统计**。设置页可视化仪表盘、对话内 Agent 查询、账户余额与订阅配额监控,数据全部本地持久化。

![Cost dashboard: overview cards and a peak/off-peak stacked cost chart with hover details](docs/screenshots/dashboard-overview.png)

---

## Features

| | Feature | Description |
| --- | --- | --- |
| 💰 | **Cost tracking** | Every API call is recorded automatically: input / output / cache-hit / cache-write tokens and cost (cache write billed at the cache-hit price), aggregated by day and by model |
| ⏰ | **Peak/off-peak pricing** | Built-in price table; peak windows (Mon–Fri 9:00–12:00, 14:00–18:00 Beijing time) vs half-price off-peak handled automatically; **weekends are fully off-peak**; local models (e.g. ollama) count as 0; the table is **versioned by pricing era** and switches automatically to V4.1 Flash rates at 2026-09-10 12:00 Beijing time (peak 2.0 / 0.04 / 8.0), routing V4-Pro and the legacy V4-Flash family to V4.1 Flash billing per the official rules |
| 🔔 | **Peak-price notice** | A "Peak/off-peak pricing & notice" panel in Settings: current tier + countdown strip, style switch (**compact single-row · 24h-proportional** / **ring dial · phase dot**), an optional **two-row compact** stacked layout for the compact style (bar-above-text / text-above-bar), a "Show time" toggle, popup alert + browser notification before a tier switch, lead time, popup position (bottom-right/center), alert type; a persistent strip in the sidebar footer (adapts to rail/collapsed). Mirrors `dsh-cost-meter` |
| 📌 | **Six overview cards** | Six cards at the top of Settings: Today / This month / Total spend / API requests / Tokens / **Account balance**. The three spend cards **exclude subscription equivalent cost** (shown as an annotation instead) |
| 👁️ | **Vision model** | Supports `deepseek-v4-flash-vision-exp`: priced as flash in the legacy era, billed at V4.1 Flash rates from 2026-09-10 12:00; images are converted to tokens per the official rule (≤384 tokens each, billed per API usage) |
| 📊 | **Visual dashboard** | A new "Cost Statistics" page in Settings: overview cards, cost bar charts (by peak period / by model), per-model request & token charts — **all with hover tooltips** |
| 📈 | **Subscription quota** | Kimi Coding Plan and similar subscriptions: weekly quota, 5-hour rolling window limit, pay-as-you-go-equivalent cost for reference |
| 💳 | **Balance lookup** | One-click DeepSeek account balance (total / topped-up / granted / status) |
| 🤖 | **Agent tools** | Ask in any chat: "how much have I spent today?" — the agent answers via `cost_stats` / `cost_prices` |
| 🔻 | **Status line** | A live line under the chat input: **session cost** (segmented pills: session / subscription plan / per-model), split by the models actually used in the session; multi-model collapses to top2 by default, click to expand. Subscription shows the plan name; no quota or call-count clutter |
| 🔥 | **Usage heatmap** | A "Token Usage" panel in Settings: a Codex-style **26-week daily-usage grid**, colored per-day by input / cache / output / cost with hover details and a today outline; all-time totals shown on top |
| 💾 | **Local persistence** | Data lives in `~/.dsh/storages/cost-tracker-records.json`; survives restarts, never leaves your machine. **Details are kept for the last 180 days; older records are auto-compressed into permanent daily rollups, so all-time stats stay exact with bounded memory/disk** |
| 📤 | **CSV export** | One-click export of details + daily rollups (`purpose=rollup`) for further analysis in Excel / Numbers |

## Screenshots

**Ask the agent directly** — built-in cost/balance/price tools with a live status line under the input box:

![Querying cost and balance in chat, with a live cost status line under the input](docs/screenshots/chat-tools.png)

**Subscription quota & account balance** — progress bars, reset countdowns and balance at a glance:

![Kimi Coding Plan quota monitoring and DeepSeek account balance](docs/screenshots/subscription-balance.png)

**Per-model details** — request trends and token composition per model, with hover tooltips:

![Per-model request area chart and token stacked chart with full-date hover tooltip](docs/screenshots/model-detail.png)

---

## Installation (choose one)

> Prerequisite: you already run DSH in web mode (`dsh web`). `~/.dsh` below means the DSH home directory (`${DSH_HOME:-$HOME/.dsh}`).

### Option A: Let DSH install it for you (recommended, no CLI knowledge needed)

Open any DSH session and paste this prompt verbatim to the agent:

```
Please install the DSH plugin dsh-cost-tracker for me:
1. git clone https://github.com/Angelyeye/dsh-cost-tracker.git into ~/.dsh/profiles/node_modules/dsh-cost-tracker (the directory MUST be named dsh-cost-tracker)
2. Append to the top-level array of ~/.dsh/profiles/web/cordis.patch.yml:
   - insert:
       - id: cost-tracker
         name: dsh-cost-tracker
3. Tell me when done — I will restart dsh web myself
```

Then stop `dsh web` with `Ctrl+C`, start it again, and refresh your browser.

### Option B: Manual install (3 commands)

```bash
# 1. Download the plugin (directory name must match the package name)
mkdir -p ~/.dsh/profiles/node_modules
git clone https://github.com/Angelyeye/dsh-cost-tracker.git ~/.dsh/profiles/node_modules/dsh-cost-tracker

# 2. Register the plugin (append to the patch file)
cat >> ~/.dsh/profiles/web/cordis.patch.yml <<'EOF'
- insert:
    - id: cost-tracker
      name: dsh-cost-tracker
EOF

# 3. Restart DSH (Ctrl+C the running dsh web first)
dsh web
```

### Verify it works

1. Open the DSH Web GUI → **Settings** (bottom-left) → a **"Cost Statistics"** entry appears in the sidebar;
2. A cost status line shows up under the chat input;
3. Ask the agent "check my current spending" — a correct answer means everything is ready.

> ⚠️ If `~/.dsh/profiles/web/cordis.patch.yml` already contains entries, keep them and only append the block above; the file's top level must remain a YAML array.

---

## Usage

### The Settings dashboard

- **Time range**: switch between last 7 days / 30 days / all time (top-right);
- **Six overview cards**: Today / This month / Total spend / API requests / Tokens / Account balance. The three spend cards exclude subscription equivalent cost (shown as an annotation); month is by Beijing calendar month; total is all-time (details + permanent rollups, always exact);
- **Cost chart**: segment by peak period or by model; hover for daily breakdowns;
- **Color schemes**: in "by model" view, three swatches next to the title switch between 橙→黄 / 蓝→紫 / 蓝→浅蓝 palettes. Models are ranked by total spend and colored in a sequential gradient (rank 1 = darkest at the bottom, getting lighter upwards; no cycling, no collisions). The choice is remembered in the browser (localStorage);
- **Per-model sections**: one request-count chart and one token-composition chart (input / cache write / output / cache hit) per model;
- **Usage heatmap**: a Codex-style 26-week daily-usage grid; shade by the day's token count relative to the maximum; hover any cell for that day's breakdown (input / cache / output / cost), today outlined;
- **Peak/off-peak pricing & notice**: pick the tier strip style (**compact single-row — a 24h-proportional bar with a white real-time line** / **ring dial — a 24h hollow dial with a phase-colored dot**), optionally switch the compact strip to a **two-row compact** stacked layout (bar-above-text or text-above-bar), toggle the "Show time" tick labels (00:00–21:00), set the popup-alert lead time (1–30 min), alert type (both / entering peak / entering off-peak), popup position (bottom-right / center), and optional browser system notification; everything auto-saves. A persistent strip in the sidebar footer shows the current tier and countdown to the next switch;
- **CSV export**: exports detail records (last 180 days) plus daily rollup rows (`purpose=rollup`).

### Agent tools

| Tool | Purpose | Example prompt |
| --- | --- | --- |
| `cost_stats` | Query usage & cost statistics | "How much did I spend today?" |
| `cost_prices` | Show the built-in price table & peak rules | "What does deepseek-v4-flash cost right now?" |
| `cost_peak` | Show the current peak tier & next-switch countdown | "Is it peak hour right now?" |
| `cost_reset` | **Erase ALL statistics (irreversible)** | "Reset my cost statistics" |

### HTTP API (for other tools)

All endpoints are `POST` + JSON and listen on the loopback address:

```
POST /api/cost-tracker/summary      Overview
POST /api/cost-tracker/dashboard    Dashboard data
POST /api/cost-tracker/usage        Usage heatmap (all-time totals + daily token aggregation)
POST /api/cost-tracker/peak         Peak-phase snapshot (current tier / next switch / config)
POST /api/cost-tracker/peak-config  Save peak-price notice config
POST /api/cost-tracker/kimi-usage   Kimi subscription quota
POST /api/cost-tracker/balance      Account balance
POST /api/cost-tracker/prices       Price table (versioned by pricing era)
POST /api/cost-tracker/export       CSV export
```

Example: `curl -X POST http://127.0.0.1:3080/api/cost-tracker/summary -d '{}'`

---

## Changelog

### v1.6.0 (2026-09-10)

**Added**
- **Support for the V4.1 Flash pricing rules (effective 2026-09-10 12:00 Beijing time)**: the price table is now **versioned by pricing era** (`PRICE_ERAS`) and each record is priced with **its own timestamp**, so historical records keep their original basis and the switch happens automatically — no restart or config change needed.
  - New era `v41` (2026-09-10 12:00 Beijing = `2026-09-10T04:00:00Z`): V4.1 Flash peak rates are **input (cache hit) 0.04 / input (cache miss) 2 / output 8** (CNY per 1M tokens); off-peak remains exactly half (0.02 / 1 / 4). **Peak windows are unchanged**, so the peak strip and countdown need no changes.
  - New **model routing** (per-era `routes`): until V4.1 Pro ships, V4-Pro requests are routed to V4.1 Flash and billed at V4.1 Flash rates; the legacy V4-Flash family (including `deepseek-v4-flash-vision-exp`) is superseded by V4.1 Flash and billed the same way. **Records are booked under the model that was actually billed** (e.g. `deepseek-v4-pro` → `deepseek-v4.1-flash`), so per-model aggregation reflects the real billing basis.
  - New exports: `V41_EFFECTIVE_AT` / `V41_FLASH_MODEL` / `PRICE_ERAS` / `eraAt()` / `exactModelsAt()` / `resolveModelInEra()` / `normalizeModelName()`.
- **Model-name normalization**: names are lowercased with separators stripped, so `deepseek-v4.1-flash` / `deepseek-v4-1-flash` / `deepseek-v41-flash` / `DeepSeek-V4.1-Flash` all resolve to the same rate, preventing a silently mis-priced fallback if the official model ID is spelled differently.
- `cost_prices` and the HTTP `/prices` endpoint now **render every era**: effective time, rates and routing rules, plus the currently effective era (`era` / `eraLabel` / `eras` / `v41EffectiveAt`).

**Changed**
- `priceFor(np, model, ts)` gained a third `ts` argument (timestamp of the call, defaults to now) and now also returns `model` (the canonical **billed** model name) and `era`. The recording path passes the record timestamp.
- The DeepSeek provider fallback rate now matches V4.1 Flash (`2.0 / 8.0 / 0.04`) so unknown deepseek models are no longer over-estimated at the old price.
- `EXACT_MODELS` now means the **legacy era** table specifically; kept exported for compatibility.

**Tests**
- New era/routing cases in `test/pricing.test.js` (boundary 11:59:59 vs 12:00:00, V4-Pro routing, legacy V4-Flash routing, alias normalization, off-peak half price, dangling-route guard).
- All rate assertions now pass an **explicit timestamp** so results no longer drift with wall-clock time across the 12:00 switch.

**Cost impact (same call, peak)**
- V4-Pro (100k input miss + 6k output + 20k cache hit): **¥1.068 → ¥0.2488** (about **-76.7%**).
- Legacy V4-Flash, same volumes: **¥0.356 → ¥0.2488** (about **-30.1%**).

### v1.5.2 (2026-08-25)

**Added**
- **"Two-row compact (stacked layout)" option for the compact strip**: with the "Compact (single row)" style selected, a new checkbox switches the strip from left-right to a stacked two-row layout, with a further choice of "bar on top · text below" (default) or "text on top · bar below"; applies to both the sidebar footer and the settings preview.
- New `peakCompactStack` (default `false`) and `peakCompactOrder` (`bar-first` / `text-first`, default `bar-first`) config options, covered by `defaultPeakConfig` / `normalizePeakConfig` and the config unit tests.

**Fixed**
- In stacked mode the track's `flex-basis` (72px) landed on the vertical axis, stretching the strip to 72px tall; overridden with `flex: 0 0 auto` to keep the same 6px slim bar as the single-row layout.

### v1.5.1 (2026-08-24)

**Fixed**
- **Sidebar footer (`sidebar.footer.action`) UI compatibility with multiple plugins**: DSH's renderer sets that slot's anchor to `display: contents`, so several plugins registering there (e.g. `linxin666/dsh-web-ui-all`) get squeezed into one row and overlap. The anchor is now overridden to stack **vertically** (`display:flex; flex-direction:column`), so this plugin's tier strip coexists with other footer plugins without overlapping (same idea as `dsh-footer-order`); it uses the stable `data-slot` selector and is unaffected in the collapsed (rail) state.

### v1.5.0 (2026-08-24)

**Added**
- **Tier-strip "style" gains a "Ring dial (24h hollow)"** (replaces the old "Classic/ two rows"): divided by 24h (00:00 top, 06:00 right, 12:00 bottom, 18:00 left) — orange = peak hours (9:00–12:00, 14:00–18:00), blue = off-peak, weekend is all-blue (all-day off-peak). 12 selectable "current-time" pointer schemes (default: **phase-colored dot** — peak orange / off-peak blue / weekend green); no more long center-to-edge needle. The center shows the current phase + countdown to the next switch.
- **"Show time" toggle** (ring dial only): show/hide the 00:00–21:00 hour tick labels, default on.
- **"Compact (single-row)" strip is now 24h-proportional**: a blue off-peak base bar spanning 24h, with orange peak segments placed proportionally (9:00–12:00 → 37.5%–50%, 14:00–18:00 → 58.33%–75%), and a white divider line marking the real-time "current time"; weekends show only the blue base + white line.

**Improved**
- Backend `peakSnapshot()` now returns a structured `peakHours` array (`PEAK_HOUR_WINDOWS`); the frontend draws the proportional bar / arcs from it, keeping the same basis as `isPeak`/`peakPhaseAt`. A hardcoded fallback `[9,12]`/`[14,18]` is bundled as well.
- New `peakShowTickLabels` config option (default `true`), added to `defaultPeakConfig` / `normalizePeakConfig`.
- Added design doc `docs/peak-dial-design.md` and an interactive preview page `docs/peak-dial-preview.html` (with all 12 pointer schemes).

### v1.4.1 (2026-08-23)

**Fixed cache-write pricing and added reasoning billing (aligned with official rules & dsh-cost-meter)**

- **Fixed cache-write (cacheWrite) pricing bug**: previously `cacheWrite` was billed at the **cache-miss** price (flash 3.0 / pro 9.0), badly overcharging sessions with heavy cache writes. The official rule (and `dsh-cost-meter`) sets **cache write = cache-hit price**, now unified as `(cacheRead + cacheWrite) × cache-hit price` (flash 0.10 / pro 0.30).
- `computeCost()` is now `input×miss-price + output×output-price + (cacheRead+cacheWrite)×hit-price`, matching the official / reference formula exactly.
- **Added reasoning-token billing**: `normalizeTokens()` now has a `reasoning` bucket (reads `usage.reasoningTokens`); a model price containing `reasoning` bills it at its own unit price (DeepSeek current models list no separate reasoning price → 0).
- Synced `cacheWrite` to the hit price across `EXACT_MODELS` / `SUBSCRIPTION_RATES` / `PROVIDER_RATES` / `GENERIC_RATES`.
- Updated the `cost_prices` tool text and unit tests (added "cache write at hit price" and "reasoning billing" cases).

> Note: this release only fixes **per-model pricing**. Differences between plugins in "call counts / cumulative usage" stem from counting granularity (live `llm/stream` vs DSH session projection `(turn,step)`), which is not a pricing bug.

### v1.4.0 (2026-08-23)

**New**
- **Peak-price notice (mirrors `dsh-cost-meter`)**: a "Peak/off-peak pricing & notice" panel in Settings — enable peak/off-peak pricing, prominent peak notice, strip style (compact / classic), popup alert before a tier switch, lead time (1–30 min), alert type (both / peak / off-peak), popup position (bottom-right / center), and optional browser system notification. All settings auto-save to `~/.dsh/storages/cost-tracker-config.json`. A persistent strip in the sidebar footer shows the current tier + countdown to the next switch, and adapts to the collapsed (rail) state. Adds `POST /api/cost-tracker/peak` and `POST /api/cost-tracker/peak-config`, plus the `cost_peak` agent tool.
- **Six overview cards**: Today / This month / Total spend / API requests / Tokens / **Account balance**. The three spend cards **exclude subscription equivalent cost** (shown as an annotation); month is by Beijing calendar month; total is all-time (details + permanent rollups, always exact).

**Improved**
- **Synced with DeepSeek's latest pricing**: peak hours are now **Mon–Fri 9:00–12:00, 14:00–18:00 Beijing time**, with **weekends fully off-peak (half price)**; `isPeak()` no longer ignores the weekday, fixing weekends being wrongly billed at peak rates.
- The notice strip now matches the reference project: a two-segment track (orange left / blue right) + marker + single-line colored chip.

**Fixed**
- The preview popup was hardcoded to center; it now **follows your configured popup position** (bottom-right / center).

---

## FAQ

**Q: Where is my data? Is it safe?**
Everything stays on your machine in `~/.dsh/storages/cost-tracker-records.json`; nothing is uploaded. The API binds to loopback but has no authentication — **do not expose the DSH port to the public internet**.

**Q: Do I lose data when DSH restarts?**
No. Records are flushed to disk with debounced atomic writes and restored on startup. A corrupted file is backed up as `.corrupt-<timestamp>` and tracking restarts cleanly.

**Q: How long is history kept? Is there a stats cap?**
Detail records are kept for the last **180 days**; older records are auto-compressed into **permanent daily rollups** (aggregates only: calls / token breakdown / cost — no per-call details). So all-time totals and per-model stats stay **exact forever**, while memory, disk and write volume stay bounded no matter how long you run. The daily chart axis spans up to 730 days. Old-format data files migrate automatically; set the `DSH_COST_TRACKER_STORE` env var to override the store path (default `$DSH_HOME/storages`, or `~/.dsh` when `DSH_HOME` is unset).

**Q: How do I enable/disable the startup logs?**
The plugin starts **silently by default**. Set the environment variable `DSH_COST_TRACKER_LOG=1` (or `true` / `yes` / `on`) to enable startup logs: nav-icon self-check results, the data-restore report (`restored N detail records ...`) and the ready marker. **Error logs** (persist failures, corrupted files, etc.) are always printed and are not affected by this switch.

**Q: What does "equivalent cost" mean for subscription models (kimi-coding)?**
Subscriptions are not billed per token. The plugin estimates what those calls *would* cost at pay-as-you-go prices so you can judge whether your subscription pays off — **it is not a real charge**.

**Q: The amounts don't exactly match my official bill?**
Costs are estimated locally from a built-in price table and may differ slightly from the official bill (price updates, tiered pricing, etc.). Treat official billing as authoritative; the balance shown is fetched live from the official API.

**Q: How do I uninstall?**
1. Open `~/.dsh/profiles/web/cordis.patch.yml` and remove the 4-line `- insert:` block for `cost-tracker` (or ask the DSH agent to do it);
2. Restart `dsh web`;
3. Optionally delete `~/.dsh/profiles/node_modules/dsh-cost-tracker` and `~/.dsh/storages/cost-tracker-records.json`.

**Q: How do I update the plugin?**
Run `git pull` inside the plugin directory. If only the UI (`client.js`) changed, a **hard browser refresh** (Cmd/Ctrl+Shift+R) is enough; if `index.js` changed, restart `dsh web`.

## Repository layout

```
├── index.js        Host half: usage capture, aggregation, HTTP API, agent tools
├── store.js        Storage layer: 180-day detail retention + permanent daily rollups + persistence (pure logic, unit-testable)
├── pricing.js      Pricing & tokens: price tables, peak/off-peak billing, vision model, peak-phase math (pure logic, unit-testable)
├── config.js       Config layer: defaults & normalization for the peak-price notice (pure logic, unit-testable)
├── client.js       Client half: settings dashboard, status line & peak-price notice UI
├── package.json    Plugin manifest (with dsh.client declaration)
├── test/           Unit tests (node test/storage.test.js)
└── docs/           README screenshots
```

## License

[MIT](./LICENSE) · Issues and PRs welcome
