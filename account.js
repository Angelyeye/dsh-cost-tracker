// ============================================================
// DSH 0.2.1-rc.2+「DeepSeek 账号登录」余额适配 —— 纯投影层
//
// 为什么需要这一层（背景，来自 0.2.1-rc.2 运行时源码，见 README 的「账号登录」节）：
//   · 0.2.1-rc.2 起 DSH 支持浏览器 PKCE 账号登录。账号态推理用
//     `x-dsh-auth-token` 走 Platform 网关（@deepseek-ai/dsh-llm-deepseek-account），
//     README 原文：「不会回退到 API key」——**登录不会下发 API Key**。
//   · 插件旧版余额只认 `DEEPSEEK_API_KEY` 去请求
//     https://api.deepseek.com/user/balance，于是账号态下永远「未找到 DeepSeek API Key」。
//   · 账号余额的正规取法：宿主服务 `deepseekAccount.getBalance(client)`，
//     内部请求 Platform Web 的 GET /api/v0/users/get_user_summary。
//
// 契约（逐字核对过 0.2.1-rc.2 的 lib/types/*.js）：
//   getBalance(client) → null
//                      | { status: 'failed' }
//                      | { status: 'ready', value: Wallet[], bonusWallets: Wallet[] }
//   Wallet = { currency: 'CNY' | 'USD', balance: '<十进制字符串>' }
//     · value        = 充值钱包（normal_wallets）
//     · bonusWallets = 赠金钱包（bonus_wallets）
//     · null = 没有已存授权（未登录），或查询期间凭据被清除
//     · 'failed' = 网络/超时/协议类失败（**不会**被伪造成 0 余额）
//   client 参数**必填**：platformClientHeaders 直接读
//     client.version / client.locale / client.timezoneOffsetSeconds，
//     少一个就抛 TypeError —— 所以本模块必须把三个字段补齐再调用。
//
// 本模块只做「纯投影」：不碰 ctx、不发网络请求，便于在无 DSH 运行时的环境下
// 直接单测（见 test/balance-account.test.js）。宿主侧调用见 index.js 的 balance()。
// ============================================================

/** 余额/钱包金额的十进制文法：与 0.2.1-rc.2 运行时 zod 校验器逐字一致。 */
const DECIMAL_RE = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/

/** 币种偏好：与旧版 API Key 路径「优先取 CNY」保持一致。 */
const CURRENCY_PREFERENCE = ['CNY', 'USD']

/** 数字字面量的符号（视图层用）。 */
export function currencySymbol(currency) {
  return String(currency || '').toUpperCase() === 'USD' ? '$' : '¥'
}

/**
 * 解析十进制字符串为「BigInt 系数 + 小数位数」。
 * @param {string} value - 形如 "12.34" / "-0.5" / "0E-16" / "1e+3"
 * @returns {{coef:bigint, scale:number}|null} 不合法返回 null
 */
function decParse(value) {
  const text = String(value === null || value === undefined ? '' : value).trim()
  const m = DECIMAL_RE.exec(text)
  if (!m) return null
  const intPart = m[2] || ''
  const fracPart = m[3] || ''
  // "1." / ".5" / "0" 都合法；"." 单独一个不合法
  if (!intPart && !fracPart) return null
  const exp = m[4] ? parseInt(m[4], 10) : 0
  if (!Number.isFinite(exp) || Math.abs(exp) > 200) return null
  const sign = m[1] === '-' ? -1n : 1n
  const digits = (intPart + fracPart).replace(/^0+(?=\d)/, '') || '0'
  let coef = BigInt(digits) * sign
  let scale = fracPart.length - exp
  if (scale < 0) {
    coef *= 10n ** BigInt(-scale)
    scale = 0
  }
  return { coef, scale }
}

/** 把「系数 + 小数位数」格式化成十进制字符串（不丢精度、不做四舍五入）。 */
function decFormat(coef, scale) {
  // 零统一输出 "0"：Platform 会返回 0E-16 这类「零但带巨大尾数」的值，
  // 若原样展开会变成 0.0000000000000000，界面上毫无意义。
  if (coef === 0n) return '0'
  const negative = coef < 0n
  let abs = negative ? -coef : coef
  let text = abs.toString()
  if (scale > 0) {
    while (text.length <= scale) text = '0' + text
    text = text.slice(0, text.length - scale) + '.' + text.slice(text.length - scale)
  }
  return (negative ? '-' : '') + text
}

/**
 * 精确十进制加法（字符串进、字符串出，不经过 Number，避免 0.1+0.2 类误差）。
 * 非法输入按 0 处理 —— 钱包原始字符串另存在结果里，不会丢证据。
 * @param {string} a
 * @param {string} b
 * @returns {string}
 */
export function decAdd(a, b) {
  const x = decParse(a)
  const y = decParse(b)
  const left = x || { coef: 0n, scale: 0 }
  const right = y || { coef: 0n, scale: 0 }
  const scale = Math.max(left.scale, right.scale)
  const lc = left.coef * 10n ** BigInt(scale - left.scale)
  const rc = right.coef * 10n ** BigInt(scale - right.scale)
  return decFormat(lc + rc, scale)
}

/** 多个十进制字符串求和。 */
export function decSum(list) {
  let total = '0'
  for (const v of list || []) total = decAdd(total, v)
  return total
}

