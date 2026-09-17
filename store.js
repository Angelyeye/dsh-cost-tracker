// ============================================================
// DSH 花费统计插件 —— 存储层（纯 Node，可独立测试）
//
// 数据保留策略（v1.1.2 起）：
//   明细记录（details）保留最近 DETAIL_DAYS 天；更早的记录自动按
//   「天 + 模型」压缩为永久日汇总（rollups）。全时段统计 = 明细 + 汇总，
//   永远精确，且内存 / 磁盘 / 写入量有界。
//
// 云端同步支持（v1.8.0 起）：
//   · 每条明细带单调递增 `seq`（加载时补齐、写入时分配），云端凭它增量拉取；
//   · `resetEpoch` 在 clear() 时 +1，使「清空后重新导入」不被云端判为重复；
//   · seq 与 resetEpoch 随文件持久化，旧文件（无这两个字段）自动兼容升级。
//
// 文件格式：
//   v2: { v: 2, seq: n, resetEpoch: n, details: [...], rollups: { dayKey: { modelKey: entry } } }
//   v1（旧版裸数组）在 load() 时自动迁移；损坏文件自动备份为
//   .corrupt-<时间戳> 并从零开始，不阻断启动。
// ============================================================
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash } from 'node:crypto'

/** 明细保留天数（更早的记录折叠进日汇总） */
export const DETAIL_DAYS = 180
/** 图表按天轴最大跨度（天） */
export const MAX_AXIS_DAYS = 730
/** 明细安全上限（纯兜底；180 天内几乎不可达） */
export const MAX_DETAILS = 200000
const DAY_MS = 86400000

function pad2(n) { return n < 10 ? '0' + n : '' + n }

/** 北京时间（UTC+8）的日期键 YYYY-MM-DD */
export function dayKey(ts) {
  const d = new Date(ts + 28800000)
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
}

export function modelKeyOf(r) {
  return r.provider + '/' + r.model
}

export function emptyEntry(provider, model, subscription, estimated) {
  return {
    provider, model,
    subscription: !!subscription,
    estimated: !!estimated,
    calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
    cost: 0, peak: 0, off: 0, flat: 0,
  }
}

/** 单条日汇总最多记录多少条被吸收明细的键（云端据此排除重复，超出部分不再追溯） */
export const MAX_ABSORBED_KEYS = 5000

// ---------- 原子落盘（Windows 友好） ----------
/**
 * rename 的**瞬时**失败码。Windows 上目标文件被短暂占用时 renameSync 会抛这些：
 *   · 杀毒 / 搜索索引器刚扫过刚写完的临时文件；
 *   · 资源管理器预览、备份/同步工具正在读该文件；
 *   · 上一个 dsh 实例还没退干净（或同时跑了两个实例）。
 * 这类「等一下就好」，退避重试即可；代码类错误（ENOENT、EISDIR…）不该重试。
 */
const TRANSIENT_RENAME_CODES = new Set(['EPERM', 'EACCES', 'EBUSY'])
export function isTransientRenameError(e) {
  return !!e && TRANSIENT_RENAME_CODES.has(String(e.code || ''))
}

/** 同步睡眠（Node 没有 sleepSync；Atomics.wait 不占 CPU） */
function sleepSync(ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch (e) {
    const end = Date.now() + ms
    while (Date.now() < end) { /* 无 SharedArrayBuffer 的极端环境下退化为忙等 */ }
  }
}

/**
 * 原子落盘：写临时文件 → rename 覆盖目标。
 *
 * · 临时文件名带 **pid**：两个实例各写各的临时文件，不会互相盖掉半个文件
 *   （旧实现固定用 `<file>.tmp`，两实例必然抢同一个临时文件）。
 * · rename 遇瞬时占用时按 20/40/80/160ms 退避重试（默认 5 次，约 0.3s）。
 * · 仍失败**不做**「直接覆盖写」：那会让并发读方看到半个 JSON，而 store.load()
 *   一旦读到半个 JSON 会把文件改名为 `.corrupt-*` 并清空 —— 损失远大于「晚几秒落盘」。
 *   数据留在内存里，由调用方稍后重试（见 index.js 的 writeRecords 重试链）。
 *
 * @returns {{ok:boolean, attempts:number, mode:'rename'|'failed', error?:Error|null, transient?:boolean}}
 */
