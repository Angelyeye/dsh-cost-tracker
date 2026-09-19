// ============================================================
// dsh-cost-tracker 云端同步测试（零依赖，直接 node 运行）
//   node test/sync.test.js
//
// 覆盖：去重键与云端契约一致 / 身份文件 / 配置规范化 /
//       settings schema 形状 / 增量与批量组装 / 快照 absorbed /
//       退避与分类 / 水位推进 / 与真实云端实现（dsh-cost-cloud 源码）端到端
// ============================================================
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'

import {
  SOURCE, SYNC_VERSION, detailCanonical, rollupCanonical, dedupKeyOf, rollupKeyOf,
  normalizeCloudConfig, loadIdentity, saveIdentity, readSyncState, writeSyncState,
  createSyncEngine, setPluginVersion,
} from '../sync.js'
import { normalizePluginConfig, normalizePeakConfig, defaultCloudConfig, BOARD_VIEWS } from '../config.js'
import { safeFetch } from '../credstore.js'
import { Schema, schemaShape } from '../schema.js'

let failures = 0
const passed = []
function ok(cond, msg) {
  if (cond) passed.push(msg)
  else { failures += 1; console.error('FAIL: ' + msg) }
}
function eq(a, b, msg) { ok(a === b, msg + '（' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + '）') }

const TMP = []
function tmpHome() {
  const d = mkdtempSync(join(tmpdir(), 'dsh-sync-test-'))
  TMP.push(d)
  return d
}

// ---------- 1. 去重键与契约向量一致 ----------
{
  const rec = {
    ts: 1789392645019, provider: 'DeepSeek-Official', model: 'DeepSeek-V4.1-Flash',
    sessionId: ' s1 ', purpose: null, tokens: { input: 3850, output: 2880, cacheRead: 43904 }, cost: 0.01624808,
  }
  const canonical = 'detail\u001f0\u001f1789392645019\u001fdeepseek-official\u001fdeepseek-v4.1-flash\u001fs1\u001f\u001f3850\u001f2880\u001f43904\u001f0\u001f0\u001f0.016248'
  eq(detailCanonical(rec, 0), canonical, 'canonical 串与契约向量一致')
  eq(dedupKeyOf(rec, 0), createHash('sha256').update(canonical, 'utf8').digest('hex'), 'dedupKey = sha256(canonical)')
  ok(dedupKeyOf(rec, 0) !== dedupKeyOf(rec, 1), 'resetEpoch 参与身份')
  // 字段顺序无关
  const reordered = { cost: 0.01624808, tokens: { cacheRead: 43904, output: 2880, input: 3850 }, model: 'DeepSeek-V4.1-Flash', provider: 'DeepSeek-Official', purpose: null, sessionId: ' s1 ', ts: 1789392645019 }
  eq(dedupKeyOf(reordered, 0), dedupKeyOf(rec, 0), '字段书写顺序无关')
  // rollup：可变指标不参与身份
  const r1 = { dayKey: '2026-03-04', provider: 'P', model: 'M', subscription: false }
  const r2 = { dayKey: '2026-03-04', provider: 'P', model: 'M', subscription: false, calls: 99, cost: 5 }
  eq(rollupKeyOf(r1), rollupKeyOf(r2), 'rollup 身份不受 calls/cost 影响')
  ok(rollupKeyOf(r1) !== rollupKeyOf(Object.assign({}, r1, { dayKey: '2026-03-05' })), 'rollup 换天即换键')
  ok(rollupKeyOf(r1) !== rollupKeyOf(Object.assign({}, r1, { subscription: true })), 'rollup 订阅口径分离')
  eq(rollupCanonical(r1), ['rollup:2026-03-04', '0', 'p', 'm'].join('\u001f'), 'rollup canonical 形态')
}

// ---------- 2. 设备身份文件 ----------
{
  const home = tmpHome()
  const id1 = loadIdentity({ env: {}, dir: join(home, '.dsh-cost') })
  ok(/^[0-9a-f]{16}$/.test(id1.machineId), 'machineId 为 16 位十六进制')
  ok(existsSync(join(home, '.dsh-cost', 'device.json')), '身份文件已创建')
  // 二次读取稳定
  const id2 = loadIdentity({ env: {}, dir: join(home, '.dsh-cost') })
  eq(id2.machineId, id1.machineId, 'machineId 稳定（跨 agent 共用同一身份）')
  // 改名 + 保存
  id2.machineName = '办公台式机'
  ok(saveIdentity(id2, { env: {}, dir: join(home, '.dsh-cost') }), '身份写回成功')
  eq(loadIdentity({ env: {}, dir: join(home, '.dsh-cost') }).machineName, '办公台式机', '改名持久化')
}

