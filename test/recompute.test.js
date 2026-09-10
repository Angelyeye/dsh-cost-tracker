// ============================================================
// dsh-cost-tracker 补账（cost_recompute）集成测试（零依赖）
//   node test/recompute.test.js
// 用真实插件实例 + 临时 DSH_HOME 跑一遍 _apply/_execute，
// 验证价格时代切换后能把「按旧价入库」的记录按各自时间戳重算。
// 绝不触碰真实数据：所有读写都落在 mkdtemp 出来的临时目录。
// ============================================================
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 北京时间辅助
function bj(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h - 8, mi) }
const LEGACY_TS = bj(2026, 9, 10, 11, 0)   // 切换前（高峰）
const OFF_TS = bj(2026, 9, 10, 12, 30)     // 切换后（闲时）
const PEAK_TS = bj(2026, 9, 10, 15, 0)     // 切换后（高峰）

let failures = 0
const passed = []
function ok(cond, msg) {
  if (cond) passed.push(msg)
  else { failures += 1; console.error('FAIL: ' + msg) }
}
function approx(a, b, msg) { ok(Math.abs(a - b) < 1e-6, msg + ' (' + a + ' vs ' + b + ')') }

// ---------- 临时环境 ----------
const home = mkdtempSync(join(tmpdir(), 'dsh-cost-recompute-'))
const storages = join(home, 'storages')
mkdirSync(storages, { recursive: true })
const storeFile = join(storages, 'cost-tracker-records.json')
process.env.DSH_HOME = home
process.env.DSH_COST_TRACKER_STORE = storeFile
delete process.env.DSH_COST_TRACKER_LOG

const tk = { input: 100000, output: 6000, cacheRead: 20000, cacheWrite: 0 }
// 按旧价手工算出、模拟「切换后宿主未重启」时入库的费用
const OLD_PRO_OFF = 0.534    // (100000*9 + 6000*27 + 20000*0.30)/1e6 * 0.5
const OLD_PRO_PEAK_BEFORE = 1.068
const OLD_VISION_PEAK = 0.356 // (100000*3 + 6000*9 + 20000*0.10)/1e6

function rec(ts, model, cost, period) {
  return { ts, provider: 'deepseek-official', model, sessionId: 's1', purpose: '', cost, estimated: false, period, tokens: { ...tk }, subscription: false }
}

const seed = {
  v: 2,
  details: [
    rec(LEGACY_TS, 'deepseek-v4-pro', OLD_PRO_PEAK_BEFORE, 'peak'),
    rec(OFF_TS, 'deepseek-v4-pro', OLD_PRO_OFF, 'off-peak'),
    rec(PEAK_TS, 'deepseek-v4-flash-vision-exp', OLD_VISION_PEAK, 'peak'),
  ],
  rollups: {},
}
writeFileSync(storeFile, JSON.stringify(seed), 'utf8')

const plugin = (await import('../index.js')).default
const registered = new Map()
const ctx = {
  get: () => undefined,
  on: () => {},
  effect: () => () => {},
  tools: { register: (def) => registered.set(def.name, def) },
  webServer: { register: () => {} },
}
plugin.apply(ctx)

const tool = registered.get('cost_recompute')
ok(!!tool, 'cost_recompute: 工具已注册')
ok(registered.has('cost_prices') && registered.has('cost_peak'), '回归: 既有工具仍在')

// ---------- 1. 试算（默认不落盘） ----------
const before = readFileSync(storeFile, 'utf8')
const dry = await tool.execute({})
ok(dry.ok === true && dry.applied === false, '试算: 未落盘')
ok(dry.era === 'v41', '试算: 默认按最近价格时代 v41 起算')
ok(dry.since === Date.UTC(2026, 8, 10, 4, 0, 0), '试算: 起始时刻 = 2026-09-10 12:00 北京')
ok(dry.scanned === 2, '试算: 只扫描切换后的 2 条记录（切换前那条不计）')
ok(dry.changed === 2, '试算: 2 条需修正')
ok(readFileSync(storeFile, 'utf8') === before, '试算: 磁盘内容未被改动')
// 旧价 0.534(闲) + 0.356(峰) = 0.890 → 新价 0.1244(闲) + 0.2488(峰) = 0.3732
approx(dry.oldCost, 0.89, '试算: 原合计 ¥0.890')
approx(dry.newCost, 0.3732, '试算: 新合计 ¥0.3732')
ok(dry.byModel.length >= 2, '试算: 按模型给出明细')

