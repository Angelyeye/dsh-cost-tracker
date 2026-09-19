// ============================================================
// dsh-cost-tracker 定价 / Token 层测试（零依赖，直接 node 运行）
//   node test/pricing.test.js
// 覆盖：视觉模型单价、峰谷边界、真实 API 用量计费、缓存命中、
//       token 归一化（含图片 token）、既有模型回归、
//       **计费时代（V4.1 Flash 新价）分版与模型路由**
//
// 注意：单价表按时间分版（PRICE_ERAS），本文件所有涉及单价的断言都显式传入
// 时间戳（LEGACY_TS / V41_TS），不依赖「现在几点」，避免跨 2026-09-10 12:00
// 价格切换后测试结果随运行时刻漂移。
// ============================================================
import {
  EXACT_MODELS, PRICE_ERAS, V41_EFFECTIVE_AT, V41_FLASH_MODEL,
  PROVIDER_RATES, SUBSCRIPTION_RATES, GENERIC_RATES,
  PEAK_WINDOWS, VISION_MODEL, VISION_IMAGE_MAX_TOKENS,
  CN_HOLIDAYS, isPeak, peakPhaseAt, priceFor, computeCost, normalizeTokens,
  eraAt, exactModelsAt, resolveModelInEra, normalizeModelName,
  subscriptionPlanFor, VOLCENGINE_PLAN_PROVIDER_KEYS, VOLCENGINE_PLAN_RATES,
  setPeakHolidays, getPeakHolidays, holidayKeyAt, isCnHoliday, normalizeHolidayList,
} from '../pricing.js'

let failures = 0
const passed = []
function ok(cond, msg) {
  if (cond) passed.push(msg)
  else { failures += 1; console.error('FAIL: ' + msg) }
}
function approx(a, b, msg) {
  const d = Math.abs(a - b)
  ok(d < 1e-9, `${msg} (${a} ≈ ${b})`)
}

// 北京时间辅助：构造 UTC+8 某时刻的 epoch ms
function bj(y, mo, d, h, mi) { return Date.UTC(y, mo - 1, d, h - 8, mi) }

// 价格时代取样点：旧价（2026-08-21 周五 10:00 高峰） / 新价（2026-09-11 周五 10:00 高峰）
const LEGACY_TS = bj(2026, 8, 21, 10, 0)
const V41_TS = bj(2026, 9, 11, 10, 0)
// 新价时代的后期取样点（2026-09-15 周二 10:00 高峰）——用于验证 V4-Pro 不路由
const V41_PRO_TS = bj(2026, 9, 15, 10, 0)
// 切换瞬间：2026-09-10 12:00（北京时间，V4.1 Flash 调价生效）
const SWITCH_TS = V41_EFFECTIVE_AT
// 曾被误当作「V4-Pro 路由时刻」的边界：北京时间 2026-09-14 12:00（官方其后撤销了下线计划）
const PRO_PLAN_REVOKED_TS = Date.UTC(2026, 8, 14, 4, 0, 0)

// ---------- 1. 视觉模型精确单价 ----------
{
  const p = priceFor('deepseek', VISION_MODEL, LEGACY_TS)
  ok(p.estimated === false, '视觉模型: 精确计价（非估算）')
  ok(p.subscription === false, '视觉模型: 非订阅')
  ok(p.tiered === true, '视觉模型: 峰谷计价')
  approx(p.rates.input, 3.0, '视觉模型: 输入（缓存未命中）高峰 3.0')
  approx(p.rates.output, 9.0, '视觉模型: 输出高峰 9.0')
  approx(p.rates.cacheRead, 0.10, '视觉模型: 缓存命中 0.10')
  approx(p.rates.cacheWrite, 0.10, '视觉模型: 缓存写入 0.10（按命中价计）')
  ok(EXACT_MODELS[VISION_MODEL] !== undefined, '视觉模型: 在精确单价表中')
  ok(VISION_IMAGE_MAX_TOKENS === 384, '视觉模型: 每张图片 token 上限 384')
}

