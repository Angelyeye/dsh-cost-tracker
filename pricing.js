// ============================================================
// DSH 花费统计插件 —— 定价与 Token 层（纯逻辑，可独立测试）
//
// 单价来源：DeepSeek 官方定价页
//   https://api-docs.deepseek.com/zh-cn/quick_start/pricing
//   - 高峰时段（北京时间周一至周五 9:00-12:00、14:00-18:00）为表内价格；
//     空闲时段 = 高峰 × 0.5。周末（周六/周日）全天计入空闲时段。
//   - deepseek-v4-flash-vision-exp 与 deepseek-v4-flash 单价一致
//     （输入缓存未命中 3.0 / 命中 0.10 / 输出 9.0，百万 tokens）
//
// 视觉模型 Token 规则：
//   https://api-docs.deepseek.com/zh-cn/guides/vision#token-usage
//   图片进入模型前按尺寸自动缩放（<384×384 放大、更大缩小至约 800×800），
//   每张图片换算 token 数存在上限（384 个），与文本 token 一并计费——
//   即包含在接口返回的 prompt_tokens 中，由 DSH 映射为 inputTokens，
//   插件按接口用量记账（接口用量为准，估算可能有误差）。
// ============================================================

/** 精确单价表（CNY / 1M tokens，高峰价；tiered=true 时空闲时段自动 ×0.5） */
export const EXACT_MODELS = {
  'deepseek-v4-flash': { input: 3.0, output: 9.0, cacheRead: 0.10, cacheWrite: 3.0 },
  'deepseek-v4-pro': { input: 9.0, output: 27.0, cacheRead: 0.30, cacheWrite: 9.0 },
  'deepseek-v4-flash-vision-exp': { input: 3.0, output: 9.0, cacheRead: 0.10, cacheWrite: 3.0 },
}

/**
 * 订阅套餐（等效费用估算，仅供参考）。
 * DSH 的 kimi provider 上报名为 'kimi'（模型 kimi-k3 等），
 * 'kimi-coding' 为别名形式（kimi-coding-official 归一化后形如 kimi-coding），
 * 两个键都命中，避免订阅调用被误计为按量估算。
 */
export const SUBSCRIPTION_RATES = {
  'kimi-coding': { input: 6.5, output: 27.0, cacheRead: 1.1, cacheWrite: 6.5 },
  kimi: { input: 6.5, output: 27.0, cacheRead: 1.1, cacheWrite: 6.5 },
}

/** Provider 兜底单价（估算） */
export const PROVIDER_RATES = {
  deepseek: { rates: { input: 3.0, output: 9.0, cacheRead: 0.10, cacheWrite: 3.0 }, tiered: true },
  openai: { rates: { input: 10.0, output: 30.0, cacheRead: 5.0, cacheWrite: 10.0 }, tiered: false },
  anthropic: { rates: { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 15.0 }, tiered: false },
  gemini: { rates: { input: 2.5, output: 10.0, cacheRead: 0.625, cacheWrite: 2.5 }, tiered: false },
  ollama: { rates: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tiered: false },
  local: { rates: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tiered: false },
}

/** 未知模型兜底单价（估算） */
export const GENERIC_RATES = { input: 2.0, output: 8.0, cacheRead: 0.5, cacheWrite: 2.0 }

/** 高峰时段（北京时间，仅周一至周五），空闲时段 = 高峰 × 0.5；周末全天空闲 */
export const PEAK_WINDOWS = '周一至周五 9:00-12:00 · 14:00-18:00（周末全天闲时）'

/** 视觉模型名（DeepSeek DeepSeek-V4-Flash-Vision-Exp） */
export const VISION_MODEL = 'deepseek-v4-flash-vision-exp'

/** 每张图片换算 token 的上限（官方规则） */
export const VISION_IMAGE_MAX_TOKENS = 384

/** 是否高峰时段（北京时间 UTC+8，仅周一至周五；周末全天空闲） */
export function isPeak(ts) {
  const d = new Date(ts + 28800000)
  const day = d.getUTCDay() // 0=周日 … 6=周六
  if (day === 0 || day === 6) return false // 周末不计高峰
  const h = d.getUTCHours()
  return (h >= 9 && h < 12) || (h >= 14 && h < 18)
}

/** 峰时段窗口（北京时间小时，半开区间 [start, end)）。 */
export const PEAK_HOUR_WINDOWS = [{ start: 9, end: 12 }, { start: 14, end: 18 }]

