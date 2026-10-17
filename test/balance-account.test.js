// ============================================================
// DSH 0.2.1-rc.2「DeepSeek 账号登录」余额兼容测试
//   node test/balance-account.test.js
//
// 被它钉住的三件事：
//   ① 账号服务契约：宿主 deepseekAccount.getBalance(client) 的 client 元数据
//      **三字段必填**（version / locale / timezoneOffsetSeconds），少一个运行时
//      就抛 TypeError —— 这是「账号登录下余额查询报未知错误」最容易复发的坑。
//   ② 余额来源优先级：手填 Key > 账号登录态 > 配置/环境 API Key；账号态
//      **不得**回退到 API Key（那会显示另一个账户的数字）。
//   ③ 账号钱包 → 插件字段的投影：Platform 的充值钱包 / 赠金钱包分开算，
//      合计用精确十进制加法（不经 Number，不产生 0.1+0.2 类误差）。
//
// 用真实文件 + 真实 HTTP 处理器跑，不做模块内打桩：
//   · DSH_HOME 指到临时目录，凭据文件按真实格式写 refs 段；
//   · ctx.get('deepseekAccount') 返回替身，替身记录收到的 client 参数；
//   · 全局 fetch 只放行 api.deepseek.com/user/balance，其它地址一律抛错，
//     确保「账号态优先」时**没有**任何出站请求。
// ============================================================
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { accountClientMeta, mapAccountBalance, accountBalanceFailure, decAdd, decSum, currencySymbol } from '../account.js'
import { priceFor, PROVIDER_RATES, GENERIC_RATES } from '../pricing.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`)
  else {
    failures++
    console.log(`  FAIL  ${name}`)
    if (detail !== undefined) console.log(`        ${detail}`)
  }
}
function eq(a, b, msg) { check(msg + '（' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + '）', a === b) }

// ---------- 纯函数层 ----------
console.log('dsh-cost-tracker 账号登录态余额兼容测试')
console.log('')

console.log('[1] accountClientMeta：getBalance(client) 的必填三字段')
{
  const meta = accountClientMeta(undefined, '1.9.6')
  eq(meta.version, '1.9.6', '缺省 version 回落到插件版本')
  check('locale 非空（宿主默认语言）', typeof meta.locale === 'string' && meta.locale.length > 0, meta.locale)
  check('timezoneOffsetSeconds 是整数秒', Number.isInteger(meta.timezoneOffsetSeconds), String(meta.timezoneOffsetSeconds))

  const given = accountClientMeta({ version: '9.9.9', locale: 'en-US', timezoneOffsetSeconds: 'abc' }, '1.9.6')
  eq(given.version, '9.9.9', '显式 version 优先')
  eq(given.locale, 'en-US', '显式 locale 优先')
  check('非法时区偏移回落为本机时区（不产生 NaN）', Number.isInteger(given.timezoneOffsetSeconds), String(given.timezoneOffsetSeconds))

  const rounded = accountClientMeta({ timezoneOffsetSeconds: 28800.6 }, '1.9.6')
  eq(rounded.timezoneOffsetSeconds, 28801, '小数时区偏移取整')

  // 真实运行时要求这三个字段都存在且类型正确，任何一个是 undefined 都会让
  // platformClientHeaders 抛 TypeError（见 0.2.1-rc.2 的 dsh-deepseek-account/lib/types/index.js:43-52）
  for (const bad of [{}, { version: '', locale: '', timezoneOffsetSeconds: null }, { version: 1, locale: 2, timezoneOffsetSeconds: 'x' }]) {
    const m = accountClientMeta(bad, '1.9.6')
    check('畸形输入也补齐三字段：' + JSON.stringify(bad),
      typeof m.version === 'string' && m.version.length > 0 && typeof m.locale === 'string' && m.locale.length > 0 && Number.isInteger(m.timezoneOffsetSeconds),
      JSON.stringify(m))
  }
}

