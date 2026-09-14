// ============================================================
// dsh-cost-tracker 三态视图测试（零依赖，直接 node 运行）
//   node test/view.test.js
//
// 核心不变量：服务端已按 excludeDevice 排除本机后，
//   mergeDash(本地, 云端_排除本机) === 全网合计，且本机恰好计一次。
// 另外覆盖云端字段缺失、日期并集、订阅口径、排序与容错。
// ============================================================
import { BOARD_VIEWS, BOARD_DIMS, normalizeCloudDash, mergeDash, addSlice, zeroSlice } from '../view.js'

let failures = 0
const passed = []
function ok(cond, msg) {
  if (cond) passed.push(msg)
  else { failures += 1; console.error('FAIL: ' + msg) }
}
function eq(a, b, msg) { ok(a === b, msg + '（' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + '）') }
function near(a, b, msg) { ok(Math.abs(a - b) < 1e-9, msg + '（' + a + ' ≈ ' + b + '）') }

// 本机数据形状（与 buildDashboard 一致）
function localDash() {
  return {
    ok: true, days: 7,
    realCost: 3.5, realCalls: 30, realTokens: 9000,
    subEquivalent: 0, subCalls: 0, subTokens: 0,
    peakCost: 2, offCost: 1.5, flatCost: 0,
    today: { real: 0.5, calls: 4, tokens: 1200, sub: 0, subCalls: 0, subTokens: 0 },
    month: { real: 3.5, calls: 30, tokens: 9000, sub: 0, subCalls: 0, subTokens: 0 },
    all: { real: 40, calls: 300, tokens: 90000, sub: 5, subCalls: 12, subTokens: 3000 },
    byDay: [
      { date: '2026-09-10', label: '9/10', peak: 1, off: 0.5, flat: 0 },
      { date: '2026-09-11', label: '9/11', peak: 1, off: 1, flat: 0 },
    ],
    byModel: [
      { model: 'deepseek-official/deepseek-v4.1-flash', subscription: false, estimated: false, calls: 30, tokens: 9000, cost: 3.5 },
    ],
    byModelDay: [
      { model: 'deepseek-official/deepseek-v4.1-flash', subscription: false, estimated: false, days: [
        { date: '2026-09-10', label: '9/10', calls: 15, tokens: 4000, input: 1000, output: 500, cacheRead: 2500, cacheWrite: 0, cost: 1.5 },
        { date: '2026-09-11', label: '9/11', calls: 15, tokens: 5000, input: 1500, output: 500, cacheRead: 3000, cacheWrite: 0, cost: 2 },
      ] },
    ],
    recent: [{ ts: 1, model: 'local-1', cost: 0.1 }],
    devices: [], sources: [],
    asOf: 0,
  }
}

// 云端返回（已 excludeDevice=本机，即"其他设备"）
function cloudDash() {
  return {
    ok: true, source: 'cloud', days: 7,
    realCost: 1.25, realCalls: 12, realTokens: 4000,
    subEquivalent: 2, subCalls: 3, subTokens: 900,
    peakCost: 0.5, offCost: 0.75, flatCost: 0,
    today: { real: 0.25, calls: 2, tokens: 800, sub: 0, subCalls: 0, subTokens: 0 },
    month: { real: 1.25, calls: 12, tokens: 4000, sub: 2, subCalls: 3, subTokens: 900 },
    all: { real: 9, calls: 90, tokens: 30000, sub: 4, subCalls: 6, subTokens: 1800 },
    byDay: [
      { date: '2026-09-11', label: '9/11', peak: 0.5, off: 0.5, flat: 0 },
      { date: '2026-09-12', label: '9/12', peak: 0, off: 0.25, flat: 0 },
    ],
    byModel: [
      { model: 'deepseek-official/deepseek-v4.1-flash', subscription: false, estimated: false, calls: 8, tokens: 3000, cost: 0.75 },
      { model: 'openai/gpt-5-codex', subscription: false, estimated: true, calls: 4, tokens: 1000, cost: 0.5 },
    ],
    byModelDay: [
      { model: 'deepseek-official/deepseek-v4.1-flash', subscription: false, estimated: false, days: [
        { date: '2026-09-11', label: '9/11', calls: 8, tokens: 3000, input: 1000, output: 500, cacheRead: 1500, cacheWrite: 0, cost: 0.75 },
      ] },
    ],
    recent: [{ ts: 2, model: 'cloud-1', cost: 0.2, deviceName: '笔记本', source: 'codex' }],
    devices: [{ device: 'machine-B', name: '笔记本', cost: 1.25, calls: 12, tokens: 4000, sources: ['codex'] }],
    sources: [{ source: 'codex', cost: 1.25, calls: 12, tokens: 4000, devices: ['machine-B'] }],
    asOf: 1789392645019,
  }
}

