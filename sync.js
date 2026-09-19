// ============================================================
// DSH 花费统计插件 —— 云端同步引擎（纯逻辑，可独立测试）
//
// 契约见 dsh-cost-cloud 仓库的 docs/INGEST-API.md（syncVer = 1）。
// 本模块只做四件事：
//   1. 维护本机身份（machineId / deviceName）与同步游标（watermark）
//   2. 按契约 §6 计算内容哈希 dedupKey（与服务端逐位一致）
//   3. 组装增量载荷（明细 + 日汇总快照，附 absorbed 列表）
//   4. 分类处理响应/错误并退避，**绝不阻塞本地记账**
//
// 设计取舍：
//   · 游标只是省流量的优化；正确性由内容哈希兜底（游标丢失后全量重发是安全的）
//   · 明细先发、快照后发：快照的 absorbed 声明会让服务端把这些明细移出统计
//   · 任何异常都不抛出到调用方（除手动 runOnce 的诊断结果外）
// ============================================================
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 本插件在云端看板里的 agent 标识 */
export const SOURCE = 'dsh'
export const SYNC_VERSION = 1
const US = '\u001f'
const DAY_MS = 86400000
const MAX_BATCH_BYTES = 900 * 1024
/**
 * 历史回填算法版本（记录在状态文件 `backfillVer` 里）。
 * 低于本值的部署，下一轮同步会做一次「水位归零 + 由旧到新全量补发」。
 *   1 = v1.8.4：已废弃 —— 多轮循环用服务端返回的水位（整体 MAX(client_seq)）
 *       推进游标，会一步跨过本批之后尚未补发的记录，回填只发一批就短路。
 *   2 = v1.8.5 起：游标只推进到**本批实际送达**的 maxClientSeq，多轮可覆盖全部。
 */
const BACKFILL_VER = 2

// ------------------------------------------------------------
// 共享设备身份（与其它 agent 的适配器共用同一份文件）
//   目录可用 DSH_COST_HOME 覆盖（多 OS 用户想合并为同一台设备时指向共享路径）
// ------------------------------------------------------------
export function dataDir(env) {
  const e = env || process.env
  return e.DSH_COST_HOME && String(e.DSH_COST_HOME).trim()
    ? String(e.DSH_COST_HOME).trim()
    : join(homedir(), '.dsh-cost')
}

export function identityPath(env) { return join(dataDir(env), 'device.json') }
export function syncStatePath(storageDir) { return join(storageDir, 'cost-tracker-sync.json') }

function defaultMachineId(env) {
  const e = env || process.env
  const host = e.COMPUTERNAME || e.HOSTNAME || e.HOST || 'unknown-host'
  const user = e.USERNAME || e.USER || 'unknown-user'
  return createHash('sha256').update(host + '/' + user).digest('hex').slice(0, 16)
}

/**
 * 读取（必要时创建）共享设备身份。
 * @param {{env?:object, dir?:string}} [opts]
 * @returns {{v:number, machineId:string, machineName:string, nameLocked:boolean}}
 */
export function loadIdentity(opts) {
  const env = (opts && opts.env) || process.env
  const dir = (opts && opts.dir) || dataDir(env)
  const file = join(dir, 'device.json')
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (parsed && typeof parsed === 'object' && parsed.machineId) {
      return {
        v: 1,
        machineId: String(parsed.machineId),
        machineName: String(parsed.machineName || ''),
        nameLocked: parsed.nameLocked === true,
      }
    }
  } catch (e) { /* 首次运行或文件损坏：重建 */ }
  const id = {
    v: 1,
    machineId: defaultMachineId(env),
    machineName: (env.COMPUTERNAME || env.HOSTNAME || 'DSH 设备'),
    nameLocked: false,
  }
  try {
    mkdirSync(dir, { recursive: true })
    writeFileSync(file, JSON.stringify(id, null, 2), 'utf8')
  } catch (e) { /* 只读环境：内存态继续工作 */ }
  return id
}

export function saveIdentity(id, opts) {
  const env = (opts && opts.env) || process.env
  const dir = (opts && opts.dir) || dataDir(env)
  try {
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'device.json')
    const tmp = file + '.tmp'
    writeFileSync(tmp, JSON.stringify(id, null, 2), 'utf8')
    renameSync(tmp, file)
    return true
  } catch (e) {
    return false
  }
}