/**
 * 某一时刻所处的峰谷相位与相邻切换点（供时段条 / 倒计时 / 切换前弹窗）。
 * 与 isPeak 同口径（北京时间 UTC+8），并处理「周末全天谷价」：
 *  - 工作日：按峰窗口判定 inPeak，扫描前后 N 天收集切换点；
 *  - 周末：inPeak=false 且 weekend=true，日内无切换点（价格恒为谷），
 *    下一个价格切换点为下周一 09:00（首个峰窗口起点）。
 * @param {number} ts - epoch ms
 * @param {number} [spanDays=5] - 前后扫描天数（须覆盖最长周末间隔）
 * @returns {{inPeak:boolean, weekend:boolean, prevAtMs:number, nextAtMs:number,
 *            nextIntoPeak:boolean}|null} prevAtMs/nextAtMs 为相邻切换点 epoch ms
 */
export function peakPhaseAt(ts, spanDays) {
  if (!Number.isFinite(ts)) return null
  const SPAN = (Number.isFinite(spanDays) && spanDays >= 1) ? Math.floor(spanDays) : 5
  const DAY_MS = 86400000
  // 北京时间日 index 与星期（0=周日 … 6=周六；1970-01-01 为周四）。
  const D0 = Math.floor((ts + 28800000) / DAY_MS)
  const weekday = (D0 + 4) % 7
  const isWeekendNow = weekday === 6 || weekday === 0
  // 某北京时间日 D 的某时 h 对应的 epoch ms（北京 = UTC+8）。
  const atBeijing = (D, h) => D * DAY_MS - 28800000 + h * 3600000
  // 收集 ±SPAN 天内全部窗口边界切换点，剔除落在周末（无价格变化）的点。
  const points = []
  for (let off = -SPAN; off <= SPAN; off += 1) {
    const D = D0 + off
    const wd = (D + 4) % 7
    if (wd === 6 || wd === 0) continue // 周末日内无切换
    for (const w of PEAK_HOUR_WINDOWS) {
      points.push({ at: atBeijing(D, w.start), intoPeak: true })
      points.push({ at: atBeijing(D, w.end), intoPeak: false })
    }
  }
  let prev = null
  let next = null
  for (const p of points) {
    if (p.at <= ts && (prev === null || p.at > prev.at)) prev = p
    if (p.at > ts && (next === null || p.at < next.at)) next = p
  }
  if (isWeekendNow) {
    // 周末全谷价：当前谷，下一切换 = 下周一首个峰窗口起点；prev = 周六 00:00（北京）。
    if (next === null) return null
    return { inPeak: false, weekend: true, prevAtMs: (D0 - weekday) * DAY_MS - 57600000, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
  }
  if (prev === null || next === null) return null
  return { inPeak: isPeak(ts), weekend: false, prevAtMs: prev.at, nextAtMs: next.at, nextIntoPeak: next.intoPeak }
}

/**
 * 解析一次调用的价格信息。
 * @param {string} np - 归一化后的 provider 名（如 deepseek）
 * @param {string} model - 模型名（如 deepseek-v4-flash-vision-exp）
 * @returns {{rates:object, tiered:boolean, estimated:boolean, subscription:boolean}}
 */
export function priceFor(np, model) {
  if (SUBSCRIPTION_RATES[np]) return { rates: SUBSCRIPTION_RATES[np], tiered: false, estimated: true, subscription: true }
  if (EXACT_MODELS[model]) return { rates: EXACT_MODELS[model], tiered: true, estimated: false, subscription: false }
  const p = PROVIDER_RATES[np]
  if (p) return { rates: p.rates, tiered: p.tiered, estimated: true, subscription: false }
  return { rates: GENERIC_RATES, tiered: false, estimated: true, subscription: false }
}

/**
 * 计算一次调用的费用（CNY）。
 * @param {object} rates - {input, output, cacheRead, cacheWrite}（CNY / 1M tokens）
 * @param {boolean} tiered - 是否峰谷计价（false 时按表内价）
 * @param {boolean} peak - 是否高峰时段（tiered 且非高峰时 ×0.5）
 * @param {{input:number, output:number, cacheRead:number, cacheWrite:number}} t - token 用量
 */
export function computeCost(rates, tiered, peak, t) {
  const f = tiered && !peak ? 0.5 : 1
  return (t.input * rates.input + t.output * rates.output + t.cacheRead * rates.cacheRead + t.cacheWrite * rates.cacheWrite) * f / 1000000
}

function toNum(x) { const n = Number(x); return isNaN(n) ? 0 : n }

/**
 * 把 DSH usage 事件归一化为插件记账的四段 token。
 * - inputTokens：缓存未命中的输入（DSH 已从 prompt_tokens 中扣除缓存命中部分）
 * - imageTokens：预留的视觉图片 token 字段（当前 DSH 未提供，图片 token 已在 inputTokens 内）；
 *   若未来出现独立字段则并入输入，避免漏计
 * @param {object} usage - DSH llm/stream usage 事件
 */
export function normalizeTokens(usage) {
  return {
    input: toNum(usage.inputTokens) + toNum(usage.imageTokens),
    output: toNum(usage.outputTokens),
    cacheRead: toNum(usage.cacheReadTokens),
    cacheWrite: toNum(usage.cacheWriteTokens),
  }
}