// ---------- 1. 视图与维度常量 ----------
{
  eq(BOARD_VIEWS.length, 3, '三态视图共三项')
  eq(BOARD_VIEWS.map(v => v.id).join(','), 'local,local+cloud,cloud', '视图取值固定')
  ok(BOARD_DIMS.map(d => d.id).includes('agent'), '维度包含「按 Agent」')
  ok(BOARD_DIMS.map(d => d.id).includes('device'), '维度包含「按机器」')
}

// ---------- 2. 归一化：缺字段补 0，不抛异常 ----------
{
  eq(normalizeCloudDash(null, 7), null, '空输入返回 null')
  eq(normalizeCloudDash({ ok: false, error: 'x' }, 7), null, 'ok:false 返回 null')
  const n = normalizeCloudDash({ ok: true, realCost: 1 }, 14)
  eq(n.days, 14, 'days 缺省用回退值')
  eq(n.today.real, 0, 'today 缺省补 0')
  eq(n.byDay.length, 0, 'byDay 缺省为空数组')
  eq(n.devices.length, 0, 'devices 缺省为空数组')
  ok(Array.isArray(n.byModelDay), 'byModelDay 归一为数组')
}

// ---------- 3. 相加：本机 + 云端(排除本机) = 全网，且本机只计一次 ----------
{
  const merged = mergeDash(localDash(), cloudDash())
  near(merged.realCost, 4.75, '区间按量花费相加（3.5 + 1.25）')
  eq(merged.realCalls, 42, '调用次数相加')
  eq(merged.realTokens, 13000, 'Tokens 相加')
  near(merged.subEquivalent, 2, '订阅等效相加')
  eq(merged.subCalls, 3, '订阅调用相加')
  near(merged.today.real, 0.75, '今日相加')
  near(merged.month.real, 4.75, '本月相加')
  near(merged.all.real, 49, '全时段相加（40 + 9）')
  eq(merged.all.subCalls, 18, '全时段订阅调用相加')
  near(merged.peakCost, 2.5, '高峰期相加')
  near(merged.offCost, 2.25, '闲时相加')
  eq(merged.source, 'merged', '标记为合并数据源')
  eq(merged.devices.length, 1, '带上其他设备清单')
  eq(merged.sources.length, 1, '带上其他 Agent 清单')
  eq(merged.asOf, 1789392645019, '带上云端数据时间戳')
}

// ---------- 4. 日期并集：本地与云端日期不同也能拼上 ----------
{
  const merged = mergeDash(localDash(), cloudDash())
  eq(merged.byDay.map(d => d.date).join(','), '2026-09-10,2026-09-11,2026-09-12', '按日期升序并集')
  const d11 = merged.byDay.find(d => d.date === '2026-09-11')
  near(d11.peak, 1.5, '同一天高峰期相加（1 + 0.5）')
  near(d11.off, 1.5, '同一天闲时相加（1 + 0.5）')
  const d12 = merged.byDay.find(d => d.date === '2026-09-12')
  near(d12.off, 0.25, '仅云端存在的日期保留')
  const daySum = merged.byDay.reduce((s, d) => s + d.peak + d.off + d.flat, 0)
  near(daySum, merged.realCost, '按天合计 = 区间合计（口径自洽）')
}