// ------------------------------------------------------------
// 契约 §6：去重键（必须与 dsh-cost-cloud 的实现逐位一致）
// ------------------------------------------------------------
function s(v) { return v === undefined || v === null ? '' : String(v).trim() }
function i(v) { const n = Number(v); return Number.isFinite(n) ? Math.trunc(n) : 0 }
function cost6(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n === 0) return '0'
  return String(Math.round(n * 1e6) / 1e6)
}

/** 明细记录的 canonical 串；provider/model 小写、字符串 trim、整数截断、费用 6 位最短表示 */
export function detailCanonical(rec, resetEpoch) {
  const t = (rec && rec.tokens) || {}
  return [
    'detail', i(resetEpoch), i(rec && rec.ts),
    s(rec && rec.provider).toLowerCase(), s(rec && rec.model).toLowerCase(),
    s(rec && rec.sessionId), s(rec && rec.purpose),
    i(t.input), i(t.output), i(t.cacheRead), i(t.cacheWrite), i(t.reasoning),
    cost6(rec && rec.cost),
  ].join(US)
}

/** 日汇总快照的 canonical 串：身份只含 日 + 订阅口径 + provider + model（不含可变指标） */
export function rollupCanonical(entry) {
  return [
    'rollup:' + s(entry && entry.dayKey),
    entry && (entry.subscription === true || entry.subscription === 1) ? '1' : '0',
    s(entry && entry.provider).toLowerCase(),
    s(entry && entry.model).toLowerCase(),
  ].join(US)
}

export function sha256hex(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex')
}

export function dedupKeyOf(rec, resetEpoch) {
  return sha256hex(detailCanonical(rec, resetEpoch))
}

export function rollupKeyOf(entry) {
  return sha256hex(rollupCanonical(entry))
}

// ------------------------------------------------------------
// 云端配置
// ------------------------------------------------------------
export function normalizeCloudConfig(raw) {
  const def = {
    cloudEnabled: false,
    cloudUrl: '',
    cloudToken: '',
    deviceName: '',
    deviceId: '',
    syncIntervalSec: 60,
    syncBatchSize: 500,
    maskSessionId: false,
    includePurpose: true,
    syncRollups: true,
    syncSinceDays: 180,
    cloudView: 'local',
    cloudPanelDevices: [],
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return def
  const url = typeof raw.cloudUrl === 'string' ? raw.cloudUrl.trim().replace(/\/+$/, '') : ''
  const validUrl = /^https?:\/\/[^\s]+$/i.test(url) ? url : ''
  const intIn = (v, lo, hi, fb) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : fb)
  const view = raw.cloudView === 'local+cloud' || raw.cloudView === 'cloud' ? raw.cloudView : 'local'
  return {
    cloudEnabled: raw.cloudEnabled === true && !!validUrl,
    cloudUrl: validUrl,
    cloudToken: typeof raw.cloudToken === 'string' ? raw.cloudToken.trim().slice(0, 512) : '',
    deviceName: typeof raw.deviceName === 'string' ? raw.deviceName.trim().slice(0, 64) : '',
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId.trim().slice(0, 128) : '',
    syncIntervalSec: intIn(raw.syncIntervalSec, 15, 3600, def.syncIntervalSec),
    syncBatchSize: intIn(raw.syncBatchSize, 50, 2000, def.syncBatchSize),
    maskSessionId: raw.maskSessionId === true,
    includePurpose: raw.includePurpose !== false,
    syncRollups: raw.syncRollups !== false,
    syncSinceDays: intIn(raw.syncSinceDays, 0, 3650, def.syncSinceDays),
    cloudView: view,
    cloudPanelDevices: Array.isArray(raw.cloudPanelDevices)
      ? raw.cloudPanelDevices.map((x) => String(x)).filter(Boolean).slice(0, 64)
      : [],
  }
}

// ------------------------------------------------------------
// 同步状态（游标文件）
// ------------------------------------------------------------
export function defaultSyncState() {
  return {
    v: 1,
    deviceId: '',
    watermark: 0,
    lastSyncAt: 0,
    lastOkAt: 0,
    lastError: '',
    needAuth: false,
    backoffMs: 0,
    pendingFailures: 0,
    legacySent: false,
    backfillVer: 0,
    rollups: {},
    records: 0,
  }
}

