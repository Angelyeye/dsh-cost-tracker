// ============================================================
// DSH 花费统计插件 —— Host 半端（静态版）
// 由动态版 cost-tracker.host.js 改造而来：
//   harness.handle  → webServer HTTP 路由（/api/cost-tracker/*）
//   harness.*Tool   → ctx.tools.register
//   subprocess node → 原生 fetch + node:fs
//   新增数据持久化 → ~/.dsh/storages/cost-tracker-records.json
// ============================================================
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, realpathSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { homedir } from 'node:os'

// ============================================================
// 设置侧边栏图标补丁 · 启动自愈
// DSH 设置外壳的 navIcon() 按 id 硬编码图标，未知 id 回退齿轮；
// slot 注册不支持自带图标，只能给外壳产物打补丁。
// DSH 升级/重装会覆盖外壳文件 —— 因此每次启动自检，缺失即重打。
// 任何一步失败都静默跳过（侧边栏回退齿轮，面板内图标不受影响）。
// ============================================================
const NAV_ICON_BRANCH = 'if (id === "cost-dashboard") return (0, react_jsx_runtime.jsxs)("svg", { className: SettingsRoot_module_css_default.navIcon, width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", xmlns: "http://www.w3.org/2000/svg", children: [(0, react_jsx_runtime.jsx)("rect", { x: 1.5, y: 8.6, width: 3.1, height: 5.9, rx: 0.9, fill: "currentColor" }), (0, react_jsx_runtime.jsx)("rect", { x: 5.9, y: 5.2, width: 3.1, height: 9.3, rx: 0.9, fill: "currentColor" }), (0, react_jsx_runtime.jsxs)("g", { fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round", children: [(0, react_jsx_runtime.jsx)("path", { d: "M10.7 4.9 L12.3 7.2 L13.9 4.9" }), (0, react_jsx_runtime.jsx)("path", { d: "M12.3 7.2 L12.3 10.9" }), (0, react_jsx_runtime.jsx)("path", { d: "M10.9 7.8 L13.7 7.8" }), (0, react_jsx_runtime.jsx)("path", { d: "M10.9 9.5 L13.7 9.5" })] })] }); // cost-tracker-icon-patch\n\t\t\t'