export function writeFileAtomic(filePath, data, opts) {
  const o = opts || {}
  const fs = Object.assign({ mkdirSync, writeFileSync, renameSync, unlinkSync }, o.fs || {})
  const sleep = o.sleep || sleepSync
  const tries = Math.max(1, Number(o.tries) || 5)
  const tmp = filePath + '.' + process.pid + '.tmp'
  const cleanup = () => { try { fs.unlinkSync(tmp) } catch (e) { /* 已被 rename 走或从未创建 */ } }
  try {
    fs.mkdirSync(dirname(filePath), { recursive: true })
    fs.writeFileSync(tmp, data, 'utf8')
  } catch (e) {
    cleanup()
    return { ok: false, attempts: 0, mode: 'failed', error: e, transient: isTransientRenameError(e) }
  }
  let attempts = 0
  let last = null
  for (let i = 0; i < tries; i++) {
    attempts += 1
    try {
      fs.renameSync(tmp, filePath)
      return { ok: true, attempts, mode: 'rename', error: last }
    } catch (e) {
      last = e
      if (!isTransientRenameError(e)) break
      if (i < tries - 1) sleep(20 * Math.pow(2, i))
    }
  }
  cleanup()
  return { ok: false, attempts, mode: 'failed', error: last, transient: isTransientRenameError(last) }
}

/** 给用户看的失败原因（区分「被占用」与「文件系统错误」） */
function explainPersistError(res) {
  if (res.transient) {
    return '记录文件被占用（杀毒/索引器/备份工具正在读它，或另有一个 dsh 实例在跑；'
      + 'Windows 上 rename 需要目标文件的删除权限，被占用时会失败）'
  }
  return '文件系统错误（不是占用问题）'
}


/**
 * 由插件侧统一计算明细的内容哈希键（与云端契约 §6 一致）。
 * 这里即时计算而不是在 store 里 import sync.js —— 该函数只依赖 node:crypto，
 * 复用它可保证「本地折叠」与「云端去重」用的是同一个键。
 * @param {object} r - 明细记录
 * @param {number} resetEpoch - 清空纪元
 */
export function recordHashKey(r, resetEpoch) {
  const US = '\u001f'
  const s = (v) => (v === undefined || v === null ? '' : String(v).trim())
  const i = (v) => { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0 }
  const c6 = (v) => { const n = Number(v); return !Number.isFinite(n) || n === 0 ? '0' : String(Math.round(n * 1e6) / 1e6) }
  const t = (r && r.tokens) || {}
  const canonical = [
    'detail', i(resetEpoch), i(r && r.ts),
    s(r && r.provider).toLowerCase(), s(r && r.model).toLowerCase(),
    s(r && r.sessionId), s(r && r.purpose),
    i(t.input), i(t.output), i(t.cacheRead), i(t.cacheWrite), i(t.reasoning),
    c6(r && r.cost),
  ].join(US)
  return createHash('sha256').update(canonical, 'utf8').digest('hex')
}

export function mergeIntoEntry(entry, r) {
  entry.calls += 1
  entry.input += r.tokens.input
  entry.output += r.tokens.output
  entry.cacheRead += r.tokens.cacheRead
  entry.cacheWrite += r.tokens.cacheWrite
  entry.cost += r.cost
  if (r.period === 'peak') entry.peak += r.cost
  else if (r.period === 'off-peak') entry.off += r.cost
  else entry.flat += r.cost
  return entry
}

/**
 * 把一条记录折叠进 rollups（按 dayKey + modelKey）。
 * 同时记录被吸收明细的内容哈希（`absorbed`），供云端排除重复统计 ——
 * 这是「明细超期后仍能全时段精确」的关键：快照 + 被吸收键声明。
 * @param {object} rollups - 日汇总容器
 * @param {object} r - 明细记录
 * @param {number} [resetEpoch] - 清空纪元（参与哈希）
 */
export function rollupRecord(rollups, r, resetEpoch) {
  const dk = dayKey(r.ts)
  const mk = modelKeyOf(r)
  const day = rollups[dk] || (rollups[dk] = {})
  const entry = day[mk] || (day[mk] = emptyEntry(r.provider, r.model, r.subscription, r.estimated))
  mergeIntoEntry(entry, r)
  if (!Array.isArray(entry.absorbed)) entry.absorbed = []
  if (entry.absorbed.length < MAX_ABSORBED_KEYS) entry.absorbed.push(recordHashKey(r, resetEpoch || 0))
  if (entry.absorbed.length === MAX_ABSORBED_KEYS) entry.absorbedTruncated = true
  return entry
}

/** 把 details 中早于保留窗口的记录折叠进 rollups，返回折叠条数（details 为按时间升序） */
export function applyRetention(details, rollups, now, detailDays = DETAIL_DAYS, resetEpoch = 0) {
  const cutoff = now - detailDays * DAY_MS
  let i = 0
  while (i < details.length && details[i].ts < cutoff) {
    rollupRecord(rollups, details[i], resetEpoch)
    i++
  }
  if (i > 0) details.splice(0, i)
  return i
}

