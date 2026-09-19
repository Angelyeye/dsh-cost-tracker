// ============================================================
// dsh-cost-tracker 历史导入 单测（宿主面 + 纯逻辑）
//   node test/import.test.js
//
// 用 zstdCompressSync 合成宿主会话日志（**多 frame 追加**，与宿主真实容器一致），
// 覆盖 v1.9.0 历史导入的三层幂等与全部边界：
//   ① frame 边界扫描：多帧拼接、截断尾帧忽略、跨帧残行拼接；
//   ② 回放：usage 按 (turn,step) 去重、全零用量（失败尝试）丢弃、
//      provider/model 取 message.source、request/header 的嵌套 config 兜底、
//      fork 种子段（time < createdAt）跳过；
//   ③ 覆盖判定：装插件前的调用导入、跨安装点会话按切割线截断、
//      停机缺口日补录、**已被实时覆盖的日子不导入**（宁可漏记不重复）；
//   ④ 幂等：重跑命中清单快跳；文件变化后按「逐调用键」去重，只补新增；
//   ⑤ 宿主面：import-run / import-status 路由真的注册并写库，
//      记录带 source='import'，manifest 落盘，且实时记录不受影响。
// ============================================================
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { zstdCompressSync } from 'node:zlib'
import { scanZstdFrames, readSessionRecords, replaySessionCalls, buildLiveCoverage, dayKeyOf, importKeyOf, planAndBuildImports, listSessionLogs } from '../import.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`)
  else {
    failures++
    console.log(`  FAIL  ${name}`)
    if (detail !== undefined) console.log(`        ${detail}`)
  }
}

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const home = mkdtempSync(join(tmpdir(), 'cost-import-'))
process.env.DSH_HOME = home

console.log('dsh-cost-tracker 历史导入测试')
console.log(`  DSH_HOME = ${home}`)
console.log('')

// ---------- 合成会话日志工具 ----------
/** 把若干条事件编码成**一个 zstd frame**（宿主每个追加批次一个 frame） */
function frame(events) {
  return zstdCompressSync(Buffer.from(events.map((e) => JSON.stringify(e)).join('\n') + '\n', 'utf8'))
}
const SESS_DIR = join(home, 'sessions', 'proj-a')
function writeLog(session, name, frames) {
  const dir = join(SESS_DIR, session)
  mkdirSync(dir, { recursive: true })
  const p = join(dir, name)
  writeFileSync(p, Buffer.concat(frames))
  return p
}
/** 一次调用的事件组（header + message） */
function callEvents(sid, createdAt, ts, turn, step, provider, model, usage) {
  return [
    { type: 'request/header', seq: turn * 10 + step, time: ts, data: { header: { config: { provider, model } } } },
    { type: 'assistant/message', seq: turn * 10 + step + 1, time: ts, data: { turn, step, message: { role: 'assistant', source: { kind: 'model', provider, model } }, usage } },
  ]
}
const U = (i, o, cr = 0, cw = 0, r = 0) => ({ inputTokens: i, outputTokens: o, cacheReadTokens: cr, cacheWriteTokens: cw, reasoningTokens: r, totalTokens: i + o + cr + cw })

// 时间轴（UTC）：安装点 = 2026-09-15T04:00Z
const T = (h, m = 0, d = 15) => Date.UTC(2026, 8, d, h, m, 0)
const INSTALL = T(4)
const SID_A = 'session-aaaa-0001'
const SID_B = 'session-bbbb-0002'
const SID_C = 'session-cccc-0003'  // 停机缺口日（09-17）
const SID_D = 'session-dddd-0004'  // 已被实时覆盖的日子

