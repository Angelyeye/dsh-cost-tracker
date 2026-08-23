// ============================================================
// dsh-cost-tracker 定价 / Token 层测试（零依赖，直接 node 运行）
//   node test/pricing.test.js
// 覆盖：视觉模型单价、峰谷边界、真实 API 用量计费、缓存命中、
//       token 归一化（含图片 token）、既有模型回归
// ============================================================
import {
  EXACT_MODELS, PROVIDER_RATES, SUBSCRIPTION_RATES, GENERIC_RATES,
  PEAK_WINDOWS, VISION_MODEL, VISION_IMAGE_MAX_TOKENS,
  isPeak, peakPhaseAt, priceFor, computeCost, normalizeTokens,
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

// ---------- 1. 视觉模型精确单价 ----------
{
  const p = priceFor('deepseek', VISION_MODEL)
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
  const flash = priceFor('deepseek', 'deepseek-v4-flash')
  ok(flash.estimated === false && flash.tiered === true, '回归: flash 精确峰谷')
  approx(flash.rates.input, 3.0, '回归: flash 输入')
  const pro = priceFor('deepseek', 'deepseek-v4-pro')
  approx(pro.rates.input, 9.0, '回归: pro 输入')
  approx(pro.rates.output, 27.0, '回归: pro 输出')
  // provider 兜底（估算）
  const unk = priceFor('deepseek', 'deepseek-unknown-model')
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
  ok(PEAK_WINDOWS === '周一至周五 9:00-12:00 · 14:00-18:00（周末全天闲时）', '回归: 峰谷窗口文案')
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

// ---------- 7. index.js 仍可加载（含 pricing 导入） ----------
{
  const mod = await import('../index.js')
  ok(mod.default && mod.default.name === 'cost-tracker', 'index.js: 默认导出插件对象')
}

console.log('\n' + passed.length + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
