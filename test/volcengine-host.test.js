// ============================================================
// dsh-cost-tracker 火山方舟配额（宿主面）契约测试
//   node test/volcengine-host.test.js
//
// 这组断言拦的是「模块单测全绿、接进宿主却不好使」这一类缺陷，共六层：
//   ① volcengine-usage 路由真的注册进了 HTTP 面，且老配置下可用；
//   ② 凭据发现链：.credentials.yaml → 发出**已签名**的请求（不是 Bearer）；
//   ③ 端到端形状：真实响应 → 解析 → windowList（客户端直接渲染的形状）；
//   ④ **SecretAccessKey 绝不出现在任何响应里**（写进配置也不回显）；
//   ⑤ 失败路径软件降级：无凭据 / 401 / 结构变化都只回 ok:false + 中文原因，
//      不抛异常、不 500、不影响其它路由；
//   ⑥ v1.9.4 回归：宿主全局 fetch 被 undici 包污染（不解压 gzip、且不给
//      content-encoding）时，配额查询仍须成功 —— 现场就是面板上的
//      「配额查询不可用：火山方舟配额响应不是合法 JSON（GetCodingPlanUsage）」。
//
// 全程打桩 fetch，**绝不发真实网络请求**（真发出去也只会拿到 403）。
// ============================================================
import * as zlib from 'node:zlib'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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

// ---------- 沙箱：独立 DSH_HOME + 打桩 fetch ----------
const home = mkdtempSync(join(tmpdir(), 'cost-volc-'))
process.env.DSH_HOME = home

const AK = 'AKLTsandbox0001'
const SK = 'secretSandbox0001'
mkdirSync(join(home, 'storages'), { recursive: true })
// 预置「老配置」：没有 volcengine* 键，也没有 ui* 键 —— 升级前的那份文件
writeFileSync(join(home, 'storages', 'cost-tracker-config.json'), JSON.stringify({
  peakEnabled: true,
  cloudEnabled: false,
  deviceName: '火山测试机',
}), 'utf8')
// 凭据文件：模拟用户已有的 VOLC_ACCESSKEY / VOLC_SECRETKEY
writeFileSync(join(home, '.credentials.yaml'), `version: 1\nrefs:\n  VOLC_ACCESSKEY: ${AK}\n  VOLC_SECRETKEY: ${SK}\n`, 'utf8')

const realFetch = globalThis.fetch
/** 打桩 fetch：记录每次请求，按可配置的应答模式返回 */
let fetchCalls = []
let respond = () => ({ status: 200, body: { Result: { QuotaUsage: [] } } })
/** v1.9.4 回归开关：true = 模拟被 undici 包污染的宿主 —— 正文是原始 gzip 且不给 content-encoding */
let compressRaw = false
globalThis.fetch = async (url, init) => {
  const u = String(url)
  fetchCalls.push({ url: u, init })
  if (!u.startsWith('https://open.volcengineapi.com/')) {
    throw new Error('沙箱内只允许打向火山管控面: ' + u)
  }
  const r = respond(u, init) || {}
  const status = r.status ?? 200
  const json = typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})
  if (compressRaw) {
    return {
      status,
      ok: status >= 200 && status < 300,
      headers: { get: () => null },
      arrayBuffer: async () => zlib.gzipSync(Buffer.from(json, 'utf8')),
    }
  }
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    text: async () => json,
  }
}

const effectNow = (fn) => { try { fn() } catch (e) {} return () => {} }
const ctx = {
  get: () => undefined, inject: () => {}, effect: effectNow, on: () => {},
  tools: { register: () => {} }, commands: { register: () => {} },
  settings: undefined, logger: undefined,
}
let webHandler = null
ctx.webServer = { register: (route) => { webHandler = route && (route.handler || route); return () => {} } }

async function api(name, args, handler) {
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
  await (handler || webHandler)(req, res)
  const raw = chunks.join('')
  try { return JSON.parse(raw) } catch (e) { return { __raw: raw, __status: res.statusCode } }
}

