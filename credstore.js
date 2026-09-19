// ============================================================
// DSH 花费统计插件 —— 凭据库封套 + 出站防护（纯逻辑 + seam 注入，可独立测试）
//
// 设计目标：**密钥零落盘**。密钥只存 DSH 凭据库（ctx.credentials，.credentials.yaml
// 由宿主凭据服务托管），配置文件里只允许出现「是否已配置」的布尔标记。
//
// 三层防线：
//   1. 存取封套：save / resolve / describe / clear —— 统一命名（COST_TRACKER_* 引用名），
//      未挂载凭据服务时回落「内存态」并在返回值里如实标注（绝不为兼容而悄悄把
//      明文写回配置文件）；save() 的返回值明确区分「已持久化」与「只在内存里」。
//   2. 旧明文迁移：migrateLegacySecrets() —— 启动时把 v1.8.x 明文落盘的
//      volcengineSecretAccessKey（base64 混淆）与 cloudToken 搬进凭据库，
//      然后从配置对象里清除并回写净化后的配置文件（幂等，带 secretsMigrated 标记）。
//      **只有确认已持久化才清除明文**：凭据库不可写时保留明文，绝不丢凭据。
//   3. 出站防护：safeFetch() —— 每一跳都过主机白名单；非 loopback 强制 https；
//      redirect:'manual' + 自管跳转（最多 3 跳）：**携带凭据的请求不跨主机跟随**
//      （防重定向把凭据带去别处），不带凭据的请求可在白名单内跟随
//      （官方定价页 `/pricing` → `/pricing/` 这种同站加斜杠的 302 必须放行）。
// ============================================================

/** 本插件占用的凭据引用名（POSIX shell 标识符风格，宿主凭据库通用） */
export const CRED_REFS = {
  cloudToken: 'COST_TRACKER_CLOUD_TOKEN',
  volcengineSecret: 'COST_TRACKER_VOLCENGINE_SK',
}

function isLoopbackHost(host) {
  return /^(localhost|127\.0\.0\.1|\[::1?\]|::1)$/i.test(String(host || ''))
}

/** 从 URL 提取 hostname（不含端口）；非法 URL 返回 '' */
export function hostnameOf(url) {
  try {
    return String(new URL(String(url)).hostname)
  } catch (e) {
    return ''
  }
}

/**
 * 出站白名单校验。
 * @param {string} url - 目标地址
 * @param {string[]} allowHosts - 允许的 hostname 精确匹配列表（大小写不敏感）
 * @returns {{ok:boolean, reason:string, host:string}}
 */
export function assertAllowedHost(url, allowHosts) {
  const host = hostnameOf(url)
  if (!host) return { ok: false, reason: 'URL 无法解析', host: '' }
  const list = (allowHosts || []).map((h) => String(h || '').toLowerCase()).filter(Boolean)
  const lower = host.toLowerCase()
  if (list.length && list.indexOf(lower) < 0) {
    return { ok: false, reason: '目标主机不在出站白名单内：' + lower + '（允许：' + list.join(', ') + '）', host: lower }
  }
  const proto = String(new URL(String(url)).protocol || '').toLowerCase()
  if (proto !== 'https:' && !isLoopbackHost(host)) {
    return { ok: false, reason: '非本机地址必须使用 https（当前 ' + proto + '）', host: lower }
  }
  return { ok: true, reason: '', host: lower }
}

/**
 * 带防护的 fetch 封套（v1.9.0，含重定向策略）。
 *
 * ⚠️ **必须同时接受两种入参形状**（v1.9.0 首个版本的缺陷教训）：
 *   · `safeFetch(url, { init: { method, body }, allowHosts })` —— 本模块自己的文档形状；
 *   · `safeFetch(url, { method, body, headers, allowHosts })` —— **fetch 原生签名**，
 *     即 `<typeof fetch>` 位置上的封装写法 `(url, init) => safeFetch(url, { ...init, allowHosts })`。
 * 只认 `opts.init` 会让后者丢掉 method/body：POST 静默退化成 GET、请求体消失，
 * 云端回 405「方法不允许」——真实故障现场就是同步全面失败、水位不前进。
 * 因此 fetch 的 init 字段在顶层也识别一遍（`opts.init` 优先）。
 *
 * 规则（按「凭据是否会跟着跑」区分，而不是一刀切拒绝 3xx）：
 *   · 每次请求（含每一跳）都过 `assertAllowedHost`：主机白名单 + 非本机强制 https；
 *   · `redirect: 'manual'` 自己处理跳转，最多 3 跳；
 *   · **携带凭据**（authorization / api-key 等头）的请求**不跨主机跟随** ——
 *     跨主机重定向一律失败并点名去向主机，这就是「防凭据外带」的硬边界；
 *   · 不带凭据的请求（如抓取官方定价页：`/pricing` → `/pricing/` 这种同站加斜杠）
 *     可以在白名单内跟随，否则会把正常功能也一并挡死。
 *
 * @param {string} url
 * @param {{headers?:object, init?:object, allowHosts?:string[], timeoutMs?:number, fetchFn?:typeof fetch}} opts
 */