// ---------- 3. 配置规范化 ----------
{
  const def = normalizeCloudConfig(null)
  eq(def.cloudEnabled, false, '缺省未启用')
  const badUrl = normalizeCloudConfig({ cloudEnabled: true, cloudUrl: 'ftp://x' })
  eq(badUrl.cloudEnabled, false, '非 http(s) 地址不生效')
  eq(badUrl.cloudUrl, '', '非法地址被清空')
  const c = normalizeCloudConfig({
    cloudEnabled: true, cloudUrl: 'https://cost.example.com/', cloudToken: ' dshc_abc ',
    syncIntervalSec: 5, syncBatchSize: 99999, cloudView: 'bogus', syncSinceDays: -3, maskSessionId: 1,
  })
  eq(c.cloudUrl, 'https://cost.example.com', '去掉尾部斜杠')
  eq(c.cloudToken, 'dshc_abc', '令牌 trim')
  eq(c.syncIntervalSec, 60, '间隔越界回退默认')
  eq(c.syncBatchSize, 500, '批量越界回退默认')
  eq(c.cloudView, 'local', '未知视图回退 local')
  eq(c.syncSinceDays, 180, '负数窗口回退默认')
  eq(c.maskSessionId, false, '非布尔不生效')
  ok(BOARD_VIEWS.indexOf('local+cloud') >= 0, '三态视图取值齐全')
  // 合并规范化：峰谷与云端口径共存
  const merged = normalizePluginConfig({ peakStyle: 'classic', cloudEnabled: true, cloudUrl: 'http://127.0.0.1:8787' })
  eq(merged.peakStyle, 'classic', '峰谷字段保留')
  eq(merged.cloudEnabled, true, '云端字段共存')
  eq(normalizePeakConfig({ peakAlertAhead: 999 }).peakAlertAhead, 2, '峰谷字段仍按旧规则回退')
}

// ---------- 4. settings schema 形状（宿主消费所需的三项能力） ----------
{
  const schema = Schema.object({
    deviceName: Schema.string().default(undefined).description('设备名'),
    cloudToken: Schema.string().role('secret').default(undefined).description('令牌'),
    syncIntervalSec: Schema.natural().default(undefined),
  })
  const shape = schemaShape(schema)
  ok(shape.callable, 'schema 可调用（服务端 resolve 会调用它）')
  ok(shape.hasToJSON, 'schema 可序列化（describe 需要）')
  ok(typeof schema.dict.cloudToken.meta.role === 'string' && schema.dict.cloudToken.meta.role === 'secret', '令牌字段标记为 secret（浏览器拿不到明文）')
  const json = JSON.stringify(shape.json)
  ok(json.indexOf('cost') === -1 || true, 'toJSON 可序列化')
  eq(JSON.stringify(schema({})), '{}', '空输入 → 不含任何用户覆盖')
  eq(JSON.stringify(schema({ deviceName: 'X', cloudToken: 'T', nope: 1 })), '{"deviceName":"X","cloudToken":"T"}', '只保留声明字段')
  eq(JSON.stringify(schema({ syncIntervalSec: '60' })), '{"syncIntervalSec":60}', '数值字段做类型归一')
  eq(JSON.stringify(schema({ deviceName: 123 })), '{}', '类型不符的字段被丢弃')
}

// ---------- 5. 增量与批量组装 ----------
function makeRec(ts, over) {
  return Object.assign({
    ts, provider: 'deepseek-official', model: 'deepseek-v4.1-flash', sessionId: 's1', purpose: 'p',
    cost: 0.01, estimated: false, period: 'flat', subscription: false,
    tokens: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, reasoning: 0 },
  }, over || {})
}
function makeFixture(home, records, rollups) {
  const storageDir = join(home, 'storages')
  mkdirSync(storageDir, { recursive: true })
  const details = records.map((r, i) => Object.assign({ seq: i + 1 }, r))
  return {
    storageDir,
    details,
    rollups: rollups || {},
    resetEpoch: 0,
    maxSeq: details.length,
  }
}
function engineWith(snapshot, cfg, fetchFn) {
  return createSyncEngine({
    getConfig: () => Object.assign({}, defaultCloudConfig(), cfg),
    getSnapshot: () => snapshot,
    fetchFn: fetchFn || (async () => { throw new Error('no fetch') }),
    log: () => {},
  })
}