console.log('dsh-cost-tracker 火山方舟配额宿主契约测试')
console.log(`  DSH_HOME = ${home}`)
console.log('')

const mod = await import(pathToFileURL(join(root, 'index.js')).href)
mod.default.apply(ctx)

// ---------- 1. 端到端：老配置 + 凭据文件 → 已签名请求 → 可渲染窗口 ----------
console.log('[1] 老配置升级后开箱可用（凭据发现链）')
{
  respond = () => ({
    status: 200,
    body: {
      ResponseMetadata: { RequestId: 'r1' },
      Result: {
        Status: 'Running',
        QuotaUsage: [
          { Level: 'session', Percent: 12.5, ResetTimestamp: 1782226478 },
          { Level: 'weekly', Percent: 0.5, ResetTimestamp: -1 },
          { Level: 'monthly', Percent: 88, ResetTimestamp: 1785686400000 },
        ],
      },
    },
  })
  fetchCalls = []
  const v = await api('volcengine-usage', { force: true })

  check('路由已注册且返回 ok', v.ok === true, JSON.stringify(v).slice(0, 240))
  check('老配置（无 volcengine* 键）也能取到凭据',
    v.keySource !== 'none' && !!v.keySource, `keySource=${v.keySource}`)
  check('选中了 CodingPlan 官方 Action', v.action === 'GetCodingPlanUsage', String(v.action))

  // 真的发了已签名请求，而不是 Bearer
  check('发出了恰好一次请求', fetchCalls.length === 1, `count=${fetchCalls.length}`)
  const auth = String(fetchCalls[0] && fetchCalls[0].init && fetchCalls[0].init.headers && fetchCalls[0].init.headers.authorization || '')
  check('使用的是 HMAC-SHA256 签名（不是 Bearer）',
    auth.startsWith('HMAC-SHA256 Credential=') && !auth.includes('Bearer'), auth.slice(0, 80))
  check('签名里的 AK 与凭据文件一致', auth.includes(`Credential=${AK}/`), auth.slice(0, 60))
  check('请求头带 X-Date / X-Content-Sha256',
    !!fetchCalls[0].init.headers['x-date'] && !!fetchCalls[0].init.headers['x-content-sha256'])

  // 客户端直接渲染的形状
  check('windowList 是三档且带中文标签',
    Array.isArray(v.windowList) && v.windowList.length === 3,
    JSON.stringify((v.windowList || []).map(w => w.name)))
  const five = (v.windowList || []).find(w => w.name === 'fiveHour')
  const weekly = (v.windowList || []).find(w => w.name === 'weekly')
  check('5 小时窗口百分比正确传递', five && five.percent === 12.5, JSON.stringify(five))
  check('0.5% 未被放大成 50%（不套用「≤1 视为小数」规则）', weekly && weekly.percent === 0.5, JSON.stringify(weekly))
  check('窗口顺序为 5 小时 → 周 → 月',
    (v.windowList || []).map(w => w.name).join(',') === 'fiveHour,weekly,monthly',
    (v.windowList || []).map(w => w.name).join(','))
}