/**
 * 全时段汇总（明细 + 日汇总）。口径与 buildSummary 一致：
 * 按量计费与订阅（等效费用）分开统计。
 * @returns {{realCost:number, realCalls:number, realTokens:number,
 *            subEquivalent:number, subCalls:number, subTokens:number,
 *            byModel:Map<string,{model:string, subscription:boolean, estimated:boolean,
 *                                 calls:number, tokens:number, cost:number}>}}
 */
export function collectTotals(details, rollups) {
  const t = { realCost: 0, realCalls: 0, realTokens: 0, subEquivalent: 0, subCalls: 0, subTokens: 0, byModel: new Map() }
  const add = (provider, model, subscription, estimated, calls, tokens, cost) => {
    const key = modelKeyOf({ provider, model })
    let m = t.byModel.get(key)
    if (!m) {
      m = { model: key, subscription: !!subscription, estimated: !!estimated, calls: 0, tokens: 0, cost: 0 }
      t.byModel.set(key, m)
    }
    m.calls += calls
    m.tokens += tokens
    m.cost += cost
    if (subscription) { t.subCalls += calls; t.subEquivalent += cost; t.subTokens += tokens }
    else { t.realCalls += calls; t.realCost += cost; t.realTokens += tokens }
  }
  for (const r of details) {
    add(r.provider, r.model, r.subscription, r.estimated, 1, r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite, r.cost)
  }
  for (const dk of Object.keys(rollups)) {
    const day = rollups[dk]
    for (const mk of Object.keys(day)) {
      const e = day[mk]
      add(e.provider, e.model, e.subscription, e.estimated, e.calls, e.input + e.output + e.cacheRead + e.cacheWrite, e.cost)
    }
  }
  return t
}

/**
 * 按天聚合（明细 + 日汇总）：dayKey -> 当日分段
 * @returns {Map<string,{peak:number, off:number, flat:number, cost:number, calls:number, tokens:number, subCost:number, subCalls:number}>}
 */
export function collectByDay(details, rollups) {
  const days = new Map()
  const ensure = (dk) => {
    let d = days.get(dk)
    if (!d) {
      d = { peak: 0, off: 0, flat: 0, cost: 0, calls: 0, tokens: 0, subCost: 0, subCalls: 0 }
      days.set(dk, d)
    }
    return d
  }
  for (const r of details) {
    const d = ensure(dayKey(r.ts))
    const total = r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite
    d.tokens += total
    if (r.subscription) { d.subCost += r.cost; d.subCalls += 1 }
    else {
      d.calls += 1
      d.cost += r.cost
      if (r.period === 'peak') d.peak += r.cost
      else if (r.period === 'off-peak') d.off += r.cost
      else d.flat += r.cost
    }
  }
  for (const dk of Object.keys(rollups)) {
    const d = ensure(dk)
    for (const mk of Object.keys(rollups[dk])) {
      const e = rollups[dk][mk]
      const total = e.input + e.output + e.cacheRead + e.cacheWrite
      d.tokens += total
      if (e.subscription) { d.subCost += e.cost; d.subCalls += e.calls }
      else {
        d.calls += e.calls
        d.cost += e.cost
        d.peak += e.peak
        d.off += e.off
        d.flat += e.flat
      }
    }
  }
  return days
}

/**
 * 创建存储。details/rollups 为原地可变引用。
 * @param {string} filePath - 数据文件路径
 * @param {{detailDays?:number, maxDetails?:number}} [opts] - 测试可覆盖默认值
 */