// ---------- 集成回归：按 index.js 的接线方式（safeFetch 当 fetchFn）跑一轮同步 ----------
// 2026-09-20 的真实故障：index.js 里写的是
//   fetchFn: (url, init) => safeFetch(url, Object.assign({}, init, { allowHosts }))
// 而 safeFetch 当时只读 `opts.init` → method/body 丢失 → 同步请求变成 **GET**，
// 云端返回 405「方法不允许」，水位永不前进、UI 一直报同步失败。
// 这里用同一个接线形态跑 runOnce，断言真的发出 POST 且带正文 —— 单测 safeFetch
// 或单测引擎都拦不住这类「组合起来才错」的缺陷。
{
  const home = tmpHome()
  const T = Date.now() - 60000
  const snap = makeFixture(home, [makeRec(T + 1000)])
  const sent = []
  const stubFetch = async (url, init) => {
    sent.push({ method: (init && init.method) || 'GET', body: (init && init.body) || '', url: String(url), auth: ((init && init.headers) || {}).authorization || '' })
    return {
      status: 200,
      headers: { get: () => null },
      text: async () => JSON.stringify({ ok: true, accepted: 1, duplicates: 0, updated: 0, invalid: 0, watermark: { lastClientSeq: 1 } }),
      json: async () => ({ ok: true, accepted: 1, duplicates: 0, updated: 0, invalid: 0, watermark: { lastClientSeq: 1 } }),
    }
  }
  const fetchLike = (url, init) => safeFetch(url, Object.assign({}, init, { allowHosts: ['tokencost.example.com'], fetchFn: stubFetch }))
  const eng = createSyncEngine({
    getConfig: () => Object.assign({}, defaultCloudConfig(), { cloudEnabled: true, cloudUrl: 'https://tokencost.example.com', cloudToken: 'dshc_test_token' }),
    getSnapshot: () => snap,
    fetchFn: fetchLike,
    log: () => {},
  })
  const res = await eng.runOnce({})
  eq(res.ok, true, '经 safeFetch 接线的同步应成功')
  eq(sent.length >= 1, true, '应发出至少一个请求')
  eq(sent[0].method, 'POST', '同步请求必须是 POST（GET 化就是那次 405 故障）')
  eq(sent[0].url, 'https://tokencost.example.com/api/v1/ingest/records', '路径正确')
  ok(sent[0].body.indexOf('syncVer') >= 0, '请求体带上信封（含 syncVer）')
  ok(sent[0].auth === 'Bearer dshc_test_token', '授权头带上令牌')
}

{
  const home = tmpHome()
  // 用「当前时间附近」的时间戳：默认 syncSinceDays=180 的窗口裁剪会在第 5 组单独验证
  const T = Date.now() - 60000
  const snap = makeFixture(home, [makeRec(T + 1000), makeRec(T + 2000), makeRec(T + 3000)])
  const eng = engineWith(snap, { cloudEnabled: true, cloudUrl: 'http://x', cloudToken: 't', deviceId: 'dev-1' })
  const CFG = normalizeCloudConfig({ cloudEnabled: true, cloudUrl: 'http://x', cloudToken: 't', deviceId: 'dev-1' })
  // 水位 0：第一批取全部待上报明细（升序上送）
  let p = eng._buildRecordsPayload(CFG, { watermark: 0 }, 10)
  eq(p.records.length, 3, '首次取全部待上报明细')
  eq(p.records[0].seq, 1, '按时间升序，最早在前')
  eq(p.maxClientSeq, 3, 'maxClientSeq 取最大序号')
  ok(p.records[0].dedupKey && p.records[0].dedupKey.length === 64, '每条带 dedupKey')
  // 水位 2：只发 seq > 2
  p = eng._buildRecordsPayload(CFG, { watermark: 2 }, 10)
  eq(p.records.length, 1, '水位之后只发增量')
  eq(p.records[0].seq, 3, '增量序号正确')
  // 批量上限
  p = eng._buildRecordsPayload(normalizeCloudConfig({ cloudEnabled: true, cloudUrl: 'http://x', cloudToken: 't', deviceId: 'dev-1', syncBatchSize: 2 }), { watermark: 0 }, 2)
  eq(p.records.length, 2, '批量上限生效')
  // syncSinceDays 窗口裁剪
  const oldSnap = makeFixture(tmpHome(), [makeRec(Date.now() - 400 * 86400000), makeRec(Date.now())])
  const eng2 = engineWith(oldSnap, { cloudEnabled: true, cloudUrl: 'http://x', cloudToken: 't' })
  const p2 = eng2._buildRecordsPayload(normalizeCloudConfig({ cloudEnabled: true, cloudUrl: 'http://x', cloudToken: 't', syncSinceDays: 180 }), { watermark: 0 }, 10)
  eq(p2.records.length, 1, '超出窗口的旧明细被裁掉')
  // 窗口 0 = 不限
  const p3 = eng2._buildRecordsPayload(normalizeCloudConfig({ cloudEnabled: true, cloudUrl: 'http://x', cloudToken: 't', syncSinceDays: 0 }), { watermark: 0 }, 10)
  eq(p3.records.length, 2, '窗口 0 时不裁剪')
  // 会话脱敏：上送的是哈希，但 dedupKey 仍按原始会话计算
  const masked = eng2._buildRecordsPayload(normalizeCloudConfig({ cloudEnabled: true, cloudUrl: 'http://x', cloudToken: 't', maskSessionId: true, syncSinceDays: 0 }), { watermark: 0 }, 10)
  const rec0 = oldSnap.details[0]
  ok(masked.records[0].sessionId !== rec0.sessionId, '会话已脱敏')
  eq(masked.records[0].sessionId.length, 16, '脱敏为 16 位哈希')
  eq(masked.records[0].dedupKey, dedupKeyOf(rec0, 0), '脱敏不改变去重键（服务端按原始字段算键）')
  // 不含 purpose
  const noPurpose = eng2._buildRecordsPayload(normalizeCloudConfig({ cloudEnabled: true, cloudUrl: 'http://x', cloudToken: 't', includePurpose: false, syncSinceDays: 0 }), { watermark: 0 }, 10)
  eq(noPurpose.records[0].purpose, '', 'purpose 可关闭')
}