// ---------- 1b. 真机响应形状（2026-09 实测 GetCodingPlanUsage） ----------
// 这几个断言用的是**线上真实返回**的字段与量级：Percent 是 0-100 的百分数但
// 数值极小（0.05–0.4），并附带 Cap/RewardTotalPercent。1 位小数会把 0.05
// 抹成 0%（看上去像没统计到），所以精度与 Cap 折算都要钉住。
console.log('[1b] 真机响应形状（Percent 小数 + Cap 折算）')
{
  respond = () => ({
    status: 200,
    body: {
      ResponseMetadata: { RequestId: 'live', Action: 'GetCodingPlanUsage', Service: 'ark', Region: 'cn-beijing' },
      Result: {
        Status: 'Running',
        UpdateTimestamp: 1789820117,
        QuotaUsage: [
          { Level: 'session', Percent: 0.39386899999999997, ResetTimestamp: 1789833269, Cap: 100, RewardTotalPercent: 0 },
          { Level: 'weekly', Percent: 0.09973339999999999, ResetTimestamp: 1789920000, Cap: 100, RewardTotalPercent: 0 },
          { Level: 'monthly', Percent: 0.04986669999999999, ResetTimestamp: 1792425599, Cap: 100, RewardTotalPercent: 0 },
        ],
        HasReward: false,
      },
    },
  })
  const v = await api('volcengine-usage', { force: true })
  const by = n => (v.windowList || []).find(w => w.name === n) || {}
  check('月度 0.0499% 不被抹成 0%', by('monthly').percent === 0.05, JSON.stringify(by('monthly')))
  check('周度保留两位小数', by('weekly').percent === 0.1, JSON.stringify(by('weekly')))
  check('5 小时窗口保留两位小数', by('fiveHour').percent === 0.39, JSON.stringify(by('fiveHour')))
  check('Cap 折算成绝对量（客户端可展示 used/quota）',
    by('monthly').quota === 100 && by('monthly').used === 0.05, JSON.stringify(by('monthly')))
  check('总量级极小的窗口仍给出真实重置时刻',
    /^2026-10-19T15:59:59/.test(by('monthly').resetsAt || ''), String(by('monthly').resetsAt))
}

// ---------- 2. 密钥零外泄 ----------
console.log('[2] 密钥绝不回显')
{
  const v = await api('volcengine-usage', { force: true })
  const raw = JSON.stringify(v)
  check('响应里不含 SecretAccessKey', !raw.includes(SK), raw.slice(0, 200))
  check('响应里不含 AccessKeyID 明文', !raw.includes(AK), raw.slice(0, 200))
  check('只回显来源与变量名', typeof v.keySource === 'string' && typeof v.keyEnv === 'string',
    `keySource=${v.keySource} keyEnv=${v.keyEnv}`)
  // keyEnv 必须是**真实变量名**（不是 undefined/空）：排查时面板要直接告诉用户去改哪个环境变量
  check('keyEnv 是真实变量名而非未知', v.keyEnv === 'VOLC_ACCESSKEY', String(v.keyEnv))

  // 写进配置卡片也不能被读回来。
  // 边界：AccessKeyID **会**回显（面板要用它预填输入框，且它在火山控制台里本就明文可见），
  // SecretAccessKey 才是真正的秘密，任何响应都不得包含它。
  const saved = await api('volcengine-config', { volcengineAccessKeyId: 'AKLTconfig0001', volcengineSecretAccessKey: 'secretConfig0001' })
  check('volcengine-config 写入后回显 AK 与「已配置」',
    saved.ok === true && saved.volcengineHasKeys === true && saved.volcengineAccessKeyId === 'AKLTconfig0001',
    JSON.stringify(saved))
  check('写入响应不含 SecretAccessKey 明文',
    !JSON.stringify(saved).includes('secretConfig0001'), JSON.stringify(saved))
  const status = await api('sync', {})
  check('sync 状态里也不含密钥',
    !JSON.stringify(status).includes('secretConfig0001'), JSON.stringify(status).slice(0, 200))
  // v1.9.0：SK 只进凭据库（本沙箱无凭据服务 → 内存态），**配置文件不再落明文**；
  // 读回依然只给布尔。
  const onDisk = readFileSync(join(home, 'storages', 'cost-tracker-config.json'), 'utf8')
  check('配置文件不再落 SK 明文（凭据库接管）', !onDisk.includes('secretConfig0001'))
  check('落盘后峰谷 / 云端字段未被挤掉',
    onDisk.includes('火山测试机') && JSON.parse(onDisk).peakEnabled === true)

  // 还原成「用凭据文件」，后续用例继续走凭据发现链（清空必须显式 clear:true）
  await api('volcengine-config', { clear: true })
}