export function createStore(filePath, opts) {
  const detailDays = (opts && opts.detailDays) || DETAIL_DAYS
  const maxDetails = (opts && opts.maxDetails) || MAX_DETAILS
  const details = []
  const rollups = {}
  /** 单调递增的明细序号（云端增量同步用） */
  let seq = 0
  /** 清空计数：clear() 时 +1，使重新导入的数据不被云端判为重复 */
  let resetEpoch = 0
  /** 本次加载是否为旧文件（缺 seq 字段）——需要补配序号并落盘 */
  let needsNumbering = false

  /** 按时间升序补配 seq（旧文件升级路径） */
  function assignSeq() {
    const sorted = details.slice().sort((a, b) => (a.ts || 0) - (b.ts || 0))
    let n = seq
    for (const r of sorted) n += 1
    // 按排序结果分配：最老者序号最小，与上报顺序一致
    let i = n - details.length + 1
    for (const r of sorted) { r.seq = i; i += 1 }
    // details 需保持按时间升序（写入顺序）：排序后回填
    sorted.sort((a, b) => (a.seq || 0) - (b.seq || 0))
    details.length = 0
    for (const r of sorted) details.push(r)
    seq = n
  }

  function load() {
    try {
      if (!existsSync(filePath)) return
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'))
      if (Array.isArray(parsed)) {
        // v1：旧版裸数组，逐条迁移
        for (const r of parsed) if (isRecord(r)) details.push(r)
      } else if (parsed && typeof parsed === 'object') {
        if (Number.isFinite(parsed.seq)) seq = Math.max(0, Math.floor(parsed.seq))
        if (Number.isFinite(parsed.resetEpoch)) resetEpoch = Math.max(0, Math.floor(parsed.resetEpoch))
        if (Array.isArray(parsed.details)) {
          for (const r of parsed.details) {
            if (!isRecord(r)) continue
            if (!Number.isFinite(r.seq)) needsNumbering = true
            details.push(r)
          }
        }
        if (parsed.rollups && typeof parsed.rollups === 'object') {
          for (const dk of Object.keys(parsed.rollups)) {
            const day = parsed.rollups[dk]
            if (!day || typeof day !== 'object') continue
            for (const mk of Object.keys(day)) {
              const e = day[mk]
              if (!e || typeof e !== 'object' || typeof e.calls !== 'number') continue
              rollups[dk] = rollups[dk] || {}
              rollups[dk][mk] = e
            }
          }
        }
      }
      applyRetention(details, rollups, Date.now(), detailDays, resetEpoch)
      trimDetails()
      // 旧文件：补配序号（内存生效，下次 persist 落盘）
      if (needsNumbering) assignSeq()
      // 兜底：seq 小于现存最大序号时对齐（防止手工编辑过的文件造成重复序号）
      let maxSeen = 0
      for (const r of details) if (Number.isFinite(r.seq) && r.seq > maxSeen) maxSeen = r.seq
      if (maxSeen > seq) seq = maxSeen
      return details.length
    } catch (e) {
      // 损坏时改名备份，从零开始，不阻断启动
      try { renameSync(filePath, filePath + '.corrupt-' + Date.now()) } catch (e2) {}
      console.error('cost tracker load failed, starting empty', e)
      return 0
    }
  }

  function isRecord(r) {
    return !!r && typeof r === 'object' && typeof r.ts === 'number' && r.tokens && typeof r.tokens.input === 'number'
  }

  function trimDetails() {
    if (details.length > maxDetails) details.splice(0, details.length - maxDetails)
  }

  function add(r) {
    seq += 1
    r.seq = seq
    details.push(r)
    applyRetention(details, rollups, Date.now(), detailDays)
    trimDetails()
    return r
  }

  // 落盘失败只报一次（避免每 1.5 秒刷屏）；恢复后又失败会再次提示
  let persistWarned = false
  // 最近一次失败的原因（供调用方在重试链耗尽后打印）
  let lastPersistError = null
  let lastPersistTransient = false
  /** 供调用方在「自己还有重试机会」时静默（quiet=1），等重试链耗尽再报一次 */
  function persistProblemText(res) {
    return 'cost tracker persist failed: ' + ((res.error && res.error.message) || String(res.error))
      + '\n  原因：' + explainPersistError(res)
      + '\n  影响：数据仍在内存中，会在下一次写入时自动重试（不会丢）；'
      + '若反复出现，请确认没有同时运行两个 dsh 实例'
  }
  function persist(opts) {
    const o = opts || {}
    const res = writeFileAtomic(filePath, JSON.stringify({ v: 2, seq, resetEpoch, details, rollups }), o)
    if (res.ok) {
      lastPersistError = null
      lastPersistTransient = false
      if (res.attempts > 1 && !persistWarned) {
        persistWarned = true
        console.error('cost tracker persist: 文件被短暂占用，重试 ' + res.attempts + ' 次后已写入（'
          + explainPersistError({ transient: true }) + '）')
      } else if (res.attempts === 1) {
        persistWarned = false
      }
      return true
    }
    lastPersistError = res.error
    lastPersistTransient = res.transient === true
    if (!o.quiet && !persistWarned) {
      persistWarned = true
      console.error(persistProblemText(res))
    }
    return false
  }
  /** 重试链彻底放弃时由调用方打印（保证「只在真的没救时」才出现一次） */
  function persistProblem() {
    persistWarned = true
    return persistProblemText({ error: lastPersistError, transient: lastPersistTransient })
  }

  function clear() {
    details.length = 0
    for (const dk of Object.keys(rollups)) delete rollups[dk]
    resetEpoch += 1
    seq = 0
  }

  function counts() {
    let calls = details.length
    for (const dk of Object.keys(rollups)) {
      for (const mk of Object.keys(rollups[dk])) calls += rollups[dk][mk].calls
    }
    return { details: details.length, calls, maxSeq: seq, resetEpoch }
  }

  return {
    details, rollups, load, add, persist, persistProblem, clear, counts,
    /** 当前最大序号（云端水位比较用） */
    maxSeq: () => seq,
    /** 清空次数（参与去重键） */
    epoch: () => resetEpoch,
    /** 旧文件是否补配过序号（用于首次全量补传判定） */
    wasRenumbered: () => needsNumbering,
  }
}
