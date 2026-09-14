// ============================================================
// DSH 花费统计插件 —— 配置层（纯逻辑，可独立测试）
//
// 两部分配置同存于 $DSH_HOME/storages/cost-tracker-config.json：
//   1. 峰谷计价提示（peak*）：默认值与参考项目 dsh-cost-meter 保持一致；
//   2. 云端同步（cloud* / sync* / boardView）：多机汇总与设备身份。
//
// 字段（峰谷）：
//   peakEnabled        启用 DeepSeek 峰谷时段价格（影响计费 + 提示显隐）
//   peakNotice         峰时高价时段显著提示（时段条显示）
//   peakStyle          时段条样式：compact（简洁单行）/ classic（环形表盘，24h 中空圆环）
//   peakShowTickLabels 环形表盘是否显示时间刻度（00:00–21:00），默认 true
//   peakCompactStack   简洁样式下的「双行紧凑」：true 时改为上下布局（默认 false，左右单行）
//   peakCompactOrder   双行紧凑的排布顺序：bar-first（时段条在上·文字在下，默认）/ text-first（文字在上·时段条在下）
//   peakAlertEnabled   峰/谷切换前弹窗提醒
//   peakAlertAhead     提前提醒分钟数（1-30，默认 2）
//   peakAlertTarget    提醒类型：both（峰和谷）/ peak（进入峰时）/ offpeak（进入谷时）
//   peakAlertPosition  弹窗位置：corner（右下角）/ center（屏幕中心）
//   peakAlertWebNotify 同步发送浏览器系统通知
//   peakEffectiveAt    峰谷计价生效时间（ISO 字符串，展示用）
//
// 字段（云端同步，v1.8.0）：
//   cloudEnabled       是否启用云端同步（必须有合法 cloudUrl 才算生效）
//   cloudUrl           云端服务地址（仅接受 http/https，无尾斜杠）
//   cloudToken         共享引导令牌 / 设备令牌（浏览器侧以 secret 形式派发）
//   deviceName         本机在看板上显示的名字（写入共享身份文件）
//   deviceId           手动覆盖设备身份（留空用自动生成的 machineId）
//   syncIntervalSec    自动同步间隔秒（15..3600，默认 60）
//   syncBatchSize      单批明细条数（50..2000，默认 500）
//   maskSessionId      会话脱敏：上报前把 sessionId 换成不可逆哈希
//   includePurpose     是否上报 purpose（项目归属）
//   syncRollups        是否上报历史日汇总快照（含 absorbed 声明）
//   syncSinceDays      首次/全量补传的起始窗口天数（0 = 不限）
//   cloudView          看板视图：local | local+cloud | cloud（默认 local）
//                        · local+cloud 的云端口径为「cloud-rest」：排除本机 DSH 来源，
//                          于是「本机可见数据 + 云端结果」= 本机全部 + 其他整机 + 本机其它 agent（不重不漏）
//   cloudPanelDevices  云端视图的机器过滤（空数组 = 全部）
//   lastSyncAt/lastSyncOk/lastSyncError  最近一次同步结果（只读回显用）
// ============================================================

/** 默认峰谷计价生效时间（UTC；两档方案已即时生效，门控恒通过） */
export const DEFAULT_PEAK_EFFECTIVE_AT = '2026-08-01T00:00:00Z'

/** 峰值（读取）默认配置 */
export function defaultPeakConfig() {
  return {
    peakEnabled: true,
    peakNotice: true,
    peakStyle: 'compact',
    peakShowTickLabels: true,
    peakCompactStack: false,
    peakCompactOrder: 'bar-first',
    peakAlertEnabled: true,
    peakAlertAhead: 2,
    peakAlertTarget: 'both',
    peakAlertPosition: 'corner',
    peakAlertWebNotify: false,
    peakEffectiveAt: DEFAULT_PEAK_EFFECTIVE_AT,
  }
}

/** 云端同步默认配置 */
export function defaultCloudConfig() {
  return {
    cloudEnabled: false,
    cloudUrl: '',
    cloudToken: '',
    deviceName: '',
    deviceId: '',
    syncIntervalSec: 60,
    syncBatchSize: 500,
    maskSessionId: false,
    includePurpose: true,
    syncRollups: true,
    syncSinceDays: 180,
    cloudView: 'local',
    cloudPanelDevices: [],
    lastSyncAt: 0,
    lastSyncOk: false,
    lastSyncError: '',
  }
}

/** 看板三态视图取值 */
export const BOARD_VIEWS = ['local', 'local+cloud', 'cloud']

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
    peakShowTickLabels: bool(raw.peakShowTickLabels, def.peakShowTickLabels),
    peakCompactStack: bool(raw.peakCompactStack, def.peakCompactStack),
    peakCompactOrder: raw.peakCompactOrder === 'text-first' ? 'text-first' : 'bar-first',
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
 * 规范化云端同步配置。
 * 与 sync.js 的同名函数保持一致（本文件不依赖 sync.js，避免循环引用）。
 */
export function normalizeCloudConfig(raw) {
  const def = defaultCloudConfig()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return def
  const url = typeof raw.cloudUrl === 'string' ? raw.cloudUrl.trim().replace(/\/+$/, '') : ''
  const validUrl = /^https?:\/\/[^\s]+$/i.test(url) ? url.slice(0, 512) : ''
  return {
    cloudEnabled: raw.cloudEnabled === true && !!validUrl,
    cloudUrl: validUrl,
    cloudToken: typeof raw.cloudToken === 'string' ? raw.cloudToken.trim().slice(0, 512) : '',
    deviceName: typeof raw.deviceName === 'string' ? raw.deviceName.trim().slice(0, 64) : '',
    deviceId: typeof raw.deviceId === 'string' ? raw.deviceId.trim().slice(0, 128) : '',
    syncIntervalSec: intIn(raw.syncIntervalSec, 15, 3600, def.syncIntervalSec),
    syncBatchSize: intIn(raw.syncBatchSize, 50, 2000, def.syncBatchSize),
    maskSessionId: raw.maskSessionId === true,
    includePurpose: raw.includePurpose !== false,
    syncRollups: raw.syncRollups !== false,
    syncSinceDays: intIn(raw.syncSinceDays, 0, 3650, def.syncSinceDays),
    cloudView: BOARD_VIEWS.indexOf(raw.cloudView) >= 0 ? raw.cloudView : def.cloudView,
    cloudPanelDevices: Array.isArray(raw.cloudPanelDevices)
      ? raw.cloudPanelDevices.map((x) => String(x)).filter(Boolean).slice(0, 64)
      : [],
    lastSyncAt: Number.isFinite(raw.lastSyncAt) ? Number(raw.lastSyncAt) : 0,
    lastSyncOk: raw.lastSyncOk === true,
    lastSyncError: typeof raw.lastSyncError === 'string' ? raw.lastSyncError.slice(0, 300) : '',
  }
}

/** 合并规范化：一份配置文件同时承载峰谷与云端同步字段 */
export function normalizePluginConfig(raw) {
  return Object.assign(normalizePeakConfig(raw), normalizeCloudConfig(raw))
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