console.log('[2] 精确十进制加法（钱包合计不能有浮点误差）')
{
  eq(decAdd('1.5', '2.25'), '3.75', '不同小数位相加')
  eq(decAdd('0.1', '0.2'), '0.3', '0.1+0.2 = 0.3（不是 0.30000000000000004）')
  eq(decAdd('1e+3', '5'), '1005', '科学计数法')
  eq(decAdd('0E-16', '0'), '0', 'Platform 会返回 0E-16 这种值')
  eq(decSum(['1.10', '2.20']), '3.30', '多位求和保留小数位')
  eq(decAdd('-1.25', '2'), '0.75', '负数')
  eq(decAdd('abc', '1'), '1', '非法值按 0（原始字符串另存，不丢证据）')
  eq(decSum([]), '0', '空列表为 0')
}

console.log('[3] mapAccountBalance：Platform 钱包 → 插件字段')
{
  const ready = mapAccountBalance({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '100.50' }],
    bonusWallets: [{ currency: 'CNY', balance: '20.00' }],
  })
  check('ready → ok', !!ready && ready.ok === true, JSON.stringify(ready))
  eq(ready.total, '120.50', '总余额 = 充值 + 赠金')
  eq(ready.toppedUp, '100.50', '充值余额取 normal_wallets')
  eq(ready.granted, '20.00', '赠金取 bonus_wallets')
  eq(ready.currency, 'CNY', '币种优先 CNY')
  eq(ready.source, 'account', '来源标记 account')
  eq(ready.available, null, '账号态没有 is_available，必须是 null 而不是 false')
  eq(ready.keySource, 'account', 'keySource 与旧字段兼容')

  const multiBonus = mapAccountBalance({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '1' }],
    bonusWallets: [{ currency: 'CNY', balance: '2' }, { currency: 'CNY', balance: '3.5' }],
  })
  eq(multiBonus.granted, '5.5', '多笔赠金求和')
  eq(multiBonus.total, '6.5', '总余额含全部赠金')

  const usdOnly = mapAccountBalance({ status: 'ready', value: [{ currency: 'USD', balance: '7.25' }], bonusWallets: [] })
  eq(usdOnly.currency, 'USD', '只有 USD 时取 USD')
  eq(usdOnly.total, '7.25', 'USD 余额')
  eq(currencySymbol(usdOnly.currency), '$', 'USD 符号')

  const empty = mapAccountBalance({ status: 'ready', value: [], bonusWallets: [] })
  eq(empty.total, '0', '空钱包 → 0（不是 null）')
  eq(empty.available, null, '空钱包也不伪造可用性')

  eq(mapAccountBalance(null), null, 'null（未登录）→ null，交给调用方回退')
  eq(mapAccountBalance({ status: 'failed' }), null, 'failed → null')
  eq(mapAccountBalance({ status: 'ready' }), null, '缺钱包数组 → null')
  eq(mapAccountBalance({ status: 'ready', value: [{ currency: 'CNY', balance: 'NaN' }] }), null, '非法金额字符串被拒')

  const failure = accountBalanceFailure('x')
  check('失败形状字段齐全（视图层无需特判 undefined）',
    failure.ok === false && failure.error === 'x' && failure.source === 'account'
      && failure.total === '' && failure.toppedUp === '' && failure.granted === '')
}

// ---------- 宿主 HTTP 面（真实 apply + 真实路由） ----------
const realFetch = globalThis.fetch
const outbound = []
globalThis.fetch = async (url, init) => {
  const u = String(url)
  outbound.push({ url: u, headers: (init && init.headers) || {} })
  if (u.startsWith('https://api.deepseek.com/user/balance')) {
    const body = JSON.stringify({
      is_available: true,
      balance_infos: [{ currency: 'CNY', total_balance: '99.00', granted_balance: '9.00', topped_up_balance: '90.00' }],
    })
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: async () => body,
      json: async () => JSON.parse(body),
      arrayBuffer: async () => Buffer.from(body, 'utf8'),
    }
  }
  throw new Error('测试沙箱内不应发起其它出站请求：' + u)
}

let seq = 0
function freshHome() {
  seq++
  const home = mkdtempSync(join(tmpdir(), 'cost-bal-' + seq + '-'))
  mkdirSync(join(home, 'storages'), { recursive: true })
  return home
}
/** 按真实格式写凭据文件的 refs 段。 */
function writeApiKey(home, key) {
  writeFileSync(join(home, '.credentials.yaml'), 'version: 1\nrefs:\n  DEEPSEEK_API_KEY: ' + key + '\n', 'utf8')
}

