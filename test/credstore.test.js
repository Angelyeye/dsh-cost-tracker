// ============================================================
// dsh-cost-tracker 凭据封套 + 出站防护 单测
//   node test/credstore.test.js
//
// 覆盖 v1.9.0 的「密钥零落盘 + 凭据外带防护」两件事：
//   ① createCredSeam：凭据服务在场时用凭据库，缺席时退内存态并如实标注；
//   ② migrateLegacySecrets：把 v1.8.x 明文（cloudToken / 火山 SK）搬进凭据库，
//      并从配置对象里清除（幂等；凭据库已有值时不覆盖）；
//   ③ assertAllowedHost：白名单 / https 强制 / 非法 URL；
//   ④ safeFetch：3xx 拒绝跟随（防重定向把 Authorization 带去别处）、
//      白名单外拒发、init.headers 与 opts.headers 正确合并。
// ============================================================
import { createCredSeam, migrateLegacySecrets, safeFetch, assertAllowedHost, hostnameOf, CRED_REFS } from '../credstore.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`)
  else {
    failures++
    console.log(`  FAIL  ${name}`)
    if (detail !== undefined) console.log(`        ${detail}`)
  }
}

console.log('dsh-cost-tracker 凭据封套 + 出站防护测试')
console.log('')

/** 最小可用的凭据服务替身（与 DSH ctx.credentials 同形） */
function fakeCredService() {
  const store = new Map()
  return {
    store,
    async resolve(ref) { return store.has(ref) ? { value: store.get(ref), source: 'local-store' } : undefined },
    async describe(ref) { return { configured: store.has(ref), source: 'local-store', writable: true } },
    async set(ref, value) { store.set(ref, value) },
    async unset(ref) { store.delete(ref) },
  }
}

// ---------- 1. 封套后端选择 ----------
console.log('[1] createCredSeam：凭据库在场 / 缺席')
{
  const svc = fakeCredService()
  const seam = createCredSeam(svc)
  check('有凭据服务 → backend=credentials', seam.backend === 'credentials', seam.backend)
  await seam.save(CRED_REFS.cloudToken, 'tok-abc')
  const r = await seam.resolve(CRED_REFS.cloudToken)
  check('保存后可解析', r.value === 'tok-abc' && r.backend === 'credentials', JSON.stringify(r))
  check('落到了凭据服务里（不是封套内部）', svc.store.get(CRED_REFS.cloudToken) === 'tok-abc')
  const d = await seam.describe(CRED_REFS.cloudToken)
  check('describe 只给布尔不给值', d.configured === true && JSON.stringify(d).indexOf('tok-abc') < 0, JSON.stringify(d))
  await seam.clear(CRED_REFS.cloudToken)
  check('clear 后未配置', (await seam.describe(CRED_REFS.cloudToken)).configured === false)

  const bare = createCredSeam(undefined)
  check('无凭据服务 → backend=memory（如实标注）', bare.backend === 'memory', bare.backend)
  check('无凭据服务 → durable=false（不算持久化）', bare.durable === false, String(bare.durable))
  const savedBare = await bare.save(CRED_REFS.volcengineSecret, 'sk-1')
  check('内存态写入返回 false（未持久化）', savedBare === false, String(savedBare))
  const rb = await bare.resolve(CRED_REFS.volcengineSecret)
  check('内存态仍可用（同进程内）', rb.value === 'sk-1' && rb.backend === 'memory', JSON.stringify(rb))

  // 只有 resolve 没有 set 的旧宿主：不能悄悄丢，落内存态
  const half = createCredSeam({ resolve: async () => undefined, describe: async () => ({ configured: false, writable: false }) })
  const savedHalf = await half.save(CRED_REFS.cloudToken, 'tok-half')
  check('旧宿主（无 set）落内存态且报「未持久化」', savedHalf === false && (await half.resolve(CRED_REFS.cloudToken)).value === 'tok-half')
  check('旧宿主 durable=false', half.durable === false)
}