export function readSyncState(storageDir) {
  try {
    const parsed = JSON.parse(readFileSync(syncStatePath(storageDir), 'utf8'))
    return Object.assign(defaultSyncState(), parsed && typeof parsed === 'object' ? parsed : {})
  } catch (e) {
    return defaultSyncState()
  }
}

export function writeSyncState(storageDir, state) {
  try {
    mkdirSync(storageDir, { recursive: true })
    const file = syncStatePath(storageDir)
    const tmp = file + '.tmp'
    writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8')
    renameSync(tmp, file)
    return true
  } catch (e) {
    return false
  }
}

// ------------------------------------------------------------
// HTTP 辅助
// ------------------------------------------------------------
function classifyStatus(status, body) {
  if (status === 200 && body && body.ok) return { ok: true }
  const code = (body && body.code) || ''
  if (status === 401 || code === 'TOKEN_INVALID' || code === 'TOKEN_MISSING') {
    return { ok: false, code: 'TOKEN_INVALID', needAuth: true, message: '云端令牌无效，请在插件配置里更新' }
  }
  if (status === 403) {
    return { ok: false, code, needAuth: false, message: (body && body.error) || '云端拒绝：设备被禁用或未开启自注册' }
  }
  if (status === 413 || code === 'BATCH_TOO_LARGE' || code === 'PAYLOAD_TOO_LARGE') {
    return { ok: false, code: 'TOO_LARGE', shrink: true, message: '批次过大，已自动折半重试' }
  }
  if (status === 400) {
    return { ok: false, code, needAuth: false, fatal: true, message: (body && body.error) || '请求被云端拒绝（协议不匹配？）' }
  }
  if (status === 429) return { ok: false, code: 'RATE_LIMITED', retry: true, retryAfterMs: (body && body.retryAfterMs) || 60000, message: '触发云端限流，稍后重试' }
  if (status >= 500 || status === 0) return { ok: false, code: 'SERVER', retry: true, message: (body && body.error) || '云端暂时不可用' }
  return { ok: false, code, needAuth: false, message: (body && body.error) || ('HTTP ' + status) }
}

// ------------------------------------------------------------
// 同步引擎
// ------------------------------------------------------------
/**
 * @param {object} deps
 * @param {() => object} deps.getConfig - 返回规范化后的插件配置（含 cloud* 字段）
 * @param {() => Promise<string>|string} [deps.getToken] - 异步令牌提供者（v1.9.0：
 *   令牌存 DSH 凭据库，配置文件零明文；未提供时回落 cfg.cloudToken 旧路径）
 * @param {() => {details:Array, rollups:object, resetEpoch:number, storageDir:string, maxSeq:number}} deps.getSnapshot
 * @param {(patch:object) => void} [deps.setConfigField] - 回写配置（记录同步结果/身份）
 * @param {typeof fetch} [deps.fetchFn]
 * @param {() => number} [deps.now]
 * @param {(msg:string) => void} [deps.log]
 */
