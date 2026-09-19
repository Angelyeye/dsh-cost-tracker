// ============================================================
// DSH 花费统计插件 —— 配置层（纯逻辑，可独立测试）
//
// 三部分配置同存于 $DSH_HOME/storages/cost-tracker-config.json：
//   1. 峰谷计价提示（peak*）：默认值与参考项目 dsh-cost-meter 保持一致；
//   2. 云端同步（cloud* / sync* / boardView）：多机汇总与设备身份；
//   3. 界面显示（ui*）：前端各落点的显隐（本文件末尾有说明）。
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
//
// 字段（界面显示，v1.8.12）：
//   uiDockEnabled       输入框上方的「本会话花费」胶囊（conversation.composer.dock）
//   uiPeakEnabled       侧边栏底部的峰谷时段条（sidebar.footer.action）
//   uiDashboardEnabled  设置页左侧的「花费统计」看板入口（settings.section）
//
//   三者**互相独立**，且都只影响前端渲染，不影响记账、云端同步与 Agent 工具。
//   插件配置卡片（settings.plugin.item）不受这三个开关控制 —— 它必须始终可点，
//   否则关掉之后用户就没有入口再打开了。
//
//   真值语义与 peakEnabled 相反：null/undefined → true（显隐是从 v1.8.12 才有的新
//   能力，老配置文件里没有这几个键，必须保持默认全部可见），只有显式 false 才隐藏。
//   这样两个方向上都安全：老配置升级后界面不变，新配置关掉就是关掉。
//
// 字段（火山方舟配额，v1.8.14）：
//   volcengineAccessKeyId      火山引擎 AccessKeyID（管控面 AK，非方舟推理 API Key）
//   volcengineSecretAccessKey  火山引擎 SecretAccessKey（role=secret，不回显明文）
//
//   两者**留空即回落到凭据发现链**（DSH 凭据库 → .credentials.yaml 文件），
//   因此老配置文件升级后为零改动、开箱可用。配额查询走方舟管控面 OpenAPI，
//   需要 IAM 子用户具备 ArkReadOnlyAccess + BillingCenterReadOnlyAccess。
//   注意与推理用的 ARK API Key 是**两套不同的凭据**，不要混填。
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

/**
 * 前端显隐开关（设置 → 插件 → 插件配置 → 花费统计 → 界面显示）。
 * 每项声明：配置键、文案、说明，以及它在 DSH 里对应的插槽（便于对照宿主与测试）。
 * 新增可控落点时只改这张表：服务端 normalize 与前端卡片都从它派生。
 */
export const UI_SURFACES = [
  {
    key: 'uiDockEnabled',
    label: '输入框上方的花费胶囊',
    desc: '本会话花费与模型明细（会话输入区上方）。关闭后输入区不再显示任何花费信息。',
    slot: 'conversation.composer.dock',
  },
  {
    key: 'uiPeakEnabled',
    label: '侧边栏峰谷时段条',
    desc: '侧边栏底部的当前档位 / 倒计时。关闭后峰谷切换弹窗与系统通知一并停用；只想留提醒不想要时段条时，请改用「峰谷计价与提示」里的提示开关。',
    slot: 'sidebar.footer.action',
  },
  {
    key: 'uiDashboardEnabled',
    label: '设置页「花费统计」看板',
    desc: '设置页左侧导航的花费统计入口与看板。关闭后该入口隐藏，插件仍照常记账并同步云端。',
    slot: 'settings.section',
  },
]

/** 界面显示默认配置（全部可见；老配置文件里没有这几个键，读出来就是 true） */
export function defaultUiConfig() {
  const out = {}
  for (const s of UI_SURFACES) out[s.key] = true
  return out
}

/**
 * 火山方舟配额凭据默认配置（**留空**）。
 * 留空不是「缺失」，而是明确表示「走凭据发现链」——老配置文件里没有这两个键，
 * 升级后读出来就是空串，行为与升级前完全一致（配额面板自动从凭据库取 AK/SK）。
 */
export function defaultVolcengineConfig() {
  return {
    volcengineAccessKeyId: '',
    volcengineSecretAccessKey: '',
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

/**
 * 规范化界面显示开关（显隐真值见文件头的说明：缺省/非布尔 → 可见）。
 * @param {object} raw - 任意输入
 */
export function normalizeUiConfig(raw) {
  const def = defaultUiConfig()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return def
  const out = {}
  for (const s of UI_SURFACES) out[s.key] = bool(raw[s.key], def[s.key])
  return out
}

/**
 * 规范化火山方舟配额凭据。
 * 只做长度与类型收敛，**不校验格式**：AK/SK 的形态由火山引擎决定，
 * 这里猜错反而会把合法凭据判为非法。空串 = 未配置 = 走凭据发现链。
 */
export function normalizeVolcengineConfig(raw) {
  const def = defaultVolcengineConfig()
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return def
  return {
    volcengineAccessKeyId: typeof raw.volcengineAccessKeyId === 'string' ? raw.volcengineAccessKeyId.trim().slice(0, 256) : def.volcengineAccessKeyId,
    volcengineSecretAccessKey: typeof raw.volcengineSecretAccessKey === 'string' ? raw.volcengineSecretAccessKey.trim().slice(0, 256) : def.volcengineSecretAccessKey,
  }
}

/** 合并规范化：一份配置文件同时承载峰谷、云端同步与界面显示三组字段 */
export function normalizePluginConfig(raw) {
  return Object.assign(
    normalizePeakConfig(raw),
    normalizeCloudConfig(raw),
    normalizeUiConfig(raw),
    normalizeVolcengineConfig(raw),
  )
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