/**
 * 构造 getBalance(client) 的 client 元数据。
 *
 * 三个字段都必填：缺 version 时用插件自身版本，缺 locale 时按宿主运行环境的
 * 默认语言（Node 自带完整 ICU），缺时区偏移时用本机时区。浏览器半端会把
 * navigator.language 与本机时区一起传上来（见 client.js 的 balanceClientMeta）。
 *
 * @param {object} [input] - 来自 HTTP 参数 { version, locale, timezoneOffsetSeconds }
 * @param {string} [fallbackVersion] - 缺省版本号（插件版本）
 * @returns {{version:string, locale:string, timezoneOffsetSeconds:number}}
 */
export function accountClientMeta(input, fallbackVersion) {
  const src = input && typeof input === 'object' ? input : {}
  let version = typeof src.version === 'string' && src.version.trim() ? src.version.trim() : ''
  if (!version) version = typeof fallbackVersion === 'string' && fallbackVersion.trim() ? fallbackVersion.trim() : '0.0.0'
  let locale = typeof src.locale === 'string' && src.locale.trim() ? src.locale.trim() : ''
  if (!locale) {
    try { locale = String(Intl.DateTimeFormat().resolvedOptions().locale || '') } catch (e) { locale = '' }
  }
  if (!locale) locale = 'zh-CN'
  let tz = Number(src.timezoneOffsetSeconds)
  if (!Number.isFinite(tz)) tz = -new Date().getTimezoneOffset() * 60
  return { version, locale, timezoneOffsetSeconds: Math.round(tz) }
}

/** 钱包数组归一化：只留币种与金额都合法的项，保留原始金额字符串。 */
function normalizeWallets(list, kind) {
  const out = []
  if (!Array.isArray(list)) return out
  for (const w of list) {
    if (!w || typeof w !== 'object') continue
    const currency = typeof w.currency === 'string' ? w.currency.toUpperCase() : ''
    if (!currency) continue
    const balance = w.balance === null || w.balance === undefined ? '' : String(w.balance)
    if (!decParse(balance)) continue
    out.push({ currency, balance, kind })
  }
  return out
}

/** 取某币种的合计（无该币种钱包时返回 '0'）。 */
function sumCurrency(wallets, currency) {
  const amounts = []
  for (const w of wallets) if (w.currency === currency) amounts.push(w.balance)
  return amounts.length ? decSum(amounts) : '0'
}

/**
 * 把 `deepseekAccount.getBalance()` 的 ready 结果投影成本插件既有的 balance 形状。
 *
 * 兼容性：`total` / `granted` / `toppedUp` / `currency` / `keySource` 全部沿用旧字段，
 * 新增 `source: 'account'`、`available: null`（账号态无法判断官方 is_available）与
 * `wallets` / `currencies`（多币种时视图层可逐个展示）。
 *
 * 口径说明：Platform 的充值钱包与赠金钱包是**两个**钱包，
 * 「总余额」= 同币种充值合计 + 同币种赠金合计（官方 Web 也是分开列示）。
 *
 * @param {object} details - getBalance 的返回值
 * @returns {object|null} ready 时返回插件形状；非 ready（含 null）返回 null
 */
export function mapAccountBalance(details) {
  if (!details || typeof details !== 'object' || details.status !== 'ready') return null
  // 运行时契约里两个数组永远存在；缺失说明服务形状变了 —— 这时宁可失败，
  // 也不能把「不知道」渲染成「0 余额」（0.2.1-rc.2 自己的实现同样坚持这一点）。
  if (!Array.isArray(details.value) || !Array.isArray(details.bonusWallets)) return null
  const recharge = normalizeWallets(details.value, 'recharge')
  const bonus = normalizeWallets(details.bonusWallets, 'bonus')
  // 有元素但全被校验挡掉 = 载荷损坏 → 失败，而不是静默归零
  if ((details.value.length && !recharge.length) || (details.bonusWallets.length && !bonus.length)) return null
  const currencies = []
  for (const w of recharge) if (currencies.indexOf(w.currency) < 0) currencies.push(w.currency)
  for (const w of bonus) if (currencies.indexOf(w.currency) < 0) currencies.push(w.currency)
  let currency = ''
  for (const c of CURRENCY_PREFERENCE) {
    if (currencies.indexOf(c) >= 0) { currency = c; break }
  }
  if (!currency) currency = currencies[0] || 'CNY'
  const toppedUp = sumCurrency(recharge, currency)
  const granted = sumCurrency(bonus, currency)
  return {
    ok: true,
    error: '',
    // 账号态没有 is_available 这一说（余额不足是请求失败时由宿主提示）；
    // 用 null 而不是 false，避免把「未知」显示成「不可用」。
    available: null,
    source: 'account',
    keySource: 'account',
    currency,
    total: decAdd(toppedUp, granted),
    toppedUp,
    granted,
    currencies,
    wallets: recharge.concat(bonus),
  }
}

/**
 * 账号余额查询失败的统一形状（保持旧字段齐全，视图层无需特判空值）。
 * @param {string} error - 面向用户的中文错误说明
 * @returns {object}
 */
export function accountBalanceFailure(error) {
  return {
    ok: false,
    error: String(error || '账号余额查询失败'),
    available: null,
    source: 'account',
    keySource: 'account',
    currency: 'CNY',
    total: '',
    toppedUp: '',
    granted: '',
    currencies: [],
    wallets: [],
  }
}