// ---------- 2b. 防呆：空串不等于清空 ----------
// 我们从不回显 SK，所以跨浏览器/重开面板时 SK 输入框必然是空的。若把空串当成
// 「清空」，用户只改一下 AK 就会把已存好的 SK 一起抹掉 —— 那是静默丢凭据。
console.log('[2b] 保存语义：空串不覆盖已存的 SecretAccessKey')
{
  await api('volcengine-config', { volcengineAccessKeyId: 'AKLTkeep0001', volcengineSecretAccessKey: 'secretKeep0001' })
  // 只改 AK，SK 留空（模拟「输入框本来就是空的」）
  const r1 = await api('volcengine-config', { volcengineAccessKeyId: 'AKLTkeep0002', volcengineSecretAccessKey: '' })
  check('只改 AK 时 SK 未被清空', r1.volcengineHasKeys === true, JSON.stringify(r1))
  check('改后的 AK 已生效', r1.volcengineAccessKeyId === 'AKLTkeep0002', String(r1.volcengineAccessKeyId))
  fetchCalls = []
  const v1 = await api('volcengine-usage', { force: true })
  check('改 AK 后仍能用（说明 SK 还在）', v1.ok === true, JSON.stringify(v1).slice(0, 200))
  check('用的是新 AK', String(fetchCalls[0]?.init?.headers?.authorization || '').includes('Credential=AKLTkeep0002/'))

  // 显式 clear 才清空
  const r2 = await api('volcengine-config', { clear: true })
  check('clear:true 后两者都空', r2.volcengineHasKeys === false && r2.volcengineAccessKeyId === '', JSON.stringify(r2))
  const r3 = await api('volcengine-config', { volcengineAccessKeyId: 'AKLTonly0003' })
  check('只填 AK 时仍算未配齐', r3.volcengineHasKeys === false, JSON.stringify(r3))
  await api('volcengine-config', { clear: true })
}

// ---------- 3. 配置卡片填的凭据优先生效 ----------
console.log('[3] 配置卡片凭据优先于凭据文件')
{
  await api('volcengine-config', { volcengineAccessKeyId: 'AKLTcard9999', volcengineSecretAccessKey: 'secretCard9999' })
  fetchCalls = []
  const v = await api('volcengine-usage', { force: true })
  const auth = String(fetchCalls[0]?.init?.headers?.authorization || '')
  check('用的是卡片里填的 AK', auth.includes('Credential=AKLTcard9999/'), auth.slice(0, 60))
  check('来源标记为 credentials（SK 已入凭据库）', v.keySource === 'credentials', String(v.keySource))
  check('卡片凭据的 SK 不回显', !JSON.stringify(v).includes('secretCard9999'))
  await api('volcengine-config', { clear: true })
}

// ---------- 4. 失败路径软降级 ----------
console.log('[4] 失败路径：软失败，不抛异常、不 500')
{
  // 结构变化
  respond = () => ({ status: 200, body: { Result: { Weird: true } } })
  let v = await api('volcengine-usage', { force: true })
  check('结构变化 → ok:false 且带中文原因', v.ok === false && /未解析出用量窗口/.test(v.error || ''), String(v.error))
  check('结构变化时仍返回可渲染的空 windowList', Array.isArray(v.windowList) && v.windowList.length === 0)
  check('HTTP 层仍是 200（软失败，不是 500）', v.__status === undefined || v.__status === 200, String(v.__status))

  // 401
  respond = () => ({ status: 401, body: {} })
  v = await api('volcengine-usage', { force: true })
  check('401 → ok:false 且提示凭据/权限', v.ok === false && /权限|无效/.test(v.error || ''), String(v.error))

  // 业务信封
  respond = () => ({ status: 200, body: { ResponseMetadata: { Error: { Code: 'AccessDenied', Message: 'not authorized' } } } })
  v = await api('volcengine-usage', { force: true })
  check('业务信封 → 透出服务端 Code', v.ok === false && /AccessDenied/.test(v.error || ''), String(v.error))

  // 网络异常
  respond = () => { throw new Error('ECONNRESET') }
  v = await api('volcengine-usage', { force: true })
  check('网络异常 → ok:false 且不炸路由', v.ok === false && /ECONNRESET/.test(v.error || ''), String(v.error))
}

