// ============================================================
// dsh-cost-tracker 法定节假日（峰谷口径）契约测试
//   node test/peak-holidays.test.js
//
// 官方价目页脚注 (2)：「北京时间周一至周五（**不含中国法定节假日**）9:00-12:00、
// 14:00-18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。」
// v1.9.2 之前只排除周末，节假日落在工作日时会按高峰多计 1 倍 —— 这组断言把整条链路钉住：
//   ① 内置表（国办发明电〔2025〕7 号）默认生效，节假日全天判闲时；
//   ② 配置卡写入的自定义列表/停用哨兵真的改变**记账口径**（isPeak 与 peak 快照同源）；
//   ③ 配置落盘、重启后仍然生效（不会被默认值悄悄顶掉）；
//   ④ 工具输出如实回显来源与条数（不静默改写用户输入）。
// ============================================================
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

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

// ---------- 沙箱：独立 DSH_HOME ----------
const home = mkdtempSync(join(tmpdir(), 'cost-peak-holidays-'))
process.env.DSH_HOME = home
mkdirSync(join(home, 'storages'), { recursive: true })
delete process.env.DSH_COST_TRACKER_LOG

const configFile = join(home, 'storages', 'cost-tracker-config.json')
const realFetch = globalThis.fetch
globalThis.fetch = async (url) => { throw new Error('本测试不应发起网络请求: ' + String(url)) }

// 北京时间辅助（分钟缺省按 0 —— 显式传 undefined 会让 Date.UTC 返回 NaN）
const bj = (y, mo, d, h, mi) => Date.UTC(y, mo - 1, d, h - 8, mi || 0)

// ctx.effect 必须立即执行（路由注册写在 effect 回调里）
const effectNow = (fn) => { try { fn() } catch (e) { /* 销毁函数不可调用 */ } return () => {} }

function makeCtx() {
  const tools = new Map()
  const ctx = {
    get: () => undefined,
    inject: () => {},
    effect: effectNow,
    on: () => {},
    tools: { register: (def) => tools.set(def.name, def) },
    commands: { register: () => {} },
    settings: undefined,
    logger: undefined,
    webServer: { register: (route) => { ctx.__webHandler = route && (route.handler || route); return () => {} } },
    __webHandler: null,
    __tools: tools,
  }
  return ctx
}

/** 直接调用插件注册的 HTTP 处理器，等价于客户端的 fetch('/api/cost-tracker/<name>') */
async function api(ctx, name, args) {
  const chunks = []
  const req = {
    method: 'POST',
    url: '/api/cost-tracker/' + name,
    [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(args || {}), 'utf8') },
  }
  const res = { statusCode: 0, writeHead(code) { this.statusCode = code }, end(body) { chunks.push(body || '') } }
  await ctx.__webHandler(req, res)
  const raw = chunks.join('')
  try { return JSON.parse(raw) } catch (e) { return { __raw: raw, __status: res.statusCode } }
}

console.log('dsh-cost-tracker 法定节假日（峰谷口径）契约测试')
console.log(`  DSH_HOME = ${home}`)
console.log('')

const mod = await import(pathToFileURL(join(root, 'index.js')).href)
const { isPeak, getPeakHolidays, setPeakHolidays, CN_HOLIDAYS } = await import(pathToFileURL(join(root, 'pricing.js')).href)

let ctx = makeCtx()
mod.default.apply(ctx)

console.log('[1] 默认：内置表生效，节假日全天按闲时')
{
  check('webServer 已注册处理器', typeof ctx.__webHandler === 'function')
  const snap = await api(ctx, 'peak', {})
  check('peak 快照回显节假日信息', !!snap.holidays, JSON.stringify(snap.holidays))
  check('默认来源 = 内置表', snap.holidays && snap.holidays.mode === 'builtin' && snap.holidays.builtin === true, JSON.stringify(snap.holidays))
  check('内置表条数 = 2026 全年放假日', snap.holidays && snap.holidays.count === CN_HOLIDAYS.length, JSON.stringify({ got: snap.holidays && snap.holidays.count, want: CN_HOLIDAYS.length }))
  check('峰谷文案点明「周末与法定节假日全天闲时」', /周末与法定节假日全天闲时/.test(snap.peakWindows || ''), snap.peakWindows)

  const px = await api(ctx, 'prices', {})
  check('prices 也回显节假日信息（工具/接口同源）', px.peakHolidays && px.peakHolidays.builtin === true, JSON.stringify(px.peakHolidays))
  check('prices 不再暴露已废除的 v41ProRouteAt', px.v41ProRouteAt === undefined, JSON.stringify(px.v41ProRouteAt))
  check('prices 只有两个价格时代', Array.isArray(px.eras) && px.eras.length === 2, JSON.stringify((px.eras || []).map((e) => e.id)))
  check('任何时代都没有 V4-Pro 反向路由',
    (px.eras || []).every((e) => !(e.routes || {})['deepseek-v4-pro']),
    JSON.stringify((px.eras || []).map((e) => e.routes)))

  // 记账口径：与 isPeak 同源（模块态由插件启动时注入）
  check('2026-10-01 国庆（周四）10:00 → 闲时', isPeak(bj(2026, 10, 1, 10)) === false)
  check('2026-09-25 中秋（周五）10:00 → 闲时', isPeak(bj(2026, 9, 25, 10)) === false)
  check('2026-10-08 节后（周四）10:00 → 高峰', isPeak(bj(2026, 10, 8, 10)) === true)
  check('快照相位与 isPeak 同源（同一时刻判定一致）',
    !!snap.phase && snap.phase.inPeak === isPeak(snap.now),
    JSON.stringify({ inPeak: snap.phase && snap.phase.inPeak, expect: isPeak(snap.now) }))
}

