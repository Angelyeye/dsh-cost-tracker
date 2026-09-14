// ============================================================
// 跨仓库联调验证（人工执行，非测试套件的一部分）
//
//   node scripts/verify-integration.mjs [cloudRepoDir]
//
// 做的事：
//   1. 用临时数据目录启动 dsh-cost-cloud（真实 HTTP 端口）
//   2. 用 DSH 插件真实的 sync.js 引擎模拟「两台设备 × 两个 agent」增量上报
//      （本机 dsh + 本机 codex + 另一台笔记本 dsh）
//   3. 断言：云端合计 = 各设备各来源之和；重复同步不增长；三态视图相加成立
//   4. 打印「设备 × Agent」矩阵，便于人工核对
// ============================================================
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PLUGIN_DIR = join(HERE, '..')
const CLOUD_DIR = process.argv[2] || join(PLUGIN_DIR, '..', 'dsh-cost-cloud')

if (!existsSync(join(CLOUD_DIR, 'src', 'server.js'))) {
  console.error('找不到云端服务目录：' + CLOUD_DIR)
  process.exit(2)
}

const { listen } = await import('file://' + join(CLOUD_DIR, 'src', 'server.js').replace(/\\/g, '/'))
const { resolveConfig } = await import('file://' + join(CLOUD_DIR, 'src', 'config.js').replace(/\\/g, '/'))
const { createSyncEngine, dedupKeyOf } = await import('file://' + join(PLUGIN_DIR, 'sync.js').replace(/\\/g, '/'))
const { defaultCloudConfig } = await import('file://' + join(PLUGIN_DIR, 'config.js').replace(/\\/g, '/'))

const dir = mkdtempSync(join(tmpdir(), 'dshc-integration-'))
const cfg = resolveConfig({
  DATA_DIR: dir,
  SESSION_SECRET: 'y'.repeat(48),
  ADMIN_PASSWORD: 'integration-pw',
  ALLOW_DEVICE_SELF_REGISTER: '1',
  DSH_SYNC_TOKEN: 'integration-bootstrap-token-0123456789',
  HOST: '127.0.0.1',
  PORT: '18877',
}, { cwd: dir })
if (!cfg.ok) { console.error(cfg.problems); process.exit(2) }

const { server, app, url } = await listen(cfg.config, { log: () => {} })
console.log('云端已启动：' + url)

let failed = 0
function ok(cond, msg) {
  if (cond) console.log('  ✓ ' + msg)
  else { failed += 1; console.error('  ✗ ' + msg) }
}
function near(actual, expected, msg) {
  ok(Math.abs(actual - expected) < 1e-6, msg + '（' + actual + ' ≈ ' + expected + '）')
}

/** 造一个假的"设备上的插件实例"：真实 sync.js 引擎 + 内存 store */
function makeDevice({ machineId, deviceName, token, storageDir, records }) {
  const details = records.map((r, i) => Object.assign({ seq: i + 1 }, r))
  const snapshot = { details, rollups: {}, resetEpoch: 0, maxSeq: details.length, storageDir }
  let cfgObj = Object.assign(defaultCloudConfig(), {
    cloudEnabled: true, cloudUrl: url, cloudToken: token, deviceId: machineId,
    deviceName, syncBatchSize: 500,
  })
  const engine = createSyncEngine({
    getConfig: () => Object.assign({}, cfgObj),
    getSnapshot: () => snapshot,
    setConfigField: (patch) => { cfgObj = Object.assign(cfgObj, patch) },
    log: () => {},
  })
  return { engine, details }
}

function detail(ts, cost, over) {
  return Object.assign({
    ts, provider: 'deepseek-official', model: 'deepseek-v4.1-flash', sessionId: 's', purpose: 'p',
    tokens: { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0, reasoning: 0 },
    cost, estimated: false, period: 'flat', subscription: false,
  }, over || {})
}

async function registerDevice(deviceId, deviceName) {
  const res = await fetch(url + '/api/v1/devices/register', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ deviceId, deviceName, source: 'dsh' }),
  })
  const body = await res.json()
  if (!body.ok) throw new Error('注册失败：' + JSON.stringify(body))
  return body.token
}