// ---------- 2. 旧明文迁移 ----------
console.log('[2] migrateLegacySecrets：配置文件明文 → 凭据库')
{
  const svc = fakeCredService()
  const seam = createCredSeam(svc)
  const cfg = {
    cloudToken: 'dshc_legacy_token_value',
    volcengineSecretAccessKey: 'legacySkValue',
    volcengineAccessKeyId: 'AKLTlegacy',
    cloudUrl: 'https://cost.example.com',
    peakEnabled: true,
  }
  const r1 = await migrateLegacySecrets(cfg, seam)
  check('报告搬移了两项', r1.moved.length === 2, JSON.stringify(r1))
  check('配置对象里的密钥被清空', cfg.cloudToken === '' && cfg.volcengineSecretAccessKey === '', JSON.stringify(cfg))
  check('非密钥字段未被牵连', cfg.volcengineAccessKeyId === 'AKLTlegacy' && cfg.peakEnabled === true)
  check('令牌进了凭据库', svc.store.get(CRED_REFS.cloudToken) === 'dshc_legacy_token_value')
  check('SK 进了凭据库', svc.store.get(CRED_REFS.volcengineSecret) === 'legacySkValue')

  // 幂等：再跑一次不再有变更
  const cfg2 = { cloudToken: '', volcengineSecretAccessKey: '' }
  const r2 = await migrateLegacySecrets(cfg2, seam)
  check('清空后再迁移是空操作', r2.changed === false && r2.moved.length === 0, JSON.stringify(r2))

  // 凭据库已有值时不覆盖（避免旧配置文件里的陈值把新凭据顶掉）
  const cfg3 = { cloudToken: 'stale_token_from_old_file', volcengineSecretAccessKey: '' }
  const r3 = await migrateLegacySecrets(cfg3, seam)
  check('凭据库已有值 → 不覆盖，仅提示', svc.store.get(CRED_REFS.cloudToken) === 'dshc_legacy_token_value' && r3.notes.length === 1, JSON.stringify(r3))
  check('陈值同样从配置对象里清掉', cfg3.cloudToken === '')
}

// ---------- 2b. 安全边界：凭据库不可写时**保留**明文 ----------
// 「配置文件零明文」不能以丢凭据为代价：宿主没有凭据服务（或只读）时，
// 密钥只能留在内存 → 一旦清掉配置里的明文，重启后凭据就永久丢了。
console.log('[2b] 凭据库不可写 → 明文保留（不丢凭据）')
{
  const readOnly = createCredSeam({ resolve: async () => undefined, describe: async () => ({ configured: false, writable: false }) })
  const cfg = { cloudToken: 'must_survive_token', volcengineSecretAccessKey: 'must_survive_sk', cloudUrl: 'https://x.example.com' }
  const r = await migrateLegacySecrets(cfg, readOnly)
  check('未报告已搬移', r.moved.length === 0, JSON.stringify(r))
  check('pending=true（有悬而未决的明文）', r.pending === true)
  check('令牌明文被保留', cfg.cloudToken === 'must_survive_token', cfg.cloudToken)
  check('SK 明文被保留', cfg.volcengineSecretAccessKey === 'must_survive_sk', cfg.volcengineSecretAccessKey)
  check('提示里说明原因与处置', r.notes.length === 2 && /凭据库不可写/.test(r.notes[0]), JSON.stringify(r.notes))
  check('本次进程内仍能用（内存副本）', (await readOnly.resolve(CRED_REFS.cloudToken)).value === 'must_survive_token')
}

// ---------- 3. 出站白名单 ----------
console.log('[3] assertAllowedHost：白名单 / https / 非法 URL')
{
  check('白名单内 https → 放行', assertAllowedHost('https://api.deepseek.com/user/balance', ['api.deepseek.com']).ok === true)
  check('白名单外 → 拒绝', assertAllowedHost('https://evil.example.com/x', ['api.deepseek.com']).ok === false)
  check('白名单大小写不敏感', assertAllowedHost('https://API.DeepSeek.com/x', ['api.deepseek.com']).ok === true)
  check('非 loopback 的 http → 拒绝', assertAllowedHost('http://api.deepseek.com/x', ['api.deepseek.com']).ok === false)
  check('loopback http → 放行（本地云端服务）', assertAllowedHost('http://127.0.0.1:8787/x', ['127.0.0.1']).ok === true)
  check('localhost http → 放行', assertAllowedHost('http://localhost:8787/x', []).ok === true)
  check('非法 URL → 拒绝', assertAllowedHost('not a url', []).ok === false)
  check('空白名单 = 只校验协议', assertAllowedHost('https://any.example.com/x', []).ok === true)
  check('hostnameOf 提取主机名', hostnameOf('https://a.b.c:8443/x') === 'a.b.c', hostnameOf('https://a.b.c:8443/x'))
}