console.log('[2] 配置卡「停用」：只按周末判定，节假日回到高峰')
{
  const saved = await api(ctx, 'peak-config', { peakHolidays: 'none' })
  check('peak-config 接受哨兵 none 并原样回显', saved && saved.peakHolidays === 'none', JSON.stringify(saved.peakHolidays))
  check('模块态随之更新（记账口径即时改变）', isPeak(bj(2026, 10, 1, 10)) === true)
  check('周末仍为闲时（停用节假日不影响周末）', isPeak(bj(2026, 10, 3, 10)) === false)
  const onDisk = JSON.parse(readFileSync(configFile, 'utf8'))
  check('配置落盘为哨兵 none', onDisk.peakHolidays === 'none', JSON.stringify(onDisk.peakHolidays))
  const snap = await api(ctx, 'peak', {})
  check('peak 快照同步为 disabled（界面据此显示「已停用」）',
    snap.holidays && snap.holidays.disabled === true && snap.holidays.count === 0, JSON.stringify(snap.holidays))
}

console.log('[3] 自定义列表：整体替换内置表，非法条目如实报告')
{
  const saved = await api(ctx, 'peak-config', { peakHolidays: '2026-10-01, 2027/1/2  乱七八糟' })
  check('自定义列表被原样接受（不静默改写）', saved && saved.peakHolidays === '2026-10-01, 2027/1/2  乱七八糟', JSON.stringify(saved.peakHolidays))
  const snap = await api(ctx, 'peak', {})
  const hol = snap.holidays || {}
  check('归一化后 2 条有效', hol.count === 2 && hol.mode === 'custom', JSON.stringify(hol))
  check('排序 + 补零（斜杠写法归一）',
    hol.dates && hol.dates[0] === '2026-10-01' && hol.dates[1] === '2027-01-02',
    JSON.stringify(hol.dates))
  check('非法条目被如实报告（不静默吞掉）',
    Array.isArray(hol.invalid) && hol.invalid.length === 1 && hol.invalid[0] === '乱七八糟',
    JSON.stringify(hol.invalid))
  check('自定义表生效：10-01 闲时、10-05 高峰（内置表已被替换）',
    isPeak(bj(2026, 10, 1, 10)) === false && isPeak(bj(2026, 10, 5, 10)) === true)
  check('自定义表覆盖下一年（2027-01-02 闲时）', isPeak(bj(2027, 1, 2, 10)) === false)
  check('未列入的 2027-01-01 仍按高峰（自定义表不追加内置）', isPeak(bj(2027, 1, 1, 10)) === true)
}

console.log('[4] 重启后仍然生效（配置文件是真源）')
{
  // 模拟重启：同一份 DSH_HOME，重新 apply
  const ctx2 = makeCtx()
  mod.default.apply(ctx2)
  check('重启后模块态恢复为自定义表', isPeak(bj(2026, 10, 1, 10)) === false && isPeak(bj(2027, 1, 2, 10)) === false)
  const snap = await api(ctx2, 'peak', {})
  check('重启后快照仍为 custom 2 条', snap.holidays && snap.holidays.mode === 'custom' && snap.holidays.count === 2, JSON.stringify(snap.holidays))
  ctx = ctx2
}

console.log('[5] 恢复内置：空串 → 内置表，且工具输出说明来源')
{
  const saved = await api(ctx, 'peak-config', { peakHolidays: '' })
  check('空串恢复内置表（响应回显空串）', saved && saved.peakHolidays === '', JSON.stringify(saved.peakHolidays))
  const snap = await api(ctx, 'peak', {})
  check('快照回到 builtin 且条数 = 内置表', snap.holidays && snap.holidays.mode === 'builtin' && snap.holidays.count === CN_HOLIDAYS.length, JSON.stringify(snap.holidays))
  check('模块态恢复：10-01 重新为闲时', isPeak(bj(2026, 10, 1, 10)) === false)
  check('配置落盘为空串', JSON.parse(readFileSync(configFile, 'utf8')).peakHolidays === '')

  const tool = ctx.__tools.get('cost_peak')
  check('cost_peak 工具已注册', !!tool)
  if (tool) {
    const v = await tool.execute({})
    const text = tool.output.render({}, v)[0].text
    check('cost_peak 描述点明不含法定节假日',
      /不含中国法定节假日/.test(tool.description || ''), tool.description)
    check('cost_peak 输出含峰谷文案', /法定节假日全天闲时/.test(text), JSON.stringify(text.slice(0, 160)))
  }
  const pricesTool = ctx.__tools.get('cost_prices')
  if (pricesTool) {
    const v = await pricesTool.execute({})
    const text = pricesTool.output.render({}, v)[0].text
    check('cost_prices 输出说明 V4-Pro 维持自有牌价', /deepseek-v4-pro 维持 V4-Pro 自有牌价/.test(text), JSON.stringify(text.slice(0, 200)))
    check('cost_prices 输出说明节假日口径', /法定节假日/.test(text), JSON.stringify(text.slice(0, 240)))
    check('cost_prices 输出不再出现 V4-Pro 路由行', !/路由：deepseek-v4-pro/.test(text))
  }
}

// ---------- 收尾：恢复模块默认值，避免影响同进程内的其它测试 ----------
setPeakHolidays('')
const restored = getPeakHolidays()
check('收尾：模块态恢复内置表', restored.builtin === true && restored.count === CN_HOLIDAYS.length, JSON.stringify(restored))

globalThis.fetch = realFetch
rmSync(home, { recursive: true, force: true })
console.log('')
if (failures > 0) {
  console.log(`FAILED: ${failures} 项断言未通过`)
  process.exit(1)
}
console.log('OK: 全部断言通过')
process.exit(0)