export async function safeFetch(url, opts) {
  const o = opts || {}
  const f = o.fetchFn || globalThis.fetch
  const allowHosts = o.allowHosts || []
  const MAX_HOPS = 3
  const init = Object.assign({}, o.init || {})
  // ⚠️ 顶层 fetch 同名字段兜底（`opts.init` 优先）。v1.9.0 首个版本的缺陷就在
  // 这里：index.js 按 fetch 原生签名接线 `(url, init) => safeFetch(url, {...init, allowHosts})`，
  // 而本函数当时只读 `opts.init`，于是 method/body 被丢掉 —— POST 静默退化成 GET、
  // 请求体消失，云端回 405「方法不允许」，同步全面失败（水位不前进）。
  for (const k of ['method', 'body', 'headers', 'signal', 'cache', 'credentials', 'mode', 'referrer', 'referrerPolicy', 'integrity', 'keepalive', 'window', 'duplex']) {
    if (o[k] !== undefined && init[k] === undefined) init[k] = o[k]
  }
  // init.headers 在前、opts.headers 在后：调用方经 init 传的签名头不被覆盖
  const headers = Object.assign({}, init.headers || {}, o.headers || {})
  const credentialHeader = Object.keys(headers).find((k) => /^(authorization|proxy-authorization|x-api-key|api-key)$/i.test(k))
  let current = String(url)
  let method = init.method
  let body = init.body

  for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
    const guard = assertAllowedHost(current, allowHosts)
    if (!guard.ok) throw new Error('出站被拒绝：' + guard.reason)
    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), o.timeoutMs || 15000)
    let res
    try {
      res = await f(current, Object.assign({}, init, { method, body, headers, redirect: 'manual', signal: ac.signal }))
    } finally {
      clearTimeout(timer)
    }
    if (!(res.status >= 300 && res.status < 400)) return res
    const loc = typeof res.headers.get === 'function' ? (res.headers.get('location') || '') : ''
    if (!loc) return res // 3xx 但没给 Location：交给调用方按状态自行判断
    let target
    try {
      target = new URL(loc, current).toString()
    } catch (e) {
      throw new Error('重定向目标无法解析：' + loc)
    }
    const fromHost = hostnameOf(current)
    const toHost = hostnameOf(target)
    if (credentialHeader && toHost !== fromHost) {
      throw new Error('目标返回跨主机重定向 ' + res.status + ' → ' + toHost + '（携带 ' + credentialHeader + ' 的请求不跨主机跟随，防止凭据外带）')
    }
    const hopGuard = assertAllowedHost(target, allowHosts)
    if (!hopGuard.ok) throw new Error('重定向被拒绝（' + res.status + ' → ' + toHost + '）：' + hopGuard.reason)
    if (hop === MAX_HOPS) throw new Error('重定向次数过多（>' + MAX_HOPS + ' 跳），已放弃：' + target)
    // 303（以及 301/302 上的 POST）按 HTTP 语义降级为 GET 并丢弃 body
    if (res.status === 303 || ((res.status === 301 || res.status === 302) && String(method || '').toUpperCase() === 'POST')) {
      method = 'GET'
      body = undefined
    }
    current = target
  }
  throw new Error('重定向处理异常')
}

/**
 * 凭据封套工厂：包装宿主 credentials 服务；未挂载或只读时退化为**内存态**存储，
 * 并通过 backend 如实标注（'memory' / 'credentials'），调用方据此在 UI 提示
 * 「凭据库不可用，密钥仅保存在本进程内存，重启后需重填」。
 *
 * `save()` 的返回值语义（v1.9.0 起明确）：
 *   true  = **已持久化**到凭据库（重启后仍在）；
 *   false = 只写进了进程内存（凭据服务缺席或只读）—— 迁移逻辑据此决定
 *           「能不能把配置文件里的明文删掉」，避免为了「零明文」而丢凭据。
 *
 * @param {object|undefined} cred - ctx.get('credentials')（可能为 undefined）
 * @returns {{backend:string, durable:boolean, save:async, resolve:async, describe:async, clear:async}}
 */
