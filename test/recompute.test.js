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
const LEGACY_TS = bj(2026, 9, 10, 11, 0)   // Flash 调价前（高峰，V4-Pro 旧牌价）
const MID_TS = bj(2026, 9, 10, 12, 30)     // Flash 调价后（闲时，V4-Pro 仍自有牌价）
const ROUTE_TS = bj(2026, 9, 15, 15, 0)    // v1.9.0/1.9.1 曾当作「路由后」（高峰）——现为 V4-Pro 自有牌价
const FLASH_TS = bj(2026, 9, 15, 12, 30)   // 现役名 deepseek-flash（闲时，误标估算）

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
// 按各档单价手工算出、模拟「价格切换后宿主未重启」时按旧口径入库的费用
const OLD_PRO_OFF = 0.534      // (100000*9 + 6000*27 + 20000*0.30)/1e6 * 0.5
const OLD_PRO_PEAK_BEFORE = 1.068
const OLD_VISION_PEAK = 0.356  // (100000*3 + 6000*9 + 20000*0.10)/1e6
const V41_VISION_OFF = 0.1244  // (100000*2 + 6000*8 + 20000*0.04)/1e6 * 0.5
const WRONG_FLASH_OFF = 0.3732 // 误按兜底旧价入库的 deepseek-flash 记录
const V41_FLASH_OFF = 0.1244   // (100000*2 + 6000*8 + 20000*0.04)/1e6 * 0.5（闲时半价）

function rec(ts, model, cost, period, estimated) {
  return { ts, provider: 'deepseek-official', model, sessionId: 's1', purpose: '', cost, estimated: estimated === true, period, tokens: { ...tk }, subscription: false }
}