// ---------- 2. 峰谷时段边界（北京时间，仅周一至周五为高峰；周末全天空闲） ----------
{
  // 2026-08-21 是周五 —— 高峰窗口边界
  ok(isPeak(bj(2026, 8, 21, 8, 59)) === false, '峰谷: 周五 08:59 空闲')
  ok(isPeak(bj(2026, 8, 21, 9, 0)) === true, '峰谷: 周五 09:00 高峰')
  ok(isPeak(bj(2026, 8, 21, 11, 59)) === true, '峰谷: 周五 11:59 高峰')
  ok(isPeak(bj(2026, 8, 21, 12, 0)) === false, '峰谷: 周五 12:00 空闲')
  ok(isPeak(bj(2026, 8, 21, 13, 59)) === false, '峰谷: 周五 13:59 空闲')
  ok(isPeak(bj(2026, 8, 21, 14, 0)) === true, '峰谷: 周五 14:00 高峰')
  ok(isPeak(bj(2026, 8, 21, 17, 59)) === true, '峰谷: 周五 17:59 高峰')
  ok(isPeak(bj(2026, 8, 21, 18, 0)) === false, '峰谷: 周五 18:00 空闲')
  ok(isPeak(bj(2026, 8, 21, 1, 30)) === false, '峰谷: 周五凌晨空闲')
  // 周末全天计为闲时（2026-08-22 周六 / 2026-08-23 周日）
  ok(isPeak(bj(2026, 8, 22, 9, 0)) === false, '峰谷: 周六 09:00 空闲（周末全天空闲）')
  ok(isPeak(bj(2026, 8, 22, 14, 0)) === false, '峰谷: 周六 14:00 空闲（周末全天空闲）')
  ok(isPeak(bj(2026, 8, 23, 9, 0)) === false, '峰谷: 周日 09:00 空闲（周末全天空闲）')
  ok(isPeak(bj(2026, 8, 23, 17, 59)) === false, '峰谷: 周日 17:59 空闲（周末全天空闲）')
}

// ---------- 2b. 峰谷相位与倒计时（peakPhaseAt） ----------
{
  // 工作日高峰中：下一切换点 = 当日 12:00 转谷
  let p = peakPhaseAt(bj(2026, 8, 21, 10, 30))
  ok(p !== null && p.inPeak === true && p.weekend === false, '相位: 周五 10:30 高峰')
  ok(p.nextAtMs === bj(2026, 8, 21, 12, 0) && p.nextIntoPeak === false, '相位: 周五 10:30 下一切换 = 12:00 转谷')
  // 工作日谷段（12:00-14:00）：下一切换 = 当日 14:00 转峰
  p = peakPhaseAt(bj(2026, 8, 21, 13, 0))
  ok(p !== null && p.inPeak === false, '相位: 周五 13:00 谷段')
  ok(p.nextAtMs === bj(2026, 8, 21, 14, 0) && p.nextIntoPeak === true, '相位: 周五 13:00 下一切换 = 14:00 转峰')
  // 工作日傍晚（18:00 后）：跨周末，下一转峰 = 下周一 09:00
  p = peakPhaseAt(bj(2026, 8, 21, 19, 0))
  ok(p !== null && p.inPeak === false, '相位: 周五 19:00 谷段')
  ok(p.nextAtMs === bj(2026, 8, 24, 9, 0) && p.nextIntoPeak === true, '相位: 周五 19:00 跨周末 → 下周一 09:00 转峰')
  // 周六：周末全谷价，下一转峰 = 下周一 09:00
  p = peakPhaseAt(bj(2026, 8, 22, 10, 0))
  ok(p !== null && p.weekend === true && p.inPeak === false, '相位: 周六 10:00 周末全谷价')
  ok(p.nextAtMs === bj(2026, 8, 24, 9, 0) && p.nextIntoPeak === true, '相位: 周六 10:00 下一切换 = 下周一 09:00 转峰')
  // 周日同理
  p = peakPhaseAt(bj(2026, 8, 23, 15, 0))
  ok(p !== null && p.weekend === true && p.nextAtMs === bj(2026, 8, 24, 9, 0), '相位: 周日 15:00 周末全谷价')
  // 非法输入 → null
  ok(peakPhaseAt(NaN) === null, '相位: 非法时刻返回 null')
}