// ---------- 5b. 回归：推理 API Key 绝不能被当成 AccessKeyID ----------
// 真实故障现场：用户配了 baseURL 指向方舟 coding 端点的 provider（其 apiKeyEnv 是
// **推理用** API Key），凭据库里另有一对 VOLC_ACCESSKEY / VOLC_SECRETKEY。
// 早先的候选链把 provider 的 apiKeyEnv 也塞进 AK 候选，于是「推理 Key 当 AK +
// 凭据库的 SK」拼成假凭据 → 签名 401，而报错只说「凭据无效或无权限」，查不出原因。
console.log('[5b] 推理 API Key 不得被当作 AK（真实故障回归）')
{
  const home3 = mkdtempSync(join(tmpdir(), 'cost-volc-infer-'))
  mkdirSync(join(home3, 'storages'), { recursive: true })
  // 凭据库：只有 SK，**没有** AK —— 若把推理 Key 当 AK 就会误判为「凭据齐全」
  writeFileSync(join(home3, '.credentials.yaml'),
    'version: 1\nrefs:\n  BYTEBLUS_CODING_PLAN_CN_API_KEY: 11111111-2222-3333-4444-555555555555\n  VOLC_SECRETKEY: secretOnly\n', 'utf8')
  process.env.DSH_HOME = home3
  const fresh = await import(pathToFileURL(join(root, 'index.js')).href + '?infer=' + Date.now())
  let handler3 = null
  const ctx3 = {
    // 复刻真实 settings：provider 的 apiKeyEnv 是推理 Key
    get: (k) => (k === 'settings' ? {
      get: (ns) => (ns === 'llm-pi-ai' ? {
        providers: {
          'byteblus-coding-plan-cn': {
            apiKeyEnv: 'BYTEBLUS_CODING_PLAN_CN_API_KEY',
            baseURL: 'https://ark.cn-beijing.volces.com/api/coding/v3',
          },
        },
      } : undefined),
    } : undefined),
    inject: () => {}, effect: effectNow, on: () => {},
    tools: { register: () => {} }, commands: { register: () => {} },
    webServer: { register: (route) => { handler3 = route && (route.handler || route); return () => {} } },
  }
  fresh.default.apply(ctx3)
  fetchCalls = []
  const v = await api('volcengine-usage', { force: true }, handler3)
  check('推理 Key 不被当成 AK（仍判定为缺 AK）',
    v.ok === false && /缺 AccessKeyID|都缺/.test(v.error || ''), String(v.error))
  check('因此不发任何签名请求（避免拿到误导性的 401）', fetchCalls.length === 0, `count=${fetchCalls.length}`)
  check('提示里点名那条是推理 Key，不是配额凭据',
    /推理/.test(v.error || '') && /BYTEBLUS_CODING_PLAN_CN_API_KEY/.test(v.error || ''), String(v.error))
  process.env.DSH_HOME = home
  try { rmSync(home3, { recursive: true, force: true }) } catch (e) {}
}

