<div align="center">

# <img src="./docs/icon-mark.svg" width="30" valign="bottom" alt="icon"> DSH Cost Tracker

**LLM COST & USAGE TRACKING PLUGIN FOR DEEPSEEK HARNESS**

[简体中文](./README.md) | **English**

[![version](https://img.shields.io/npm/v/@angelyeye/dsh-cost-tracker?label=version&style=flat-square)](https://www.npmjs.com/package/@angelyeye/dsh-cost-tracker)
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
| ⏰ | **Peak/off-peak pricing** | Built-in price table; peak windows (Mon–Fri 9:00–12:00, 14:00–18:00 Beijing time) vs half-price off-peak handled automatically; **weekends are fully off-peak**; local models (e.g. ollama) count as 0; the table is **versioned by pricing era** and switches automatically to V4.1 Flash rates at 2026-09-10 12:00 Beijing time (peak 2.0 / 0.04 / 8.0), routing the legacy V4-Flash family to V4.1 Flash billing per the official rules; **V4-Pro is routed from 2026-09-14 12:00 only** (before that it keeps its own rates 9.0 / 27.0 / 0.30) |
| 🔔 | **Peak-price notice** | A "Peak/off-peak pricing & notice" panel in Settings: current tier + countdown strip, style switch (**compact single-row · 24h-proportional** / **ring dial · phase dot**), an optional **two-row compact** stacked layout for the compact style (bar-above-text / text-above-bar), a "Show time" toggle, popup alert + browser notification before a tier switch, lead time, popup position (bottom-right/center), alert type; a persistent strip in the sidebar footer (adapts to rail/collapsed). Mirrors `dsh-cost-meter` |
| 📌 | **Six overview cards** | Six cards at the top of Settings: Today / This month / Total spend / API requests / Tokens / **Account balance**. The three spend cards **exclude subscription equivalent cost** (shown as an annotation instead) |
| 👁️ | **Vision model** | Supports `deepseek-v4-flash-vision-exp`: priced as flash in the legacy era, billed at V4.1 Flash rates from 2026-09-10 12:00 (that legacy id is retired; requests are served by V4.1 Flash); images are converted to tokens per the official rule (≤384 tokens each, billed per API usage) |
| 🏷️ | **Official model-name alignment** | Billing recognises the official current name **`deepseek-flash`** (price-card note (1): "use the model name `deepseek-flash`"); older spellings such as `deepseek-v4.1-flash` normalize to the same rate, so an official rename can never silently drop usage into the fallback estimate |
| 📊 | **Visual dashboard** | A new "Cost Statistics" page in Settings: overview cards, cost bar charts (by peak period / by model), per-model request & token charts — **all with hover tooltips** |
| 🧭 | **Multi-machine aggregation (cloud sync)** | Point it at your own **self-hosted cloud service** (separate `dsh-cost-cloud` repo, zero runtime dependencies) to merge usage from several computers; the dashboard then offers a **This machine / This machine + cloud / Cloud only** switcher plus a **device × Agent matrix** (row totals = column totals = grand total). Only token counts, cost, timestamps and identifiers are uploaded, with optional session-id masking |
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
>
> One caveat for Option A: the plugin marketplace itself requires `dsh web ≥ 0.1.0-rc.6`. On an older host the **Plugin Marketplace** entry never appears at all — in that case use Option B or Option C.

### Option A: Install from the plugin marketplace (recommended)

This plugin is listed in the curated [awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) catalog (category `usage`). Open **Settings → Plugin Marketplace** inside DSH, search for `dsh-cost-tracker` and press install. The equivalent command line is:

```bash
dsh plugin --profile web add @angelyeye/dsh-cost-tracker
```

> You can also install straight from the repository with `dsh plugin --profile web add github:Angelyeye/dsh-cost-tracker`. It yields the same package: the name comes from the bundle's own `package.json`, so the graph row id — and therefore the client-registration requirement — is identical either way.

The marketplace installs the plugin into your profile and writes the loader config for you. It installs **the latest published version** — no manual `git clone`, no hand-editing the patch file. Restart `dsh web` and refresh the browser when prompted.

### Option B: Let DSH install it for you (no CLI knowledge needed)

Open any DSH session and paste this prompt verbatim to the agent:

```
Please install the DSH plugin @angelyeye/dsh-cost-tracker for me:
1. git clone https://github.com/Angelyeye/dsh-cost-tracker.git into ~/.dsh/profiles/node_modules/@angelyeye/dsh-cost-tracker (the directory MUST match the package name)
2. Append to the top-level array of ~/.dsh/profiles/web/cordis.patch.yml:
   - insert:
       - id: dsh-cost-tracker
         name: "@angelyeye/dsh-cost-tracker"
3. Tell me when done — I will restart dsh web myself
```

Then stop `dsh web` with `Ctrl+C`, start it again, and refresh your browser.

### Option C: Manual install (3 commands)

```bash
# 1. Download the plugin (directory name must match the package name)
mkdir -p ~/.dsh/profiles/node_modules/@angelyeye
git clone https://github.com/Angelyeye/dsh-cost-tracker.git ~/.dsh/profiles/node_modules/@angelyeye/dsh-cost-tracker

# 2. Register the plugin (append to the patch file)
cat >> ~/.dsh/profiles/web/cordis.patch.yml <<'EOF'
- insert:
    - id: dsh-cost-tracker
      name: "@angelyeye/dsh-cost-tracker"
EOF

# 3. Restart DSH (Ctrl+C the running dsh web first)
dsh web
```

### Verify it works

1. Open the DSH Web GUI → **Settings** (bottom-left) → a **"Cost Statistics"** entry appears in the sidebar;
2. A cost status line shows up under the chat input;
3. Ask the agent "check my current spending" — a correct answer means everything is ready.

> ⚠️ If `~/.dsh/profiles/web/cordis.patch.yml` already contains entries, keep them and only append the block above; the file's top level must remain a YAML array.

### Migrating from the old package name (only installs of v1.6.0 or older)

As of v1.7.0 the package name changed from `dsh-cost-tracker` to `@angelyeye/dsh-cost-tracker` — the old name is held on npm by an unrelated package, and the marketplace's npm mapping requires the published name to equal the repository's `package.json` `name`.

> ⚠️ **The v1.7.0 migration guidance has been corrected.** v1.7.0 shipped a client-registration defect (see the v1.7.1 entry in [`CHANGELOG.md`](./CHANGELOG.md)): the client half fails to load for **every** install of v1.7.0, whichever way it was installed. Install **v1.7.1 or newer** — do not troubleshoot by reinstalling v1.7.0. Installing from the repository does not help either: the package name is the same, so the graph row id is the same, and the fault is inside the bundle.

⚠️ **Do not simply install the new version on top of the old one.** Both versions' `cordis.patch.yml` insert the **same loader id** (`dsh-cost-tracker`), so stacking them loads **both copies** — duplicated HTTP routes, agent tools and UI slots. Remove the old one first:

**Marketplace install** (installed via `dsh plugin add`):

```bash
dsh plugin --profile web remove dsh-cost-tracker
dsh plugin --profile web add @angelyeye/dsh-cost-tracker
```

**Manual clone install**:

```bash
# 1. Edit ~/.dsh/profiles/web/cordis.patch.yml and remove the - insert: block whose id is dsh-cost-tracker (4 lines)
# 2. Delete the old directory
rm -rf ~/.dsh/profiles/node_modules/dsh-cost-tracker
# 3. Reinstall once via Option A above
```

> Note: if you delete the old directory but leave that `- insert:` block in `cordis.patch.yml`, DSH fails to resolve the module name `dsh-cost-tracker` at startup and the profile will not load. Handle both together.

**No data is lost**: usage records live in `~/.dsh/storages/cost-tracker-records.json`, independent of the plugin directory, the package name and the install method.

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
| `cost_stats` | Query usage & cost statistics (`scope=local` (default, this machine) / `cloud` (all machines) / `both`) | "How much did I spend today?" · "What did all my machines cost together?" |
| `cost_prices` | Show the built-in price table & peak rules | "What does deepseek-v4-flash cost right now?" |
| `cost_peak` | Show the current peak tier & next-switch countdown | "Is it peak hour right now?" |
| `cost_recompute` | **Re-price stored records by pricing era (one-off backfill)**, dry-run by default | "Re-price the records from before the price change" |
| `cost_sync` | **Cloud sync**: status / sync now / test connection / update config | "Sync my usage to the cloud" · "Is cloud sync healthy?" |
| `cost_reset` | **Erase ALL statistics (irreversible)** | "Reset my cost statistics" |

### Multi-machine aggregation (cloud sync, v1.8.0)

Running DSH on several computers? Send usage to your own **self-hosted cloud service** and see the network-wide totals — broken down by device and by agent — from any of them.

**Deploy the service** (separate repo, zero runtime dependencies):

```bash
git clone <your repo url> dsh-cost-cloud && cd dsh-cost-cloud
cp .env.example .env      # fill SESSION_SECRET and ADMIN_PASSWORD_HASH (node scripts/hash-password.js "pw")
docker compose up -d      # open http://<server>:8787 and generate a shared bootstrap token under Settings
```

**Configure each device**: open **Settings → Plugins → Plugin configuration → Cost Tracker** and fill in:

| Field | Meaning |
| --- | --- |
| Device name | How this machine shows up on the dashboard |
| Service URL | e.g. `https://cost.example.com` |
| Shared token | the `dshc_...` value from the cloud Settings page |
| Sync interval | 60s by default |

Then hit `Test connection` → `Sync now`. Back in **Settings → Cost Tracker** the view switcher appears:

| View | Meaning |
| --- | --- |
| **This machine** | local-only (identical to running without cloud sync) |
| **This machine + cloud** | this machine + **all other devices** + **the other agents running on this machine** (server-side *union*, nothing double-counted) |
| **Cloud only** | cloud records only (includes this machine's synced part) |

> The union behind "This machine + cloud" is `other devices` ∪ `non-DSH agents on this machine`.
> So with several machines and mixed agents: this machine's DSH numbers come from local storage, its ZCode/Codex (etc.) numbers come from the cloud, and every other computer comes from the cloud — the three add up to exactly the whole network, with nothing counted twice or missed.

The dimension selector adds per-device / per-agent / per-model breakdowns and a **device × Agent matrix** (row totals = column totals = grand total).

**Other agents can report too**: the ingest protocol is open. Any agent's stats plugin that implements `docs/INGEST-API.md` in the `dsh-cost-cloud` repo is aggregated with no server changes, and a new agent column shows up automatically.
**Key rule**: every agent on the same machine must share one `machineId` (the shared `~/.dsh-cost/device.json` file); otherwise one computer is counted as several devices.

**Privacy**: only token counts, cost, timestamps and identifiers are uploaded — never prompts, responses, file paths or code. The config card offers "mask session id" (irreversible hash) and "omit purpose".

### HTTP API (for other tools)

All endpoints are `POST` + JSON and listen on the loopback address:

```
POST /api/cost-tracker/summary      Overview
POST /api/cost-tracker/dashboard    Dashboard data
POST /api/cost-tracker/usage        Usage heatmap (all-time totals + daily token aggregation)
POST /api/cost-tracker/peak         Peak-phase snapshot (current tier / next switch / config)
POST /api/cost-tracker/peak-config  Save peak-price notice config
POST /api/cost-tracker/sync         Cloud sync status (device id / watermark / pending / last error)
POST /api/cost-tracker/sync-now     Sync now ({"full":true} to re-send everything)
POST /api/cost-tracker/sync-test    Test the cloud connection
POST /api/cost-tracker/sync-config  Save cloud sync config
POST /api/cost-tracker/cloud        Read-only cloud aggregation (route/days/excludeSelf/devices/sources)
POST /api/cost-tracker/kimi-usage   Kimi subscription quota
POST /api/cost-tracker/balance      Account balance
POST /api/cost-tracker/prices       Price table (versioned by pricing era)
POST /api/cost-tracker/recompute    Re-price stored records by era (dry-run unless {"apply":true})
POST /api/cost-tracker/export       CSV export
```

Example: `curl -X POST http://127.0.0.1:3080/api/cost-tracker/summary -d '{}'`

---

## Changelog

> Highlights only — the full version-by-version history lives in [`CHANGELOG.md`](./CHANGELOG.md) (Chinese).

### v1.8.11 (2026-09-17)

**Added: startup detection of "another dsh instance is using the same records file", reported by name**

- The root cause behind the v1.8.10 `EPERM` report was exactly this: **a previous `dsh` instance was still running when another was started**, so two instances wrote the same records file, overwrote each other, and tripped `rename`'s EPERM on Windows. Until now the only clue was a stack trace.
- On startup the plugin now registers a **advisory-only** instance lock next to the records file (`.lock`, holding pid / version). If the holder is still alive it prints the culprit and what to do (Ctrl+C the old instance first). It **never blocks startup**: a stale, corrupted or self-owned lock is ignored, and shutdown only removes its own lock.
- Verified with two real processes: the second instance printed `检测到另一个 dsh 实例（PID 15784 · v1.8.10）…` (detected another dsh instance) immediately.

**Docs: both READMEs caught up on long-standing drift (no functional change)**

- The English changelog was backfilled with v1.8.7–v1.8.10 (it had stopped at v1.8.6) plus the missing v1.3.0; the "This machine + cloud" semantics were corrected from the outdated "the server excludes this machine" to the actual **union** (other devices ∪ non-DSH agents on this machine); a "Multi-machine aggregation (cloud sync)" feature row and `sync.js` / `view.js` / `schema.js` were added (the feature table had no cloud entry at all).
- The Chinese README gained the two missing dashboard bullets (**Six overview cards**, **Peak-price notice**) and a note in the restart FAQ about transient write locks.
- Both READMEs now use a **dynamic npm version badge** (instead of a hardcoded v1.6.0), and the changelog heading points at `CHANGELOG.md` for the full history.

### v1.8.10 (2026-09-17)

**Fixed: occasional `EPERM` on flush (a `rename` blocked by a transient lock) printing a scary stack trace**

- **Symptom**: restarting `dsh web` printed `cost tracker persist failed Error: EPERM: operation not permitted, rename '...cost-tracker-records.json.tmp' -> '...cost-tracker-records.json'` with a full stack. **No data was lost** (it was still in memory and the next flush succeeded), but it looked like a crash.
- **Root cause**: `persist()` is "write a temp file → `rename` over the target", but it **only tried once**. On Windows `rename` needs *delete* access to the target, which fails transiently when an antivirus/search indexer has just scanned the temp file, when Explorer preview or a backup/sync tool is reading it, or when a **previous `dsh` instance has not fully exited** (or two instances run at once). The temp file also used a fixed name (`<file>.tmp`), so two instances were guaranteed to collide on it.
- **Fix**: temp name now carries the **pid**; `rename` **retries with backoff** on `EPERM/EACCES/EBUSY` (20/40/80/160 ms, 5 attempts ≈ 0.35 s) while `ENOENT`-style errors are not retried; if it still fails the plugin does **not** fall back to an in-place overwrite (a concurrent reader could see half a JSON file, and `load()` treats that as corruption — renaming it to `.corrupt-*` and starting empty, which is far worse than a few seconds of delay) — the data stays in memory and is retried instead. `index.js` then schedules **3 more delayed retries** (2 s / 4 s / 6 s) and stays **silent until the retry chain is exhausted**, printing one clear "cause + impact" message instead of a stack. The final flush on shutdown gets 10 attempts (~2 s).
- **Verified** against a real Windows file lock (`[System.IO.File]::Open(..., FileShare.Read)`): a held lock → retries, then gives up with the **original file byte-identical**, no leftover temp file and a readable message; a lock released after 120 ms → the 3rd attempt succeeds with no intervention; quiet mode on failure → empty stderr.

### v1.8.9 (2026-09-17)

**Wording fix: "平峰" → "不分峰谷" (flat / tier-independent), and the third legend item is hidden when it is zero**

- The peak/off-peak chart's third legend item was labelled 平峰 — a literal translation of the internal `period='flat'`. Official pricing has **only two tiers**: peak (Mon–Fri 9:00–12:00, 14:00–18:00 Beijing time) and off-peak (peak × 0.5, weekends fully off-peak). `flat` actually means "**this charge does not depend on the time of day**" (`price.tiered === false`: subscription plans, non-DeepSeek provider fallbacks, unknown-model generic rates). In Chinese electricity-tariff usage 平峰/平段 means a *third time-of-day tier*, so the label implied DeepSeek has three price tiers.
- It also occupied a legend slot and a colour swatch even when the whole window was 0 (the normal case when only DeepSeek pay-as-you-go calls are recorded), reinforcing the illusion.
- The legend, the "period" column of recent records and the `cost_peak` tool output now read **"不分峰谷"**, and the legend/chart only include the third series **when the window's flat total is > 0**. Billing logic and the `flat` field are unchanged.

### v1.8.8 (2026-09-15)

**Fixed: the "Cloud only" view showed request counts but every amount as ¥0.0000 (field-name mismatch)**

- The cloud's `/api/v1/overview` returns `realCost` / `subEquivalent`, while the local dashboard and every card reads `real` / `sub`. The client-side normalization passed the fields straight through (and dropped `summary` entirely), so the amounts were all zero while `calls`/`tokens` — same names on both sides — survived. **The cloud fixture in the tests used `real/sub`, which hid the defect**; it now uses the real online shape.
- `view.js` gained `cloudSlices()` for per-field mapping (accepting `realCost/real`, `subCost/subEquivalent/sub` for backwards compatibility), with the inline fallback in `client.js` kept identical.

**Added: cloud `GET /api/v1/plugin-view` (device-token readable) so "Cloud only" can draw charts**

- The client needs `byDay / byModel / byModelDay / recent` to draw the cost chart, per-model detail and recent records; `/api/v1/overview` only returned the summary cards, so those panels were structurally empty. The new endpoint returns exactly the local `buildDashboard` shape and supports `union`.
- The plugin probes `/api/v1/health` capabilities and prefers `plugin-view`, falling back to `overview` on older cloud servers (cards work, charts stay empty) instead of failing outright.
- Fixed the same class of bug on the cloud side: `pluginView()`'s today/month/all slices were taken from an unfiltered table scan, **bypassing `excludeDevice`** (so "This machine + cloud" counted this machine twice); they now use the same filter, with `calls/tokens` holding pay-as-you-go only and subscriptions counted separately (`subCalls`/`subTokens`).

### v1.8.7 (2026-09-15)

**Fixed: `cost_recompute` only scanned the most recent pricing era, silently skipping older stale records**

- After the v1.8.6 backfill, **750 `deepseek-flash` records were still flagged "estimated"** (timestamps 09-10 21:24 … 09-14 02:36): the default `since` was the start of the latest pricing era (`v41pro` = 09-14 12:00), so nothing before it was scanned — yet the tool reported "no records needed re-pricing".
- The default is now a **full-range scan (`since = 0`)**, and `since: 0` is correctly recognised as "all time" (the old `> 0` check fell through to the era default). In full-range mode `era` is reported as `null` instead of claiming a single era. The backfill is idempotent, so the extra scan is cheap.
- Measured locally: `scanned=1642 / changed=772 / estimatedFlips=750 / delta=0.0000`, and a second run reported `changed=0` — the "estimated" flag was cleared on 1643 `deepseek-flash` records with **amounts unchanged** (only the 5 Kimi subscription records stay estimated, which is correct).
- Hardening: `client-registration.test.js` now asserts that the `package.json` version equals `index.js`'s `PLUGIN_VERSION` (they had drifted in the v1.8.6 release).

### v1.8.6 (2026-09-15)

**Fixed: two basis mismatches against DeepSeek's official pricing** (checked against the official [price card](https://api-docs.deepseek.com/zh-cn/quick_start/pricing) and the [V4.1 Flash announcement](https://api-docs.deepseek.com/zh-cn/news/news260910))

- **The V4-Pro routing date was 4 days early (understated spend)**: the old code merged `deepseek-v4-pro → V4.1 Flash` routing with the Flash price change (09-10 12:00), but the official wording is "after **2026-09-14 12:00 Beijing time**". V4-Pro calls in that 4-day window were understated by roughly 4.5×. The eras are now split with `v41pro` (`V41_PRO_ROUTE_AT = 2026-09-14T04:00:00Z`), and era `v41` keeps V4-Pro's own rates (9 / 27 / 0.30).
- **The official current model name `deepseek-flash` was missing from the exact table (records mislabelled "estimated")**: the official docs say "use the model name `deepseek-flash`", while the code used the non-callable `deepseek-v4.1-flash` as its canonical name — so the real name fell through to the provider fallback. The amount was exactly right, but every record was flagged `estimated: true` (1402 local records affected). `deepseek-flash` is now canonical, with an alias table (`MODEL_ALIASES`) mapping equivalent spellings.
- **`cost_recompute` no longer skips "flag-only" changes**: it now reports `estimatedFlips` and states explicitly that N records only had their "estimated" flag corrected with no amount change.
- **Stored amounts do not change**: only the `estimated` flag, the V4-Pro basis inside the 09-10…09-14 window, and the bucket merge of historical `deepseek-v4.1-flash` records (22 locally) into `deepseek-flash`. Running `cost_recompute` once is recommended (dry-run by default, `apply: true` to persist).

### v1.6.0 (2026-09-10)

**Added**
- **Support for the V4.1 Flash pricing rules (effective 2026-09-10 12:00 Beijing time)**: the price table is now **versioned by pricing era** (`PRICE_ERAS`) and each record is priced with **its own timestamp**, so historical records keep their original basis and the switch happens automatically — no restart or config change needed.
  - New era `v41` (2026-09-10 12:00 Beijing = `2026-09-10T04:00:00Z`): V4.1 Flash peak rates are **input (cache hit) 0.04 / input (cache miss) 2 / output 8** (CNY per 1M tokens); off-peak remains exactly half (0.02 / 1 / 4). **Peak windows are unchanged**, so the peak strip and countdown need no changes.
  - New **model routing** (per-era `routes`): until V4.1 Pro ships, V4-Pro requests are routed to V4.1 Flash and billed at V4.1 Flash rates; the legacy V4-Flash family (including `deepseek-v4-flash-vision-exp`) is superseded by V4.1 Flash and billed the same way. **Records are booked under the model that was actually billed** (e.g. `deepseek-v4-pro` → `deepseek-v4.1-flash`), so per-model aggregation reflects the real billing basis.
  - New exports: `V41_EFFECTIVE_AT` / `V41_FLASH_MODEL` / `PRICE_ERAS` / `eraAt()` / `exactModelsAt()` / `resolveModelInEra()` / `normalizeModelName()`.
- **Model-name normalization**: names are lowercased with separators stripped, so `deepseek-v4.1-flash` / `deepseek-v4-1-flash` / `deepseek-v41-flash` / `DeepSeek-V4.1-Flash` all resolve to the same rate, preventing a silently mis-priced fallback if the official model ID is spelled differently.
- `cost_prices` and the HTTP `/prices` endpoint now **render every era**: effective time, rates and routing rules, plus the currently effective era (`era` / `eraLabel` / `eras` / `v41EffectiveAt`).

- **New `cost_recompute` one-off backfill tool** (also exposed as HTTP `/api/cost-tracker/recompute`): re-prices stored records and rewrites the billed model name using the timestamp of each record. It targets records booked at the old price between the era switch and a host restart; it **dry-runs by default** and writes back only with `apply: true`, and it is idempotent. Only detail rows are recomputed (details cover the last 180 days; older records are already folded into daily rollups whose time range predates any pricing switch).

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

### v1.3.0 (2026-08-23)

**New**
- **Token usage heatmap**: a "Token Usage" panel in Settings with a Codex-style **26-week daily-usage grid**, shaded into 4 levels by each day's token count relative to the maximum and stretched to the panel width; hover any cell for that day's breakdown (date / input / cache / output / cost), today outlined; all-time totals on top (`累计 X tokens · input · cache · output · N calls`). Adds `POST /api/cost-tracker/usage`. Date keys are always Beijing time (UTC+8), matching the server's bucketing.
- **Per-model split for the current session**: the status line breaks the session down by the models actually used, with subscriptions counted separately from pay-as-you-go.

**Improved**
- **Status line redesign**: a **segmented pill** layout (session / subscription plan / per-model), pipe-separated and baseline-aligned.
- **Session cost only**: no more cumulative amount or current peak/off-peak price.
- **Subscription de-duplication**: subscriptions appear once as a colored badge (plan name + total equivalent cost) instead of repeating in the model area.
- **Multi-model collapsing**: top-2 models plus a count by default; click `▸` to expand the full list.
- **Less noise**: quota leftovers and per-model call counts (`×N`) removed.
- **Visual consistency**: unified amount weight and colors.

**Fixed**
- The status line no longer depends on the "currently selected model"; it follows the models/subscriptions actually used in the session, fixing wrong figures when switching sessions and subscription sessions showing ¥0.
- The heatmap tooltip now repositions near the left/right/top edges instead of being clipped by the container.

---

## FAQ

**Q: Where is my data? Is it safe?**
Everything stays on your machine in `~/.dsh/storages/cost-tracker-records.json`; nothing is uploaded. The API binds to loopback but has no authentication — **do not expose the DSH port to the public internet**.

**Q: Do I lose data when DSH restarts?**
No. Records are flushed to disk with debounced atomic writes (temp file + `rename`) and restored on startup. A corrupted file is backed up as `.corrupt-<timestamp>` and tracking restarts cleanly.
If a flush hits a **transient lock** (on Windows: an antivirus/indexer/backup tool reading the file, or a previous `dsh` instance that has not exited yet) it **retries with backoff**; if the retries fail the data stays in memory and is retried later, and the existing file is **never left half-written**. If this keeps happening, make sure two DSH instances are not running at once.

**Q: How long is history kept? Is there a stats cap?**
Detail records are kept for the last **180 days**; older records are auto-compressed into **permanent daily rollups** (aggregates only: calls / token breakdown / cost — no per-call details). So all-time totals and per-model stats stay **exact forever**, while memory, disk and write volume stay bounded no matter how long you run. The daily chart axis spans up to 730 days. Old-format data files migrate automatically; set the `DSH_COST_TRACKER_STORE` env var to override the store path (default `$DSH_HOME/storages`, or `~/.dsh` when `DSH_HOME` is unset).

**Q: How do I enable/disable the startup logs?**
The plugin starts **silently by default**. Set the environment variable `DSH_COST_TRACKER_LOG=1` (or `true` / `yes` / `on`) to enable startup logs: nav-icon self-check results, the data-restore report (`restored N detail records ...`) and the ready marker. **Error logs** (persist failures, corrupted files, etc.) are always printed and are not affected by this switch.

**Q: What does "equivalent cost" mean for subscription models (kimi-coding)?**
Subscriptions are not billed per token. The plugin estimates what those calls *would* cost at pay-as-you-go prices so you can judge whether your subscription pays off — **it is not a real charge**.

**Q: The amounts don't exactly match my official bill?**
Costs are estimated locally from a built-in price table and may differ slightly from the official bill (price updates, tiered pricing, etc.). Treat official billing as authoritative; the balance shown is fetched live from the official API.

**Q: How do I uninstall?**
1. **Remove the loader entry first** — marketplace install: open **Settings → Plugin Marketplace → Installed** and uninstall there (it also cleans up the patch entry it wrote); manual install: open `~/.dsh/profiles/web/cordis.patch.yml` and remove the 4-line `- insert:` block for `dsh-cost-tracker` (or ask the DSH agent to do it);
2. Restart `dsh web`;
3. Optionally delete `~/.dsh/profiles/node_modules/@angelyeye/dsh-cost-tracker` and `~/.dsh/storages/cost-tracker-records.json`.

**Q: How do I update the plugin?**
- **Marketplace install:** open **Settings → Plugin Marketplace → Updates**, or re-run `dsh plugin --profile web add @angelyeye/dsh-cost-tracker`;
- **Manual install:** run `git pull` inside the plugin directory.

Either way: if only the UI (`client.js`) changed, a **hard browser refresh** (Cmd/Ctrl+Shift+R) is enough; if `index.js` changed, restart `dsh web`.

## Repository layout

```
├── index.js        Host half: usage capture, aggregation, HTTP API, agent tools
├── store.js        Storage layer: 180-day detail retention + permanent daily rollups + atomic writes (with lock retries; pure logic, unit-testable)
├── pricing.js      Pricing & tokens: price tables, peak/off-peak billing, vision model, peak-phase math (pure logic, unit-testable)
├── config.js       Config layer: defaults & normalization for the peak-price notice and cloud sync (pure logic, unit-testable)
├── sync.js         Cloud sync engine: device identity, incremental watermark, idempotent batches, backoff
├── schema.js       Host settings schema (the plugin-config card fields)
├── view.js         Three-state view merge: normalizes This machine / + cloud / Cloud only (shared by browser and tests)
├── client.js       Client half: settings dashboard, status line & peak-price notice UI
├── package.json    Plugin manifest: declares dsh.bundle (what makes it installable) and dsh.client (browser UI)
├── cordis.patch.yml Bundle patch: registers the plugin with DSH's loader, pointed at by dsh.bundle
├── screenshots.json Marketplace detail-page screenshot list (relative paths, 1-8 images)
├── README.md       Chinese documentation
├── README.en.md    English documentation
├── CHANGELOG.md    Changelog (Chinese)
├── test/           Unit tests (storage / pricing / config / recompute / render / cloud read; node test/*.test.js)
└── docs/           README screenshots and design notes
```

## License

[MIT](./LICENSE) · Issues and PRs welcome