// ---------- 2c. 法定节假日（官方口径：节假日全天计入空闲时段） ----------
// 官方价目页脚注 (2)：「北京时间周一至周五（**不含中国法定节假日**）9:00-12:00、
// 14:00-18:00 为高峰时段；其余时段，包括周末及中国法定节假日全天均为空闲时段。」
// 内置表来源：国办发明电〔2025〕7 号（2026 年放假安排）。
{
  ok(CN_HOLIDAYS.length >= 30, '节假日: 内置表含 2026 全年放假日（≥30 天）')
  ok(CN_HOLIDAYS.indexOf('2026-10-01') >= 0 && CN_HOLIDAYS.indexOf('2026-02-17') >= 0, '节假日: 含国庆与春节')
  ok(CN_HOLIDAYS.indexOf('2026-10-08') < 0, '节假日: 节后首日（10-08）不是假日')

  // holidayKeyAt：按北京日历日切分（UTC 边界附近不漂移）
  ok(holidayKeyAt(bj(2026, 10, 1, 0, 0)) === '2026-10-01', '节假日: 北京 00:00 属当日')
  ok(holidayKeyAt(bj(2026, 10, 1, 23, 59)) === '2026-10-01', '节假日: 北京 23:59 仍属当日')
  ok(holidayKeyAt(Date.UTC(2026, 8, 30, 16, 0)) === '2026-10-01', '节假日: UTC 09-30T16:00 = 北京 10-01 00:00')
  ok(isCnHoliday(bj(2026, 10, 1, 10, 0)) === true, '节假日: 10-01 认定为法定节假日')
  ok(isCnHoliday(bj(2026, 10, 8, 10, 0)) === false, '节假日: 10-08 非节假日')

  // 节假日落在工作日：峰段也必须按闲时
  ok(isPeak(bj(2026, 9, 24, 10, 0)) === true, '节假日: 节前平日 09-24 周四 10:00 = 高峰')
  ok(isPeak(bj(2026, 9, 25, 10, 0)) === false, '节假日: 中秋 09-25 周五 10:00 = 闲时')
  ok(isPeak(bj(2026, 10, 1, 10, 0)) === false, '节假日: 国庆 10-01 周四 10:00 = 闲时')
  ok(isPeak(bj(2026, 10, 5, 15, 0)) === false, '节假日: 国庆 10-05 周一 15:00 = 闲时')
  ok(isPeak(bj(2026, 10, 8, 10, 0)) === true, '节假日: 节后 10-08 周四 10:00 = 高峰')
  ok(isPeak(bj(2026, 2, 16, 10, 0)) === false, '节假日: 春节 02-16 周一 10:00 = 闲时')
  ok(isPeak(bj(2026, 6, 19, 14, 30)) === false, '节假日: 端午 06-19 周五 14:30 = 闲时')
  // 调休补班的周六/周日不计高峰（定价规则只看「周一至周五」）
  ok(isPeak(bj(2026, 5, 9, 10, 0)) === false, '节假日: 调休上班的周六 05-09 10:00 = 闲时')

  // 节假日相位：全天谷价 + 下一切换点为节后首个工作日峰起点 + 连休起点
  let p = peakPhaseAt(bj(2026, 10, 5, 10, 0))
  ok(p !== null && p.allDayOff === true && p.holiday === true && p.weekend === false && p.inPeak === false, '节假日相位: 10-05 国庆中 = 全谷价（holiday）')
  ok(p.nextAtMs === bj(2026, 10, 8, 9, 0) && p.nextIntoPeak === true, '节假日相位: 下一切换 = 节后 10-08 09:00 转峰')
  ok(p.prevAtMs === bj(2026, 10, 1, 0, 0), '节假日相位: 连休起点 = 10-01 00:00')
  // 超长连休（春节 9 天）也能跨过去找到下一切换点
  p = peakPhaseAt(bj(2026, 2, 16, 10, 0))
  ok(p !== null && p.nextAtMs === bj(2026, 2, 24, 9, 0), '节假日相位: 春节 02-16 → 下一切换 = 02-24 09:00')
  // 假期最后一天的傍晚起算，同样指向节后首个工作日
  p = peakPhaseAt(bj(2026, 10, 7, 19, 0))
  ok(p !== null && p.allDayOff === true && p.nextAtMs === bj(2026, 10, 8, 9, 0), '节假日相位: 假期最后一天傍晚 → 10-08 09:00')

  // 覆盖语义：空串 = 内置；'none' = 停用；自定义列表 = 整体替换
  ok(getPeakHolidays().mode === 'builtin' && getPeakHolidays().builtin === true, '节假日配置: 默认用内置表')
  let r = setPeakHolidays('none')
  ok(r.mode === 'disabled' && r.count === 0, '节假日配置: none = 停用')
  ok(isPeak(bj(2026, 10, 1, 10, 0)) === true, '节假日配置: 停用后国庆又按高峰计')
  r = setPeakHolidays('2026-12-31, 2027/1/1 2027-1-2 乱七八糟 2027-13-01')
  ok(r.mode === 'custom' && r.count === 3, '节假日配置: 自定义列表归一化（3 条有效）')
  ok(r.dates[0] === '2026-12-31' && r.dates[1] === '2027-01-01' && r.dates[2] === '2027-01-02', '节假日配置: 排序 + 补零 + 斜杠写法归一')
  ok(r.invalid.length === 2 && r.invalid[0] === '乱七八糟', '节假日配置: 如实报告被忽略的条目')
  ok(isPeak(bj(2026, 10, 1, 10, 0)) === true, '节假日配置: 自定义列表整体替换（国庆不再是假日）')
  ok(isPeak(bj(2027, 1, 1, 10, 0)) === false, '节假日配置: 自定义的 2027-01-01 生效')
  r = setPeakHolidays('')
  ok(r.mode === 'builtin' && r.count === CN_HOLIDAYS.length, '节假日配置: 空串恢复内置表')
  ok(isPeak(bj(2026, 10, 1, 10, 0)) === false, '节假日配置: 恢复后国庆重新按闲时计')
  ok(normalizeHolidayList(['2026-1-5', '2026-01-05', 'bad']).length === 1, '节假日配置: 数组去重')
  setPeakHolidays('') // 收尾：恢复默认，避免影响后续断言
}

