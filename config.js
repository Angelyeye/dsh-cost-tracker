// ============================================================
// DSH 花费统计插件 —— 配置层（纯逻辑，可独立测试）
//
// 峰谷计价提示相关的可持久化设置。默认值与参考项目 dsh-cost-meter
// 保持一致，便于用户获得一致的峰/谷切换提醒体验。
//
// 字段：
//   peakEnabled        启用 DeepSeek 峰谷时段价格（影响计费 + 提示显隐）
//   peakNotice         峰时高价时段显著提示（时段条显示）
//   peakStyle          时段条样式：compact（简洁单行）/ classic（经典两行）
//   peakAlertEnabled   峰/谷切换前弹窗提醒
//   peakAlertAhead     提前提醒分钟数（1-30，默认 2）
//   peakAlertTarget    提醒类型：both（峰和谷）/ peak（进入峰时）/ offpeak（进入谷时）
//   peakAlertPosition  弹窗位置：corner（右下角）/ center（屏幕中心）
//   peakAlertWebNotify 同步发送浏览器系统通知
//   peakEffectiveAt    峰谷计价生效时间（ISO 字符串，展示用）
// ============================================================

/** 默认峰谷计价生效时间（UTC；两档方案已即时生效，门控恒通过） */
export const DEFAULT_PEAK_EFFECTIVE_AT = '2026-08-01T00:00:00Z'

/** 峰值（读取）默认配置 */
export function defaultPeakConfig() {
  return {
    peakEnabled: true,
    peakNotice: true,
    peakStyle: 'compact',
    peakAlertEnabled: true,
    peakAlertAhead: 2,
    peakAlertTarget: 'both',
    peakAlertPosition: 'corner',
    peakAlertWebNotify: false,
    peakEffectiveAt: DEFAULT_PEAK_EFFECTIVE_AT,
  }
}

function bool(v, fallback) { return typeof v === 'boolean' ? v : fallback }
function intIn(v, lo, hi, fallback) { return typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : fallback }

/**
 * 规范化一份用户配置：只保留已知字段，非法值回退默认。
 * @param {object} raw - 任意输入
 * @returns 规范化后的配置对象
 */
export function normalizePeakConfig(raw) {
  const def = defaultPeakConfig()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return def
  const out = {
    peakEnabled: bool(raw.peakEnabled, def.peakEnabled),
    peakNotice: bool(raw.peakNotice, def.peakNotice),
    peakStyle: raw.peakStyle === 'classic' ? 'classic' : 'compact',
    peakAlertEnabled: bool(raw.peakAlertEnabled, def.peakAlertEnabled),
    peakAlertAhead: intIn(raw.peakAlertAhead, 1, 30, def.peakAlertAhead),
    peakAlertTarget: (raw.peakAlertTarget === 'peak' || raw.peakAlertTarget === 'offpeak') ? raw.peakAlertTarget : def.peakAlertTarget,
    peakAlertPosition: raw.peakAlertPosition === 'center' ? 'center' : 'corner',
    peakAlertWebNotify: bool(raw.peakAlertWebNotify, def.peakAlertWebNotify),
    peakEffectiveAt: typeof raw.peakEffectiveAt === 'string' && raw.peakEffectiveAt.length > 0 ? raw.peakEffectiveAt : def.peakEffectiveAt,
  }
  return out
}

/**
 * 峰谷计费是否已生效：peakEnabled 且当前时间 >= effectiveAt（生效前视为未启用）。
 * @param {object} cfg - 规范化配置
 * @param {number} now - epoch ms（缺省用当前时间）
 */
export function peakEffective(cfg, now) {
  if (!cfg || cfg.peakEnabled !== true) return false
  const t = Date.parse((cfg && cfg.peakEffectiveAt) || '')
  if (Number.isFinite(t) && now < t) return false
  return true
}
