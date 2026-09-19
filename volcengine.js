// ============================================================
// DSH 花费统计插件 —— 火山方舟（Volcengine Ark）Coding Plan 配额查询
//
// 与 kimi-usage 的差别：火山方舟的配额走**管控面 OpenAPI**，需要
// AccessKeyID + SecretAccessKey 做 HMAC-SHA256 签名（不是 Bearer 令牌），
// 因此不能复用 index.js 里那条「Authorization: Bearer」的简单路径。
//
// 签名算法与端点全部硬编码在此，凭据只发往 open.volcengineapi.com 一个域。
// 纯函数（签名 / 解析 / 凭据归一）单独导出，便于零依赖单测：
//   node test/volcengine-plan.test.js
//
// 实测依据（2026-09，上游 dsh-cost-meter issue #60 / #71 与本机实测）：
//   - GetCodingPlanUsage 无参即可返回 Result.QuotaUsage[{Level,Percent,ResetTimestamp}]，
//     Level 为 session / weekly / monthly 三档；**该接口只给 Percent，没有 used/total**；
//   - GetAFPUsage 实为 AgentPlan 接口（CodingPlan 账号会拿到空/全 0），作兜底；
//   - GetUsageDetails 裸调 400（缺 Filter.StartTime），GetPersonalPlan 亦需额外参数，
//     仅保留为兜底变体；
//   - 需控制台创建 IAM 子用户并授予 ArkReadOnlyAccess + BillingCenterReadOnlyAccess。
//
// 归一化输出（与 kimi 面板同形，便于客户端复用同一套渲染）：
//   windows = { fiveHour|weekly|monthly|daily: { percent, resetsAt, ... } }
//   percent 一律为 0-100 的**已用**百分比；resetsAt 为 ISO 字符串（无重置为 ''）。
// ============================================================

import { createHash, createHmac } from 'node:crypto'

// ---------- 固定官方端点（硬编码白名单，凭据只发往此域） ----------

export const VOLCENGINE_HOST = 'open.volcengineapi.com'
export const VOLCENGINE_SERVICE = 'ark'
export const VOLCENGINE_REGION = 'cn-beijing'
export const VOLCENGINE_VERSION = '2024-01-01'

/**
 * 管控面 Action 白名单（按序尝试）。
 * GetCodingPlanUsage 为 CodingPlan 官方用量接口，置于首位；
 * 其余为 AgentPlan / 计费明细 / 个人版套餐的兜底变体。
 */
export const VOLCENGINE_ACTIONS = ['GetCodingPlanUsage', 'GetAFPUsage', 'GetUsageDetails', 'GetPersonalPlan']

/** 用户可见的凭据发现线索（面板中性提示里展示） */
export const VOLCENGINE_KEY_ENVS = ['VOLC_ACCESSKEY', 'VOLCENGINE_ACCESS_KEY_ID', 'VOLCENGINE_ACCESS_KEY', 'ARK_ACCESS_KEY_ID']
export const VOLCENGINE_SECRET_ENVS = ['VOLC_SECRETKEY', 'VOLCENGINE_SECRET_ACCESS_KEY', 'VOLCENGINE_SECRET_KEY', 'ARK_SECRET_ACCESS_KEY']

// ---------- 签名 ----------

function hmacSha256(key, data) {
  return createHmac('sha256', key).update(data, 'utf8').digest()
}

function hashHex(data) {
  return createHash('sha256').update(data, 'utf8').digest('hex')
}

/** RFC3986 百分号编码（火山签名要求，与 encodeURIComponent 的差异在于 !'()* 需转义） */
export function uriEscape(str) {
  return encodeURIComponent(String(str))
    .replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
}

/** 查询串规范化：键排序、值转义（数组值各自转义后排序） */
export function queryParamsToString(params) {
  return Object.keys(params).sort().map((key) => {
    const val = params[key]
    if (val === undefined || val === null) return undefined
    const ek = uriEscape(key)
    if (!ek) return undefined
    if (Array.isArray(val)) return `${ek}=${val.map(uriEscape).sort().join(`&${ek}=`)}`
    return `${ek}=${uriEscape(String(val))}`
  }).filter(Boolean).join('&')
}

/** 火山要求的 X-Date 格式：YYYYMMDDTHHMMSSZ（UTC，无分隔符） */
export function volcengineDateTimeNow(date) {
  const d = date instanceof Date ? date : new Date()
  return d.toISOString().replace(/[:-]|\.\d{3}/g, '')
}

