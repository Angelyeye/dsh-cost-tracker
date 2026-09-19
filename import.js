// ============================================================
// DSH 花费统计插件 —— 历史导入（回放宿主会话日志，纯 Node，可独立测试）
//
// 目标：把「装插件之前」的 DSH 对话调用补录进账本。宿主会话日志位于
//   $DSH_HOME/sessions/<项目>/<会话>/session.v3.jsonl[.zstd]（旧版无 v3 段）
// 每个追加批次是独立的 zstd frame；成功调用的用量在 assistant/message 的
// data.usage 里（provider/model 在 data.message.source），流式样本在
// assistant/chunk 的 usage 块里 —— 同一 (turn, step) 以最终 message 为准。
//
// 幂等与防重复计数（三层）：
//   1. 会话清单（manifest）按文件 mtime+size 快跳未变化的日志；
//   2. 覆盖判定：只有「插件不可能记到」的调用才导入 ——
//        ts < 本机最早一条**实时**记录的时刻（插件安装点），
//        或该调用所在日完全没有实时覆盖（明细 + 日汇总都没有，停机缺口）；
//        且 ts 早于该会话首条实时记录（会话跨安装点的切割线）；
//   3. 逐调用键去重：sessionId|ts|model|五桶 tokens，与已导入明细比对。
//   导入记录带 source:'import'，与实时记录(source:'live')在任何聚合中都可区分；
//   覆盖判定只看实时记录 —— 导入记录既不当覆盖面，也不影响重跑判定。
//
// Zstd frame 扫描算法改编自 dsh-cost-meter（MIT）lib/backfill.js 的
// scanZstdFrames —— 与宿主 dsh-session-persistence-jsonl 容器格式一致；
// 逐帧解压、逐帧按行切片，任一时刻只保留单帧解压结果（防大日志 OOM）。
// ============================================================
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import * as zlib from 'node:zlib'

export const IMPORT_SOURCE = 'import'

const ZSTD_MAGIC = 4247762216
/** 打包行（文本/推理/工具调用增量游程）不含 header 与 usage，回放时跳过 */
const PACKED_ROW_TYPES = new Set(['text-chunks', 'reasoning-chunks', 'tool-call-chunks'])

/**
 * 结构化扫描拼接的 zstd frame 边界（不解压块内容）。残缺尾帧（崩溃截断）忽略。
 * @param {Buffer} buffer
 * @returns {{start:number,end:number}[]}
 */
export function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return frames
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) return frames
    offset += 4
    if (offset === buffer.length) return frames
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) return frames // 保留位：结构非法，停止扫描
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) return frames
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) return frames
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) return frames // 保留块类型：结构非法
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return frames
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return frames
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/**
 * 读取一份会话日志的全部事件行：zstd 逐帧解压、逐帧按行切片（防 OOM）；
 * 明文 .jsonl 直接按行。坏行跳过。
 * @param {string} path
 * @returns {object[]}
 */
export function readSessionRecords(path) {
  const buffer = readFileSync(path)
  const records = []
  let pending = '' // 跨帧行缓冲：上一帧末尾未换行的残行拼进下一帧首行
  const consumeText = (text) => {
    if (!text.length) return
    const lines = text.split('\n')
    lines[0] = pending + lines[0]
    pending = lines[lines.length - 1]
    for (let i = 0; i < lines.length - 1; i += 1) {
      const line = lines[i]
      if (!line.length) continue
      try { records.push(JSON.parse(line)) } catch (e) { /* 坏行跳过 */ }
    }
  }
  if (path.endsWith('.zstd')) {
    if (typeof zlib.zstdDecompressSync !== 'function') return []
    for (const f of scanZstdFrames(buffer)) {
      consumeText(zlib.zstdDecompressSync(buffer.subarray(f.start, f.end)).toString('utf8'))
    }
  } else {
    consumeText(buffer.toString('utf8'))
  }
  if (pending.length > 0) {
    try { records.push(JSON.parse(pending)) } catch (e) { /* 尽力而为 */ }
  }
  return records
}

/**
 * 枚举会话根目录下全部会话日志（<root>/<项目>/<会话>/session*.jsonl[.zstd]）。
 * @param {string} root - 会话根目录（$DSH_HOME/sessions）
 */
export function listSessionLogs(root) {
  const paths = []
  let projects
  try { projects = readdirSync(root, { withFileTypes: true }) } catch (e) { return paths }
  for (const project of projects) {
    if (!project.isDirectory()) continue
    let sessions
    try { sessions = readdirSync(join(root, project.name), { withFileTypes: true }) } catch (e) { continue }
    for (const session of sessions) {
      if (!session.isDirectory()) continue
      for (const name of ['session.v3.jsonl.zstd', 'session.v3.jsonl', 'session.jsonl.zstd', 'session.jsonl']) {
        const path = join(root, project.name, session.name, name)
        try {
          if (statSync(path).isFile()) { paths.push(path); break } // 同一会话多种编码互斥，取先命中者
        } catch (e) { /* 继续尝试另一后缀 */ }
      }
    }
  }
  return paths
}

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const str = (v) => (v === undefined || v === null ? '' : String(v).trim())