// ---------- 2. 落盘 ----------
const applied = await tool.execute({ apply: true })
ok(applied.applied === true, '落盘: applied = true')
const after = JSON.parse(readFileSync(storeFile, 'utf8')).details
ok(after.length === 3, '落盘: 记录条数不变（就地重算，不新增/删除）')

const legacy = after.find(r => r.ts === LEGACY_TS)
approx(legacy.cost, OLD_PRO_PEAK_BEFORE, '落盘: 切换前记录费用不变（¥1.068）')
ok(legacy.model === 'deepseek-v4-pro', '落盘: 切换前记录模型名不变')
ok(legacy.period === 'peak', '落盘: 切换前记录档位不变')

const post1 = after.find(r => r.ts === OFF_TS)
approx(post1.cost, 0.1244, '落盘: V4-Pro 闲时改按 V4.1 Flash 计费（¥0.1244）')
ok(post1.model === 'deepseek-v4.1-flash', '落盘: V4-Pro 记录模型名改写为 V4.1 Flash')
ok(post1.period === 'off-peak', '落盘: 档位仍为闲时')

const post2 = after.find(r => r.ts === PEAK_TS)
approx(post2.cost, 0.2488, '落盘: 视觉版改按 V4.1 Flash 高峰计费（¥0.2488）')
ok(post2.model === 'deepseek-v4.1-flash', '落盘: 视觉版记录模型名改写为 V4.1 Flash')
ok(post2.period === 'peak', '落盘: 视觉版档位仍为高峰')

// ---------- 3. 幂等 ----------
const again = await tool.execute({ apply: true })
ok(again.changed === 0 && again.applied === false, '幂等: 再次重算无需修正')
ok(again.note.indexOf('没有需要重算') === 0, '幂等: 提示无需重算')

// ---------- 4. 自定义 since ----------
const wider = await tool.execute({ since: bj(2026, 9, 10, 10, 0) })
ok(wider.scanned === 3, 'since: 自定义起点可覆盖切换前记录（只读扫描）')
ok(wider.era === 'legacy', 'since: 起点落在旧价时代时 era = legacy')

// ---------- 5. cost_prices 已按时代渲染 ----------
const pv = await registered.get('cost_prices').execute({})
ok(Array.isArray(pv.eras) && pv.eras.length === 2, 'prices: 返回两个价格时代')
const { eraAt, exactModelsAt } = await import('../pricing.js')
const nowEra = eraAt(Date.now())
ok(pv.era === nowEra.id, 'prices: 当前生效时代与时钟一致（' + nowEra.id + '）')
ok(pv.exact === exactModelsAt(Date.now()), 'prices: exact 为当前时代的单价表')
ok(pv.eras[1].routes['deepseek-v4-pro'] === 'deepseek-v4.1-flash', 'prices: 暴露 V4-Pro 路由规则')
const text = registered.get('cost_prices').output.render({}, pv)[0].text
ok(text.indexOf('V4.1 Flash') > -1, 'prices: 渲染文本包含 V4.1 Flash')
ok(text.indexOf('路由：deepseek-v4-pro') > -1, 'prices: 渲染文本包含路由说明')
ok(text.indexOf('2026-08 价') > -1 && text.indexOf('V4.1 Flash 价') > -1, 'prices: 渲染文本列出两个时代')
ok(text.indexOf('era=') > -1, 'prices: 渲染文本标出当前 era')
ok(text.indexOf('当前生效：') > -1, 'prices: 渲染文本标出当前生效版本')
ok(text.indexOf('0.04') > -1 && text.indexOf('（未命中）2') > -1 && text.indexOf('输出 8') > -1, 'prices: 渲染文本包含 V4.1 Flash 新价')

rmSync(home, { recursive: true, force: true })
console.log('\n' + passed.length + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