// ---------- 3. 真实 API 用量计费（视觉调用实测 usage） ----------
// 实测：deepseek-v4-flash-vision-exp + 2 张图片（1x1 + 1600x1200）
//   prompt_tokens=555（含图片 token）, completion_tokens=32, cached=0
{
  const t = { input: 555, output: 32, cacheRead: 0, cacheWrite: 0 }
  const rates = EXACT_MODELS[VISION_MODEL]
  approx(computeCost(rates, true, true, t), 0.001953, '视觉实测: 高峰价 555×3 + 32×9 = ¥0.001953')
  approx(computeCost(rates, true, false, t), 0.0009765, '视觉实测: 空闲价半价 = ¥0.0009765')
}

// ---------- 4. 缓存命中计费 ----------
{
  const t = { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0 }
  const rates = EXACT_MODELS[VISION_MODEL]
  const expectPeak = (1000 * 3.0 + 500 * 9.0 + 2000 * 0.10) / 1e6 // 0.0077
  approx(computeCost(rates, true, true, t), expectPeak, '缓存: 高峰命中计费')
  approx(computeCost(rates, true, false, t), expectPeak / 2, '缓存: 空闲半价')
  // 非峰谷模型（如 openai 兜底）不半价
  const o = PROVIDER_RATES.openai
  approx(computeCost(o.rates, false, false, t), computeCost(o.rates, false, true, t), '缓存: 非峰谷模型不分时段')
}

// ---------- 5. token 归一化（含图片 token 并入输入） ----------
{
  const n = normalizeTokens({ inputTokens: 555, outputTokens: 32, cacheReadTokens: 0 })
  ok(n.input === 555 && n.output === 32 && n.cacheRead === 0 && n.cacheWrite === 0, '归一化: 常规 usage')
  // 预留：若未来 DSH 单独上报 imageTokens，并入输入避免漏计
  const m = normalizeTokens({ inputTokens: 100, imageTokens: 384, outputTokens: 50, cacheReadTokens: 20, cacheWriteTokens: 10 })
  ok(m.input === 484 && m.cacheRead === 20 && m.cacheWrite === 10, '归一化: imageTokens 并入输入')
  // 缺字段容错
  const z = normalizeTokens({})
  ok(z.input === 0 && z.output === 0 && z.cacheRead === 0 && z.cacheWrite === 0, '归一化: 空 usage 为 0')
  // 视觉调用（图片 token 已在 inputTokens 内）→ 费用与实测一致
  approx(computeCost(EXACT_MODELS[VISION_MODEL], true, true, normalizeTokens({ inputTokens: 555, outputTokens: 32 })), 0.001953, '归一化+计费: 视觉调用端到端')
}

// ---------- 6. 既有模型回归 ----------
{
  const flash = priceFor('deepseek', 'deepseek-v4-flash', LEGACY_TS)
  ok(flash.estimated === false && flash.tiered === true, '回归: flash 精确峰谷')
  approx(flash.rates.input, 3.0, '回归: flash 输入')
  const pro = priceFor('deepseek', 'deepseek-v4-pro', LEGACY_TS)
  approx(pro.rates.input, 9.0, '回归: pro 输入')
  approx(pro.rates.output, 27.0, '回归: pro 输出')
  // provider 兜底（估算）
  const unk = priceFor('deepseek', 'deepseek-unknown-model', LEGACY_TS)
  ok(unk.estimated === true && unk.tiered === true, '回归: deepseek 未知模型走兜底估算')
  // 订阅（DSH 实际上报 provider 名为 kimi；kimi-coding 为别名形式）
  const kimi = priceFor('kimi', 'kimi-k3')
  ok(kimi.subscription === true && kimi.estimated === true && kimi.tiered === false, '回归: kimi 订阅等效（实际上报名）')
  const kimi2 = priceFor('kimi-coding', 'kimi-k3')
  ok(kimi2.subscription === true && kimi2.estimated === true && kimi2.tiered === false, '回归: kimi-coding 订阅等效（别名形式）')
  // 未知 provider → generic
  const g = priceFor('weird-provider', 'x')
  ok(g.estimated === true && g.rates === GENERIC_RATES, '回归: 未知 provider 用 generic')
  // 本地模型 0 元
  const lo = priceFor('ollama', 'llama3')
  approx(computeCost(lo.rates, false, true, { input: 99999, output: 99999, cacheRead: 0, cacheWrite: 0 }), 0, '回归: 本地模型计 0')
  ok(PEAK_WINDOWS === '周一至周五 9:00-12:00 · 14:00-18:00（周末与法定节假日全天闲时）', '回归: 峰谷窗口文案')
  ok(SUBSCRIPTION_RATES['kimi-coding'] !== undefined && SUBSCRIPTION_RATES.kimi !== undefined, '回归: 订阅表存在（两个键）')
}