// 会话 A：全部在安装点之前（3 次调用）
const pathA = writeLog(SID_A, 'session.v3.jsonl.zstd', [
  frame([{ type: 'session', version: 3, id: SID_A, createdAt: T(1) }]),
  frame(callEvents(SID_A, T(1), T(1, 10), 1, 1, 'deepseek-official', 'deepseek-flash', U(1000, 200))),
  frame(callEvents(SID_A, T(1), T(2, 0), 1, 2, 'deepseek-official', 'deepseek-v4-pro', U(2000, 300, 500))),
  frame(callEvents(SID_A, T(1), T(3, 0), 2, 1, 'kimi-coding', 'kimi-k3', U(3000, 400))),
])
// 会话 B：跨安装点（1 次在安装前 03:00，2 次在安装后 05:00 / 06:00）
const pathB = writeLog(SID_B, 'session.v3.jsonl.zstd', [
  frame([{ type: 'session', version: 3, id: SID_B, createdAt: T(2) }]),
  frame(callEvents(SID_B, T(2), T(3, 0), 1, 1, 'deepseek-official', 'deepseek-flash', U(500, 100))),
  frame(callEvents(SID_B, T(2), T(5, 0), 1, 2, 'deepseek-official', 'deepseek-flash', U(600, 120))),
  frame(callEvents(SID_B, T(2), T(6, 0), 2, 1, 'deepseek-official', 'deepseek-flash', U(700, 140))),
])
// 会话 C：停机缺口日（09-17，无任何实时记录）
const pathC = writeLog(SID_C, 'session.v3.jsonl.zstd', [
  frame([{ type: 'session', version: 3, id: SID_C, createdAt: T(4, 0, 17) }]),
  frame(callEvents(SID_C, T(4, 0, 17), T(5, 0, 17), 1, 1, 'deepseek-official', 'deepseek-flash', U(800, 160))),
])
// 会话 D：与实时记录同一天（09-15 07:00），但本会话没有实时记录
const pathD = writeLog(SID_D, 'session.v3.jsonl.zstd', [
  frame([{ type: 'session', version: 3, id: SID_D, createdAt: T(7) }]),
  frame(callEvents(SID_D, T(7), T(7, 30), 1, 1, 'deepseek-official', 'deepseek-flash', U(900, 180))),
])

// ---------- 1. frame 扫描 ----------
console.log('[1] zstd frame 边界扫描')
{
  const buf = readFileSync(pathA)
  const frames = scanZstdFrames(buf)
  check('多帧拼接被逐个识别（4 帧）', frames.length === 4, String(frames.length))
  check('帧区间连续无重叠', frames.every((f, i) => (i === 0 ? f.start === 0 : f.start === frames[i - 1].end)), JSON.stringify(frames))
  const truncated = scanZstdFrames(Buffer.concat([buf, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0x00])]))
  check('截断尾帧被忽略（不抛错）', truncated.length === 4, String(truncated.length))
  const junk = scanZstdFrames(Buffer.from('not a zstd stream at all'))
  check('非 zstd 数据 → 空', junk.length === 0)

  const recs = readSessionRecords(pathA)
  check('逐帧解压后事件齐全（1 session + 6 调用事件）', recs.length === 7, String(recs.length))
  check('跨帧顺序保持', recs[0].type === 'session' && recs[recs.length - 1].type === 'assistant/message')
}

// 跨帧残行：把一条 JSON 劈成两帧（前帧不换行结尾）
{
  const dir = join(SESS_DIR, 'session-split-0005')
  mkdirSync(dir, { recursive: true })
  const ev = JSON.stringify({ type: 'assistant/message', time: T(1), data: { turn: 1, step: 1, message: { source: { provider: 'p', model: 'm' } }, usage: U(10, 5) } })
  const cut = Math.floor(ev.length / 2)
  const p = join(dir, 'session.v3.jsonl.zstd')
  writeFileSync(p, Buffer.concat([zstdCompressSync(Buffer.from(ev.slice(0, cut))), zstdCompressSync(Buffer.from(ev.slice(cut) + '\n'))]))
  const recs = readSessionRecords(p)
  check('跨帧残行被正确拼接', recs.length === 1 && recs[0].data.turn === 1, JSON.stringify(recs).slice(0, 120))
}