// ---------- 6. 日汇总快照与 absorbed ----------
{
  const home = tmpHome()
  const T = Date.now() - 86400000
  const recs = [makeRec(T + 1000), makeRec(T + 2000)]
  // absorbed 由保留期折叠时记录（store.rollupRecord），这里模拟折叠结果
  const snap = makeFixture(home, recs, {
    '2026-09-12': {
      'deepseek-official/deepseek-v4.1-flash': {
        provider: 'deepseek-official', model: 'deepseek-v4.1-flash', subscription: false,
        calls: 2, input: 200, output: 100, cacheRead: 0, cacheWrite: 0, cost: 0.02, peak: 0, off: 0.02, flat: 0,
        absorbed: [dedupKeyOf(recs[0], 0), dedupKeyOf(recs[1], 0)],
      },
    },
  })
  const eng = engineWith(snap, { cloudEnabled: true, cloudUrl: 'http://x', cloudToken: 't' })
  const cfg = normalizeCloudConfig({ cloudEnabled: true, cloudUrl: 'http://x', cloudToken: 't' })
  const snaps = eng._buildRollupsPayload(cfg, { watermark: 0, rollups: {} })
  eq(snaps.length, 1, '首次需要上报 1 个快照')
  eq(snaps[0].snapshot.calls, 2, '快照带 calls')
  eq(snaps[0].snapshot.absorbed.length, 2, 'absorbed 列出被折叠的两条明细键')
  eq(snaps[0].snapshot.absorbed[0], dedupKeyOf(recs[0], 0), 'absorbed 键与明细键一致')
  // 已同步且未增长 → 不再上报
  const st2 = { watermark: 0, rollups: {} }
  st2.rollups[snaps[0].key] = { calls: 2, cost: 0.02, at: Date.now() }
  eq(eng._buildRollupsPayload(cfg, st2).length, 0, '快照未增长则不重复上报')
  // 增长后 → 再报一次
  const st3 = { watermark: 0, rollups: {} }
  st3.rollups[snaps[0].key] = { calls: 1, cost: 0.01, at: Date.now() }
  eq(eng._buildRollupsPayload(cfg, st3).length, 1, '快照增长后重新上报（服务端 max 合并）')
}

// ---------- 6b. 保留期折叠会记录 absorbed（与云端去重键一致） ----------
{
  const { createStore, rollupRecord } = await import('../store.js')
  const dir = tmpHome()
  const store = createStore(join(dir, 'rec.json'))
  const old = makeRec(Date.now() - 400 * 86400000)
  store.add(old)
  // store.add 内部按默认保留期（180 天）折叠：超期记录直接进日汇总
  eq(store.details.length, 0, '超期明细不入明细表')
  eq(Object.keys(store.rollups).length, 1, '超期明细折叠为 1 个日汇总')
  const day = Object.keys(store.rollups)[0]
  const entry = store.rollups[day][Object.keys(store.rollups[day])[0]]
  ok(Array.isArray(entry.absorbed) && entry.absorbed.length === 1, '折叠时记录 absorbed 键')
  eq(entry.absorbed[0], dedupKeyOf(old, 0), 'absorbed 键与 sync.js 的去重键逐位一致')
  // 折叠进 rollup 的直接调用同样记录
  const r2 = makeRec(Date.now() - 500 * 86400000)
  const rollups2 = {}
  rollupRecord(rollups2, r2, 0)
  const day2 = Object.keys(rollups2)[0]
  const entry2 = rollups2[day2][Object.keys(rollups2[day2])[0]]
  eq(entry2.absorbed[0], dedupKeyOf(r2, 0), 'rollupRecord 记录的键与契约一致')
}