// ---------- 6b. 缓存写入按命中价计（官方规则对齐） ----------
{
  const rates = EXACT_MODELS['deepseek-v4-flash']
  // 缓存写入 token 与缓存命中 token 同价（均为 0.10），不再是未命中价 3.0
  ok(rates.cacheWrite === rates.cacheRead, '缓存写入: flash cacheWrite === cacheRead（命中价）')
  ok(rates.cacheWrite === 0.10, '缓存写入: flash cacheWrite = 0.10（命中价，非 3.0）')
  ok(EXACT_MODELS['deepseek-v4-pro'].cacheWrite === 0.30, '缓存写入: pro cacheWrite = 0.30（命中价）')
  // 计费：输入 1000×3 + 输出 500×9 + (读 2000 + 写 3000)×0.10，高峰
  const t = { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 3000 }
  const expectPeak = (1000 * 3.0 + 500 * 9.0 + (2000 + 3000) * 0.10) / 1e6 // (3000+4500+500)/1e6 = 0.008
  approx(computeCost(rates, true, true, t), expectPeak, '缓存写入: 读写都按命中价计（高峰）')
  approx(computeCost(rates, true, false, t), expectPeak / 2, '缓存写入: 空闲半价')
}

// ---------- 6c. reasoning token 归一化与计费 ----------
{
  const n = normalizeTokens({ inputTokens: 10, outputTokens: 20, reasoningTokens: 30 })
  ok(n.reasoning === 30, '归一化: reasoningTokens 归一')
  // 模型带 reasoning 单价时才计费
  const r = EXACT_MODELS['deepseek-v4-flash']
  approx(computeCost(r, true, true, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 1000000 }), 0, '计费: 无 reasoning 单价 → 计 0')
  const withR = { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, reasoning: 1 }
  approx(computeCost({ input: 3, output: 9, cacheRead: 0.10, cacheWrite: 0.10, reasoning: 4 }, true, true, withR), (1 * 3 + 1 * 9 + 0 + 1 * 4) / 1e6, '计费: 有 reasoning 单价按单价计')
}

// ---------- 6d. 计费时代（V4.1 Flash 新价）分版 ----------
{
  // 切换时刻：北京时间 2026-09-10 12:00 = 2026-09-10T04:00:00Z
  ok(V41_EFFECTIVE_AT === Date.UTC(2026, 9 - 1, 10, 4, 0, 0), '时代: V41 生效时刻 = 2026-09-10 12:00 北京')
  // v1.9.2：官方撤销 V4-Pro 下线计划后，09-14 12:00 不再有任何口径变化 —— 时代只剩两版
  ok(PRICE_ERAS.length === 2, '时代: 共两版价格（legacy / v41）')
  ok(PRICE_ERAS[0].id === 'legacy' && PRICE_ERAS[1].id === 'v41', '时代: 顺序为 legacy → v41')

  // eraAt：切换前一夜仍是 legacy，切换瞬间起为 v41（09-14 前后同属 v41）
  ok(eraAt(SWITCH_TS - 1).id === 'legacy', '时代: 11:59:59.999 仍为旧价')
  ok(eraAt(SWITCH_TS).id === 'v41', '时代: 12:00:00.000 起为新价')
  ok(eraAt(V41_TS).id === 'v41', '时代: 切换后为新价')
  ok(eraAt(V41_PRO_TS).id === 'v41', '时代: 09-14 之后仍为 v41（无第三时代）')
  ok(eraAt(PRO_PLAN_REVOKED_TS - 1).id === 'v41', '时代: 09-14 12:00 前一毫秒 = v41')
  ok(eraAt(PRO_PLAN_REVOKED_TS).id === 'v41', '时代: 09-14 12:00 整点 = v41（撤销后无边界）')
  ok(exactModelsAt(SWITCH_TS - 1) === EXACT_MODELS, '时代: 切换前精确表 = 旧表')
  ok(exactModelsAt(SWITCH_TS)[V41_FLASH_MODEL].input === 2.0, '时代: 切换后精确表 = V4.1 Flash 表')

  // 官方现役模型名：deepseek-flash（价格卡脚注 (1)「模型名请使用 deepseek-flash」）
  ok(V41_FLASH_MODEL === 'deepseek-flash', '时代: 规范模型名 = 官方现役名 deepseek-flash')
  const cur = priceFor('deepseek', 'deepseek-flash', V41_TS)
  ok(cur.estimated === false, '现役名: deepseek-flash 命中精确档（非兜底估算）')
  ok(cur.model === 'deepseek-flash', '现役名: 以 deepseek-flash 入账')
  const alias = priceFor('deepseek', 'deepseek-v4.1-flash', V41_TS)
  ok(alias.estimated === false && alias.model === V41_FLASH_MODEL, '现役名: deepseek-v4.1-flash 归一化后命中同一档')

  // V4.1 Flash 官方价（高峰）：命中 0.04 / 未命中 2 / 输出 8
  const f = priceFor('deepseek', V41_FLASH_MODEL, V41_TS)
  ok(f.estimated === false && f.subscription === false && f.tiered === true, 'V4.1: 精确峰谷计价')
  approx(f.rates.input, 2.0, 'V4.1: 输入（缓存未命中）高峰 2.0')
  approx(f.rates.cacheRead, 0.04, 'V4.1: 输入（缓存命中）高峰 0.04')
  approx(f.rates.output, 8.0, 'V4.1: 输出高峰 8.0')
  approx(f.rates.cacheWrite, 0.04, 'V4.1: 缓存写入按命中价 0.04')

  // 空闲时段恰好半价（12:00-14:00 谷段）
  const off = priceFor('deepseek', V41_FLASH_MODEL, bj(2026, 9, 11, 12, 30))
  const tt = { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0 }
  approx(computeCost(off.rates, true, false, tt), computeCost(off.rates, true, true, tt) / 2, 'V4.1: 空闲时段半价')
}