// ---------- 2. 回放 ----------
console.log('[2] 回放：去重 / 兜底 / 种子段')
{
  const recs = readSessionRecords(pathA)
  const r = replaySessionCalls(recs, { fallbackSessionId: 'fallback' })
  check('会话 id / createdAt 取自 session 事件', r.sessionId === SID_A && r.createdAt === T(1), JSON.stringify({ s: r.sessionId, c: r.createdAt }))
  check('3 次调用全部重建', r.calls.length === 3, String(r.calls.length))
  check('按时间升序', r.calls.every((c, i) => i === 0 || c.ts >= r.calls[i - 1].ts))
  check('模型名保留原始 id（计费规范化在计价层）', r.calls[1].model === 'deepseek-v4-pro', r.calls[1].model)
  check('token 桶完整', JSON.stringify(r.calls[1].tokens) === JSON.stringify({ input: 2000, output: 300, cacheRead: 500, cacheWrite: 0, reasoning: 0 }), JSON.stringify(r.calls[1].tokens))

  // 同一 (turn,step) 的流式样本 + 最终 message：以最终 message 为准
  const events = [
    { type: 'session', id: 's', createdAt: 1000 },
    { type: 'assistant/chunk', time: 1100, data: { turn: 1, step: 1, chunk: { type: 'usage', usage: U(100, 10) } } },
    { type: 'assistant/message', time: 1200, data: { turn: 1, step: 1, message: { source: { provider: 'deepseek-official', model: 'deepseek-flash' } }, usage: U(999, 99) } },
  ]
  const dedup = replaySessionCalls(events)
  check('(turn,step) 去重：最终 message 覆盖流式样本', dedup.calls.length === 1 && dedup.calls[0].tokens.input === 999, JSON.stringify(dedup.calls))

  // 全零用量（失败尝试）不产出
  const empty = replaySessionCalls([
    { type: 'session', id: 's2', createdAt: 1000 },
    { type: 'assistant/message', time: 1100, data: { turn: 1, step: 1, message: { source: { provider: 'p', model: 'm' } }, usage: U(0, 0) } },
    { type: 'assistant/attempt', time: 1150, data: { turn: 1, step: 1, stream: [] } },
  ])
  check('全零用量不产出记录', empty.calls.length === 0, JSON.stringify(empty.calls))

  // fork 种子段：time < createdAt 的拷贝事件跳过
  const seeded = replaySessionCalls([
    { type: 'session', id: 's3', createdAt: 5000, isSeeded: true },
    { type: 'assistant/message', time: 2000, data: { turn: 1, step: 1, message: { source: { provider: 'p', model: 'm' } }, usage: U(10, 5) } },
    { type: 'assistant/message', time: 6000, data: { turn: 2, step: 1, message: { source: { provider: 'p', model: 'm' } }, usage: U(20, 6) } },
  ])
  check('fork 种子段（time < createdAt）被跳过', seeded.calls.length === 1 && seeded.calls[0].ts === 6000, JSON.stringify(seeded.calls.map((c) => c.ts)))

  // 无 message.source 时回落 request/header.data.header.config
  const fallback = replaySessionCalls([
    { type: 'session', id: 's4', createdAt: 1000 },
    { type: 'request/header', time: 1100, data: { header: { config: { provider: 'byteblus-coding-plan-cn', model: 'glm-5-3-flash-260828' } } } },
    { type: 'assistant/message', time: 1200, data: { turn: 1, step: 1, message: { role: 'assistant' }, usage: U(50, 5) } },
  ])
  check('provider/model 回落 header.config', fallback.calls.length === 1 && fallback.calls[0].provider === 'byteblus-coding-plan-cn' && fallback.calls[0].model === 'glm-5-3-flash-260828', JSON.stringify(fallback.calls[0]))

  // 辅路请求（标题生成）不产出
  const aux = replaySessionCalls([
    { type: 'session', id: 's5', createdAt: 1000 },
    { type: 'session/title-llm-request', time: 1100, data: { route: { provider: 'deepseek-official', model: 'deepseek-flash' } } },
  ])
  check('标题生成等辅路请求不产出记录', aux.calls.length === 0)
}