export function createSyncEngine(deps) {
  const getConfig = deps.getConfig
  const getToken = typeof deps.getToken === 'function' ? deps.getToken : null
  const getSnapshot = deps.getSnapshot
  const setConfigField = deps.setConfigField || (() => {})
  const fetchFn = deps.fetchFn || globalThis.fetch
  const now = deps.now || (() => Date.now())
  const log = deps.log || (() => {})
  let identity = null
  let running = false
  /** 最近一次成功解析的令牌（仅用于 status() 的 hasToken 回显，绝不进日志/配置） */
  let lastKnownToken = ''

  /** 令牌解析：凭据库提供者优先（异步），回落配置文件旧路径（迁移前的兜底） */
  async function resolveToken(cfg) {
    if (getToken) {
      try {
        const t = String((await getToken()) || '').trim()
        if (t) { lastKnownToken = t; return t }
      } catch (e) { /* 凭据服务暂不可用：回落 cfg */ }
    }
    const legacy = String(cfg.cloudToken || '').trim()
    if (legacy) lastKnownToken = legacy
    return legacy
  }

  function identityOf() {
    if (!identity) {
      const snap = safeSnapshot()
      const cfg = normalizeCloudConfig(getConfig())
      identity = loadIdentity({ dir: dataDir() })
      if (cfg.deviceName && !identity.nameLocked && identity.machineName !== cfg.deviceName) {
        identity.machineName = cfg.deviceName
        saveIdentity(identity)
      }
    }
    return identity
  }

  function safeSnapshot() {
    try { return getSnapshot() || {} } catch (e) { return {} }
  }

  function state() {
    const snap = safeSnapshot()
    return readSyncState(snap.storageDir || process.cwd())
  }

  function saveState(next) {
    const snap = safeSnapshot()
    return writeSyncState(snap.storageDir || process.cwd(), next)
  }

  function headers(token) {
    return {
      'content-type': 'application/json',
      authorization: 'Bearer ' + token,
    }
  }

  /** 组装本批明细载荷 */
  function buildRecordsPayload(cfg, st, limitOverride) {
    const snap = safeSnapshot()
    const details = Array.isArray(snap.details) ? snap.details : []
    const resetEpoch = Number(snap.resetEpoch) || 0
    const limit = limitOverride || cfg.syncBatchSize
    const cutoff = cfg.syncSinceDays > 0 ? now() - cfg.syncSinceDays * DAY_MS : 0
    const out = []
    let bytes = 0
    // 必须**由旧到新**收集：水位语义是"已成功上送的最大 seq"，
    // 若从最新往回取批，首批只覆盖最新 limit 条，水位随即跳过更旧的记录，
    // 它们就再也不会被选中（历史数据永久缺失）。
    for (let k = 0; k < details.length; k += 1) {
      const r = details[k]
      if (!r || typeof r.ts !== 'number') continue
      const seq = Number.isFinite(r.seq) ? r.seq : 0
      if (seq <= st.watermark && st.watermark > 0) continue
      if (cutoff && r.ts < cutoff) continue
      const rec = {
        seq: seq || undefined,
        ts: r.ts,
        provider: r.provider,
        model: r.model,
        sessionId: cfg.maskSessionId && r.sessionId ? sha256hex(String(r.sessionId)).slice(0, 16) : (r.sessionId || ''),
        purpose: cfg.includePurpose ? (r.purpose || '') : '',
        tokens: {
          input: Number(r.tokens && r.tokens.input) || 0,
          output: Number(r.tokens && r.tokens.output) || 0,
          cacheRead: Number(r.tokens && r.tokens.cacheRead) || 0,
          cacheWrite: Number(r.tokens && r.tokens.cacheWrite) || 0,
          reasoning: Number(r.tokens && r.tokens.reasoning) || 0,
        },
        cost: Number(r.cost) || 0,
        estimated: r.estimated === true,
        subscription: r.subscription === true,
        period: r.period || 'flat',
      }
      // 去重键按**原始记录**计算（服务端也按原始字段算），脱敏只影响上送字段
      rec.dedupKey = dedupKeyOf(r, resetEpoch)
      const size = JSON.stringify(rec).length
      if (out.length > 0 && (out.length >= limit || bytes + size > MAX_BATCH_BYTES)) break
      out.push(rec)
      bytes += size
      if (out.length >= limit) break
    }
    // details 本身按时间升序，顺序收集即为升序上送（便于服务端推进水位）
    return {
      records: out,
      maxClientSeq: out.length ? Math.max(...out.map((r) => Number(r.seq) || 0)) : 0,
      resetEpoch,
    }
  }

  /** 组装待上报的日汇总快照（含 absorbed 明细键） */
  function buildRollupsPayload(cfg, st) {
    const snap = safeSnapshot()
    const rollups = snap.rollups || {}
    const out = []
    const sent = Object.assign({}, st.rollups || {})
    for (const day of Object.keys(rollups)) {
      for (const mk of Object.keys(rollups[day])) {
        const e = rollups[day][mk]
        if (!e) continue
        const key = rollupKeyOf({ dayKey: day, provider: e.provider, model: e.model, subscription: e.subscription })
        const prev = sent[key]
        // 快照只增不减：calls / cost 与前次相同则无需再传
        if (prev && Number(prev.calls) >= Number(e.calls) && Number(prev.cost) >= Number(e.cost)) continue
        out.push({
          key,
          snapshot: {
            dayKey: day,
            provider: e.provider,
            model: e.model,
            subscription: e.subscription === true,
            calls: Number(e.calls) || 0,
            tokens: {
              input: Number(e.input) || 0,
              output: Number(e.output) || 0,
              cacheRead: Number(e.cacheRead) || 0,
              cacheWrite: Number(e.cacheWrite) || 0,
              reasoning: Number(e.reasoning) || 0,
            },
            cost: Number(e.cost) || 0,
            peak: Number(e.peak) || 0,
            off: Number(e.off) || 0,
            flat: Number(e.flat) || 0,
            // 被折叠进本快照的明细键：服务端据此把它们移出统计（避免与快照重复计数）
            absorbed: Array.isArray(e.absorbed) ? e.absorbed.slice(0, 5000) : [],
          },
        })
        if (out.length >= 200) break
      }
      if (out.length >= 200) break
    }
    return out
  }

  function pad2(n) { return n < 10 ? '0' + n : '' + n }

  async function postJson(url, token, payload, timeoutMs) {
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), timeoutMs || 15000)
    try {
      const res = await fetchFn(url, { method: 'POST', headers: headers(token), body: JSON.stringify(payload), signal: ac.signal })
      let body = null
      try { body = await res.json() } catch (e) { body = null }
      return { status: res.status, body }
    } catch (e) {
      return { status: 0, body: null, error: String((e && e.message) || e) }
    } finally {
      clearTimeout(timer)
    }
  }

  /** 解析设备身份：优先令牌归属，其次自注册，最后用本机 machineId */
  async function ensureDevice(cfg, st) {
    const id = identityOf()
    const deviceId = cfg.deviceId || id.machineId
    if (st.deviceId && !cfg.deviceId) return st.deviceId
    return deviceId
  }

  /** 单次同步（手动或定时触发） */
  async function runOnce(opts) {
    const manual = !!(opts && opts.manual)
    const full = !!(opts && opts.full)
    const cfg = normalizeCloudConfig(getConfig())
    const result = { ok: false, skipped: true, accepted: 0, duplicates: 0, rollups: 0, error: '', needAuth: false, at: now() }
    if (!cfg.cloudEnabled || !cfg.cloudUrl) {
      result.error = '未启用云端同步或未填写服务地址'
      return result
    }
    // 令牌：凭据库（getToken）优先，配置文件遗留明文兜底（迁移完成前）
    const cloudToken = await resolveToken(cfg)
    if (!cloudToken) {
      result.error = '未填写云端令牌'
      result.needAuth = true
      return result
    }
    if (running) {
      result.error = '上一次同步仍在进行'
      return result
    }
    running = true
    try {
      const st = readSyncState(safeSnapshot().storageDir || process.cwd())
      if (full) { st.watermark = 0; st.legacySent = false; st.backfillVer = 0 }
      // 一次性历史回填：≤1.8.3 的取批方向是"最新优先"，首批传完水位就跳到了最新
      // seq，更旧的记录被 `seq <= watermark` 永久跳过（云端因此缺一段历史）。
      // 这里在升级后的第一轮同步把水位归零、由旧到新把全部历史补齐一次；
      // 服务端按内容哈希幂等，重复的记录只会被计为 duplicates。
      // 用 backfillVer 而不是布尔量：v1.8.4 的回填算法本身有缺陷（见常量注释），
      // 必须让已经跑过 v1 回填的部署再补跑一次 v2。
      const backfill = Number(st.backfillVer) !== BACKFILL_VER
      if (backfill) st.watermark = 0
      st.deviceId = await ensureDevice(cfg, st)
      if (!identityOf().nameLocked && cfg.deviceName) {
        identity.machineName = cfg.deviceName
        saveIdentity(identity)
      }
      const id = identityOf()
      const base = cfg.cloudUrl

      // ---- 1. 明细（先发） ----
      let pending = buildRecordsPayload(cfg, st, cfg.syncBatchSize)
      let sentRecords = 0
      let round = 0
      while (pending.records.length && round < 40) {
        round += 1
        const payload = {
          syncVer: SYNC_VERSION,
          source: SOURCE,
          agentInstance: '',
          agent: { name: 'DSH', version: process.env.DSH_VERSION || '', pluginVersion: PLUGIN_VERSION },
          deviceId: st.deviceId,
          deviceName: id.machineName || cfg.deviceName || '',
          resetEpoch: pending.resetEpoch,
          maxClientSeq: pending.maxClientSeq,
          sentAt: now(),
          batchUid: randomUUID(),
          records: pending.records,
        }
        const r = await postJson(base + '/api/v1/ingest/records', cloudToken, payload)
        const cls = classifyStatus(r.status, r.body)
        if (!cls.ok) {
          if (cls.shrink && pending.records.length > 1) {
            // 批次过大：折半重试
            const half = Math.max(1, Math.floor(pending.records.length / 2))
            pending = buildRecordsPayload(cfg, st, half)
            continue
          }
          throw Object.assign(new Error(cls.message || '上报失败'), { needAuth: cls.needAuth, retryAfterMs: cls.retryAfterMs, fatal: cls.fatal })
        }
        const accepted = Number(r.body.accepted) || 0
        const dup = Number(r.body.duplicates) || 0
        const updated = Number(r.body.updated) || 0
        const invalid = Number(r.body.invalid) || 0
        sentRecords += accepted + dup + updated
        result.accepted += accepted
        result.duplicates += dup
        result.updated = (result.updated || 0) + updated
        result.invalid = (result.invalid || 0) + invalid
        // 游标只推进到**本批实际送达**的最大 seq。
        // 服务端回的是它库里该设备明细的 MAX(client_seq)（可能含更早已上传的、
        // 序号更高的记录），直接采信会一步跨过本批之后尚未补发的记录，
        // 让下面的多轮循环当场 break —— 那正是历史缺口补不回来的原因。
        if (accepted + dup + updated > 0) {
          if (pending.maxClientSeq > st.watermark) st.watermark = pending.maxClientSeq
        } else if (invalid > 0) {
          throw Object.assign(new Error('云端拒绝了本批全部 ' + invalid + ' 条记录'), { fatal: true })
        }
        const next = buildRecordsPayload(cfg, st, cfg.syncBatchSize)
        if (!next.records.length || next.maxClientSeq <= pending.maxClientSeq) break
        pending = next
      }
      result.sentRecords = sentRecords
      // 明细已由旧到新走完一轮（或达到轮次上限，水位同样可精确续传）→ 历史已对齐。
      // 只在真正跑完明细阶段后落版本号：中途失败时保持旧值，下次仍会从头补，绝不漏发。
      st.legacySent = true
      st.backfillVer = BACKFILL_VER

      // ---- 2. 日汇总快照（后发，声明 absorbed） ----
      if (cfg.syncRollups) {
        const snaps = buildRollupsPayload(cfg, st)
        for (let k = 0; k < snaps.length; k += 100) {
          const chunk = snaps.slice(k, k + 100)
          const payload = {
            syncVer: SYNC_VERSION,
            source: SOURCE,
            agentInstance: '',
            agent: { name: 'DSH', pluginVersion: PLUGIN_VERSION },
            deviceId: st.deviceId,
            deviceName: id.machineName || '',
            sentAt: now(),
            batchUid: randomUUID(),
            snapshots: chunk.map((x) => x.snapshot),
          }
          const r = await postJson(base + '/api/v1/ingest/rollups', cloudToken, payload)
          const cls = classifyStatus(r.status, r.body)
          if (!cls.ok) throw Object.assign(new Error(cls.message || '快照上报失败'), { needAuth: cls.needAuth, retryAfterMs: cls.retryAfterMs, fatal: cls.fatal })
          result.rollups += Number(r.body.rollupsUpserted) || 0
          for (const item of chunk) {
            const at = r.body && r.body.watermark ? r.body.watermark.lastAcceptedAt : now()
            st.rollups[item.key] = { calls: item.snapshot.calls, cost: item.snapshot.cost, at }
          }
        }
      }

      // ---- 3. 成功：重置退避 ----
      st.lastSyncAt = now()
      st.lastOkAt = now()
      st.lastError = ''
      st.needAuth = false
      st.backoffMs = 0
      st.pendingFailures = 0
      st.records = (st.records || 0) + result.accepted
      saveState(st)
      setConfigField({ lastSyncAt: st.lastSyncAt, lastSyncOk: true, lastSyncError: '', lastSyncAccepted: result.accepted })
      result.ok = true
      result.skipped = false
      result.watermark = st.watermark
      log('sync ok: accepted=' + result.accepted + ' dup=' + result.duplicates + ' rollups=' + result.rollups + ' watermark=' + st.watermark)
      return result
    } catch (e) {
      const st = readSyncState(safeSnapshot().storageDir || process.cwd())
      st.pendingFailures = (st.pendingFailures || 0) + 1
      st.lastError = String((e && e.message) || e)
      st.needAuth = e && e.needAuth === true
      const retryAfter = Number(e && e.retryAfterMs) || 0
      st.backoffMs = retryAfter || Math.min(300000, 5000 * Math.pow(2, Math.min(6, st.pendingFailures - 1)))
      st.lastSyncAt = now()
      saveState(st)
      setConfigField({ lastSyncAt: st.lastSyncAt, lastSyncOk: false, lastSyncError: st.lastError, needAuth: st.needAuth })
      result.error = st.lastError
      result.needAuth = st.needAuth
      result.backoffMs = st.backoffMs
      log('sync failed: ' + st.lastError)
      return result
    } finally {
      running = false
    }
  }

  /** 测试连接：GET /health 并核对协议版本 */
  async function testConnection(cfgOverride) {
    const cfg = normalizeCloudConfig(cfgOverride || getConfig())
    if (!cfg.cloudUrl) return { ok: false, error: '未填写服务地址' }
    try {
      const res = await fetchFn(cfg.cloudUrl + '/api/v1/health', { method: 'GET' })
      const body = await res.json().catch(() => null)
      if (!body || body.ok !== true) return { ok: false, error: 'HTTP ' + res.status + '：服务端未就绪' }
      if (Number(body.syncVer) !== SYNC_VERSION) {
        return { ok: false, error: '协议版本不匹配：插件 syncVer=' + SYNC_VERSION + '，服务端 syncVer=' + body.syncVer }
      }
      if (Number(body.minSyncVer) > SYNC_VERSION) {
        return { ok: false, error: '服务端要求 syncVer ≥ ' + body.minSyncVer + '，请升级插件' }
      }
      return {
        ok: true,
        serviceVersion: String(body.serviceVersion || ''),
        selfRegister: !!(body.caps && body.caps.selfRegister),
        groupBy: (body.caps && body.caps.groupBy) || [],
      }
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) }
    }
  }

  /** 同步状态（供 UI 展示） */
  function status() {
    const cfg = normalizeCloudConfig(getConfig())
    const st = readSyncState(safeSnapshot().storageDir || process.cwd())
    const snap = safeSnapshot()
    const id = identityOf()
    const pending = buildRecordsPayload(cfg, st, cfg.syncBatchSize)
    return {
      enabled: cfg.cloudEnabled,
      url: cfg.cloudUrl,
      // v1.9.0：令牌在凭据库（getToken 已解析过则已知）；配置文件明文仅是迁移前兜底
      hasToken: !!cfg.cloudToken || !!lastKnownToken,
      deviceId: cfg.deviceId || id.machineId,
      deviceName: cfg.deviceName || id.machineName,
      watermark: st.watermark,
      maxSeq: Number(snap.maxSeq) || 0,
      pending: pending.records.length,
      lastSyncAt: st.lastSyncAt,
      lastOkAt: st.lastOkAt,
      lastError: st.lastError,
      needAuth: st.needAuth,
      backoffMs: st.backoffMs,
      failures: st.pendingFailures,
      rollupsSent: Object.keys(st.rollups || {}).length,
      intervalSec: cfg.syncIntervalSec,
      view: cfg.cloudView,
      viewCloudMode: cfg.cloudView === 'cloud' ? 'cloud' : cfg.cloudView === 'local+cloud' ? 'cloud-rest' : 'cloud-others',
      maskSessionId: cfg.maskSessionId,
      includePurpose: cfg.includePurpose,
      syncSinceDays: cfg.syncSinceDays,
      dataDir: dataDir(),
      identityFile: identityPath(),
    }
  }

  return { runOnce, status, testConnection, loadIdentity: identityOf, _buildRecordsPayload: buildRecordsPayload, _buildRollupsPayload: buildRollupsPayload }
}

/** 插件版本（编译期由 index.js 注入或读 package.json，缺省视为未知） */
export let PLUGIN_VERSION = 'dev'
export function setPluginVersion(v) { PLUGIN_VERSION = String(v || 'dev') }