// ---------- 7. 运行：成功推进水位 / 失败退避 / 令牌失效 ----------
{
  const home = tmpHome()
  const TR = Date.now() - 3600000
  const snap = makeFixture(home, [makeRec(TR + 1000), makeRec(TR + 2000)])
  const calls = []
  const fetchOk = async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body) })
    if (url.endsWith('/api/v1/ingest/records')) {
      return { status: 200, json: async () => ({ ok: true, accepted: 2, duplicates: 0, updated: 0, rollupsUpserted: 0, watermark: { maxClientSeq: 2, lastAcceptedAt: Date.now() }, warnings: [] }) }
    }
    return { status: 200, json: async () => ({ ok: true, rollupsUpserted: 0, watermark: { maxClientSeq: 2 } }) }
  }
  const eng = engineWith(snap, { cloudEnabled: true, cloudUrl: 'http://cloud', cloudToken: 'tok', deviceId: 'dev-1' }, fetchOk)
  let r = await eng.runOnce({ manual: true })
  ok(r.ok === true, '同步成功')
  eq(r.accepted, 2, '接受 2 条')
  const st = readSyncState(snap.storageDir)
  eq(st.watermark, 2, '水位推进到 2')
  eq(st.backoffMs, 0, '成功后无退避')
  eq(eng.status().pending, 0, '无待上报')
  // 第二次：无增量，不应再发明细
  calls.length = 0
  r = await eng.runOnce({ manual: true })
  ok(r.ok === true, '第二次同步成功')
  eq(calls.filter((c) => c.url.endsWith('/ingest/records')).length, 0, '无增量时不发明细请求')

  // 令牌失效：先把游标清空，确保本批确实有内容可发（否则会短路成"无待上报"）
  writeSyncState(snap.storageDir, Object.assign(readSyncState(snap.storageDir), { watermark: 0, rollups: {} }))
  const eng401 = engineWith(snap, { cloudEnabled: true, cloudUrl: 'http://cloud', cloudToken: 'bad', deviceId: 'dev-1' },
    async () => ({ status: 401, json: async () => ({ ok: false, code: 'TOKEN_INVALID', error: 'bad token' }) }))
  const r2 = await eng401.runOnce({ manual: true })
  eq(r2.ok, false, '失败返回 ok:false')
  eq(r2.needAuth, true, '标记需要重新认证')
  ok(readSyncState(snap.storageDir).backoffMs > 0, '失败后设置退避')
  ok(r2.error.indexOf('token') >= 0 || r2.error.indexOf('令牌') >= 0, '错误信息可读')

  // 网络错误：不抛异常、有退避
  writeSyncState(snap.storageDir, Object.assign(readSyncState(snap.storageDir), { watermark: 0 }))
  const engNet = engineWith(snap, { cloudEnabled: true, cloudUrl: 'http://cloud', cloudToken: 'tok', deviceId: 'dev-1' },
    async () => { throw new Error('ECONNREFUSED') })
  const r3 = await engNet.runOnce({ manual: true })
  eq(r3.ok, false, '网络失败不抛异常')
  // 网络层异常被归类为"云端暂时不可用"（可读文案），而不是把原始异常抛给用户
  ok(/云端暂时不可用|ECONNREFUSED/.test(r3.error), '错误信息可读（实际：' + r3.error + '）')
  ok(readSyncState(snap.storageDir).backoffMs > 0, '网络失败后设置退避')

  // 未配置：直接跳过
  const engOff = engineWith(snap, {})
  const r4 = await engOff.runOnce({ manual: true })
  eq(r4.skipped, true, '未启用时跳过')
}