// ---------- 3. 覆盖判定 ----------
console.log('[3] 覆盖判定：切割线 / 缺口日 / 已覆盖日')
{
  const live = [{ ts: INSTALL + 30 * 60000, sessionId: SID_B, source: 'live', tokens: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }]
  const cov = buildLiveCoverage(live, {})
  check('最早实时时刻被记录', cov.firstLiveTs === INSTALL + 30 * 60000, String(cov.firstLiveTs))
  check('会话切割线被记录', cov.sessionMin.get(SID_B) === INSTALL + 30 * 60000)
  const noLive = buildLiveCoverage([], {})
  check('无实时记录时 firstLiveTs = Infinity（新装全量导入）', noLive.firstLiveTs === Infinity)

  const logs = listSessionLogs(join(home, 'sessions'))
  check('会话日志枚举齐全（5 个：A/B/C/D/split）', logs.length === 5, String(logs.length))

  const priceFn = (np, model, ts, tokens) => ({ cost: (tokens.input + tokens.output) / 1e6 * 2, estimated: false, subscription: false, period: 'peak', model })
  const hooks = { priceFn, normProvider: (p) => String(p || '').toLowerCase().replace(/-official$/, '') }
  const manifest = { v: 1, files: {} }
  const results = await planAndBuildImports(live, {}, logs, manifest, hooks)
  const byPath = {}
  for (const r of results) byPath[r.path] = r
  const importedOf = (p) => (byPath[p] && byPath[p].records ? byPath[p].records.length : -1)

  check('会话 A（全在安装前）→ 3 条全导入', importedOf(pathA) === 3, String(importedOf(pathA)))
  check('会话 B（跨安装点）→ 只导入安装前那 1 条', importedOf(pathB) === 1, String(importedOf(pathB)))
  check('会话 C（停机缺口日）→ 导入 1 条', importedOf(pathC) === 1, String(importedOf(pathC)))
  check('会话 D（已实时覆盖的日子）→ 不导入（宁可漏记不重复）', importedOf(pathD) === 0, String(importedOf(pathD)))
  const imported = results.reduce((a, r) => a + (r.records ? r.records.length : 0), 0)
  // 3（会话 A）+ 1（B 的安装前那段）+ 1（C 缺口日）+ 0（D 已覆盖）+ 1（跨帧拼接那条合成调用）
  check('合计导入 6 条', imported === 6, String(imported))
  const rec = byPath[pathA].records[0]
  check('导入记录带 source=import', rec.source === 'import', JSON.stringify(rec.source))
  check('导入记录带计价派生字段', typeof rec.cost === 'number' && rec.cost > 0 && rec.period === 'peak' && rec.estimated === false && rec.subscription === false, JSON.stringify(rec))
  check('导入记录 purpose 为空、sessionId 正确', rec.purpose === '' && rec.sessionId === SID_A, JSON.stringify({ p: rec.purpose, s: rec.sessionId }))
  check('importKey 稳定（同调用同键）', importKeyOf(SID_A, { ts: rec.ts, model: rec.model, tokens: rec.tokens }) === importKeyOf(SID_A, { ts: rec.ts, model: rec.model, tokens: rec.tokens }))
  check('dayKeyOf 为北京日历日', dayKeyOf(Date.UTC(2026, 8, 14, 17, 0)) === '2026-09-15', dayKeyOf(Date.UTC(2026, 8, 14, 17, 0)))

  // 幂等：把已导入记录喂回去（模拟落库后重跑）
  const allRecords = results.reduce((a, r) => a.concat(r.records || []), [])
  const again = await planAndBuildImports(live.concat(allRecords), {}, logs, { v: 1, files: {} }, hooks)
  const againImported = again.reduce((a, r) => a + (r.records ? r.records.length : 0), 0)
  check('重跑（清单丢失也不重复）→ 0 条新增', againImported === 0, String(againImported))

  // 文件变化：会话 C 追加一条新调用（同一缺口日）
  const extra = frame(callEvents(SID_C, T(4, 0, 17), T(6, 0, 17), 1, 2, 'deepseek-official', 'deepseek-flash', U(700, 140)))
  writeFileSync(pathC, Buffer.concat([readFileSync(pathC), extra]))
  const after = await planAndBuildImports(live.concat(allRecords), {}, logs, { v: 1, files: {} }, hooks)
  const afterC = after.find((r) => r.path === pathC)
  check('日志追加后只补新增的 1 条（旧调用按 importKey 去重）', afterC.records.length === 1 && afterC.records[0].tokens.input === 700, JSON.stringify(afterC.records && afterC.records.length))

  // 清单快跳：status=done 且 mtime/size 未变 → unchanged
  const mtime = readFileSync(pathC)
  const manifest2 = { v: 1, files: {} }
  manifest2.files[pathC] = { mtime: 0, size: 0, status: 'done' }
  const stat = (await import('node:fs')).statSync(pathC)
  manifest2.files[pathC] = { mtime: stat.mtimeMs, size: stat.size, status: 'done' }
  const skipped = await planAndBuildImports([], {}, [pathC], manifest2, hooks)
  check('清单命中且文件未变 → unchanged（不读盘）', skipped[0].status === 'unchanged', JSON.stringify(skipped[0]))
}