// ---------- 5. 模型维度：同名模型合并，异名模型并列且按费用降序 ----------
{
  const merged = mergeDash(localDash(), cloudDash())
  eq(merged.byModel.length, 2, '两个模型')
  eq(merged.byModel[0].model, 'deepseek-official/deepseek-v4.1-flash', '费用高的排前')
  near(merged.byModel[0].cost, 4.25, '同名模型费用相加（3.5 + 0.75）')
  eq(merged.byModel[0].calls, 38, '同名模型调用相加')
  near(merged.byModel[1].cost, 0.5, '其他 Agent 的模型单独一行')
  const modelSum = merged.byModel.reduce((s, m) => s + m.cost, 0)
  near(modelSum, merged.realCost, '模型合计 = 区间合计')
}

// ---------- 6. byModelDay：按日期并集补齐，保证图表不缺口 ----------
{
  const merged = mergeDash(localDash(), cloudDash())
  const m = merged.byModelDay.find(x => x.model === 'deepseek-official/deepseek-v4.1-flash')
  eq(m.days.length, merged.byDay.length, '每个模型的天数 = 日期并集长度')
  const cell11 = m.days.find(d => d.date === '2026-09-11')
  eq(cell11.calls, 23, '9/11 调用相加（15 + 8）')
  near(cell11.cost, 2.75, '9/11 费用相加（2 + 0.75）')
  const cell12 = m.days.find(d => d.date === '2026-09-12')
  eq(cell12.calls, 0, '无数据的日期补 0（不缺口）')
}

// ---------- 7. recent 拼接与来源标记 ----------
{
  const merged = mergeDash(localDash(), cloudDash())
  eq(merged.recent.length, 2, '最近记录拼接')
  ok(merged.recent.some(r => r.model === 'cloud-1'), '包含云端记录')
  ok(merged.recent.some(r => r.model === 'local-1'), '包含本机记录')
}

// ---------- 8. 容错：单边缺失时退化为可用数据 ----------
{
  const l = localDash()
  eq(mergeDash(l, null), l, '云端缺失 → 原样返回本地')
  const c = cloudDash()
  eq(mergeDash(null, c), c, '本地缺失 → 原样返回云端')
  // 云端字段缺 today/month/all 时不抛异常
  const partial = mergeDash(localDash(), { ok: true, realCost: 1 })
  near(partial.realCost, 4.5, '部分字段也能相加')
  ok(partial.today && typeof partial.today.real === 'number', '缺 today 时不炸')
  // 空对象
  const empty = mergeDash({}, {})
  eq(empty.realCost, 0, '全空不抛异常')
}

// ---------- 9. 仅本机视图：不经过合并，数字逐项不变 ----------
{
  const l = localDash()
  const snapshot = JSON.stringify(l)
  const view = 'local'
  const viewDash = view === 'local' ? l : mergeDash(l, cloudDash())
  eq(viewDash, l, '仅本机视图直接复用本地对象（口径零改动）')
  eq(JSON.stringify(l), snapshot, '本地数据未被就地修改')
}

// ---------- 10. slice 相加工具 ----------
{
  const a = addSlice({ real: 1, calls: 2, tokens: 3, sub: 4, subCalls: 5, subTokens: 6 }, { real: 0.5 })
  near(a.real, 1.5, 'addSlice 实数相加')
  eq(a.calls, 2, 'addSlice 缺字段按 0')
  eq(a.subTokens, 6, 'addSlice 保留原值')
  eq(zeroSlice().real, 0, 'zeroSlice 全 0')
  eq(addSlice(null, null).real, 0, 'addSlice 容忍 null')
}

if (failures) {
  console.error('\n' + passed.length + ' passed, ' + failures + ' failed')
  process.exit(1)
}
console.log(passed.length + ' passed, 0 failed')