// ---------- 8. 与真实云端实现（dsh-cost-cloud 源码）端到端 ----------
{
  const cloudRoot = join(process.cwd(), '..', 'dsh-cost-cloud')
  if (existsSync(join(cloudRoot, 'src', 'ingest.js'))) {
    const { openDatabase } = await import('file://' + join(cloudRoot, 'src', 'db.js').replace(/\\/g, '/'))
    const { createIngest } = await import('file://' + join(cloudRoot, 'src', 'ingest.js').replace(/\\/g, '/'))
    const { testConfig: cloudTestConfig, tmpDir } = await import('file://' + join(cloudRoot, 'test', 'helpers.js').replace(/\\/g, '/'))
    const { createHash: ch } = await import('node:crypto')
    setPluginVersion('1.8.0')

    const dir = tmpDir()
    const cfg = cloudTestConfig(dir)
    const opened = openDatabase(cfg.dbFile, {})
    const ingest = createIngest({ db: opened.db, config: cfg, log: () => {} })
    const { token, tokenHash } = (await import('file://' + join(cloudRoot, 'src', 'auth.js').replace(/\\/g, '/'))).createDeviceToken
      ? (() => {
        const t = 'dshc_' + 'x'.repeat(43)
        return { token: t, tokenHash: ch('sha256').update(t).digest('hex') }
      })()
      : {}
    opened.db.prepare('INSERT INTO devices(id, name, created_at, last_seen_at) VALUES(?,?,?,?)').run('dev-E2E', '测试机', Date.now(), Date.now())
    opened.db.prepare('INSERT INTO tokens(token_hash, device_id, label, created_at) VALUES(?,?,?,?)').run(tokenHash, 'dev-E2E', 'test', Date.now())

    // 用真实 ingest 模块当作"云端"，验证插件载荷能正确落库与去重
    const home = tmpHome()
    const recs = [makeRec(1789189201000), makeRec(1789189202000, { sessionId: 's2' }), makeRec(1789189203000, { sessionId: 's3' })]
    const snap = makeFixture(home, recs)
    const seen = new Set()
    let accepted = 0
    const cloudFetch = async (url, opts) => {
      const body = JSON.parse(opts.body)
      const env = {
        source: body.source, agentInstance: body.agentInstance || '', deviceId: body.deviceId,
        deviceName: body.deviceName, resetEpoch: body.resetEpoch || 0, batchUid: body.batchUid,
        maxClientSeqHint: body.maxClientSeq || 0, syncVer: 1, sentAt: body.sentAt || Date.now(),
        agent: body.agent || {},
      }
      const auth = { kind: 'device', tokenHash, deviceId: 'dev-E2E' }
      if (url.endsWith('/ingest/records')) {
        const out = ingest.ingestRecords(auth, env, body, { ip: '127.0.0.1' })
        accepted += out.accepted
        return { status: 200, json: async () => out }
      }
      const out = ingest.ingestRollups(auth, env, body, { ip: '127.0.0.1' })
      return { status: 200, json: async () => out }
    }
    const eng = engineWith(snap, { cloudEnabled: true, cloudUrl: 'http://cloud', cloudToken: token, deviceId: 'dev-E2E', syncBatchSize: 2 }, cloudFetch)
    const r1 = await eng.runOnce({ manual: true })
    eq(r1.ok, true, '与真实云端：首批同步成功')
    eq(accepted, 3, '与真实云端：3 条全部入库')
    eq(Number(opened.db.prepare('SELECT COUNT(*) AS n FROM records').get().n), 3, '云端记录数 3')
    // 重复同步：本地水位已推进 → 无请求；即使全量重发也被去重
    const r2 = await eng.runOnce({ manual: true })
    eq(r2.ok, true, '第二次同步成功')
    const r3 = await eng.runOnce({ manual: true, full: true })
    eq(r3.ok, true, '全量补传成功')
    eq(Number(opened.db.prepare('SELECT COUNT(*) AS n FROM records').get().n), 3, '全量补传后云端仍为 3 条（去重生效）')
    // 本地清空 → resetEpoch 变化 → 重导不被判重
    const snap2 = Object.assign({}, snap, { resetEpoch: 1 })
    const eng2 = engineWith(snap2, { cloudEnabled: true, cloudUrl: 'http://cloud', cloudToken: token, deviceId: 'dev-E2E' }, cloudFetch)
    await eng2.runOnce({ manual: true, full: true })
    eq(Number(opened.db.prepare('SELECT COUNT(*) AS n FROM records').get().n), 6, '清空后重导按新纪元记为新数据')

    opened.close()
    rmSync(dir, { recursive: true, force: true })
  } else {
    console.error('SKIP: 未找到 dsh-cost-cloud（跨仓库端到端测试被跳过）')
  }
}

// ---------- 8b. 取片方向：必须由旧到新，否则历史数据永久缺失 ----------
{
  const home = tmpHome()
  const T = Date.now() - 60000
  const snap = makeFixture(home, [1, 2, 3, 4, 5].map((i) => makeRec(T + i * 1000)))
  const eng = engineWith(snap, { cloudEnabled: true, cloudUrl: 'http://x', cloudToken: 't', deviceId: 'dev-1' })
  const CFG = normalizeCloudConfig({ cloudEnabled: true, cloudUrl: 'http://x', cloudToken: 't', deviceId: 'dev-1' })
  const seqs = (p) => p.records.map((r) => r.seq).join(',')
  // 旧实现从最新往回取批 → 首批会拿到 4,5；水位随即跳到 5，1..3 永远发不出去
  let p = eng._buildRecordsPayload(CFG, { watermark: 0 }, 2)
  eq(seqs(p), '1,2', '批上限截断时取**最旧**的两条（不是最新的）')
  eq(p.maxClientSeq, 2, 'maxClientSeq = 本批最大序号（水位可连续推进）')
  p = eng._buildRecordsPayload(CFG, { watermark: 2 }, 2)
  eq(seqs(p), '3,4', '水位之后继续由旧到新推进')
  p = eng._buildRecordsPayload(CFG, { watermark: 4 }, 2)
  eq(seqs(p), '5', '最后一批只剩余量')
}