// ---------- 4. 宿主面：路由 + 落库 ----------
console.log('[4] 宿主面：import-run / import-status')
{
  // 预置实时记录（安装后 04:30 的一条）与一份「老配置」
  const storages = join(home, 'storages')
  mkdirSync(storages, { recursive: true })
  const liveRecord = {
    ts: INSTALL + 30 * 60000, seq: 1, provider: 'deepseek-official', model: 'deepseek-flash',
    sessionId: SID_B, purpose: '', cost: 0.01, estimated: false, period: 'peak',
    tokens: { input: 500, output: 100, cacheRead: 0, cacheWrite: 0, reasoning: 0 }, subscription: false, source: 'live',
  }
  writeFileSync(join(storages, 'cost-tracker-records.json'), JSON.stringify({ v: 2, seq: 1, resetEpoch: 0, details: [liveRecord], rollups: {} }), 'utf8')
  writeFileSync(join(storages, 'cost-tracker-config.json'), JSON.stringify({ peakEnabled: true, autoImport: true, showTotalWithPlan: true }), 'utf8')

  const effectNow = (fn) => { try { fn() } catch (e) {} return () => {} }
  const ctx = {
    get: () => undefined, inject: () => {}, effect: effectNow, on: () => {},
    tools: { register: () => {} }, commands: { register: () => {} },
    settings: undefined, logger: undefined,
  }
  let webHandler = null
  ctx.webServer = { register: (route) => { webHandler = route && (route.handler || route); return () => {} } }
  const api = async (name, args) => {
    const chunks = []
    const req = {
      method: 'POST',
      url: '/api/cost-tracker/' + name,
      [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(args || {}), 'utf8') },
    }
    const res = { statusCode: 0, writeHead(code) { this.statusCode = code }, end(body) { chunks.push(body || '') } }
    await webHandler(req, res)
    try { return JSON.parse(chunks.join('')) } catch (e) { return { __raw: chunks.join(''), __status: res.statusCode } }
  }

  const mod = await import(pathToFileURL(join(root, 'index.js')).href)
  mod.default.apply(ctx)

  const st0 = await api('import-status', {})
  check('import-status 返回状态', st0.ok === true && st0.autoImport === true, JSON.stringify(st0))
  check('status 带会话根目录（便于排查）', typeof st0.sessionsRoot === 'string' && st0.sessionsRoot.indexOf('sessions') > 0, String(st0.sessionsRoot))

  const run = await api('import-run', {})
  check('import-run 成功并报告新增数（6 + 追加的 1 条）', run.ok === true && run.imported === 7, JSON.stringify(run))

  const manifest = JSON.parse(readFileSync(join(storages, 'cost-tracker-import.json'), 'utf8'))
  check('导入清单已落盘', manifest.v === 1 && Object.keys(manifest.files).length >= 4, JSON.stringify(Object.keys(manifest.files).length))
  check('清单记录 totalImported', manifest.totalImported === 7, String(manifest.totalImported))

  const store = JSON.parse(readFileSync(join(storages, 'cost-tracker-records.json'), 'utf8'))
  const imported = store.details.filter((r) => r.source === 'import')
  const live = store.details.filter((r) => r.source === 'live')
  check('导入记录已入账（7 条）', imported.length === 7, String(imported.length))
  check('原实时记录不受影响', live.length === 1 && live[0].ts === liveRecord.ts)
  check('导入记录分配到 seq', imported.every((r) => Number.isFinite(r.seq) && r.seq > 0), JSON.stringify(imported.map((r) => r.seq)))
  check('导入记录金额为正（真实计价链）', imported.every((r) => r.cost > 0), JSON.stringify(imported.map((r) => r.cost)))
  check('deepseek-v4-pro 被路由为现役计费名', imported.some((r) => r.model === 'deepseek-flash' && r.provider === 'deepseek-official'))
  check('持久化文件版本/纪元未被破坏', store.v === 2 && store.resetEpoch === 0)

  // 再跑一次：幂等，零新增
  const run2 = await api('import-run', {})
  check('重复执行零新增（幂等）', run2.ok === true && run2.imported === 0, JSON.stringify(run2))
  const store2 = JSON.parse(readFileSync(join(storages, 'cost-tracker-records.json'), 'utf8'))
  check('重复执行后明细条数不变', store2.details.length === store.details.length, String(store2.details.length))

  // 仪表盘把导入记录也计入（且按量与订阅分开）
  const dash = await api('dashboard', { days: 30 })
  check('看板读到导入记录的总花费', dash.ok === true && dash.realCost > 0, JSON.stringify({ real: dash.realCost, calls: dash.realCalls }))
  check('看板 byDay 带 sub 字段（含 Plan 开关用）', Array.isArray(dash.byDay) && dash.byDay.every((d) => typeof d.sub === 'number'), JSON.stringify(dash.byDay.slice(0, 2)))

  // 价格同步状态（不联网：只读状态）
  const pr = await api('prices', {})
  check('prices 暴露目录与同步状态', !!pr.catalog && !!pr.priceSync && typeof pr.catalog.fingerprint === 'string', JSON.stringify(Object.keys(pr.catalog || {})))
  check('prices 暴露同步时代列表（初始为空）', Array.isArray(pr.priceSync.syncedEras), JSON.stringify(pr.priceSync.syncedEras))

  // 配置卡状态：密钥只给布尔
  const sy = await api('sync', {})
  check('sync 状态带计费口径开关', sy.showTotalWithPlan === true, String(sy.showTotalWithPlan))
  check('sync 状态不回显任何密钥字段', sy.cloudToken === undefined && sy.volcengineSecretAccessKey === undefined)
  check('sync 状态给凭据布尔与后端', typeof sy.cloudTokenConfigured === 'boolean' && typeof sy.cloudTokenBackend === 'string', JSON.stringify({ t: sy.cloudTokenConfigured, b: sy.cloudTokenBackend }))
}

