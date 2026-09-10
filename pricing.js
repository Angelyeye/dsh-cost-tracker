// ============================================================
// DSH 花费统计插件 —— 定价与 Token 层（纯逻辑，可独立测试）
//
// 单价来源：DeepSeek 官方定价页
//   https://api-docs.deepseek.com/zh-cn/quick_start/pricing
//   - 高峰时段（北京时间周一至周五 9:00-12:00、14:00-18:00）为表内价格；
//     空闲时段 = 高峰 × 0.5。周末（周六/周日）全天计入空闲时段（该窗口两版价通用）。
//   - **单价随时间调整**：故单价表按生效时刻分版（见 PRICE_ERAS），按记录时间戳选版。
//       · legacy  ：V4-Flash 3.0/9.0/0.10、V4-Pro 9.0/27.0/0.30
//       · v41     ：V4.1 Flash 2.0/8.0/0.04（北京时间 2026-09-10 12:00 起生效），
//                   V4-Pro 与旧 V4-Flash 系（含 vision-exp）的请求全部路由到
//                   V4.1 Flash 并按 V4.1 Flash 单价计费（V4.1 Pro 上线前）。
//   - deepseek-v4-flash-vision-exp 与 deepseek-v4-flash 在 legacy 时代单价一致。
//
// 视觉模型 Token 规则：
//   https://api-docs.deepseek.com/zh-cn/guides/vision#token-usage
//   图片进入模型前按尺寸自动缩放（<384×384 放大、更大缩小至约 800×800），
//   每张图片换算 token 数存在上限（384 个），与文本 token 一并计费——
//   即包含在接口返回的 prompt_tokens 中，由 DSH 映射为 inputTokens，
//   插件按接口用量记账（接口用量为准，估算可能有误差）。
// ============================================================

/**
 * 计费时代（price era）——DeepSeek 单价是「随时间调整」的，因此单价表按
 * 生效时刻（since，epoch ms）分版。计费与展示一律以「记录自身的时间戳」选版，
 * 历史记录口径不会被新价改写。
 *
 * 字段：input=输入缓存未命中价 / output=输出价 / cacheRead=cacheWrite=缓存命中价
 *      （官方规则：缓存写入(cache write)与缓存命中(cache hit)同价）。
 * 均为「高峰时段」价；空闲时段 = 高峰 × 0.5（两版价格的空闲档都恰好是半价）。
 *
 * routes：某个时代内把指定模型名的请求**改按另一档单价计费**，记录也以被路由
 *         到的模型名入账，便于按模型聚合时看到真实计费口径。
 */

/** V4.1 Flash 价格的生效时刻：北京时间 2026-09-10 12:00（UTC+8）= 2026-09-10T04:00:00Z */
export const V41_EFFECTIVE_AT = Date.UTC(2026, 8, 10, 4, 0, 0)

/** V4.1 Flash 的规范模型名（被路由的请求一律以此名入账） */
export const V41_FLASH_MODEL = 'deepseek-v4.1-flash'

export const PRICE_ERAS = [
  {
    id: 'legacy',
    label: '2026-08 价（V4-Flash / V4-Pro 各自独立计价）',
    since: 0,
    models: {
      'deepseek-v4-flash': { input: 3.0, output: 9.0, cacheRead: 0.10, cacheWrite: 0.10 },
      'deepseek-v4-pro': { input: 9.0, output: 27.0, cacheRead: 0.30, cacheWrite: 0.30 },
      'deepseek-v4-flash-vision-exp': { input: 3.0, output: 9.0, cacheRead: 0.10, cacheWrite: 0.10 },
    },
    routes: {},
  },
  {
    id: 'v41',
    label: 'V4.1 Flash 价（V4-Pro 与旧 V4-Flash 系均路由至此）',
    since: V41_EFFECTIVE_AT,
    models: {
      // 高峰价：输入（缓存命中）0.04 / 输入（缓存未命中）2 / 输出 8；空闲减半
      [V41_FLASH_MODEL]: { input: 2.0, output: 8.0, cacheRead: 0.04, cacheWrite: 0.04 },
    },
    // V4.1 Pro 上线前，V4-Pro 的请求全部路由到 V4.1 Flash 并按 V4.1 Flash 单价计费；
    // 旧 V4-Flash 系（含视觉版）已被 V4.1 Flash 取代，一并按新价计费。
    routes: {
      'deepseek-v4-pro': V41_FLASH_MODEL,
      'deepseek-v4-flash': V41_FLASH_MODEL,
      'deepseek-v4-flash-vision-exp': V41_FLASH_MODEL,
    },
  },
]

/** 旧价精确单价表（legacy 时代）。保留导出，兼容既有调用与历史口径。 */
export const EXACT_MODELS = PRICE_ERAS[0].models

/** 归一化模型名：小写并剔除分隔符，使 v4.1 / v4-1 / v41 等写法命中同一档价。 */
export function normalizeModelName(m) {
  return String(m == null ? '' : m).toLowerCase().replace(/[^a-z0-9]/g, '')
}

const ERA_INDEX = new Map()
function eraIndex(era) {
  let idx = ERA_INDEX.get(era)
  if (!idx) {
    idx = { models: new Map(), routes: new Map() }
    for (const k of Object.keys(era.models)) idx.models.set(normalizeModelName(k), k)
    for (const k of Object.keys(era.routes || {})) idx.routes.set(normalizeModelName(k), era.routes[k])
    ERA_INDEX.set(era, idx)
  }
  return idx
}

/**
 * 某模型在指定时代下命中的**计费模型规范名**：先查本时代单价表，
 * 再查路由表（路由目标须在本时代单价表内）；均未命中返回 null。
 */