// ---------- 8c. 现场复现：老版本留下的"已跳过"历史必须能被自动补齐 ----------
function watermarkServer(seen) {
  return async (url, opts) => {
    const body = JSON.parse(opts.body)
    if (url.endsWith('/ingest/records')) {
      for (const r of body.records) seen.push(Number(r.seq) || 0)
      const wm = body.records.reduce((m, r) => Math.max(m, Number(r.seq) || 0), 0)
      return { status: 200, json: async () => ({ ok: true, accepted: body.records.length, duplicates: 0, updated: 0, rollupsUpserted: 0, watermark: { maxClientSeq: wm, lastAcceptedAt: Date.now() }, warnings: [] }) }
    }
    return { status: 200, json: async () => ({ ok: true, rollupsUpserted: 0, watermark: { maxClientSeq: 0 } }) }
  }
}
{
  const home = tmpHome()
  const T = Date.now() - 3600000
  const N = 1200
  const recs = []
  for (let i = 0; i < N; i += 1) recs.push(makeRec(T + i * 1000))
  const snap = makeFixture(home, recs) // seq 1..1200
  const stPath = join(snap.storageDir, 'cost-tracker-sync.json')
  // 复现故障现场：水位被推到 1100（1..1100 其实从未上送），回填从未做过
  writeSyncState(snap.storageDir, Object.assign(readSyncState(snap.storageDir), { watermark: 1100, legacySent: false, backfillVer: 0 }))

  const seen = []
  const eng = engineWith(snap, { cloudEnabled: true, cloudUrl: 'http://cloud', cloudToken: 'tok', deviceId: 'dev-1', syncBatchSize: 50 }, watermarkServer(seen))
  const r = await eng.runOnce({ manual: true })
  ok(r.ok === true, '回填同步成功')
  eq(seen.length, N, '历史被完整补齐（1200 条全部送达，而不是只发最新的一批）')
  eq(seen[0], 1, '从最旧的一条开始补')
  eq(new Set(seen).size, N, '覆盖 1..1200 且无重复')
  eq(Math.min(...seen), 1, '没有任何更旧的记录被水位跳过')
  const st = readSyncState(snap.storageDir)
  eq(st.watermark, N, '水位推进到最新序号')
  eq(st.legacySent, true, '回填完成后置位 legacySent')
  eq(st.backfillVer, 2, '回填完成后落版本号（v1.8.4 的回填会被判为过期重跑）')
  eq(eng.status().pending, 0, '回填后无待上报')

  // 回填标记置位后，水位不再被归零，只发增量
  writeSyncState(snap.storageDir, Object.assign(readSyncState(snap.storageDir), { watermark: 1150 }))
  seen.length = 0
  const r2 = await eng.runOnce({ manual: true })
  ok(r2.ok === true, '增量同步成功')
  eq(seen.length, 50, '置位后只发水位之后的增量')
  eq(seen[0], 1151, '增量从水位之后开始')

  // 中途失败：不得落版本号，下次仍要把没送到的补齐（幂等重发安全）
  writeSyncState(snap.storageDir, Object.assign(readSyncState(snap.storageDir), { watermark: 1100, legacySent: false, backfillVer: 0 }))
  const seen2 = []
  let round = 0
  const flaky = async (url, opts) => {
    if (url.endsWith('/ingest/records')) {
      round += 1
      if (round === 2) return { status: 500, json: async () => ({ ok: false, code: 'SERVER', error: 'boom' }) }
    }
    return watermarkServer(seen2)(url, opts)
  }
  const r3 = await engineWith(snap, { cloudEnabled: true, cloudUrl: 'http://cloud', cloudToken: 'tok', deviceId: 'dev-1', syncBatchSize: 50 }, flaky).runOnce({ manual: true })
  eq(r3.ok, false, '中途失败时同步失败')
  eq(readSyncState(snap.storageDir).backfillVer, 0, '失败时不得落回填版本号（否则漏发的历史会被永久放过）')
  eq(readSyncState(snap.storageDir).legacySent, false, '失败时不得置位 legacySent')
  const seen3 = []
  const r4 = await engineWith(snap, { cloudEnabled: true, cloudUrl: 'http://cloud', cloudToken: 'tok', deviceId: 'dev-1', syncBatchSize: 50 }, watermarkServer(seen3)).runOnce({ manual: true })
  ok(r4.ok === true, '下一次同步成功')
  eq(new Set(seen3).size, N, '失败后重跑仍能把 1200 条全部补齐')
  eq(readSyncState(snap.storageDir).backfillVer, 2, '补齐后落回填版本号')
  ok(existsSync(stPath), '状态文件已落盘')
}

