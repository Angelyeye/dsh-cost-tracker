// ============================================================
// DSH 花费统计插件 —— 定价与 Token 层（纯逻辑，可独立测试）
//
// 单价来源：DeepSeek 官方定价页
//   https://api-docs.deepseek.com/zh-cn/quick_start/pricing
//   - 高峰时段（北京时间 9:00-12:00、14:00-18:00）为表内价格；空闲时段 = 高峰 × 0.5
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

/** 高峰时段（北京时间），空闲时段 = 高峰 × 0.5 */
export const PEAK_WINDOWS = '9:00-12:00 · 14:00-18:00'

/** 视觉模型名（DeepSeek DeepSeek-V4-Flash-Vision-Exp） */
export const VISION_MODEL = 'deepseek-v4-flash-vision-exp'

/** 每张图片换算 token 的上限（官方规则） */
export const VISION_IMAGE_MAX_TOKENS = 384

/** 是否高峰时段（北京时间 UTC+8） */
export function isPeak(ts) {
  const h = new Date(ts + 28800000).getUTCHours()
  return (h >= 9 && h < 12) || (h >= 14 && h < 18)
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