// ---------- 6e. V4-Pro 维持自有牌价（官方 2026-09-14 撤销下线计划，**不做路由**） ----------
// 依据：官方更新日志「为响应广大用户的需求，我们决定在 2026 年 9 月 14 日之后继续提供
// DeepSeek V4 Pro 的 API 调用服务，计费方式保持不变」，且现行价目页仍为 V4-Pro 单列价格
// （9.0/27.0/0.30）与独立并发（500，Flash 为 2500）；脚注只把旧 Flash 名路由到 deepseek-flash。
// v1.9.0/1.9.1 曾按 09-10 新闻稿预告实现 pro → Flash 路由，会把 pro 调用按 Flash 价计（低估）。
{
  // 旧时代：V4-Pro 独立计价
  const proOld = priceFor('deepseek', 'deepseek-v4-pro', LEGACY_TS)
  ok(proOld.model === 'deepseek-v4-pro' && proOld.era === 'legacy', 'V4-Pro: 旧时代不路由（自有名入账）')
  approx(proOld.rates.input, 9.0, 'V4-Pro: 旧时代输入价 9.0')

  // 新价时代的各个时点（含曾被误当边界的 09-14 12:00 前后）：一律维持自有牌价
  const points = [
    ['09-11 10:00', V41_TS],
    ['09-14 11:59:59.999', PRO_PLAN_REVOKED_TS - 1],
    ['09-14 12:00:00.000', PRO_PLAN_REVOKED_TS],
    ['09-15 10:00', V41_PRO_TS],
  ]
  for (const [label, ts] of points) {
    const p = priceFor('deepseek', 'deepseek-v4-pro', ts)
    ok(p.model === 'deepseek-v4-pro', 'V4-Pro: ' + label + ' 不路由（仍以自有名入账）')
    ok(p.estimated === false && p.era === 'v41', 'V4-Pro: ' + label + ' 命中精确档（era=v41）')
    approx(p.rates.input, 9.0, 'V4-Pro: ' + label + ' 输入价 9.0')
    approx(p.rates.output, 27.0, 'V4-Pro: ' + label + ' 输出价 27.0')
    approx(p.rates.cacheRead, 0.30, 'V4-Pro: ' + label + ' 命中价 0.30')
  }

  // 结构断言：任何时代都不得给 deepseek-v4-pro 配路由（防回归）
  for (const era of PRICE_ERAS) {
    ok(!(era.routes || {})['deepseek-v4-pro'], 'V4-Pro: 时代 ' + era.id + ' 无反向路由')
    ok(!!(era.models || {})['deepseek-v4-pro'], 'V4-Pro: 时代 ' + era.id + ' 保留自有牌价')
  }

  // 计费效果：同一批 token，pro 自有价必须显著高于 Flash 价（值 4.5× / 3.375×），
  // 若哪天又被路由回 Flash，这条会立刻失败。
  const tk = { input: 100000, output: 6000, cacheRead: 20000, cacheWrite: 0 }
  const pro = priceFor('deepseek', 'deepseek-v4-pro', V41_PRO_TS)
  const flash = priceFor('deepseek', 'deepseek-flash', V41_PRO_TS)
  const proCost = computeCost(pro.rates, true, true, tk)
  const flashCost = computeCost(flash.rates, true, true, tk)
  // 100000×9 + 6000×27 + 20000×0.30 = 1,068,000 /1e6
  approx(proCost, 1.068, 'V4-Pro: 10万+6千+2万 高峰 = ¥1.068（自有牌价）')
  approx(flashCost, 0.2488, 'V4-Pro: 同量按 Flash 价 = ¥0.2488（对比用）')
  ok(proCost > flashCost * 4, 'V4-Pro: 自有价显著高于 Flash 价（不再低估）')

  // 旧 V4-Flash 系（含视觉版）自 9-10 12:00 起仍被 V4.1 Flash 取代（官方脚注 (1) 未变）
  for (const m of ['deepseek-v4-flash', VISION_MODEL]) {
    const p = priceFor('deepseek', m, V41_TS)
    ok(p.model === V41_FLASH_MODEL, '路由: ' + m + ' → V4.1 Flash 入账')
    approx(p.rates.input, 2.0, '路由: ' + m + ' 输入价 2.0')
  }

  // 路由只作用于对应模型名，不误伤其它模型
  const unknown = priceFor('deepseek', 'deepseek-v4-pro-max', V41_TS)
  ok(unknown.estimated === true && unknown.model === 'deepseek-v4-pro-max', '路由: 相似名不误命中（走兜底估算）')

  // 同为 Flash 档的前后对比：旧 flash 3/9/0.10 → 新 2/8/0.04
  const flashNew = priceFor('deepseek', 'deepseek-v4-flash', V41_TS)
  const fb = computeCost(EXACT_MODELS['deepseek-v4-flash'], true, true, tk)
  const fa = computeCost(flashNew.rates, true, true, tk)
  approx(fb, 0.356, '路由: 旧 Flash 价同量 = ¥0.356')
  approx(fa, 0.2488, '路由: 新 Flash 价同量 = ¥0.2488（约 -30.1%）')
}