const seed = {
  v: 2,
  details: [
    rec(LEGACY_TS, 'deepseek-v4-pro', OLD_PRO_PEAK_BEFORE, 'peak'),
    rec(MID_TS, 'deepseek-v4-pro', OLD_PRO_OFF, 'off-peak'),
    rec(ROUTE_TS, 'deepseek-v4-pro', OLD_PRO_PEAK_BEFORE, 'peak'),
    rec(ROUTE_TS, 'deepseek-v4-flash-vision-exp', OLD_VISION_PEAK, 'peak'),
    rec(FLASH_TS, 'deepseek-flash', WRONG_FLASH_OFF, 'off-peak', true),
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
ok(dry.since === 0, '试算: 默认全时段扫描（since=0，不漏更早时代）')
ok(dry.era === null, '试算: 全时段扫描时 era 为 null（不误报单一时代）')
ok(dry.scanned === 5, '试算: 全时段扫描覆盖全部 5 条记录')
ok(dry.changed === 2, '试算: 2 条需修正（视觉版 + 误标估算的 deepseek-flash）')
ok(dry.estimatedFlips === 1, '试算: 1 条仅订正「估算」标记')
ok(readFileSync(storeFile, 'utf8') === before, '试算: 磁盘内容未被改动')
// 全时段试算：三条 V4-Pro 记录按自有牌价重算后**金额不变**（1.068 / 0.534 / 1.068），
// 可改动的两条是视觉版（0.356 → 0.2488）与误标估算的 flash（0.3732 → 0.1244）。
const UNCHANGED = OLD_PRO_PEAK_BEFORE + OLD_PRO_OFF + OLD_PRO_PEAK_BEFORE
approx(dry.oldCost, OLD_VISION_PEAK + WRONG_FLASH_OFF + UNCHANGED, '试算: 原合计 ¥3.3992（含三条不需改动的 V4-Pro）')
approx(dry.newCost, 0.2488 + V41_FLASH_OFF + UNCHANGED, '试算: 新合计 ¥3.0432（仅两条 Flash 档记录下调）')
approx(dry.delta, -0.356, '试算: 差额 ¥-0.356（全部来自视觉版与误标估算记录）')
ok(dry.byModel.length >= 2, '试算: 按模型给出明细')

// ---------- 2. 落盘 ----------
const applied = await tool.execute({ apply: true })
ok(applied.applied === true, '落盘: applied = true')
const after = JSON.parse(readFileSync(storeFile, 'utf8')).details
ok(after.length === 5, '落盘: 记录条数不变（就地重算，不新增/删除）')

const legacy = after.find(r => r.ts === LEGACY_TS)
approx(legacy.cost, OLD_PRO_PEAK_BEFORE, '落盘: 调价前记录费用不变（¥1.068）')
ok(legacy.model === 'deepseek-v4-pro', '落盘: 调价前记录模型名不变')
ok(legacy.period === 'peak', '落盘: 调价前记录档位不变')

// 关键回归：9-10 12:00 ～ 9-14 12:00 之间 V4-Pro 尚未路由，必须保持自有牌价
const mid = after.find(r => r.ts === MID_TS)
approx(mid.cost, OLD_PRO_OFF, '落盘: V4-Pro 路由前费用不变（¥0.534，不可提前按 Flash 折算）')
ok(mid.model === 'deepseek-v4-pro', '落盘: V4-Pro 路由前模型名不变')
ok(mid.period === 'off-peak', '落盘: V4-Pro 路由前档位不变')

// 09-15 两条记录：V4-Pro 维持自有牌价（金额与模型名都不再被改写），视觉版仍路由到 Flash
const routed = after.filter(r => r.ts === ROUTE_TS)
ok(routed.length === 2, '落盘: 同一时刻的两条记录都在')
const post1 = routed[0]
approx(post1.cost, OLD_PRO_PEAK_BEFORE, '落盘: V4-Pro 维持自有牌价（¥1.068，不再按 Flash 折算）')
ok(post1.model === 'deepseek-v4-pro', '落盘: V4-Pro 模型名保持自有名（官方已撤销下线计划）')
ok(post1.period === 'peak', '落盘: 档位仍为高峰')

const post2 = routed[1]
approx(post2.cost, 0.2488, '落盘: 视觉版改按 Flash 高峰计费（¥0.2488）')
ok(post2.model === 'deepseek-flash', '落盘: 视觉版模型名改写为官方现役名 deepseek-flash')
ok(post2.period === 'peak', '落盘: 视觉版档位仍为高峰')

const flash = after.find(r => r.ts === FLASH_TS)
approx(flash.cost, V41_FLASH_OFF, '落盘: deepseek-flash 记录改按精确档计费（¥0.1244）')
ok(flash.model === 'deepseek-flash', '落盘: deepseek-flash 模型名保持官方现役名')
ok(flash.estimated === false, '落盘: deepseek-flash 不再标记为「估算」')
ok(flash.period === 'off-peak', '落盘: deepseek-flash 档位仍为闲时')

// ---------- 3. 幂等 ----------
const again = await tool.execute({ apply: true })
ok(again.changed === 0 && again.applied === false, '幂等: 再次重算无需修正')
ok(again.note.indexOf('没有需要重算') === 0, '幂等: 提示无需重算')

// ---------- 4. 自定义 since ----------
const wider = await tool.execute({ since: bj(2026, 9, 10, 10, 0) })
ok(wider.scanned === 5, 'since: 自定义起点可覆盖切换前记录（只读扫描）')
ok(wider.era === 'legacy', 'since: 起点落在旧价时代时 era = legacy')

// ---------- 5. cost_prices 已按时代渲染 ----------
const pv = await registered.get('cost_prices').execute({})
ok(Array.isArray(pv.eras) && pv.eras.length === 2, 'prices: 返回两个价格时代（legacy / v41）')
const { eraAt, exactModelsAt, V41_EFFECTIVE_AT } = await import('../pricing.js')
const nowEra = eraAt(Date.now())
ok(pv.era === nowEra.id, 'prices: 当前生效时代与时钟一致（' + nowEra.id + '）')
ok(pv.exact === exactModelsAt(Date.now()), 'prices: exact 为当前时代的单价表')
ok(pv.v41EffectiveAt === V41_EFFECTIVE_AT, 'prices: 暴露 V4.1 Flash 调价时刻')
// v1.9.2：官方撤销 V4-Pro 下线计划 → 不再有 pro 反向路由，任何时代都不得出现
ok(pv.eras.every((e) => !(e.routes || {})['deepseek-v4-pro']), 'prices: 任何时代都不含 V4-Pro 反向路由')
ok(pv.eras[1].models['deepseek-v4-pro'].input === 9.0, 'prices: v41 时代保留 V4-Pro 自有牌价 9.0')
const text = registered.get('cost_prices').output.render({}, pv)[0].text
ok(text.indexOf('deepseek-flash') > -1, 'prices: 渲染文本包含官方现役名 deepseek-flash')
ok(text.indexOf('deepseek-v4-pro 维持 V4-Pro 自有牌价') > -1, 'prices: 渲染文本说明 V4-Pro 不路由')
ok(text.indexOf('路由：deepseek-v4-pro') < 0, 'prices: 渲染文本不再出现 V4-Pro 路由说明')
ok(text.indexOf('法定节假日') > -1, 'prices: 渲染文本说明法定节假日口径')
ok(text.indexOf('2026-08 价') > -1 && text.indexOf('V4.1 Flash 价') > -1, 'prices: 渲染文本列出价格时代')
ok(text.indexOf('era=') > -1, 'prices: 渲染文本标出当前 era')
ok(text.indexOf('当前生效：') > -1, 'prices: 渲染文本标出当前生效版本')
ok(text.indexOf('0.04') > -1 && text.indexOf('（未命中）2') > -1 && text.indexOf('输出 8') > -1, 'prices: 渲染文本包含 V4.1 Flash 新价')

rmSync(home, { recursive: true, force: true })
console.log('\n' + passed.length + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