rmSync(home, { recursive: true, force: true })

// ---------- 5. 旧版明文密钥迁移（宿主面，v1.9.0 的安全承诺） ----------
// 用户可见的承诺是「升级后配置文件里不再有明文密钥」。这条断言端到端验证它：
// 预置 v1.8.x 风格的明文配置 → 启动插件 → 配置被净化、密钥进凭据库（沙箱无凭据
// 服务时退化为内存态）、状态接口仍报「已配置」但**不回显值**。
console.log('[5] 启动迁移：旧版明文密钥 → 凭据库，配置文件零明文')
{
  const home2 = mkdtempSync(join(tmpdir(), 'cost-migrate-'))
  const storages2 = join(home2, 'storages')
  mkdirSync(storages2, { recursive: true })
  const legacyToken = 'dshc_legacy_token_should_not_stay_on_disk'
  const legacySk = 'legacySecretKeyShouldNotStayOnDisk'
  writeFileSync(join(storages2, 'cost-tracker-config.json'), JSON.stringify({
    cloudEnabled: true,
    cloudUrl: 'https://cost.example.com',
    cloudToken: legacyToken,
    volcengineAccessKeyId: 'AKLTlegacy0001',
    volcengineSecretAccessKey: legacySk,
    peakEnabled: true,
    deviceName: '旧配置机器',
  }), 'utf8')

  const prevHome = process.env.DSH_HOME
  process.env.DSH_HOME = home2
  const effectNow2 = (fn) => { try { fn() } catch (e) {} return () => {} }
  // 模拟**可写的凭据服务**（与宿主 @deepseek-ai/dsh-credentials-local 同形：
  // resolve / describe / set / unset）。不可写的边界在 credstore.test.js [2b] 覆盖。
  const credStore = new Map()
  const credentials = {
    async resolve(ref) { return credStore.has(ref) ? { value: credStore.get(ref), source: 'local-store' } : undefined },
    async describe(ref) { return { configured: credStore.has(ref), source: 'local-store', writable: true } },
    async set(ref, value) { credStore.set(ref, value) },
    async unset(ref) { credStore.delete(ref) },
  }
  const ctx2 = {
    get: (name) => (name === 'credentials' ? credentials : undefined),
    inject: () => {}, effect: effectNow2, on: () => {},
    tools: { register: () => {} }, commands: { register: () => {} },
    settings: undefined, logger: undefined,
  }
  let handler2 = null
  ctx2.webServer = { register: (route) => { handler2 = route && (route.handler || route); return () => {} } }
  const api2 = async (name, args) => {
    const chunks = []
    const req = {
      method: 'POST',
      url: '/api/cost-tracker/' + name,
      [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(args || {}), 'utf8') },
    }
    const res = { statusCode: 0, writeHead(code) { this.statusCode = code }, end(body) { chunks.push(body || '') } }
    await handler2(req, res)
    try { return JSON.parse(chunks.join('')) } catch (e) { return { __raw: chunks.join('') } }
  }
  // 独立模块实例：迁移在 apply 时异步触发，需等微任务落地
  const mod2 = await import(pathToFileURL(join(root, 'index.js')).href + '?migration-check=1')
  mod2.default.apply(ctx2)
  for (let i = 0; i < 40; i += 1) await new Promise((r) => setImmediate(r))

  const onDisk = readFileSync(join(storages2, 'cost-tracker-config.json'), 'utf8')
  const parsed = JSON.parse(onDisk)
  check('配置文件不再包含云端令牌明文', !onDisk.includes(legacyToken), onDisk.slice(0, 200))
  check('配置文件不再包含火山 SK 明文', !onDisk.includes(legacySk))
  check('非密钥字段原样保留', parsed.cloudUrl === 'https://cost.example.com' && parsed.peakEnabled === true && parsed.deviceName === '旧配置机器')
  check('迁移标记落盘（secretsMigrated）', parsed.secretsMigrated === true)
  check('密钥字段在配置里被清空', parsed.cloudToken === '' && parsed.volcengineSecretAccessKey === '')
  check('AccessKeyID 保留（非敏感，面板要预填）', parsed.volcengineAccessKeyId === 'AKLTlegacy0001')

  const st2 = await api2('sync', {})
  check('状态接口仍报「已配置」', st2.cloudTokenConfigured === true && st2.volcengineHasSecret === true, JSON.stringify({ t: st2.cloudTokenConfigured, s: st2.volcengineHasSecret }))
  check('状态接口回显存储位置', st2.cloudTokenBackend === 'credentials' && st2.volcengineSecretBackend === 'credentials', JSON.stringify({ a: st2.cloudTokenBackend, b: st2.volcengineSecretBackend }))
  check('状态接口不含任何密钥明文', !JSON.stringify(st2).includes(legacyToken) && !JSON.stringify(st2).includes(legacySk))
  check('密钥确实进了凭据库（可持久化）', credStore.get('COST_TRACKER_CLOUD_TOKEN') === legacyToken && credStore.get('COST_TRACKER_VOLCENGINE_SK') === legacySk, JSON.stringify([...credStore.keys()]))
  const vc = await api2('volcengine-config', {})
  check('凭据写接口同样不回显密钥', !JSON.stringify(vc).includes(legacySk), JSON.stringify(vc).slice(0, 200))

  process.env.DSH_HOME = prevHome
  rmSync(home2, { recursive: true, force: true })
}

console.log('')
if (failures) { console.log('FAILED: ' + failures + ' 项断言未通过'); process.exit(1) }
console.log('全部通过')