/**
 * 起一个插件实例。
 * @param {object} opts
 *   · account：deepseekAccount.getBalance 的返回值（undefined 表示宿主没有账号服务）
 *   · accountThrows：让 getBalance 抛错
 *   · apiKey：写进 .credentials.yaml 的 API Key（null 表示没有）
 */
async function boot(opts) {
  const o = opts || {}
  const home = freshHome()
  process.env.DSH_HOME = home
  if (o.apiKey) writeApiKey(home, o.apiKey)
  const seen = { getBalance: 0, clientArg: undefined, getState: 0 }
  const services = {}
  if (o.settings) services.settings = o.settings
  if (o.credentials) services.credentials = o.credentials
  if (o.account !== undefined || o.accountThrows || o.accountReturnsUndefined) {
    services.deepseekAccount = {
      getState: async () => { seen.getState++; return { status: o.account === null ? 'signed-out' : 'credential-stored' } },
      getBalance: async (client) => {
        seen.getBalance++
        seen.clientArg = client
        if (o.accountThrows) throw new Error(o.accountThrows)
        if (o.accountReturnsUndefined) return undefined
        return o.account
      },
      watch: () => () => {},
    }
  }
  let handler = null
  const ctx = {
    get: (name) => services[name],
    inject: () => {},
    // 宿主 cordis 语义：effect 立即执行回调；返回值只当销毁函数
    effect: (fn) => { try { const d = fn(); return typeof d === 'function' ? d : () => {} } catch (e) { throw new Error('effect 执行失败：' + (e && e.message ? e.message : e)) } },
    on: () => {},
    tools: { register: () => {} },
    commands: { register: () => {} },
    webServer: { register: (route) => { handler = (route && route.handler) || route; return () => {} } },
  }
  const mod = await import(pathToFileURL(join(root, 'index.js')).href + '?boot=' + seq)
  await mod.default.apply(ctx)
  if (typeof handler !== 'function') throw new Error('未注册 /api/cost-tracker 处理器')

  /** 等价于浏览器 fetch('/api/cost-tracker/balance', { body: JSON.stringify(args) }) */
  async function api(name, args) {
    const chunks = []
    const req = {
      method: 'POST',
      url: '/api/cost-tracker/' + name,
      [Symbol.asyncIterator]: async function* () { yield Buffer.from(JSON.stringify(args || {}), 'utf8') },
    }
    const res = {
      statusCode: 0,
      writeHead(code) { this.statusCode = code },
      end(body) { chunks.push(body || '') },
    }
    await handler(req, res)
    return JSON.parse(chunks.join(''))
  }
  return { home, api, seen }
}

console.log('[4] 账号登录态：走宿主服务、不碰 api.deepseek.com')
{
  outbound.length = 0
  const ready = {
    status: 'ready',
    value: [{ currency: 'CNY', balance: '100.50' }],
    bonusWallets: [{ currency: 'CNY', balance: '20.00' }],
  }
  const b = await boot({ account: ready })
  const r = await b.api('balance', { locale: 'zh-CN', timezoneOffsetSeconds: 28800 })
  eq(r.ok, true, '账号态查询成功')
  eq(r.source, 'account', '来源标记为 account')
  eq(r.total, '120.50', '总余额 = 充值 + 赠金')
  eq(r.toppedUp, '100.50', '充值余额')
  eq(r.granted, '20.00', '赠金余额')
  eq(r.keySource, 'account', 'keySource=account（旧字段兼容）')
  eq(r.available, null, 'available 为 null（账号态无 is_available）')
  eq(b.seen.getBalance, 1, '调用了 getBalance 一次')
  const meta = b.seen.clientArg
  check('client 元数据三字段齐全（缺一个运行时必抛 TypeError）',
    !!meta && typeof meta.version === 'string' && meta.version.length > 0
      && typeof meta.locale === 'string' && meta.locale.length > 0
      && Number.isInteger(meta.timezoneOffsetSeconds),
    JSON.stringify(meta))
  eq(meta && meta.locale, 'zh-CN', '浏览器传上来的 locale 被采用')
  eq(meta && meta.timezoneOffsetSeconds, 28800, '浏览器传上来的时区偏移被采用')
  eq(outbound.length, 0, '账号态下没有任何出站请求（没去打 api.deepseek.com）')
  // 宿主服务拿到的是插件自己的版本号，便于 Platform 侧识别客户端
  check('version 非空且不是占位 0.0.0', !!meta && meta.version !== '0.0.0', String(meta && meta.version))

  // 账号态 + 同时存在 API Key：仍以账号为准，不产生出站请求
  outbound.length = 0
  const both = await boot({ account: ready, apiKey: 'sk-both-should-not-be-used' })
  const r2 = await both.api('balance', {})
  eq(r2.source, 'account', '有 API Key 时仍优先账号态')
  eq(outbound.length, 0, '优先账号态时不得去请求 api.deepseek.com')
}