// ---------- 5. 缓存与无凭据 ----------
console.log('[5] 缓存与无凭据')
{
  // 无凭据：换一个没有任何凭据的 DSH_HOME 重新加载插件
  const home2 = mkdtempSync(join(tmpdir(), 'cost-volc-none-'))
  mkdirSync(join(home2, 'storages'), { recursive: true })
  process.env.DSH_HOME = home2
  const fresh = await import(pathToFileURL(join(root, 'index.js')).href + '?nokeys=' + Date.now())
  let handler2 = null
  const ctx2 = {
    get: () => undefined, inject: () => {}, effect: effectNow, on: () => {},
    tools: { register: () => {} }, commands: { register: () => {} },
    webServer: { register: (route) => { handler2 = route && (route.handler || route); return () => {} } },
  }
  fresh.default.apply(ctx2)
  fetchCalls = []
  const v = await api('volcengine-usage', { force: true }, handler2)
  check('无凭据 → ok:false 且说明需要哪种凭据',
    v.ok === false && /AccessKeyID/.test(v.error || ''), String(v.error))
  check('无凭据时不发任何网络请求', fetchCalls.length === 0, `count=${fetchCalls.length}`)
  check('无凭据提示里带上候选环境变量名', /VOLC_ACCESSKEY/.test(v.keyEnv || ''), String(v.keyEnv))
  process.env.DSH_HOME = home

  // 缓存：连续两次非 force 调用只发一次请求
  respond = () => ({ status: 200, body: { Result: { QuotaUsage: [{ Level: 'session', Percent: 5, ResetTimestamp: 1782226478 }] } } })
  await api('volcengine-usage', { force: true }) // 先把缓存灌上
  fetchCalls = []
  await api('volcengine-usage', { force: false })
  await api('volcengine-usage', { force: false })
  check('120s TTL 内命中缓存（不重复打网络）', fetchCalls.length === 0, `count=${fetchCalls.length}`)
  await api('volcengine-usage', { force: true })
  check('force=true 绕过缓存', fetchCalls.length === 1, `count=${fetchCalls.length}`)

  try { rmSync(home2, { recursive: true, force: true }) } catch (e) {}
}

// ---------- 6. v1.9.4 回归：宿主全局 fetch 不解压 gzip ----------
// 现场（2026-09-24 真实故障）：DSH 宿主进程里 dshmarket 静态 import 了 npm 的 undici 包，
// 此后 Node 内置 fetch 不再解压 gzip —— 响应既没有 content-encoding，正文也是原始压缩字节。
// 插件面板因此报「配额查询不可用：火山方舟配额响应不是合法 JSON（GetCodingPlanUsage）」。
// 修法在 credstore.js：请求带 accept-encoding: identity + 按字节自解压；这一节端到端验证。
console.log('[6] 回归：宿主 fetch 返回未解压 gzip（无 content-encoding）时仍可用')
{
  respond = () => ({
    status: 200,
    body: {
      ResponseMetadata: { RequestId: 'gz-live', Action: 'GetCodingPlanUsage' },
      Result: { Status: 'Running', QuotaUsage: [
        { Level: 'session', Percent: 0.41, ResetTimestamp: 1782226478 },
        { Level: 'weekly', Percent: 3.2, ResetTimestamp: 1782658478 },
        { Level: 'monthly', Percent: 12.5, ResetTimestamp: 1784746800 },
      ] },
    },
  })
  compressRaw = true
  const v = await api('volcengine-usage', { force: true })
  check('未解压 gzip 下配额查询成功（不再是「不是合法 JSON」）',
    v.ok === true && !/不是合法 JSON/.test(v.error || ''), JSON.stringify({ ok: v.ok, error: v.error }))
  check('三档窗口都解析出来',
    !!(v.windows && v.windows.fiveHour && v.windows.weekly && v.windows.monthly),
    JSON.stringify(v.windows))
  check('窗口百分比未被放大（0.41% 仍是 0.41）',
    v.windows && v.windows.fiveHour && v.windows.fiveHour.percent === 0.41,
    JSON.stringify(v.windows && v.windows.fiveHour))
  check('命中 CodingPlan 官方 Action', v.action === 'GetCodingPlanUsage', String(v.action))
  check('请求侧要的是未压缩正文（accept-encoding: identity）',
    fetchCalls.length > 0 && String(fetchCalls[0].init.headers['accept-encoding'] || '').toLowerCase() === 'identity',
    JSON.stringify(fetchCalls[0] && fetchCalls[0].init.headers))
  compressRaw = false
  respond = () => ({ status: 200, body: { Result: { QuotaUsage: [] } } })
}

globalThis.fetch = realFetch
try { rmSync(home, { recursive: true, force: true }) } catch (e) {}

console.log('')
if (failures > 0) {
  console.log(`FAILED: ${failures} 项断言未通过`)
  process.exit(1)
}
console.log('OK: 全部断言通过')
process.exit(0)