// ---------- 6f. 模型名归一化（v4.1 / v4-1 / v41 等等价写法） ----------
{
  ok(normalizeModelName('DeepSeek-V4.1-Flash') === normalizeModelName('deepseek-v4-1-flash'), '归一化: v4.1 ≡ v4-1')
  ok(normalizeModelName('deepseek_v41_flash') === normalizeModelName('deepseek-v4.1-flash'), '归一化: v41 ≡ v4.1')
  const era = eraAt(V41_TS)
  ok(resolveModelInEra(era, 'deepseek-flash') === 'deepseek-flash', '归一化: 官方现役名原样命中')
  ok(resolveModelInEra(era, 'DeepSeek-Flash') === 'deepseek-flash', '归一化: 大小写无关（DeepSeek-Flash）')
  for (const alias of ['deepseek-flash', 'deepseek-v4.1-flash', 'deepseek-v4-1-flash', 'deepseek-v41-flash', 'DeepSeek-V4.1-Flash', 'deepseek_v4.1_flash']) {
    ok(resolveModelInEra(era, alias) === V41_FLASH_MODEL, '归一化: 别名命中 V4.1 Flash 档 → ' + alias)
    const p = priceFor('deepseek', alias, V41_TS)
    ok(p.estimated === false, '归一化: 别名走精确档（非估算）→ ' + alias)
    approx(p.rates.input, 2.0, '归一化: 别名输入价 2.0 → ' + alias)
  }
  ok(resolveModelInEra(era, '') === null, '归一化: 空名不命中')
  ok(resolveModelInEra(null, 'x') === null, '归一化: 空 era 不命中')
  // 路由目标必须在目标时代单价表内，否则不生效（防止悬空路由）
  ok(resolveModelInEra({ models: {}, routes: { a: 'b' } }, 'a') === null, '归一化: 悬空路由不命中')
}