/**
 * 回放单个会话日志，重建逐次调用（时间升序）。
 *
 * provider/model 来源优先级：assistant/message.data.message.source（每次调用
 * 自带，最权威）→ request/header.data.header.config 状态机 → request/context。usage 按 (turn,step)
 * 去重，最终 message 覆盖流式样本；全部桶为 0 的调用（失败尝试）不产出。
 * fork 种子段（time < createdAt 的拷贝事件）跳过 —— 父会话已计过。
 *
 * @param {object[]} records - readSessionRecords 的输出
 * @param {{fallbackSessionId?:string}} [opts]
 * @returns {{sessionId:string, createdAt:number, isSeeded:boolean, calls:Array}}
 */
export function replaySessionCalls(records, opts) {
  const o = opts || {}
  let sessionId = str(o.fallbackSessionId)
  let createdAt = 0
  let isSeeded = false
  let provider = ''
  let model = ''
  const byTurnStep = new Map() // `${turn}|${step}` → {ts, provider, model, usage, seq}
  for (const ev of records) {
    if (!ev || typeof ev !== 'object' || !ev.type) continue
    const t = ev.type
    if (t === 'session') {
      if (str(ev.id)) sessionId = str(ev.id)
      createdAt = num(ev.createdAt) || createdAt
      isSeeded = ev.isSeeded === true
      continue
    }
    const ts = num(ev.time)
    if (createdAt && ts && ts < createdAt) continue // fork 种子段：父会话已计过
    if (t === 'request/header') {
      // 真实形状：data.header.config.{provider,model}（实测 2026-09 会话日志）；
      // 兼容 data.{provider,model} 的扁平写法
      const d = ev.data || {}
      const cfg = (d.header && d.header.config) || d
      provider = str(cfg.provider) || provider
      model = str(cfg.model) || model
      continue
    }
    if (t === 'request/context') {
      const d = ev.data || {}
      provider = str(d.provider) || provider
      model = str(d.model) || model
      continue
    }
    if (PACKED_ROW_TYPES.has(t)) continue
    if (t === 'assistant/chunk') {
      const chunk = ev.data && ev.data.chunk
      if (chunk && chunk.type === 'usage' && chunk.usage) {
        const key = num(ev.data.turn) + '|' + num(ev.data.step)
        const prev = byTurnStep.get(key)
        byTurnStep.set(key, {
          ts: ts || (prev && prev.ts) || 0,
          provider: (prev && prev.provider) || provider,
          model: (prev && prev.model) || model,
          usage: chunk.usage,
          source: (prev && prev.source) || null,
          final: false,
        })
      }
      continue
    }
    if (t === 'assistant/message' || t === 'assistant/attempt') {
      const d = ev.data || {}
      const usage = d.usage
      const src = d.message && d.message.source ? d.message.source : null
      const key = num(d.turn) + '|' + num(d.step)
      const prev = byTurnStep.get(key)
      byTurnStep.set(key, {
        ts: ts || (prev && prev.ts) || 0,
        provider: (src && str(src.provider)) || (prev && prev.provider) || provider,
        model: (src && str(src.model)) || (prev && prev.model) || model,
        usage: usage || (prev && prev.usage) || null,
        source: src || (prev && prev.source) || null,
        final: true,
      })
      continue
    }
  }
  const calls = []
  for (const [key, item] of byTurnStep) {
    const u = item.usage
    if (!u) continue
    const tokens = {
      input: num(u.inputTokens),
      output: num(u.outputTokens),
      cacheRead: num(u.cacheReadTokens),
      cacheWrite: num(u.cacheWriteTokens),
      reasoning: num(u.reasoningTokens),
    }
    const total = tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite + tokens.reasoning
    if (!total) continue // 失败尝试 / 空调用：不产出
    if (!item.provider && !item.model) continue
    calls.push({
      ts: item.ts,
      provider: item.provider,
      model: item.model,
      turn: Number(key.split('|')[0]) || 0,
      step: Number(key.split('|')[1]) || 0,
      tokens,
    })
  }
  calls.sort((a, b) => (a.ts - b.ts) || (a.turn - b.turn) || (a.step - b.step))
  return { sessionId, createdAt, isSeeded, calls }
}

/** 导入判定所需的实时覆盖面（全部只看 source!=='import' 的记录） */
export function buildLiveCoverage(allRecords, rollups) {
  let firstLiveTs = Infinity
  const sessionMin = new Map()
  const coveredDays = new Set()
  for (const r of allRecords) {
    if (!r || r.source === IMPORT_SOURCE) continue
    if (typeof r.ts === 'number' && r.ts < firstLiveTs) firstLiveTs = r.ts
    if (typeof r.ts === 'number' && r.sessionId) {
      const cur = sessionMin.get(r.sessionId)
      if (cur === undefined || r.ts < cur) sessionMin.set(r.sessionId, r.ts)
    }
    coveredDays.add(dayKeyOf(r.ts))
  }
  for (const dk of Object.keys(rollups || {})) coveredDays.add(dk)
  return { firstLiveTs, sessionMin, coveredDays }
}