export function resolveModelInEra(era, model) {
  if (!era) return null
  const n = normalizeModelName(model)
  if (!n) return null
  const idx = eraIndex(era)
  if (idx.models.has(n)) return idx.models.get(n)
  const target = idx.routes.get(n)
  if (target) {
    const hit = idx.models.get(normalizeModelName(target))
    if (hit) return hit
  }
  return null
}

/** 某一时刻生效的价格时代（缺省用当前时间）。 */
export function eraAt(ts) {
  const t = Number.isFinite(ts) ? ts : Date.now()
  let cur = PRICE_ERAS[0]
  for (const e of PRICE_ERAS) if (t >= e.since) cur = e
  return cur
}

/** 某一时刻生效的精确单价表（缺省用当前时间）。 */
export function exactModelsAt(ts) { return eraAt(ts).models }

/**
 * 订阅套餐（等效费用估算，仅供参考）。
 * DSH 的 kimi provider 上报名为 'kimi'（模型 kimi-k3 等），
 * 'kimi-coding' 为别名形式（kimi-coding-official 归一化后形如 kimi-coding），
 * 两个键都命中，避免订阅调用被误计为按量估算。
 * 缓存写入按缓存命中价计（与官方规则一致）。
 */
export const SUBSCRIPTION_RATES = {
  'kimi-coding': { input: 6.5, output: 27.0, cacheRead: 1.1, cacheWrite: 1.1 },
  kimi: { input: 6.5, output: 27.0, cacheRead: 1.1, cacheWrite: 1.1 },
}

/** Provider 兜底单价（估算）；缓存写入按缓存命中价计。
 *  deepseek 兜底已同步至 V4.1 Flash 档（2.0/8.0/0.04），未知模型不再按旧价高估。 */
export const PROVIDER_RATES = {
  deepseek: { rates: { input: 2.0, output: 8.0, cacheRead: 0.04, cacheWrite: 0.04 }, tiered: true },
  openai: { rates: { input: 10.0, output: 30.0, cacheRead: 5.0, cacheWrite: 5.0 }, tiered: false },
  anthropic: { rates: { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 1.5 }, tiered: false },
  gemini: { rates: { input: 2.5, output: 10.0, cacheRead: 0.625, cacheWrite: 0.625 }, tiered: false },
  ollama: { rates: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tiered: false },
  local: { rates: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, tiered: false },
}

/** 未知模型兜底单价（估算）；缓存写入按缓存命中价计。 */
export const GENERIC_RATES = { input: 2.0, output: 8.0, cacheRead: 0.5, cacheWrite: 0.5 }

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
 * @param {number} [ts] - 调用发生时刻（epoch ms）；决定用哪一版单价表。
 *   缺省用当前时间——注意历史/测试场景应显式传入，否则跨价格时代会错。
 * @returns {{rates:object, tiered:boolean, estimated:boolean, subscription:boolean,
 *            model:string, era:string|null}}
 *   model 为**计费模型规范名**：命中路由时是被路由到的模型（如 V4-Pro → V4.1 Flash），
 *   记账应以它入账；未命中精确表时为原模型名。
 */
export function priceFor(np, model, ts) {
  if (SUBSCRIPTION_RATES[np]) return { rates: SUBSCRIPTION_RATES[np], tiered: false, estimated: true, subscription: true, model, era: null }
  const era = eraAt(ts)
  const hit = resolveModelInEra(era, model)
  if (hit) return { rates: era.models[hit], tiered: true, estimated: false, subscription: false, model: hit, era: era.id }
  const p = PROVIDER_RATES[np]
  if (p) return { rates: p.rates, tiered: p.tiered, estimated: true, subscription: false, model, era: era.id }
  return { rates: GENERIC_RATES, tiered: false, estimated: true, subscription: false, model, era: era.id }
}

/**
 * 计算一次调用的费用（CNY）。
 * @param {object} rates - {input, output, cacheRead, cacheWrite, reasoning?}（CNY / 1M tokens）
 *   cacheRead 与 cacheWrite 同价（均为缓存命中价），输入用未命中价，reasoning 缺省 0。
 * @param {boolean} tiered - 是否峰谷计价（false 时按表内价）
 * @param {boolean} peak - 是否高峰时段（tiered 且非高峰时 ×0.5）
 * @param {{input:number, output:number, cacheRead:number, cacheWrite:number, reasoning?:number}} t - token 用量
 */
export function computeCost(rates, tiered, peak, t) {
  const f = tiered && !peak ? 0.5 : 1
  const reasoning = toNum(t.reasoning) * (toNum(rates.reasoning))
  return (t.input * rates.input + t.output * rates.output + (t.cacheRead + t.cacheWrite) * rates.cacheRead + reasoning) * f / 1000000
}

function toNum(x) { const n = Number(x); return isNaN(n) ? 0 : n }

/**
 * 把 DSH usage 事件归一化为插件记账的 token 桶。
 * - inputTokens：缓存未命中的输入（DSH 已从 prompt_tokens 中扣除缓存命中部分）
 * - imageTokens：预留的视觉图片 token 字段（当前 DSH 未提供，图片 token 已在 inputTokens 内）；
 *   若未来出现独立字段则并入输入，避免漏计
 * - reasoningTokens：推理 token（reasoning 模型按单独单价计费；缺省 0）
 * @param {object} usage - DSH llm/stream usage 事件
 */
export function normalizeTokens(usage) {
  return {
    input: toNum(usage.inputTokens) + toNum(usage.imageTokens),
    output: toNum(usage.outputTokens),
    cacheRead: toNum(usage.cacheReadTokens),
    cacheWrite: toNum(usage.cacheWriteTokens),
    reasoning: toNum(usage.reasoningTokens),
  }
}