export function createCredSeam(cred) {
  const memory = new Map()
  const usable = !!cred && typeof cred.resolve === 'function'
  const durable = usable && typeof cred.set === 'function' && typeof cred.unset === 'function'
  return {
    backend: durable ? 'credentials' : 'memory',
    durable,
    async save(ref, value) {
      const v = String(value == null ? '' : value).trim()
      if (!v) return false
      if (durable) {
        await cred.set(ref, v)
        return true
      }
      // 只读/无凭据服务：留一份内存副本让本次进程可用，但**不算持久化**
      memory.set(ref, v)
      return false
    },
    async resolve(ref) {
      if (usable) {
        try {
          const r = await cred.resolve(ref)
          if (r && r.value) return { value: String(r.value), backend: 'credentials' }
        } catch (e) { /* 落到内存态 */ }
      }
      if (memory.has(ref)) return { value: memory.get(ref), backend: 'memory' }
      return { value: '', backend: usable ? 'credentials' : 'memory' }
    },
    async describe(ref) {
      if (usable && typeof cred.describe === 'function') {
        try {
          const d = await cred.describe(ref)
          if (d && (d.configured || d.configured === 'local-store')) return { configured: true, writable: d.writable !== false, backend: 'credentials' }
        } catch (e) { /* 落内存态 */ }
      }
      return { configured: memory.has(ref), writable: durable, backend: durable ? 'credentials' : 'memory' }
    },
    async clear(ref) {
      memory.delete(ref)
      if (durable) {
        try { await cred.unset(ref) } catch (e) { /* 尽力而为 */ }
      }
      return true
    },
  }
}

/**
 * v1.8.x 明文密钥迁移（幂等）。
 *
 * 旧版把 volcengineSecretAccessKey（base64 混淆后）与 cloudToken 直接写进
 * cost-tracker-config.json。本函数把它们搬进凭据库，然后**清除配置对象里的
 * 明文字段**并返回 {changed}；调用方负责把净化后的配置落盘。
 *
 * **安全边界**：只有当凭据库确实可写（`save()` 返回 true，即已持久化）时才清除
 * 配置里的明文。宿主没有凭据服务、或凭据服务只读时，明文**原样保留** ——
 * 「配置文件零明文」不能以丢凭据为代价（那种情况下密钥只在内存里，重启即失效）。
 *
 * 迁移后 SK/AK 查询链：凭据库 → 环境变量（原有链保持不变）。
 *
 * @param {object} cfg - normalizePluginConfig 产出的配置对象（会被就地修改）
 * @param {object} seam - createCredSeam 的实例
 * @returns {Promise<{changed:boolean, moved:string[], notes:string[]}>}
 */
export async function migrateLegacySecrets(cfg, seam) {
  const moved = []
  const notes = []
  let pending = false
  if (!cfg || typeof cfg !== 'object') return { changed: false, moved, notes, pending }
  /** 逐项搬运：只有持久化成功才清空配置字段 */
  async function move(field, ref, label) {
    const value = String(cfg[field] || '').trim()
    if (!value) return
    const d = await seam.describe(ref)
    if (d.configured) {
      // 凭据库已有值 → 不覆盖（旧文件里的可能是陈值），但仍清掉配置里的明文
      cfg[field] = ''
      notes.push('凭据库中已有 ' + ref + '，配置文件里的旧值直接丢弃（不覆盖凭据库）')
      return
    }
    const persisted = await seam.save(ref, value)
    if (persisted) {
      cfg[field] = ''
      moved.push(label + ' → ' + ref)
    } else {
      // 无法持久化：保留明文，避免「文件干净了、密钥却没了」
      pending = true
      notes.push('凭据库不可写（宿主未提供凭据服务？）：' + label + ' 的明文**保留在配置文件**中以免丢失，'
        + '请修复凭据库后重启以完成迁移')
    }
  }
  await move('volcengineSecretAccessKey', CRED_REFS.volcengineSecret, 'volcengineSecretAccessKey')
  await move('cloudToken', CRED_REFS.cloudToken, 'cloudToken')
  return { changed: moved.length > 0, moved, notes, pending }
}