// ---------- 6g. 订阅门卫 + 火山方舟 Coding Plan（v1.8.14） ----------
// 这组断言拦的是「把按量调用错记成订阅」——一旦记错，金额会从「真实花费」
// 里消失，且原始记录被标成 subscription 后无法自动回滚。所以两个方向都要钉：
//   · 订阅调用**必须**被识别为 subscription（否则订阅费用混进真实花费）
//   · 同一 provider 下的按量调用**必须不**被识别（否则真实花费凭空缩水）
{
  // Kimi 回归：登记为「整档都是订阅」，任何模型名都算订阅（1.8.13 既有行为）
  for (const np of ['kimi', 'kimi-coding']) {
    for (const m of ['kimi-k3', 'kimi-k2.5', 'whatever']) {
      const p = priceFor(np, m, V41_TS)
      ok(p.subscription === true, '订阅回归: ' + np + '/' + m + ' 仍为订阅')
      approx(p.rates.input, 6.5, '订阅回归: ' + np + '/' + m + ' 输入价 6.5')
      ok(p.era === null, '订阅回归: ' + np + '/' + m + ' 不落在价格时代里')
    }
  }
  // -official 后缀由宿主 normProvider 剥离，这里直接验证已剥离的形态
  ok(priceFor('kimi-coding', 'kimi-k3', V41_TS).subscription === true, '订阅回归: kimi-coding-official 剥离后仍命中')

  // 专属 Coding Plan 端点：baseURL 指向 /api/coding/v3 的 provider 整档都是订阅，
  // 因此**不必**追模型日期后缀（用户实测 id 形如 glm-5-3-flash-260828）。
  for (const np of ['byteblus-coding-plan-cn', 'byteplus-coding-plan-cn', 'volcengine-coding', 'volcengine-plan']) {
    for (const m of ['glm-5-3-flash-260828', 'deepseek-v4-1-flash-260910', 'doubao-seed-2-1-pro-260915', '未来新模型']) {
      const p = priceFor(np, m, V41_TS)
      ok(p.subscription === true, '火山专属端点: ' + np + '/' + m + ' 计为订阅')
      approx(p.rates.input, 3.0, '火山专属端点: ' + np + '/' + m + ' 输入价 3.0')
      ok(p.estimated === true, '火山专属端点: ' + np + '/' + m + ' 标为估算（等效参考，非真实扣费）')
    }
  }

  // 泛 volcengine：套餐内外的模型**混在同一个 provider 下**，必须靠模型白名单区分
  for (const m of ['ark-code-latest', 'Ark-Code-Latest', 'doubao-seed-code', 'kimi-k2.5', 'glm-5.1', 'deepseek-v4-pro', 'minimax-m2.5']) {
    ok(priceFor('volcengine', m, V41_TS).subscription === true, '火山白名单: ' + m + ' 计为订阅')
  }
  // 接入点 id（在线推理 = 按量）绝不能算成订阅
  for (const m of ['ep-20260413045435-2shmq', 'doubao-seed-2.0-pro-ep-123', 'some-unlisted-model']) {
    const p = priceFor('volcengine', m, V41_TS)
    ok(p.subscription === false, '火山白名单: ' + m + ' 不误判为订阅')
    ok(p.estimated === true, '火山白名单: ' + m + ' 走兜底估算')
  }

  // ark-code 前缀整族放行（方舟自动调度名会滚动升级，逐条登记必然过期）
  for (const m of ['ark-code-latest', 'ark-code-2027']) {
    ok(priceFor('volcengine', m, V41_TS).subscription === true, '火山前缀: ' + m + ' 整族放行')
  }

  // 非火山 provider 不受影响
  ok(priceFor('deepseek', 'deepseek-flash', V41_TS).subscription === false, '门卫: deepseek 不受影响')
  ok(priceFor('openai', 'gpt-5.6-luna', V41_TS).subscription === false, '门卫: openai 不受影响')

  // 订阅制的费用影响：同一批 token，订阅等效价应显著低于 V4.1 Flash 按量价
  const tk = { input: 100000, output: 6000, cacheRead: 20000, cacheWrite: 0 }
  const volc = priceFor('byteblus-coding-plan-cn', 'doubao-seed-2-1-pro-260915', V41_TS)
  const ds = priceFor('deepseek', 'deepseek-flash', V41_TS)
  const volcCost = computeCost(volc.rates, volc.tiered, false, tk)
  const dsCost = computeCost(ds.rates, ds.tiered, true, tk)
  ok(volcCost > 0 && dsCost > 0, '订阅计费: 两侧均为正数')
  ok(volc.tiered === false, '订阅计费: 订阅不分峰谷（tiered=false）')

  // 服务名/端点常量（签名正确性的外观断言；签名细节在 volcengine-plan.test.js）
  ok(typeof subscriptionPlanFor === 'function', '门卫: subscriptionPlanFor 已导出')
  ok(VOLCENGINE_PLAN_PROVIDER_KEYS.indexOf('volcengine') >= 0, '门卫: provider 别名含 volcengine')
  ok(VOLCENGINE_PLAN_RATES.input > 0, '门卫: 套餐单价表已导出')
}

// ---------- 7. index.js 仍可加载（含 pricing 导入） ----------
{
  const mod = await import('../index.js')
  ok(mod.default && mod.default.name === 'cost-tracker', 'index.js: 默认导出插件对象')
}

console.log('\n' + passed.length + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