export function ensureNavIconPatch(opts) {
  const log = (opts && opts.log) || (() => {})
  try {
    const entry = (opts && opts.entry) || (process.argv && process.argv[1]) || ''
    // 全局安装通常通过符号链接启动（如 /opt/homebrew/bin/dsh），需同时尝试 realpath
    const entries = [entry]
    try { const real = realpathSync(entry); if (real && real !== entry) entries.push(real) } catch (e) {}
    let shellFile = ''
    for (const e0 of entries) {
      let dir = dirname(e0)
      for (let i = 0; i < 8 && dir && dir !== dirname(dir); i++) {
        const candidate = join(dir, 'node_modules', '@deepseek-ai', 'dsh-client-ui-settings-general', 'lib', 'client.js')
        if (existsSync(candidate)) { shellFile = candidate; break }
        dir = dirname(dir)
      }
      if (shellFile) break
    }
    if (!shellFile) { log('skip: settings shell not found'); return false }
    const src = readFileSync(shellFile, 'utf8')
    if (src.includes('id === "cost-dashboard"')) { log('ok: already patched'); return true }
    const anchor = /function navIcon\(id\)\s*\{\s*/.exec(src)
    if (!anchor) { log('skip: navIcon() not found (shell layout changed?)'); return false }
    if (!src.includes('react_jsx_runtime') || !src.includes('SettingsRoot_module_css_default')) {
      log('skip: expected identifiers missing (shell layout changed?)'); return false
    }
    if (!existsSync(shellFile + '.cost-tracker-bak')) writeFileSync(shellFile + '.cost-tracker-bak', src)
    const at = anchor.index + anchor[0].length
    const tmp = shellFile + '.cost-tracker-tmp'
    writeFileSync(tmp, src.slice(0, at) + NAV_ICON_BRANCH + src.slice(at))
    renameSync(tmp, shellFile)
    log('ok: patch applied -> ' + shellFile)
    return true
  } catch (e) {
    log('skip: ' + String(e && e.message ? e.message : e))
    return false
  }
}

export default {
  name: 'cost-tracker',
  inject: ['tools', 'webServer'],
  apply(ctx) {
    // 侧边栏图标补丁自愈（DSH 升级覆盖外壳后自动重打；失败静默跳过）
    ensureNavIconPatch({ log: (m) => console.log('[cost-tracker] nav-icon ' + m) })

    // ---------- price tables (CNY per 1M tokens) ----------
    const EXACT_MODELS = {
      'deepseek-v4-flash': { input: 3.0, output: 9.0, cacheRead: 0.10, cacheWrite: 3.0 },
      'deepseek-v4-pro': { input: 9.0, output: 27.0, cacheRead: 0.30, cacheWrite: 9.0 },
    }
    const SUBSCRIPTION_RATES = { 'kimi-coding': { input: 6.5, output: 27.0, cacheRead: 1.1, cacheWrite: 6.5 } }
    const PROVIDER_RATES = {
      deepseek: { rates: { input: 3.0, output: 9.0, cacheRead: 0.10, cacheWrite: 3.0 }, tiered: true },
      openai: { rates: { input: 10.0, output: 30.0, cacheRead: 5.0, cacheWrite: 10.0 }, tiered: false },
      anthropic: { rates: { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 15.0 }, tiered: false },
      gemini: { rates: { input: 2.5, output: 10.0, cacheRead: 0.625, cacheWrite: 2.5 }, tiered: false },
      ollama: { rates: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tiered: false },
      local: { rates: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tiered: false },
    }
    const GENERIC_RATES = { input: 2.0, output: 8.0, cacheRead: 0.5, cacheWrite: 2.0 }
    const PEAK_WINDOWS = '9:00-12:00 · 14:00-18:00'
    const MAX_RECORDS = 10000
    const PERSIST_COUNT = 5000

    // ---------- state ----------
    const records = []
    let kimiCache = null

    // ---------- small helpers ----------
    function pad2(n) { return n < 10 ? '0' + n : '' + n }
    function toInt(x) { const n = parseInt(x, 10); return isNaN(n) ? 0 : n }
    function toStr(x) { return x === undefined || x === null ? '' : String(x) }
    function toNum(x) { const n = Number(x); return isNaN(n) ? 0 : n }
    function r2(x) { return Math.round(x * 100) / 100 }
    function r4(x) { return Math.round(x * 10000) / 10000 }
    function normProvider(p) { return toStr(p).toLowerCase().replace(/-official$/, '') }
    function isPeak(ts) { const h = new Date(ts + 28800000).getUTCHours(); return (h >= 9 && h < 12) || (h >= 14 && h < 18) }
    function dayKey(ts) {
      const d = new Date(ts + 28800000)
      return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
    }
    function timeLabel(ts) {
      const d = new Date(ts + 28800000)
      return (d.getUTCMonth() + 1) + '/' + d.getUTCDate() + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes())
    }
    function priceFor(np, model) {
      if (SUBSCRIPTION_RATES[np]) return { rates: SUBSCRIPTION_RATES[np], tiered: false, estimated: true, subscription: true }
      if (EXACT_MODELS[model]) return { rates: EXACT_MODELS[model], tiered: true, estimated: false, subscription: false }
      const p = PROVIDER_RATES[np]
      if (p) return { rates: p.rates, tiered: p.tiered, estimated: true, subscription: false }
      return { rates: GENERIC_RATES, tiered: false, estimated: true, subscription: false }
    }
    function computeCost(rates, tiered, peak, t) {
      const f = tiered && !peak ? 0.5 : 1
      return (t.input * rates.input + t.output * rates.output + t.cacheRead * rates.cacheRead + t.cacheWrite * rates.cacheWrite) * f / 1000000
    }

    // ---------- persistence ----------
    const STORE_DIR = join(homedir(), '.dsh', 'storages')
    const STORE_FILE = join(STORE_DIR, 'cost-tracker-records.json')
    const STORE_TMP = STORE_FILE + '.tmp'

    function writeRecords() {
      try {
        mkdirSync(STORE_DIR, { recursive: true })
        const snapshot = records.slice(-PERSIST_COUNT)
        writeFileSync(STORE_TMP, JSON.stringify(snapshot), 'utf8')
        renameSync(STORE_TMP, STORE_FILE)
      } catch (e) {
        console.error('cost tracker persist failed', e)
      }
    }

    function loadRecords() {
      try {
        if (!existsSync(STORE_FILE)) return
        const parsed = JSON.parse(readFileSync(STORE_FILE, 'utf8'))
        if (!Array.isArray(parsed)) return
        for (const r of parsed) {
          if (!r || typeof r !== 'object' || typeof r.ts !== 'number') continue
          records.push(r)
        }
        if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS)
        console.log('cost tracker restored ' + records.length + ' records from ' + STORE_FILE)
      } catch (e) {
        // 损坏时改名备份，从零开始，不阻断启动
        try { renameSync(STORE_FILE, STORE_FILE + '.corrupt-' + Date.now()) } catch (e2) {}
        console.error('cost tracker load failed, starting empty', e)
      }
    }

    let persistPending = false
    let persistTimer = null
    function schedulePersist() {
      if (persistPending) return
      persistPending = true
      const run = () => {
        persistPending = false
        persistTimer = null
        writeRecords()
      }
      const timer = ctx.get('timer')
      persistTimer = timer ? timer.timeout(run, 1500) : setTimeout(run, 1500)
    }
    function persistNow() {
      persistPending = false
      if (persistTimer) { try { persistTimer() } catch (e) {} persistTimer = null }
      writeRecords()
    }

    // ---------- recording ----------
    function recordUsage(options, usage, ts) {
      const provider = toStr(options && options.provider)
      const model = toStr(options && options.model)
      if (!provider && !model) return
      const np = normProvider(provider)
      const price = priceFor(np, model)
      const peak = isPeak(ts)
      const tokens = {
        input: toNum(usage.inputTokens),
        output: toNum(usage.outputTokens),
        cacheRead: toNum(usage.cacheReadTokens),
        cacheWrite: toNum(usage.cacheWriteTokens),
      }
      records.push({
        ts, provider, model,
        sessionId: toStr(options && options.sessionId),
        purpose: toStr(options && options.purpose),
        cost: computeCost(price.rates, price.tiered, peak, tokens),
        estimated: price.estimated,
        period: price.tiered ? (peak ? 'peak' : 'off-peak') : 'flat',
        tokens,
        subscription: price.subscription,
      })
      if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS)
      schedulePersist()
    }

    async function* wrapStream(source, options) {
      let usage = null
      try {
        for await (const chunk of source) {
          if (chunk && chunk.type === 'usage' && chunk.usage) usage = chunk.usage
          yield chunk
        }
      } finally {
        if (usage) {
          try { recordUsage(options, usage, Date.now()) } catch (e) { console.error('cost record failed', e) }
        }
      }
    }

    ctx.on('llm/stream', (options, next) => wrapStream(next(), options))

    // ---------- network (native fetch) ----------
    async function httpJson(url, headers, timeoutMs) {
      const ac = new AbortController()
      const t = setTimeout(() => ac.abort(), timeoutMs || 15000)
      try {
        const r = await fetch(url, { headers: headers || {}, signal: ac.signal })
        const body = await r.text()
        return { status: r.status, body: body.slice(0, 12000) }
      } catch (e) {
        return { status: 0, error: String(e && e.message ? e.message : e) }
      } finally {
        clearTimeout(t)
      }
    }

    // ---------- key resolution ----------
    function readCredFile(envName) {
      try {
        const p = join(homedir(), '.dsh', '.credentials.yaml')
        const t = readFileSync(p, 'utf8')
        const lines = t.split(/\r?\n/)
        for (const line of lines) {
          const m = line.match(/^([A-Za-z0-9_]+):\s*(.+)\s*$/)
          if (m && m[1] === envName) return m[2]
        }
      } catch (e) {}
      return ''
    }

    function kimiKeyEnv() {
      const settings = ctx.get('settings')
      if (settings) {
        try {
          const v = settings.get('llm-pi-ai')
          const providers = v && v.providers
          if (providers) {
            const kc = providers['kimi-coding']
            if (kc && kc.apiKeyEnv) return String(kc.apiKeyEnv)
            const k = providers['kimi']
            if (k && k.apiKeyEnv) return String(k.apiKeyEnv)
          }
        } catch (e) {}
      }
      return 'KIMI_CODING_API_KEY'
    }

    function deepseekKeyEnv() {
      const settings = ctx.get('settings')
      if (settings) {
        try {
          const v = settings.get('llm-deepseek')
          if (v && v.apiKeyEnv) return String(v.apiKeyEnv)
        } catch (e) {}
        try {
          const v = settings.get('llm-pi-ai')
          const p = v && v.providers && v.providers['deepseek']
          if (p && p.apiKeyEnv) return String(p.apiKeyEnv)
        } catch (e) {}
      }
      return 'DEEPSEEK_API_KEY'
    }

    async function resolveApiKey(envName) {
      const cred = ctx.get('credentials')
      if (cred) {
        try {
          const r = await cred.resolve(envName)
          if (r && r.value) return { value: String(r.value), source: 'credentials:' + toStr(r.source) }
        } catch (e) {}
      }
      const v = readCredFile(envName)
      if (v) return { value: v, source: 'file' }
      return { value: '', source: 'none' }
    }

    // ---------- kimi subscription quota ----------
    function emptyKimi(error, keySource, keyEnv) {
      return { ok: false, error, weekly: { used: 0, limit: 0, remaining: 0, resetTime: '' }, windows: [], parallel: 0, membership: '', region: '', fetchedAt: Date.now(), keySource, keyEnv }
    }

    function parseKimi(j, key, keyEnv) {
      const u = j && j.usage ? j.usage : {}
      const windows = []
      const limits = j && j.limits
      if (Array.isArray(limits)) {
        for (const l of limits) {
          const w = l && l.window ? l.window : {}
          const d = l && l.detail ? l.detail : {}
          windows.push({ duration: toInt(w.duration), timeUnit: toStr(w.timeUnit), used: toInt(d.used), limit: toInt(d.limit), remaining: toInt(d.remaining), resetTime: toStr(d.resetTime) })
        }
      }
      const user = j && j.user ? j.user : {}
      const membership = user.membership ? user.membership.level : ''
      return {
        ok: true, error: '',
        weekly: { used: toInt(u.used), limit: toInt(u.limit), remaining: toInt(u.remaining), resetTime: toStr(u.resetTime) },
        windows,
        parallel: toInt(j && j.parallel ? j.parallel.limit : 0),
        membership: toStr(membership),
        region: toStr(user.region),
        fetchedAt: Date.now(),
        keySource: key.source, keyEnv,
      }
    }

    async function kimiUsage(force) {
      const now = Date.now()
      if (!force && kimiCache && now - kimiCache.fetchedAt < 120000) return kimiCache.data
      const envName = kimiKeyEnv()
      let data
      try {
        const key = await resolveApiKey(envName)
        if (!key.value) {
          data = emptyKimi('未找到 API Key（' + envName + '）', key.source, envName)
        } else {
          const headers = { Authorization: 'Bearer ' + key.value, 'User-Agent': 'KimiCLI/1.6' }
          let r = await httpJson('https://api.kimi.com/coding/v1/usages', headers)
          if (r.status === 404) r = await httpJson('https://api.kimi.com/coding/v1/usage', headers)
          if (r.status === 200 && r.body) {
            try {
              data = parseKimi(JSON.parse(r.body), key, envName)
            } catch (e) {
              data = emptyKimi('响应解析失败', key.source, envName)
            }
          } else {
            data = emptyKimi('HTTP ' + (r.status || 0) + (r.error ? ' · ' + r.error : ''), key.source, envName)
          }
        }
      } catch (e) {
        data = emptyKimi(toStr(e && e.message ? e.message : e), 'none', envName)
      }
      kimiCache = { fetchedAt: now, data }
      return data
    }

    // ---------- deepseek balance ----------
    async function balance(args) {
      const manual = args && typeof args.apiKey === 'string' ? args.apiKey.trim() : ''
      const key = manual ? { value: manual, source: 'manual' } : await resolveApiKey(deepseekKeyEnv())
      if (!key.value) return { ok: false, error: '未找到 DeepSeek API Key', available: false, total: '', granted: '', toppedUp: '', currency: 'CNY', keySource: 'none' }
      try {
        const r = await httpJson('https://api.deepseek.com/user/balance', { Authorization: 'Bearer ' + key.value })
        if (r.status !== 200 || !r.body) return { ok: false, error: 'HTTP ' + (r.status || 0) + (r.error ? ' · ' + r.error : ''), available: false, total: '', granted: '', toppedUp: '', currency: 'CNY', keySource: key.source }
        const j = JSON.parse(r.body)
        const infos = Array.isArray(j.balance_infos) ? j.balance_infos : []
        let info = null
        for (const b of infos) { if (b && b.currency === 'CNY') { info = b; break } }
        if (!info) info = infos[0] || {}
        return { ok: true, error: '', available: !!j.is_available, total: toStr(info.total_balance), granted: toStr(info.granted_balance), toppedUp: toStr(info.topped_up_balance), currency: toStr(info.currency) || 'CNY', keySource: key.source }
      } catch (e) {
        return { ok: false, error: toStr(e && e.message ? e.message : e), available: false, total: '', granted: '', toppedUp: '', currency: 'CNY', keySource: key.source }
      }
    }

    // ---------- csv export ----------
    function csvCell(s) {
      s = String(s)
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }

    function workspaceRoot() {
      const policy = ctx.get('sandboxPolicy')
      if (policy && policy.workspaceRoot) return policy.workspaceRoot
      return process.cwd()
    }

    async function exportCsv() {
      const rows = records.slice(-3000)
      const lines = ['time,provider,model,sessionId,purpose,period,subscription,estimated,inputTokens,outputTokens,cacheReadTokens,cacheWriteTokens,totalTokens,costCNY']
      for (const r of rows) {
        const t = r.tokens
        const d = new Date(r.ts + 28800000)
        const ts = d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()) + ' ' + pad2(d.getUTCHours()) + ':' + pad2(d.getUTCMinutes()) + ':' + pad2(d.getUTCSeconds())
        lines.push([csvCell(ts), csvCell(r.provider), csvCell(r.model), csvCell(r.sessionId), csvCell(r.purpose), r.period, r.subscription ? '1' : '0', r.estimated ? '1' : '0', t.input, t.output, t.cacheRead, t.cacheWrite, t.input + t.output + t.cacheRead + t.cacheWrite, r4(r.cost)].join(','))
      }
      const csv = '\uFEFF' + lines.join('\n') + '\n'
      const name = 'cost-export-' + dayKey(Date.now()) + '.csv'
      try {
        const path = join(workspaceRoot(), name)
        writeFileSync(path, csv, 'utf8')
        return { ok: true, path, count: rows.length, error: '' }
      } catch (e) {
        return { ok: false, path: '', count: 0, error: toStr(e && e.message ? e.message : e).slice(0, 300) }
      }
    }

    // ---------- prices ----------
    function prices() {
      return {
        peakWindows: PEAK_WINDOWS,
        offPeakFactor: 0.5,
        unit: 'CNY / 1M tokens',
        exact: EXACT_MODELS,
        subscription: SUBSCRIPTION_RATES,
        providers: PROVIDER_RATES,
        generic: GENERIC_RATES,
      }
    }

    // ---------- aggregation ----------
    function enumerateDays(startKey, endKey) {
      const out = []
      let t = Date.UTC(toInt(startKey.slice(0, 4)), toInt(startKey.slice(5, 7)) - 1, toInt(startKey.slice(8, 10)))
      const end = Date.UTC(toInt(endKey.slice(0, 4)), toInt(endKey.slice(5, 7)) - 1, toInt(endKey.slice(8, 10)))
      if (end - t > 89 * 86400000) t = end - 89 * 86400000
      while (t <= end) {
        const d = new Date(t)
        out.push({ key: d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate()), label: (d.getUTCMonth() + 1) + '/' + d.getUTCDate() })
        t += 86400000
      }
      return out
    }

    function buildDashboard(args) {
      const days = args && typeof args.days === 'number' && isFinite(args.days) ? Math.max(0, Math.floor(args.days)) : 7
      const now = Date.now()
      const cutoff = days > 0 ? now - days * 86400000 : 0
      const filt = []
      for (const r of records) if (r.ts >= cutoff) filt.push(r)
      let realCost = 0, realTokens = 0, peakCost = 0, offCost = 0, flatCost = 0, realCalls = 0
      let subEquivalent = 0, subTokens = 0, subCalls = 0
      const modelMap = {}
      for (const r of filt) {
        const t = r.tokens
        const total = t.input + t.output + t.cacheRead + t.cacheWrite
        const key = r.provider + '/' + r.model
        let m = modelMap[key]
        if (!m) m = modelMap[key] = { model: key, subscription: r.subscription, estimated: r.estimated, calls: 0, tokens: 0, cost: 0, dayMap: {} }
        m.calls += 1; m.tokens += total; m.cost += r.cost
        const dk = dayKey(r.ts)
        let dm = m.dayMap[dk]
        if (!dm) dm = m.dayMap[dk] = { calls: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }
        dm.calls += 1; dm.tokens += total; dm.input += t.input; dm.output += t.output; dm.cacheRead += t.cacheRead; dm.cacheWrite += t.cacheWrite; dm.cost += r.cost
        if (r.subscription) { subCalls += 1; subEquivalent += r.cost; subTokens += total }
        else {
          realCalls += 1; realCost += r.cost; realTokens += total
          if (r.period === 'peak') peakCost += r.cost
          else if (r.period === 'off-peak') offCost += r.cost
          else flatCost += r.cost
        }
      }
      const endKey = dayKey(now)
      let startKey = endKey
      if (days > 0) startKey = dayKey(cutoff)
      else if (filt.length > 0) startKey = dayKey(filt[0].ts)
      const dates = enumerateDays(startKey, endKey)
      const dayAgg = {}
      for (const d of dates) dayAgg[d.key] = { peak: 0, off: 0, flat: 0 }
      for (const r of filt) {
        if (r.subscription) continue
        const m = dayAgg[dayKey(r.ts)]
        if (!m) continue
        if (r.period === 'peak') m.peak += r.cost
        else if (r.period === 'off-peak') m.off += r.cost
        else m.flat += r.cost
      }
      const byDay = dates.map(d => ({ date: d.key, label: d.label, peak: r4(dayAgg[d.key].peak), off: r4(dayAgg[d.key].off), flat: r4(dayAgg[d.key].flat) }))
      const keys = Object.keys(modelMap).sort((a, b) => modelMap[b].cost - modelMap[a].cost)
      const byModel = keys.map(k => {
        const m = modelMap[k]
        return { model: m.model, subscription: m.subscription, estimated: m.estimated, calls: m.calls, tokens: m.tokens, cost: r4(m.cost) }
      })
      const byModelDay = keys.map(k => {
        const m = modelMap[k]
        return {
          model: m.model, subscription: m.subscription, estimated: m.estimated,
          days: dates.map(d => {
            const dm = m.dayMap[d.key]
            return { date: d.key, label: d.label, calls: dm ? dm.calls : 0, tokens: dm ? dm.tokens : 0, input: dm ? dm.input : 0, output: dm ? dm.output : 0, cacheRead: dm ? dm.cacheRead : 0, cacheWrite: dm ? dm.cacheWrite : 0, cost: dm ? r4(dm.cost) : 0 }
          }),
        }
      })
      const recent = []
      const start = Math.max(0, records.length - 20)
      for (let i = records.length - 1; i >= start; i--) {
        const r = records[i]
        const t = r.tokens
        recent.push({ ts: r.ts, time: timeLabel(r.ts), provider: r.provider, model: r.model, period: r.period, subscription: r.subscription, estimated: r.estimated, input: t.input, output: t.output, cacheRead: t.cacheRead, cacheWrite: t.cacheWrite, tokens: t.input + t.output + t.cacheRead + t.cacheWrite, cost: r4(r.cost) })
      }
      return {
        ok: true, days,
        realCost: r4(realCost), realCalls, realTokens,
        subEquivalent: r4(subEquivalent), subCalls, subTokens,
        peakCost: r4(peakCost), offCost: r4(offCost), flatCost: r4(flatCost),
        byDay, byModel, byModelDay, recent,
        peakWindows: PEAK_WINDOWS,
      }
    }

    function buildSummary(args) {
      const sid = args && typeof args.sessionId === 'string' ? args.sessionId : ''
      const now = Date.now()
      const todayKey = dayKey(now)
      let sessionCost = 0, sessionCalls = 0, sessionSub = 0, sessionSubCalls = 0, todayCost = 0, totalCost = 0, totalCalls = 0
      for (const r of records) {
        if (r.subscription) {
          if (r.sessionId === sid) { sessionSub += r.cost; sessionSubCalls += 1 }
        } else {
          totalCost += r.cost; totalCalls += 1
          if (dayKey(r.ts) === todayKey) todayCost += r.cost
          if (r.sessionId === sid) { sessionCost += r.cost; sessionCalls += 1 }
        }
      }
      let provider = '', model = ''
      const adm = ctx.get('agentDefaultModel')
      if (adm) {
        try {
          const sel = adm.currentSelection()
          if (sel) { provider = toStr(sel.provider); model = toStr(sel.model) }
        } catch (e) {}
      }
      const np = normProvider(provider)
      const subscription = !!SUBSCRIPTION_RATES[np]
      let kimiWeeklyRemaining = null
      if (subscription) {
        if (!kimiCache || now - kimiCache.fetchedAt >= 120000) kimiUsage(false).catch(() => {})
        if (kimiCache && kimiCache.data && kimiCache.data.ok) kimiWeeklyRemaining = kimiCache.data.weekly.remaining
      }
      return {
        sessionCost: r4(sessionCost), sessionCalls,
        sessionSub: r4(sessionSub), sessionSubCalls,
        todayCost: r4(todayCost), totalCost: r4(totalCost), totalCalls,
        provider, model,
        isDeepSeek: np === 'deepseek',
        peak: isPeak(now),
        subscription,
        kimiWeeklyRemaining,
      }
    }

    function resetData() {
      const n = records.length
      records.length = 0
      kimiCache = null
      persistNow()
      return { ok: true, cleared: n }
    }

    // ---------- HTTP routes (client → host) ----------
    const ROUTES = {
      summary: (args) => buildSummary(args),
      dashboard: (args) => buildDashboard(args),
      'kimi-usage': (args) => kimiUsage(!!(args && args.force)),
      balance: (args) => balance(args),
      export: () => exportCsv(),
      prices: () => prices(),
    }

    async function handleRoute(req, res) {
      const pathname = decodeURIComponent(new URL(req.url || '/', 'http://localhost').pathname)
      const name = pathname.replace(/^\/api\/cost-tracker\//, '').replace(/\/+$/, '')
      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
      if (req.method !== 'POST') { res.writeHead(405, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, error: 'method not allowed' })); return }
      const fn = ROUTES[name]
      if (!fn) { res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ ok: false, error: 'unknown route' })); return }
      let args = {}
      try {
        let raw = ''
        for await (const chunk of req) {
          raw += chunk
          if (raw.length > 1048576) break
        }
        if (raw) args = JSON.parse(raw)
      } catch (e) {}
      try {
        const out = await fn(args)
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-cache' })
        res.end(JSON.stringify(out))
      } catch (e) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
        res.end(JSON.stringify({ ok: false, error: toStr(e && e.message ? e.message : e) }))
      }
    }

    ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: '/api/cost-tracker', handler: handleRoute }), 'cost-tracker: api routes')

    // ---------- model tools ----------
    ctx.tools.register({
      name: 'cost_stats',
      description: '查询本进程内记录的模型调用花费与用量统计（人民币 CNY 计价）。按量计费模型与订阅制套餐（等效费用，仅供参考）分开统计；数据持久化于磁盘，进程重启后自动恢复。',
      parameters: {
        type: 'object',
        properties: { days: { type: 'integer', description: '统计最近 N 天；0 表示全部。默认 7。' } },
        additionalProperties: true,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args, v) => [{ type: 'text', text: '花费统计（' + (v.days === 0 ? '全部' : '近 ' + v.days + ' 天') + '）\n按量消费：¥' + v.realTotal + '（高峰 ¥' + v.peakCost + ' · 闲时 ¥' + v.offCost + (v.flatCost > 0 ? ' · 平峰 ¥' + v.flatCost : '') + '）· 请求 ' + v.realCalls + ' 次 · Tokens ' + v.realTokens + '\n订阅套餐：请求 ' + v.subCalls + ' 次 · Tokens ' + v.subTokens + ' · 等效 ¥' + v.subEquivalent + '（订阅已覆盖，仅供参考）' }],
      },
      execute: async (args) => {
        const d = buildDashboard(args && typeof args.days === 'number' ? { days: args.days } : { days: 7 })
        return { ok: true, days: d.days, realTotal: d.realCost, realCalls: d.realCalls, realTokens: d.realTokens, peakCost: d.peakCost, offCost: d.offCost, flatCost: d.flatCost, subEquivalent: d.subEquivalent, subCalls: d.subCalls, subTokens: d.subTokens }
      },
    })

    ctx.tools.register({
      name: 'cost_prices',
      description: '查看当前内置的模型单价表（CNY / 百万 tokens）与峰谷时段规则。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args, v) => [{ type: 'text', text: '单价表（CNY / 百万 tokens）\n峰谷时段：' + v.peakWindows + '（北京时间），闲时 = 高峰价 × ' + v.offPeakFactor + '\ndeepseek-v4-flash：高峰 输入 3.0 / 输出 9.0 / 缓存命中 0.10 / 缓存写入 3.0\ndeepseek-v4-pro：高峰 输入 9.0 / 输出 27.0 / 缓存命中 0.30 / 缓存写入 9.0\nkimi-coding（订阅等效，估算）：输入 6.5 / 缓存命中 1.1 / 缓存写入 6.5 / 输出 27.0\n其他 provider 兜底为估算平价（openai 10/30/5/10，anthropic 15/75/1.5/15，gemini 2.5/10/0.625/2.5，未知 2/8/0.5/2）；ollama/local 为 0。' }],
      },
      execute: async () => prices(),
    })

    ctx.tools.register({
      name: 'cost_reset',
      description: '清空本进程内记录的全部模型调用花费与用量数据（同时清空磁盘持久化，不可恢复）。',
      parameters: {
        type: 'object',
        properties: {},
        additionalProperties: true,
      },
      output: {
        schema: { type: 'object', additionalProperties: true },
        render: (args, v) => [{ type: 'text', text: '已清空 ' + v.cleared + ' 条花费记录。' }],
      },
      execute: async () => resetData(),
    })

    // ---------- lifecycle ----------
    loadRecords()
    ctx.effect(() => () => { try { writeRecords() } catch (e) {} }, 'cost-tracker: final flush')
    console.log('cost tracker ready (static)')
  },
}
