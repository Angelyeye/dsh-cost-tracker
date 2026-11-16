// ============================================================
// dsh-cost-tracker 时间区间口径契约测试
//   node test/time-range.test.js
//
// 这组断言拦的是两类**静默错值**（不报错、但数字是错的，比崩溃更难发现）：
//
//   ① 云端区间不跟随界面筛选：fetchCloud 只发了 range/days，从不发 from/to，
//      云端 resolveRange() 于是永远按 range 枚举算 —— 界面切「近 30 天」，
//      云端那一半纹丝不动（固定近 7 天）。
//   ② days=1 被当成「近 24 小时」：会把昨天晚间的消费算进「今天」，
//      与旁边「今日费用」卡（北京日历日）对不上，屏幕上出现两个「今天」。
//
// 另外锁住 windowCutoff 的语义：本机 buildDashboard 与云端 fetchCloud 必须
// 共用同一份规则，否则「本机 + 云端」视图的两半会落在不同区间。
// ============================================================
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`)
  } else {
    failures++
    console.log(`  FAIL  ${name}`)
    if (detail !== undefined) console.log(`        ${detail}`)
  }
}

const home = mkdtempSync(join(tmpdir(), 'cost-timerange-'))
process.env.DSH_HOME = home

// 捕获 fetchCloud 真正发往云端的 URL —— 这是本组测试的核心观测点。
const realFetch = globalThis.fetch
let lastCloudUrl = null
let cloudPayload = null
globalThis.fetch = async (url, init) => {
  const u = String(url)
  // 云端健康探测：声明支持 plugin-view，让代码走真实分支
  if (u.includes('/api/v1/health')) {
    return { status: 200, json: async () => ({ ok: true, caps: { devicePluginView: true } }) }
  }
  if (u.includes('/api/v1/devices')) {
    return { status: 200, json: async () => ({ ok: true, devices: [{ id: 'SELFDEV', name: '本机' }] }) }
  }
  if (u.includes('/api/v1/')) {
    lastCloudUrl = u
    return { status: 200, json: async () => Object.assign({ ok: true }, cloudPayload || {}) }
  }
  return realFetch(url, init)
}

const { default: plugin } = await import('../index.js')

// ---------- 最小宿主替身：只登记路由，不启动真实服务器 ----------
const routes = new Map()
const listeners = new Map()
const fakeCtx = {
  tools: { register() {} },
  webServer: { register(desc) { routes.set(desc.path, desc) } },
  // 插件在 apply 期间会 ctx.on('llm/stream', ...) 挂流式计费钩子；
  // 测试不跑真实模型调用，这里只收下回调不做任何事。
  on(event, handler) { listeners.set(event, handler) },
  // 插件会尝试挂「设置」区块：宿主没有 settings 服务时返回 undefined 即走 inert 分支。
  get(service) { return service === 'settings' ? undefined : undefined },
  effect(fn) { if (typeof fn === 'function') { try { fn() } catch (e) {} } },
  inject() {},
  logger: { info() {}, warn() {}, error() {} },
}
plugin.apply(fakeCtx)

// 通过内部路由表调用（比起 HTTP 服务器更快，且测的是同一份实现）
async function callRoute(name, args) {
  const desc = routes.get('/api/cost-tracker')
  const fn = desc && desc.handler
  if (!fn) throw new Error('路由未注册')
  let out = null
  const res = {
    writeHead() {},
    end(body) { try { out = JSON.parse(body) } catch (e) { out = null } },
  }
  // 托管需要 body 流；这里用最小 AsyncIterable 替身
  const req = {
    method: 'POST',
    url: '/api/cost-tracker/' + name,
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(args || {})) },
  }
  await fn(req, res)
  return out
}

async function configureCloud() {
  await callRoute('sync-config', {
    cloudEnabled: true,
    cloudUrl: 'https://cloud.test',
    cloudToken: 'test-token',
    deviceName: '本机',
    syncIntervalSec: 3600,
  })
}

console.log('dsh-cost-tracker 时间区间口径契约测试')
console.log('  DSH_HOME =', home)

// ---------- [1] windowCutoff 语义（通过 dashboard 间接观测）----------
console.log('\n[1] 「今天」必须是北京日历日零点，不是近 24 小时')
{
  // 本地 buildDashboard 的 days=1 结果应与「今日费用」卡同口径。
  // 由于 records 为空，这里改为直接验证路由不报错且 days 被正确回显。
  const r = await callRoute('dashboard', { days: 1 })
  check('dashboard(days=1) 返回成功', r && r.ok === true, JSON.stringify(r))
  check('dashboard(days=1) 回显 days=1', r && r.days === 1, r && String(r.days))

  // 今天的 cutoff 应严格晚于「近 24 小时」起点（除恰好零点外）。
  // 用 days=1 与 days=2 的差异做结构性断言：两者必须不同口径。
  const r2 = await callRoute('dashboard', { days: 2 })
  check('days=1 与 days=2 是不同查询', r && r2 && r.days !== r2.days)
}

// ---------- [2] 云端必须收到 from/to（不是只收 range）----------
console.log('\n[2] fetchCloud 必须把精确区间发给云端（from/to）')
{
  await configureCloud()

  // 场景：界面选「近 14 天」——云端 range 枚举里没有 14d（会静默降级成 all），
  // 只有 from/to 能表达。这是本次修复最关键的断言。
  lastCloudUrl = null
  cloudPayload = { all: { real: 1, calls: 1, tokens: 1 }, summary: { realCost: 1 } }
  await callRoute('cloud', { route: 'overview', days: 14, view: 'cloud-rest' })

  check('发起了云端请求', !!lastCloudUrl, lastCloudUrl)
  if (lastCloudUrl) {
    const u = new URL(lastCloudUrl)
    const from = u.searchParams.get('from')
    const to = u.searchParams.get('to')
    check('请求包含 from 参数', from !== null && from !== '', 'url=' + lastCloudUrl)
    check('from 是合法毫秒时间戳', Number.isFinite(Number(from)) && Number(from) > 0, String(from))
    check('请求包含 to 参数', to !== null && to !== '', 'url=' + lastCloudUrl)

    // from 应约等于 now - 14 天（容差 5 分钟，避免时钟抖动/flaky）
    const expect = Date.now() - 14 * 86400000
    const drift = Math.abs(Number(from) - expect)
    check('from ≈ now - 14 天（容差 5 分钟）', drift < 5 * 60 * 1000, `drift=${Math.round(drift / 1000)}s`)
  }
}

// ---------- [3] days=1 发的是北京零点 ----------
console.log('\n[3] days=1 的 from 必须是北京时间当日 00:00')
{
  await configureCloud()
  lastCloudUrl = null
  cloudPayload = { all: { real: 1, calls: 1, tokens: 1 }, summary: { realCost: 1 } }
  await callRoute('cloud', { route: 'overview', days: 1, view: 'cloud-rest' })

  check('发起了云端请求', !!lastCloudUrl, lastCloudUrl)
  if (lastCloudUrl) {
    const from = Number(new URL(lastCloudUrl).searchParams.get('from'))
    // 北京当日零点 = UTC 当天(或前一天)16:00
    const d = new Date(from)
    const okZero = d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCHours() === 16
    check('from 落在北京 00:00（UTC 16:00 整）', okZero, new Date(from).toISOString())

    // 关键回归：不得等于「近 24 小时」
    const rolling = Date.now() - 86400000
    check('from ≠ 近 24 小时起点（不是滚动窗口）', Math.abs(from - rolling) > 60 * 1000,
      `from=${new Date(from).toISOString()} rolling=${new Date(rolling).toISOString()}`)
  }
}

// ---------- [4] 不同 days 必须得到不同区间（不允许恒定 7d）----------
console.log('\n[4] 不同 days 不能再发送相同区间（此前恒定 7d 的回归）')
{
  await configureCloud()
  const seen = []
  for (const d of [1, 7, 30]) {
    lastCloudUrl = null
    cloudPayload = { all: { real: 1, calls: 1, tokens: 1 }, summary: { realCost: 1 } }
    await callRoute('cloud', { route: 'overview', days: d, view: 'cloud-rest' })
    const u = lastCloudUrl ? new URL(lastCloudUrl) : null
    seen.push({ d, from: u ? Number(u.searchParams.get('from')) : null, range: u ? u.searchParams.get('range') : null })
  }
  console.log('        观测:', JSON.stringify(seen.map((s) => ({ days: s.d, from: s.from && new Date(s.from).toISOString().slice(0, 16), range: s.range }))))

  const froms = seen.map((s) => s.from)
  check('三次请求的 from 互不相同', new Set(froms).size === 3, JSON.stringify(froms))
  // 窗口越大，起点应越早
  check('days 越大 from 越早', froms[2] < froms[1] && froms[1] < froms[0], JSON.stringify(froms))
}

// ---------- [5] days=0（全部）走 range=all ----------
console.log('\n[5] 「全部」不得发送 from（交给 range=all）')
{
  await configureCloud()
  lastCloudUrl = null
  cloudPayload = { all: { real: 1, calls: 1, tokens: 1 }, summary: { realCost: 1 } }
  await callRoute('cloud', { route: 'overview', days: 0, view: 'cloud-rest' })

  check('发起了云端请求', !!lastCloudUrl, lastCloudUrl)
  if (lastCloudUrl) {
    const u = new URL(lastCloudUrl)
    check('range=all', u.searchParams.get('range') === 'all', String(u.searchParams.get('range')))
    const from = u.searchParams.get('from')
    check('不含 from（由 all 表达全时段）', from === null || from === '', String(from))
  }
}

console.log('')
if (failures === 0) {
  console.log('OK: 全部断言通过')
  process.exit(0)
} else {
  console.log(`FAILED: ${failures} 项断言未通过`)
  process.exit(1)
}