try {
  // ---------- 两台设备各自注册令牌；A 机上两个 agent 共用同一 machineId ----------
  const T = Date.now() - 3600000
  const tokenA = await registerDevice('machine-A', '办公台式机')
  const tokenB = await registerDevice('machine-B', '笔记本')
  const a = makeDevice({
    machineId: 'machine-A', deviceName: '办公台式机', token: tokenA,
    storageDir: join(dir, 'homes', 'A'),
    records: [detail(T + 1000, 1.25), detail(T + 2000, 2.5, { sessionId: 'a2' })],
  })
  const b = makeDevice({
    machineId: 'machine-B', deviceName: '笔记本', token: tokenB,
    storageDir: join(dir, 'homes', 'B'),
    records: [detail(T + 4000, 0.75, { sessionId: 'b1' })],
  })

  const ra = await a.engine.runOnce({ manual: true })
  ok(ra.ok === true && ra.accepted === 2, '设备 A · dsh 同步成功（accepted=' + ra.accepted + '）')
  const rb = await b.engine.runOnce({ manual: true })
  ok(rb.ok === true && rb.accepted === 1, '设备 B · dsh 同步成功（accepted=' + rb.accepted + '）')

  // 设备 A 上的另一个 agent（codex）：按契约直接构造载荷
  const codexRec = detail(T + 3000, 4.0, { provider: 'openai', model: 'gpt-5-codex', sessionId: 'codex-1' })
  const codexRes = await fetch(url + '/api/v1/ingest/records', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tokenA },
    body: JSON.stringify({
      syncVer: 1, source: 'codex', deviceId: 'machine-A', deviceName: '办公台式机',
      agent: { name: 'Codex CLI', version: '1.0.0', pluginVersion: 'mock' },
      resetEpoch: 0, maxClientSeq: 1, sentAt: Date.now(), batchUid: 'codex-batch-1',
      records: [{
        seq: 1, ts: codexRec.ts, provider: codexRec.provider, model: codexRec.model,
        sessionId: codexRec.sessionId, purpose: codexRec.purpose, tokens: codexRec.tokens,
        cost: codexRec.cost, dedupKey: dedupKeyOf(codexRec, 0),
      }],
    }),
  })
  const codexBody = await codexRes.json()
  ok(codexBody.ok === true && codexBody.accepted === 1, '设备 A · codex（第三方 agent）接入成功')

  // ---------- 登录看板 ----------
  const login = await fetch(url + '/api/admin/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password: 'integration-pw' }),
  })
  const cookie = (login.headers.getSetCookie()[0] || '').split(';')[0]
  const get = async (p) => (await fetch(url + '/api/admin/' + p, { headers: { cookie } })).json()

  const all = await get('overview?range=all')
  near(all.summary.cost, 8.5, '全网合计 = 各来源之和（1.25+2.5+4.0+0.75）')
  ok(all.devices.length === 2, '识别为 2 台设备（不是 3 台）')
  ok(all.sources.length === 2, '识别为 2 个 Agent 来源')

  // ---------- 三态视图的三种口径与「不重不漏」不变量 ----------
  // 数据：A/dsh = 3.75（本机 DSH，只看得到自己的 dsh 数据）
  //       A/codex = 4.0（同一台机器上的另一个 agent）
  //       B/dsh  = 0.75（其他整机）
  //   local  = A/dsh = 3.75
  //   cloud  = 全网  = 8.50
  //   本机+云端 = 本机(A/dsh) + 云端并集(其他整机 + 本机其它 agent) = 3.75 + (0.75 + 4.0) = 8.50
  const cAll = await get('overview?range=all')
  near(cAll.summary.cost, 8.5, 'cloud（全网）= 8.5')
  const cOthers = await get('overview?range=all&excludeDevice=machine-A')
  near(cOthers.summary.cost, 0.75, 'cloud-others（排除本机整台）= 0.75')
  const sameBoxOthers = await get('overview?range=all&devices=machine-A&excludeSource=dsh')
  near(sameBoxOthers.summary.cost, 4.0, '同机其它 agent（本机设备 + 排除 dsh）= A/codex 4.0')
  const unionParts = JSON.stringify([{ excludeDevice: 'machine-A' }, { devices: 'machine-A', excludeSource: 'dsh' }])
  const cRest = await get('overview?range=all&union=' + encodeURIComponent(unionParts))
  ok(cRest.union === true, 'union 口径生效（插件「本机+云端」用的就是它）')
  near(cRest.summary.cost, 4.75, 'cloud-rest 并集 = 其他整机 0.75 + 同机其它 agent 4.0 = 4.75')
  const localA = 3.75
  near(localA + cRest.summary.cost, cAll.summary.cost, '不变量：本机 A/dsh + 云端并集 = 全网 8.5（不重不漏）')
  // 并集内部明细也自洽
  near(cRest.summary.cost, cOthers.summary.cost + sameBoxOthers.summary.cost, '并集 = 两部分之和')
  const exclSrc = await get('overview?range=all&excludeSource=codex')
  near(exclSrc.summary.cost, 4.5, '排除 codex 后 = 两个 dsh 之和（3.75 + 0.75）')
  // 插件实际使用的白名单路径（与服务端排除展开等价）
  const others = await get('overview?range=all&devices=machine-B')
  near(others.summary.cost, cOthers.summary.cost, '白名单路径与排除路径同值')

  // ---------- 维度下钻 ----------
  const onlyA = await get('overview?range=all&devices=machine-A')
  near(onlyA.summary.cost, 7.75, '只看 A 机 = dsh 3.75 + codex 4.0')
  const onlyCodex = await get('overview?range=all&sources=codex')
  near(onlyCodex.summary.cost, 4.0, '只看 codex 来源 = 4.0')

  // ---------- 重复同步不增长 ----------
  const ra2 = await a.engine.runOnce({ manual: true })
  ok(ra2.accepted === 0, '重复同步 accepted=0（本地水位已推进）')
  const ra3 = await a.engine.runOnce({ manual: true, full: true })
  ok(ra3.ok === true, '全量补传成功')
  const all2 = await get('overview?range=all')
  near(all2.summary.cost, 8.5, '全量补传后合计不变（内容哈希去重）')

  // ---------- 设备 × Agent 矩阵 ----------
  const mx = await get('matrix?range=all')
  console.log('\n设备 × Agent 矩阵（花费 CNY）')
  console.log('  ' + '设备'.padEnd(14) + mx.cols.map(c => c.padStart(12)).join('') + '      合计')
  for (const row of mx.rows) {
    const cells = mx.cols.map(c => ('¥' + ((row.cells[c] || {}).cost || 0).toFixed(2)).padStart(12)).join('')
    console.log('  ' + (row.name || row.device).padEnd(14) + cells + ('¥' + row.cost.toFixed(2)).padStart(10))
  }
  const colTotals = mx.cols.map(c => mx.rows.reduce((s, r) => s + ((r.cells[c] || {}).cost || 0), 0))
  console.log('  ' + '合计'.padEnd(14) + colTotals.map(v => ('¥' + v.toFixed(2)).padStart(12)).join('') + ('¥' + mx.totals.cost.toFixed(2)).padStart(10))

  const rowSum = mx.rows.reduce((s, r) => s + r.cost, 0)
  const colSum = colTotals.reduce((s, v) => s + v, 0)
  near(rowSum, mx.totals.cost, '行合计 = 总计')
  near(colSum, mx.totals.cost, '列合计 = 总计')
  const rowA = mx.rows.find(r => r.device === 'machine-A')
  near(rowA.cells.dsh.cost, 3.75, '单元格 A/dsh = 1.25+2.5')
  near(rowA.cells.codex.cost, 4.0, '单元格 A/codex = 4.0')

  // ---------- 鉴权边界 ----------
  const asDevice = await fetch(url + '/api/admin/overview?range=all', { headers: { authorization: 'Bearer ' + tokenA } })
  ok(asDevice.status === 401, '设备令牌不能访问管理接口（实际 ' + asDevice.status + '）')
  const noCookie = await fetch(url + '/api/admin/overview?range=all')
  ok(noCookie.status === 401, '未登录不能访问管理接口')

  // ---------- CSV 导出含设备与 agent 列 ----------
  const csv = await (await fetch(url + '/api/admin/export.csv?range=all', { headers: { cookie } })).text()
  ok(/deviceName/.test(csv.split('\n')[0]) && /codex/.test(csv) && /machine-A/.test(csv), 'CSV 导出包含设备与 Agent 维度')
} finally {
  await new Promise((r) => server.close(r))
  app.close()
  rmSync(dir, { recursive: true, force: true })
}

console.log('')
if (failed) {
  console.error('联调验证失败：' + failed + ' 项')
  process.exit(1)
}
console.log('联调验证通过：多机多 Agent 汇总、去重、排除、维度下钻与二维矩阵均自洽。')