console.log('[5] 未登录：回退 API Key（旧路径不回归）')
{
  outbound.length = 0
  const b = await boot({ account: null, apiKey: 'sk-test-realkey' })
  const r = await b.api('balance', {})
  eq(r.ok, true, '未登录 + 有 API Key → 查询成功')
  eq(r.source, 'apikey', '来源标记 apikey')
  eq(r.total, '99.00', '沿用 api.deepseek.com 的 total_balance')
  eq(r.toppedUp, '90.00', '充值余额')
  eq(r.granted, '9.00', '赠送余额')
  eq(r.available, true, 'API Key 态保留 is_available')
  eq(r.keySource, 'file', 'Key 来源仍是凭据文件')
  eq(outbound.length, 1, '恰好一次出站请求')
  check('出站请求带 Bearer 头指向 api.deepseek.com/user/balance',
    outbound[0] && outbound[0].url === 'https://api.deepseek.com/user/balance'
      && String((outbound[0].headers || {}).Authorization || '') === 'Bearer sk-test-realkey',
    JSON.stringify(outbound[0]))
  eq(b.seen.getBalance, 1, '先问过账号服务（返回 null 才回退）')
}

console.log('[6] 未登录且没有 Key：错误文案要指向账号登录')
{
  const b = await boot({ account: null })
  const r = await b.api('balance', {})
  eq(r.ok, false, '没有可用凭据 → 失败')
  eq(r.source, 'none', 'source=none')
  check('错误文案提到「账号」（否则 0.2.1 用户不知道该去哪看余额）', /账号/.test(String(r.error)), String(r.error))

  // 旧宿主（没有 deepseekAccount 服务）：文案保持原样，不误导
  const legacy = await boot({})
  const r2 = await legacy.api('balance', {})
  eq(r2.ok, false, '旧宿主无 Key → 失败')
  eq(r2.error, '未找到 DeepSeek API Key', '旧宿主文案与 v1.9.5 完全一致（不出现账号字样）')
  eq(legacy.seen.getBalance, 0, '没有账号服务时不调用它')
}

console.log('[7] 手填 Key：优先级最高，且不打扰账号服务')
{
  outbound.length = 0
  const ready = { status: 'ready', value: [{ currency: 'CNY', balance: '1' }], bonusWallets: [] }
  const b = await boot({ account: ready })
  const r = await b.api('balance', { apiKey: '  sk-manual  ' })
  eq(r.ok, true, '手填 Key 查询成功')
  eq(r.source, 'apikey', '手填走 API Key 路径')
  eq(r.keySource, 'manual', 'keySource=manual')
  eq(b.seen.getBalance, 0, '手填 Key 时不调用账号服务')
  eq(outbound.length, 1, '手填 Key 产生一次出站请求')
  check('手填 Key 被 trim 后使用', String((outbound[0] && outbound[0].headers || {}).Authorization || '') === 'Bearer sk-manual',
    JSON.stringify(outbound[0] && outbound[0].headers))
}

console.log('[8] 账号态查询失败：如实报错、不静默回退')
{
  const throwing = await boot({ accountThrows: 'boom' })
  const r1 = await throwing.api('balance', {})
  eq(r1.ok, false, 'getBalance 抛错 → 失败')
  eq(r1.source, 'account', '来源仍是 account（不伪装成 Key 失败）')
  check('错误信息带上下文与出路提示',
    /账号余额查询失败/.test(String(r1.error)) && /API Key/.test(String(r1.error)), String(r1.error))

  const failed = await boot({ account: { status: 'failed' } })
  const r2 = await failed.api('balance', {})
  eq(r2.ok, false, 'status=failed → 失败')
  eq(r2.source, 'account', 'source=account')
  check('失败不会伪造 0 余额', r2.total === '' , JSON.stringify(r2))
  check('文案说明是 Platform 未返回数据', /Platform/.test(String(r2.error)), String(r2.error))

  // undefined 是契约外返回值（服务未实现好/RPC 异常）。它**不能**被当成「未登录」回退，
  // 否则会去查 API Key —— 那可能是另一个账户的余额。
  const undef = await boot({ accountReturnsUndefined: true })
  const r3 = await undef.api('balance', {})
  eq(r3.ok, false, 'getBalance 返回 undefined → 失败（不回退 API Key）')
  eq(r3.source, 'account', 'source=account（不伪装成 Key 失败）')
  check('文案提示服务未返回结果', /未返回结果/.test(String(r3.error)), String(r3.error))
}