// ---------- 4. safeFetch ----------
console.log('[4] safeFetch：重定向 / 白名单 / 头合并')
{
  const calls = []
  const mkRes = (status, headers) => ({
    status,
    headers: { get: (k) => (headers || {})[String(k).toLowerCase()] || null },
    text: async () => 'body',
  })
  let next = mkRes(200)
  const fetchFn = async (url, init) => { calls.push({ url, init }); return next }

  const ok = await safeFetch('https://api.deepseek.com/x', { allowHosts: ['api.deepseek.com'], fetchFn, headers: { authorization: 'Bearer s' } })
  check('白名单内 200 → 正常返回', ok.status === 200)
  check('强制 redirect=manual', calls[0].init.redirect === 'manual', JSON.stringify(calls[0].init.redirect))

  // 白名单外：必须在发请求之前就拒绝（否则凭据已经发出去了）
  const before = calls.length
  let denied = ''
  try { await safeFetch('https://evil.example.com/x', { allowHosts: ['api.deepseek.com'], fetchFn }) } catch (e) { denied = String(e.message) }
  check('白名单外拒绝且**未发出请求**', calls.length === before && /白名单/.test(denied), denied)

  // 3xx：携带凭据时**不跨主机**跟随（错误里点名去向主机，但不带凭据）
  next = mkRes(302, { location: 'https://evil.example.com/steal' })
  let redir = ''
  try { await safeFetch('https://api.deepseek.com/x', { allowHosts: ['api.deepseek.com'], fetchFn, headers: { authorization: 'Bearer secret' } }) } catch (e) { redir = String(e.message) }
  check('带凭据的跨主机 3xx 拒绝跟随并点名去向', /跨主机重定向/.test(redir) && /evil\.example\.com/.test(redir), redir)
  check('错误信息里不含凭据本身', redir.indexOf('secret') < 0, redir)

  // 同主机 3xx（官方定价页 /pricing → /pricing/ 这种加斜杠）：必须跟随，否则功能被挡死
  {
    const seen = []
    let hop = 0
    const hopFetch = async (u, init) => {
      seen.push(String(u))
      hop += 1
      return hop === 1 ? mkRes(302, { location: '/zh-cn/quick_start/pricing/' }) : mkRes(200)
    }
    const r = await safeFetch('https://api-docs.deepseek.com/zh-cn/quick_start/pricing', { allowHosts: ['api-docs.deepseek.com'], fetchFn: hopFetch })
    check('同主机 302 被跟随（加斜杠场景）', r.status === 200 && seen.length === 2, JSON.stringify(seen))
    check('跟随后请求的是重定向目标', seen[1] === 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', seen[1])
  }

  // 带凭据的同主机 302：也应跟随（凭据没有跨主机，风险为零）
  {
    let hop = 0
    const hopFetch = async () => { hop += 1; return hop === 1 ? mkRes(302, { location: 'https://api.deepseek.com/real' }) : mkRes(200) }
    const r = await safeFetch('https://api.deepseek.com/x', { allowHosts: ['api.deepseek.com'], fetchFn: hopFetch, headers: { authorization: 'Bearer s' } })
    check('带凭据的同主机 302 同样跟随', r.status === 200, String(r.status))
  }

  // 无凭据但重定向到白名单外：拒绝（每一跳都校验白名单）
  {
    const outFetch = async () => mkRes(302, { location: 'https://other.example.com/x' })
    let err = ''
    try { await safeFetch('https://api.deepseek.com/x', { allowHosts: ['api.deepseek.com'], fetchFn: outFetch }) } catch (e) { err = String(e.message) }
    check('重定向到白名单外被拒（无凭据也校验）', /重定向被拒绝/.test(err), err)
  }

  // 跳转次数上限
  {
    let n = 0
    const loopFetch = async (u) => { n += 1; return mkRes(302, { location: '/loop' + n }) }
    let err = ''
    try { await safeFetch('https://api.deepseek.com/start', { allowHosts: ['api.deepseek.com'], fetchFn: loopFetch }) } catch (e) { err = String(e.message) }
    check('无限跳转被上限挡下（≤4 次请求）', /重定向次数过多/.test(err) && n <= 4, `${err} · 请求数=${n}`)
  }

  // 303 → 降级为 GET 并丢弃 body
  {
    const calls303 = []
    let first = true
    const f303 = async (u, init) => { calls303.push({ u, method: init.method, body: init.body }); if (first) { first = false; return mkRes(303, { location: '/done' }) } return mkRes(200) }
    await safeFetch('https://api.deepseek.com/submit', { allowHosts: ['api.deepseek.com'], fetchFn: f303, init: { method: 'POST', body: '{"a":1}' } })
    check('303 降级为 GET 且丢弃 body', calls303.length === 2 && calls303[1].method === 'GET' && calls303[1].body === undefined, JSON.stringify(calls303))
  }

  // init.headers 与 opts.headers 合并（火山签名头不能被 opts 覆盖/丢弃）
  next = mkRes(200)
  calls.length = 0
  await safeFetch('https://open.volcengineapi.com/', { allowHosts: ['open.volcengineapi.com'], fetchFn, init: { method: 'POST', headers: { authorization: 'VOLC sig', host: 'open.volcengineapi.com' }, body: '{}' }, headers: { 'x-extra': '1' } })
  const h = calls[0].init.headers
  check('init.headers 未被覆盖', h.authorization === 'VOLC sig' && h.host === 'open.volcengineapi.com', JSON.stringify(h))
  check('opts.headers 被并入', h['x-extra'] === '1', JSON.stringify(h))
  check('method / body 透传', calls[0].init.method === 'POST' && calls[0].init.body === '{}')
}

// ---------- 4b. 回归：fetch 原生签名（真实故障：POST 退化成 GET → 云端 405） ----------
// 现场：index.js 把 safeFetch 当作 `<typeof fetch>` 传给同步引擎：
//   fetchFn: (url, init) => safeFetch(url, Object.assign({}, init, { allowHosts }))
// 早期实现只读 `opts.init`，于是 method/body 全丢 —— 同步请求变成 GET，
// 云端返回 405「方法不允许」，水位永远不前进（2026-09-20 真实故障）。
// 这一节就是那次故障的回归护栏：只要有人在 safeFetch 里把 fetch 签名丢掉，它立刻变红。
console.log('[4b] 回归：fetch 原生签名不得丢失 method / body / headers')
{
  const sent = []
  const inner = async (url, init) => {
    sent.push({ url: String(url), method: init && init.method, body: init && init.body, headers: (init && init.headers) || {}, redirect: init && init.redirect })
    return { status: 200, headers: { get: () => null }, text: async () => 'ok' }
  }
  // 完全照抄 index.js 的接线方式
  const fetchLike = (url, init) => safeFetch(url, Object.assign({}, init, { allowHosts: ['tokencost.example.com'], fetchFn: inner }))

  await fetchLike('https://tokencost.example.com/api/v1/ingest/records', {
    method: 'POST',
    headers: { authorization: 'Bearer dshc_x', 'content-type': 'application/json' },
    body: '{"n":1}',
  })
  check('实际发出的方法是 POST（不是 GET）', sent[0] && sent[0].method === 'POST', JSON.stringify(sent[0] && sent[0].method))
  check('请求体完整保留（GET 化会丢正文）', sent[0] && sent[0].body === '{"n":1}', JSON.stringify(sent[0] && sent[0].body))
  check('凭据头保留（仍参与跨主机判断）', sent[0] && sent[0].headers.authorization === 'Bearer dshc_x', JSON.stringify(sent[0] && sent[0].headers))
  check('content-type 保留（云端信封校验依赖它）', sent[0] && sent[0].headers['content-type'] === 'application/json', JSON.stringify(sent[0] && sent[0].headers))
  check('顶层签名同样强制 redirect=manual', sent[0] && sent[0].redirect === 'manual', JSON.stringify(sent[0] && sent[0].redirect))

  // 无 method 时保持 fetch 默认语义（GET）
  sent.length = 0
  await fetchLike('https://tokencost.example.com/api/v1/health', {})
  check('无 method 时仍是 GET（fetch 默认语义）', sent[0] && sent[0].method === undefined, JSON.stringify(sent[0] && sent[0].method))

  // 调用方即便传 redirect:'follow' 也以安全策略为准
  sent.length = 0
  await fetchLike('https://tokencost.example.com/x', { method: 'POST', redirect: 'follow', body: 'x' })
  check('调用方传 redirect:follow 也被强制 manual（安全优先）', sent[0] && sent[0].redirect === 'manual', JSON.stringify(sent[0] && sent[0].redirect))

  // 跨主机 + 凭据：fetch 签名下同样拒绝（安全边界不因入参形状而失效）
  const evil = async () => ({ status: 302, headers: { get: () => 'https://evil.example.com/x' }, text: async () => '' })
  let err = ''
  try {
    const fetchLikeEvil = (url, init) => safeFetch(url, Object.assign({}, init, { allowHosts: ['tokencost.example.com'], fetchFn: evil }))
    await fetchLikeEvil('https://tokencost.example.com/api/v1/ingest/records', { method: 'POST', headers: { authorization: 'Bearer dshc_x' }, body: '{}' })
  } catch (e) { err = String(e.message) }
  check('fetch 签名下跨主机重定向仍被拒', /跨主机重定向/.test(err), err)
}

console.log('')
if (failures) { console.log('FAILED: ' + failures + ' 项断言未通过'); process.exit(1) }
console.log('全部通过')