/**
 * 生成火山引擎 OpenAPI HMAC-SHA256 签名头。
 * 仅对 host / x-content-sha256 / x-date 三头加签；GET 无 body 时 bodySha = sha256('')。
 * @param {object} o - { accessKeyId, secretAccessKey, method, host, path, query, body, region, service, datetime }
 * @returns {{'X-Date':string,'X-Content-Sha256':string,Host:string,Authorization:string}}
 */
export function volcengineAuthorization({
  accessKeyId,
  secretAccessKey,
  method = 'GET',
  host = VOLCENGINE_HOST,
  path = '/',
  query = {},
  body = '',
  region = VOLCENGINE_REGION,
  service = VOLCENGINE_SERVICE,
  datetime,
} = {}) {
  const xDate = datetime ?? volcengineDateTimeNow()
  const date = xDate.slice(0, 8)
  const bodySha = hashHex(body)
  const signedHeaders = 'host;x-content-sha256;x-date'
  const canonicalHeaders = `host:${host}\nx-content-sha256:${bodySha}\nx-date:${xDate}`
  const qs = queryParamsToString(query)
  const canonicalRequest = [method.toUpperCase(), path, qs, `${canonicalHeaders}\n`, signedHeaders, bodySha].join('\n')
  const credentialScope = [date, region, service, 'request'].join('/')
  const stringToSign = ['HMAC-SHA256', xDate, credentialScope, hashHex(canonicalRequest)].join('\n')
  const kDate = hmacSha256(secretAccessKey, date)
  const kRegion = hmacSha256(kDate, region)
  const kService = hmacSha256(kRegion, service)
  const kSigning = hmacSha256(kService, 'request')
  const signature = hmacSha256(kSigning, stringToSign).toString('hex')
  const authorization = `HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return { 'X-Date': xDate, 'X-Content-Sha256': bodySha, Host: host, Authorization: authorization }
}

// ---------- 凭据归一 ----------

/**
 * 归一化火山双凭据（AK/SK）。支持：
 *  - 对象 { accessKeyId, secretAccessKey }（首选，字段名多重兼容）
 *  - 字符串 "AKID:SK" 或 "AKID SK"（冒号/空白分隔）
 * 返回 { accessKeyId, secretAccessKey } 或 null（任一为空即不合格）。
 */
export function normalizeVolcengineKey(key) {
  if (key !== null && typeof key === 'object' && !Array.isArray(key)) {
    const id = String(key.accessKeyId ?? key.accessKeyID ?? key.ak ?? key.apiKey ?? '').trim()
    const secret = String(key.secretAccessKey ?? key.secretKey ?? key.sk ?? key.apiSecret ?? '').trim()
    if (id.length > 0 && secret.length > 0) return { accessKeyId: id, secretAccessKey: secret }
    return null
  }
  if (typeof key === 'string') {
    const trimmed = key.trim()
    if (trimmed.length === 0) return null
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx > 0) {
      const id = trimmed.slice(0, colonIdx).trim()
      const secret = trimmed.slice(colonIdx + 1).trim()
      if (id.length > 0 && secret.length > 0) return { accessKeyId: id, secretAccessKey: secret }
    }
    const parts = trimmed.split(/\s+/)
    if (parts.length === 2 && parts[0].length > 0 && parts[1].length > 0 && parts[0].startsWith('AK')) {
      return { accessKeyId: parts[0], secretAccessKey: parts[1] }
    }
    return null
  }
  return null
}

// ---------- 响应解析（纯函数） ----------

function clampPct(p) {
  // 保留 2 位小数：实测 Coding Plan 的用量长期在 0.05%–0.4% 量级
  // （刚开通/轻度使用时），只留 1 位会把 0.05 显示成「0%」——
  // 看上去像「没统计到」，实际是有数据的。
  return Math.max(0, Math.min(100, Math.round(p * 100) / 100))
}

/**
 * 火山的百分比一律已是 0-100。
 * 注意**不能**复用配置层那套「≤1 视为小数」的规则：0.5 表示 0.5%，
 * 按小数解释会放大成 50%（十倍误差）。
 *
 * 负数是**非法数据**（不是 0）：钳位成 0 会渲染出「已用 0%」这种看似
 * 正常的假数据，反而掩盖接口异常。故负数返回 null，由调用方丢弃该窗口。
 * 超过 100 则钳位（用量统计口径上的浮点溢出，钳位不影响判断）。
 */
function percentOf(v) {
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return null
  return clampPct(n)
}

/**
 * 归一化重置时刻：unix 秒 / unix 毫秒 / ISO 字符串 → ISO 字符串。
 * -1 / 0 / 负数表示「该窗口无重置」（方舟零用量窗口会回 -1），返回 ''。
 */
export function normalizeVolcResetAt(value) {
  if (value === undefined || value === null || value === '') return ''
  if (typeof value === 'string') {
    const ms = Date.parse(value)
    if (Number.isFinite(ms)) return new Date(ms).toISOString()
    const asNum = Number(value)
    if (!Number.isFinite(asNum) || asNum <= 0) return ''
    return new Date(asNum > 1e12 ? asNum : asNum * 1000).toISOString()
  }
  const n = Number(value)
  if (!Number.isFinite(n) || n <= 0) return ''
  return new Date(n > 1e12 ? n : n * 1000).toISOString()
}

/** 归一化窗口名：五小时 / 周 / 月 / 日。未识别返回 null。 */
export function normalizeVolcWindowName(raw) {
  if (raw === undefined || raw === null) return null
  const raw0 = String(raw)
  // 中文标签先行：中文经 [^a-z0-9] 过滤后会变成空串，若放在英文判定之后，
  // 会被 s.length === 0 提前判为「不识别」，中文窗口名就全丢了。
  if (raw0.includes('小时')) return 'fiveHour'
  if (raw0.includes('日')) return 'daily'
  if (raw0.includes('周')) return 'weekly'
  if (raw0.includes('月')) return 'monthly'
  const s = raw0.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (s.length === 0) return null
  if (s.includes('5h') || s.includes('fivehour') || s === 'session' || s === 'rolling' || s === 'hour5') return 'fiveHour'
  if (s.includes('daily') || s === 'day' || s === '1d' || s.includes('afpdaily')) return 'daily'
  if (s.includes('week') || s === '7d' || s === 'seven') return 'weekly'
  if (s.includes('month') || s === '30d') return 'monthly'
  return null
}

/** 窗口名 → 中文展示名（客户端与面板共用） */
export const VOLC_WINDOW_LABELS = {
  fiveHour: '5 小时窗口',
  weekly: '本周配额',
  monthly: '本月配额',
  daily: '当日配额',
}

/** 从一个窗口对象里抽百分比：Percent 优先，其次 used/total、remaining/total。 */
function windowPercent(entry) {
  const direct = percentOf(entry.Percent ?? entry.percent ?? entry.Percentage ?? entry.percentage ?? entry.UsedPercent ?? entry.usedPercent)
  if (direct !== null) return direct
  const total = Number(entry.Total ?? entry.total ?? entry.Limit ?? entry.limit ?? entry.Quota ?? entry.quota ?? entry.Capacity ?? entry.capacity ?? entry.Max ?? entry.max)
  const used = Number(entry.Used ?? entry.used ?? entry.Usage ?? entry.usage ?? entry.Consumed ?? entry.consumed ?? entry.CurrentValue ?? entry.currentValue)
  const remain = Number(entry.Remaining ?? entry.remaining ?? entry.Remain ?? entry.remain ?? entry.Available ?? entry.available)
  if (Number.isFinite(total) && total > 0) {
    if (Number.isFinite(used)) return clampPct((used / total) * 100)
    if (Number.isFinite(remain)) return clampPct(((total - remain) / total) * 100)
  }
  return null
}

/** 从一条窗口记录里抽重置时刻（字段名多重兼容） */
function windowResetAt(entry) {
  return normalizeVolcResetAt(
    entry.ResetTimestamp ?? entry.resetTimestamp ?? entry.ResetTime ?? entry.resetTime
    ?? entry.ResetAt ?? entry.resetAt ?? entry.NextResetTime ?? entry.nextResetTime
    ?? entry.ExpiresAt ?? entry.expiresAt ?? entry.EndTime ?? entry.endTime,
  )
}

/**
 * 组装一条窗口；百分比非法则返回 null。绝对数值一并透传。
 *
 * CodingPlan 官方响应实测形态（2026-09，GetCodingPlanUsage）：
 *   { Level:'session', Percent:0.394, ResetTimestamp:1789833269, Cap:100, RewardTotalPercent:0 }
 * 即 Percent 已是「占 Cap 的百分比」，Cap 恒为 100；HasReward 为账户级字段。
 * 换算成绝对量只为让客户端的用量文案更具体，percent 仍是唯一权威口径。
 */
function buildWindow(entry) {
  const percent = windowPercent(entry)
  if (percent === null) return null
  const win = { percent, resetsAt: windowResetAt(entry) }
  const quota = Number(entry.Quota ?? entry.quota ?? entry.Total ?? entry.total ?? entry.Limit ?? entry.limit ?? entry.Capacity ?? entry.capacity)
  const used = Number(entry.Used ?? entry.used ?? entry.Usage ?? entry.usage ?? entry.CurrentValue ?? entry.currentValue)
  if (Number.isFinite(quota) && quota > 0) win.quota = quota
  if (Number.isFinite(used) && used >= 0) win.used = used
  const cap = Number(entry.Cap ?? entry.cap)
  if (Number.isFinite(cap) && cap > 0) {
    win.cap = cap
    // 只有 Cap 到位才能把百分比折算成绝对量（Percent 为 0-100 的百分数）
    if (win.used === undefined) win.used = Math.round((percent / 100) * cap * 100) / 100
    if (win.quota === undefined) win.quota = cap
  }
  const reward = Number(entry.RewardTotalPercent ?? entry.rewardTotalPercent)
  if (Number.isFinite(reward) && reward > 0) win.rewardTotalPercent = reward
  return win
}

/**
 * 解析火山方舟配额响应。兼容形态（按优先级）：
 *  ① { Result: { QuotaUsage: [{ Level:'session', Percent, ResetTimestamp, Cap }] } }  ← CodingPlan 官方
 *  ② { Result: { UsageDetails: [{ QuotaType, Total, Used, Remaining, ResetTime }] } }
 *  ③ arkcli 形态 { items: [{ product:'coding-plan', periods:[{ label, percent, reset_at }] }] }
 *  ④ 扁平窗口对象 { AFPFiveHour:{Quota,Used,ResetTime}, ... } / { fiveHour:{...} }
 * 容忍字段名与大小写差异；非法窗口忽略；无任何可解析窗口时返回 null。
 * @returns {{[name:string]:{percent:number,resetsAt:string}}|null}
 */
export function parseVolcengineUsage(data) {
  if (data === null || typeof data !== 'object') return null

  // 形态 ③：arkcli（items → coding-plan.periods）
  if (Array.isArray(data.items)) {
    const item = data.items.find((i) => i !== null && typeof i === 'object' && String(i.product ?? '').toLowerCase().includes('coding'))
      ?? data.items.find((i) => i !== null && typeof i === 'object' && Array.isArray(i.periods))
    if (item !== null && typeof item === 'object' && Array.isArray(item.periods)) {
      const windows = {}
      for (const p of item.periods) {
        if (p === null || typeof p !== 'object') continue
        const name = normalizeVolcWindowName(p.label ?? p.name ?? p.type ?? p.quotaType ?? p.window)
        if (name === null) continue
        const win = buildWindow(p)
        if (win === null) continue
        if (windows[name] === undefined) windows[name] = win
      }
      if (Object.keys(windows).length > 0) return windows
    }
  }

  // 形态 ①②：定位承载窗口数组的根对象
  const roots = [data.Result, data.result, data.data?.Result, data.data?.result, data.data].filter((v) => v !== null && typeof v === 'object')
  const root = roots.length > 0 ? roots[0] : data

  if (root !== null && typeof root === 'object' && !Array.isArray(root)) {
    const list = root.QuotaUsage ?? root.quotaUsage ?? root.UsageDetails ?? root.usageDetails
      ?? root.usages ?? root.limits ?? root.quotas ?? root.windows ?? root.periods ?? root.details ?? null
    if (Array.isArray(list)) {
      const windows = {}
      for (const entry of list) {
        if (entry === null || typeof entry !== 'object') continue
        // GetCodingPlanUsage 的窗口名字段是 Level，置于候选最前。
        const name = normalizeVolcWindowName(
          entry.Level ?? entry.level ?? entry.QuotaType ?? entry.quotaType ?? entry.Type ?? entry.type
          ?? entry.Label ?? entry.label ?? entry.Period ?? entry.period ?? entry.Name ?? entry.name
          ?? entry.Window ?? entry.window ?? entry.QuotaName ?? entry.quotaName,
        )
        if (name === null) continue
        const win = buildWindow(entry)
        if (win === null) continue
        if (windows[name] === undefined) windows[name] = win
      }
      if (Object.keys(windows).length > 0) return windows
    }
  }

  // 形态 ④：扁平窗口对象（含 AFP* 与 fiveHour/weekly/monthly 两种命名）
  const windows = {}
  const scan = (obj) => {
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || typeof v !== 'object' || Array.isArray(v)) continue
      const name = normalizeVolcWindowName(k)
      if (name === null || windows[name] !== undefined) continue
      const win = buildWindow(v)
      if (win !== null) windows[name] = win
    }
  }
  if (root !== null && typeof root === 'object') scan(root)
  if (Object.keys(windows).length === 0) scan(data)
  return Object.keys(windows).length > 0 ? windows : null
}

// ---------- 查询 ----------

/** 火山业务错误信封：ResponseMetadata.Error.Code/Message 非空即失败 */
function volcEnvelopeMessage(data) {
  const err = data?.ResponseMetadata?.Error
  if (err === null || err === undefined || typeof err !== 'object') return null
  const code = String(err.Code ?? '').trim()
  const msg = String(err.Message ?? '').trim()
  if (code.length === 0 && msg.length === 0) return null
  if (code === 'ok' || code === 'OK' || code === 'Success') return null
  return (code.length > 0 ? code : 'Error') + (msg.length > 0 ? ': ' + msg : '')
}

/**
 * 查询火山方舟 Coding Plan 配额。按 Action 白名单顺序尝试：
 * 401/403 视为「当前 Action 不可用」继续下一个（多 Action 变体语义差异），
 * 解析成功立即返回；200 但解析失败的「结构化错误」单独保留并优先抛出
 * （比末尾 Action 的 404 更有诊断价值）。
 * @param {object} o - { accessKeyId, secretAccessKey, fetchImpl, timeoutMs, signal }
 * @returns {Promise<{windows:object, action:string, endpoint:string}>}
 */
export async function queryVolcenginePlan({
  accessKeyId,
  secretAccessKey,
  fetchImpl,
  timeoutMs = 15000,
  signal,
} = {}) {
  const creds = normalizeVolcengineKey({ accessKeyId, secretAccessKey })
  if (creds === null) {
    const error = new Error('未找到火山引擎访问密钥（需 AccessKeyID + SecretAccessKey 成对提供）')
    error.soft = true
    throw error
  }
  const doFetch = fetchImpl ?? globalThis.fetch
  let lastError = null
  let parseError = null

  for (const action of VOLCENGINE_ACTIONS) {
    const query = { Action: action, Version: VOLCENGINE_VERSION }
    const url = `https://${VOLCENGINE_HOST}/?${queryParamsToString(query)}`
    let response
    try {
      const auth = volcengineAuthorization({
        accessKeyId: creds.accessKeyId,
        secretAccessKey: creds.secretAccessKey,
        method: 'GET',
        host: VOLCENGINE_HOST,
        path: '/',
        query,
        body: '',
      })
      const ac = new AbortController()
      const timer = setTimeout(() => ac.abort(), timeoutMs)
      const onAbort = () => ac.abort()
      if (signal) {
        if (signal.aborted) ac.abort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }
      try {
        response = await doFetch(url, {
          method: 'GET',
          headers: {
            'x-date': auth['X-Date'],
            'x-content-sha256': auth['X-Content-Sha256'],
            host: auth.Host,
            authorization: auth.Authorization,
            accept: 'application/json',
            'user-agent': 'dsh-cost-tracker/1.8 (DeepSeek Harness plugin)',
          },
          signal: ac.signal,
        })
      } finally {
        clearTimeout(timer)
        if (signal) signal.removeEventListener?.('abort', onAbort)
      }
    } catch (error) {
      lastError = error
      continue // 传输层错误：换下一个 Action 变体
    }

    const status = Number(response?.status) || 0
    if (status === 401 || status === 403) {
      // 多 Action 变体之间权限语义不同：单个 Action 的 401/403 只说明该 Action
      // 不可用（或该账号是另一类套餐），继续尝试下一个。
      const error = new Error(`火山方舟凭据无效或无权限访问 ${action}（HTTP ${status}）`)
      error.soft = true
      lastError = error
      continue
    }
    let text = ''
    try { text = await response.text() } catch (e) { text = '' }
    if (status < 200 || status >= 300) {
      lastError = new Error(`火山方舟配额接口 HTTP ${status}（${action}）`)
      continue
    }
    let data = null
    try { data = JSON.parse(text) } catch (e) {
      parseError ??= new Error(`火山方舟配额响应不是合法 JSON（${action}）`)
      lastError = parseError
      continue
    }
    const envelope = volcEnvelopeMessage(data)
    const windows = parseVolcengineUsage(data)
    if (windows === null) {
      // 200 但无可解析窗口：优先透出服务端业务信封的真实原因。
      const error = envelope !== null
        ? new Error(`火山方舟: ${envelope}`)
        : new Error(`火山方舟配额响应中未解析出用量窗口（${action}），接口结构可能已变化`)
      parseError ??= error
      lastError = error
      continue
    }
    return { windows, action, endpoint: url }
  }
  throw parseError ?? lastError ?? new Error('火山方舟配额查询失败：所有接口变体均未返回可用用量')
}