console.log('[9] 客户端半端：来源判定、时区元数据、展示文案')
{
  const client = readFileSync(join(root, 'client.js'), 'utf8')
  check('余额卡按 source === "account" 分流', /balance\.source === "account"/.test(client), '未找到来源判定')
  check('查询时把浏览器时区偏移传上去（宿主服务必填字段）',
    /timezoneOffsetSeconds: -new Date\(\)\.getTimezoneOffset\(\) \* 60/.test(client), '未找到 balanceClientMeta')
  check('自动刷新也带 client 元数据（不是只传空对象）',
    /apiCall\("balance", balanceClientMeta\(\)\)/.test(client), 'onRefresh 未使用 balanceClientMeta')
  check('账号态展示「账号登录」而不是可用/不可用', /"账号登录"/.test(client), '未找到账号态文案')
  check('账号态明确标注平台钱包来源', /Platform 钱包/.test(client), '未找到来源说明')
  check('API Key 态仍保留 Key 来源展示（旧行为不回归）', /Key 来源：/.test(client), '未找到 Key 来源')
  check('余额面板说明两种口径的分工', /手动填入 API Key/.test(client), '未找到口径说明')
  check('币种符号跟随余额币种（USD 不再一律显示 ¥）', /balance\.currency === "USD" \? "\$" : "¥"/.test(client), '未找到币种符号')
  check('概览卡标题跟随币种', /总余额（" \+ balance\.currency \+ "）/.test(client), '未找到动态标题')
  check('余额金额走展示格式化（平台钱包实测 16 位小数，不能原样拼进界面）',
    /fmtBalanceAmount\(balance\.total\)/.test(client) && /fmtBalanceAmount\(balance\.toppedUp\)/.test(client),
    '未找到 fmtBalanceAmount 调用')
}

console.log('[10] 余额金额展示口径（截断到分 / 不足一分显示 <0.01）')
{
  // 从 bundle 源码里取出这个纯函数在 VM 里跑（它就定义在 factory 作用域内，未导出；
  // 直接复制实现会测不到真实代码，所以按真实源码求值）。
  const client = readFileSync(join(root, 'client.js'), 'utf8')
  const m = /function fmtBalanceAmount\(v\) \{[\s\S]*?\n\t\t\}/.exec(client)
  check('client.js 中存在 fmtBalanceAmount', !!m, '未找到函数体')
  if (m) {
    const fn = new Function('return (' + m[0] + ')')()
    // 真实响应实测是 "1234.5600000000000000" 这种 16 位小数字符串
    eq(fn('1234.5600000000000000'), '1234.56', '16 位小数截断到分')
    eq(fn('0.005'), '<0.01', '正的不足一分显示 <0.01（不能显示 0.00）')
    eq(fn('0E-16'), '0.00', '零值显示 0.00')
    eq(fn('-1.239'), '-1.23', '负数保留符号并截断')
    eq(fn('100'), '100.00', '整数补两位小数')
    eq(fn('99.00'), '99.00', 'API Key 态两位小数原样通过')
    eq(fn(''), '0', '空值兜底')
    eq(fn(null), '0', 'null 兜底')
    eq(fn('abc'), 'abc', '非数字原样返回（不吞掉异常数据）')
  }
}