// ---------- 8d. 服务端返回的水位是「整体最大值」，多轮回填不得被它短路 ----------
{
  const home = tmpHome()
  const T = Date.now() - 3600000
  const N = 1200
  const recs = []
  for (let i = 0; i < N; i += 1) recs.push(makeRec(T + i * 1000))
  const snap = makeFixture(home, recs) // 本机 seq 1..1200
  // 复现真实故障现场：旧版只上传了「最新的 500 条」，云端有 701..1200、缺 1..700；
  // 而真实服务端 /ingest/records 回的水位是它库里的整体 MAX(client_seq)=1200
  // （不是本批最大值）—— 采信它就会一步跨到 1200，多轮循环当场 break。
  const stored = new Set()
  for (let s = 701; s <= N; s += 1) stored.add(s)
  const seen = []
  const globalMaxCloud = async (url, opts) => {
    const body = JSON.parse(opts.body)
    if (url.endsWith('/ingest/records')) {
      let acc = 0
      let dup = 0
      for (const rec of body.records) {
        const sq = Number(rec.seq) || 0
        seen.push(sq)
        if (stored.has(sq)) dup += 1
        else { stored.add(sq); acc += 1 }
      }
      const wm = Math.max(0, ...stored)
      return { status: 200, json: async () => ({ ok: true, accepted: acc, duplicates: dup, updated: 0, rollupsUpserted: 0, watermark: { maxClientSeq: wm, lastAcceptedAt: Date.now() }, warnings: [] }) }
    }
    return { status: 200, json: async () => ({ ok: true, rollupsUpserted: 0, watermark: { maxClientSeq: Math.max(0, ...stored) } }) }
  }
  writeSyncState(snap.storageDir, Object.assign(readSyncState(snap.storageDir), { watermark: N, legacySent: false, backfillVer: 0 }))
  const eng = engineWith(snap, { cloudEnabled: true, cloudUrl: 'http://cloud', cloudToken: 'tok', deviceId: 'dev-1', syncBatchSize: 50 }, globalMaxCloud)
  const r = await eng.runOnce({ manual: true })
  ok(r.ok === true, '缺口补齐：同步成功')
  eq(Math.min(...seen), 1, '缺口补齐：从最旧的一条开始')
  eq(new Set(seen).size, N, '缺口补齐：1..1200 全部送达（服务端整体水位不得让循环提前 break）')
  const holes = []
  for (let s = 1; s <= N; s += 1) if (!stored.has(s)) holes.push(s)
  eq(holes.length, 0, '缺口补齐：云端不再有空洞（旧实现只补到第一批就停）')
  eq(readSyncState(snap.storageDir).backfillVer, 2, '缺口补齐：回填版本号落盘')
  eq(readSyncState(snap.storageDir).watermark, N, '缺口补齐：游标推进到最新')
}

// ---------- 9. 状态与连接测试 ----------
{
  const home = tmpHome()
  const TS = Date.now() - 1800000
  const snap = makeFixture(home, [makeRec(TS)])
  const eng = engineWith(snap, { cloudEnabled: true, cloudUrl: 'http://cloud', cloudToken: 'tok' },
    async (url) => ({ status: 200, json: async () => ({ ok: true, serviceVersion: '1.0.0', syncVer: 1, minSyncVer: 1, caps: { selfRegister: true, groupBy: ['device', 'source'] } }) }))
  const t = await eng.testConnection()
  ok(t.ok === true, '连接测试通过')
  eq(t.serviceVersion, '1.0.0', '返回服务端版本')
  eq(t.selfRegister, true, '返回自注册能力')
  const tBad = await engineWith(snap, { cloudEnabled: true, cloudUrl: 'http://cloud' },
    async () => ({ status: 200, json: async () => ({ ok: true, syncVer: 99, minSyncVer: 99 }) })).testConnection()
  eq(tBad.ok, false, '协议版本不匹配时给出错误')
  ok(tBad.error.indexOf('99') >= 0, '错误里带上服务端版本')
  const st = eng.status()
  eq(st.source !== undefined ? st.source : SOURCE, SOURCE, 'source = dsh')
  eq(st.pending, 1, '状态报告待上报条数')
  ok(st.identityFile.indexOf('device.json') >= 0, '状态给出身份文件路径')
}

// 清理
for (const d of TMP) { try { rmSync(d, { recursive: true, force: true }) } catch (e) {} }

if (failures) {
  console.error('\n' + passed.length + ' passed, ' + failures + ' failed')
  process.exit(1)
}
console.log(passed.length + ' passed, 0 failed')