/** 与 store.js dayKey 同实现（北京 UTC+8），避免相互依赖 */
export function dayKeyOf(ts) {
  const d = new Date(ts + 28800000)
  const p = (n) => (n < 10 ? '0' + n : '' + n)
  return d.getUTCFullYear() + '-' + p(d.getUTCMonth() + 1) + '-' + p(d.getUTCDate())
}

/**
 * 逐调用去重键（与已导入明细比对）。
 *
 * **刻意不含模型名**：导入记录入账时模型会被计价层改写为「计费模型规范名」
 * （如 deepseek-v4-pro → deepseek-flash、旧名 → 现役名），拿改写后的名字
 * 去算键必然与日志里的原始名对不上，重跑就会把同一次调用再导一遍。
 * (sessionId, 事件时刻, 五桶 tokens) 三元组已足以唯一标识一次调用
 * （ts 直接取自日志事件时间，跨重跑稳定）。
 */
export function importKeyOf(sessionId, call) {
  const t = call.tokens
  return [str(sessionId), call.ts, t.input, t.output, t.cacheRead, t.cacheWrite, t.reasoning].join('|')
}

/**
 * 规划一次导入：决定每个日志文件要不要读、读出来哪些调用可入库。
 * @param {object[]} allRecords - 账本全部明细（含已导入）
 * @param {object} rollups - 日汇总（覆盖面用）
 * @param {{path:string}[]} logs - listSessionLogs 的输出
 * @param {object} manifest - 清单（loadManifest 的输出，会被就地更新引用）
 * @param {{priceFn:Function, normProvider:Function, now?:number}} hooks
 *   priceFn(np, model, ts, tokens) → {cost, estimated, subscription, period, model}
 * @returns {Promise<Array>} 每个文件的结果 {path, sessionId, status, calls, imported, skipped, reason}
 */
export async function planAndBuildImports(allRecords, rollups, logs, manifest, hooks) {
  const files = manifest.files || (manifest.files = {})
  const coverage = buildLiveCoverage(allRecords, rollups)
  const importedKeys = new Set()
  for (const r of allRecords) {
    if (r && r.source === IMPORT_SOURCE) importedKeys.add(importKeyOf(r.sessionId, { ts: r.ts, model: r.model, tokens: r.tokens }))
  }
  const results = []
  for (const log of logs) {
    const path = typeof log === 'string' ? log : log.path
    let st = null
    try { st = statSync(path) } catch (e) { results.push({ path, status: 'missing', imported: 0 }); continue }
    const prev = files[path]
    const unchanged = prev && prev.mtime === st.mtimeMs && prev.size === st.size
    if (unchanged && prev.status === 'done') {
      results.push({ path, status: 'unchanged', imported: 0, calls: 0, sessionId: prev.sessionId || '' })
      continue
    }
    let records
    try { records = readSessionRecords(path) } catch (e) {
      results.push({ path, status: 'error', error: String((e && e.message) || e), imported: 0 })
      continue
    }
    const dirId = path.split(/[\\/]/).slice(-2)[0] || ''
    const replay = replaySessionCalls(records, { fallbackSessionId: dirId })
    const sid = replay.sessionId || dirId
    const sessionCut = coverage.sessionMin.has(sid) ? coverage.sessionMin.get(sid) : Infinity
    const picked = []
    for (const call of replay.calls) {
      if (!(call.ts < sessionCut)) continue                      // 会话实时已覆盖（含跨安装点切割线）
      const covered = call.ts < coverage.firstLiveTs || !coverage.coveredDays.has(dayKeyOf(call.ts))
      if (!covered) continue                                     // 实时面已覆盖该日（含日汇总吸收口径）
      if (importedKeys.has(importKeyOf(sid, call))) continue     // 之前已导入过
      const np = hooks.normProvider(call.provider)
      if (!np && !call.model) continue
      const price = hooks.priceFn(np, call.model, call.ts, call.tokens)
      picked.push({
        ts: call.ts,
        provider: call.provider,
        model: price.model || call.model,
        sessionId: sid,
        purpose: '',
        cost: price.cost,
        estimated: price.estimated === true,
        period: price.period,
        tokens: call.tokens,
        subscription: price.subscription === true,
        source: IMPORT_SOURCE,
      })
    }
    results.push({ path, sessionId: sid, status: 'planned', records: picked, calls: replay.calls.length })
  }
  return results
}

/** 清单读写（与 sync.js 的游标文件同风格） */
export function loadManifest(file) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'))
    if (j && typeof j === 'object' && j.v === 1) return j
  } catch (e) { /* 首次运行 */ }
  return { v: 1, files: {}, lastRunAt: 0, totalImported: 0 }
}