console.log('[11] 账号态 provider 的兜底计价（deepseek-account 不在精确价表内的模型）')
{
  // 0.2.x「账号登录」的推理 provider 名是 deepseek-account。精确价表按模型名匹配、
  // 与 provider 无关，所以现役模型都能命中；但**表外的新模型**会落到 provider 兜底。
  // 若没有把 deepseek-account 登记进 PROVIDER_RATES，就会落到 GENERIC_RATES
  // （缓存价 0.5 vs 0.04、且 undefined tiered → 无峰谷半价），账号态费用被静默高估。
  const ts = Date.parse('2026-10-17T20:00:00+08:00')
  const p = priceFor('deepseek-account', 'deepseek-some-future-model', ts)
  eq(p.source, 'provider', '命中 provider 兜底（不是 generic）')
  eq(p.estimated, true, '兜底仍是估算口径')
  eq(p.tiered, true, '保留峰谷 tiered 语义')
  eq(p.rates.cacheRead, 0.04, '缓存价与 deepseek 对齐（不是 generic 的 0.5）')
  eq(p.subscription, false, '账号态不算订阅套餐')
  check('PROVIDER_RATES 里 deepseek-account 与 deepseek 同价',
    JSON.stringify(PROVIDER_RATES['deepseek-account'].rates) === JSON.stringify(PROVIDER_RATES.deepseek.rates)
      && PROVIDER_RATES['deepseek-account'].tiered === PROVIDER_RATES.deepseek.tiered,
    JSON.stringify({ acc: PROVIDER_RATES['deepseek-account'], ds: PROVIDER_RATES.deepseek }))
  check('与 generic 兜底确实不同（防止「登记了但没生效」）',
    JSON.stringify(PROVIDER_RATES['deepseek-account'].rates) !== JSON.stringify(GENERIC_RATES),
    JSON.stringify(GENERIC_RATES))
  // 现役模型的精确价表命中不受影响（provider 无关）
  const exact = priceFor('deepseek-account', 'deepseek-flash', ts)
  eq(exact.source === 'exact' || exact.source === 'synced', true, '现役模型仍走精确价表：' + exact.source)
  eq(exact.estimated, false, '现役模型不是估算')
}

console.log('[12] settings 读取兼容：0.2.x 的 describe() 与旧宿主的 get()')
{
  // 0.2.x 的 SettingsForms 没有 get()：旧实现在这里静默退化成默认名 DEEPSEEK_API_KEY，
  // 于是「用户自定义 apiKeyEnv」的部署会去查一个不存在的 Key 名。
  const credentials = {
    resolve: async (ref) => (ref === 'MY_DS_KEY' ? { value: 'sk-from-custom-ref', source: 'ref' } : undefined),
    set: async () => {},
    unset: async () => {},
    describe: async () => ({ configured: false, writable: true }),
  }
  const modernSettings = { describe: () => ([{ ns: 'llm-deepseek', value: { apiKeyEnv: 'MY_DS_KEY' } }]) }

  outbound.length = 0
  const modern = await boot({ account: null, settings: modernSettings, credentials })
  const r1 = await modern.api('balance', {})
  eq(r1.ok, true, '0.2.x：describe() 读出自定义 apiKeyEnv → 查询成功')
  eq(r1.keySource, 'credentials:ref', 'Key 来源是自定义 ref')
  check('出站使用的是自定义 ref 的值',
    String((outbound[0] && outbound[0].headers || {}).Authorization || '') === 'Bearer sk-from-custom-ref',
    JSON.stringify(outbound[0] && outbound[0].headers))

  // 旧宿主（只有 get）不能回归
  outbound.length = 0
  const legacySettings = { get: (ns) => (ns === 'llm-deepseek' ? { apiKeyEnv: 'MY_DS_KEY' } : undefined) }
  const legacy = await boot({ account: null, settings: legacySettings, credentials })
  const r2 = await legacy.api('balance', {})
  eq(r2.ok, true, '旧宿主：get() 路径仍工作')
  eq(r2.keySource, 'credentials:ref', '旧宿主 Key 来源一致')

  // 两套都不可用（settings 服务不存在）→ 仍走默认名
  outbound.length = 0
  const noSettings = await boot({ account: null, credentials })
  const r3 = await noSettings.api('balance', {})
  eq(r3.ok, false, '没有 settings 服务且默认名无值 → 失败')
  check('错误文案仍指向默认 Key 名', /DeepSeek API Key/.test(String(r3.error)), String(r3.error))
}

globalThis.fetch = realFetch
console.log('')
if (failures > 0) {
  console.log(`FAILED: ${failures} 项断言未通过`)
  process.exit(1)
}
console.log('OK: 全部断言通过')
process.exit(0)
