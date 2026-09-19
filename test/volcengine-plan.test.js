// ============================================================
// dsh-cost-tracker 火山方舟 Coding Plan 配额查询测试（零依赖，直接 node 运行）
//   node test/volcengine-plan.test.js
//
// 覆盖四层，全部**不打真实网络**：
//   ① 签名：与火山官方 demo（volc-openapi-demos/signature/nodejs/sign.js）
//      逐字节一致的固定向量。签名错一个字节服务端就回 403，而 403 在本插件里
//      是「软失败」——不钉住的话会表现为「凭据无效」这种查不出根因的提示。
//   ② 解析：四种已知响应形态 + 百分号语义（0.5 是 0.5% 而不是 50%）+ 非法窗口剔除。
//   ③ 凭据归一：对象 / "AK:SK" / 不全的凭据。
//   ④ 查询编排：Action 兜底顺序、403 继续换 Action、业务信封优先于传输错误、
//      凭据只发往硬编码域名（白名单断言）。
// ============================================================
import {
  VOLCENGINE_HOST, VOLCENGINE_SERVICE, VOLCENGINE_REGION, VOLCENGINE_VERSION,
  VOLCENGINE_ACTIONS, VOLCENGINE_KEY_ENVS, VOLCENGINE_SECRET_ENVS,
  volcengineAuthorization, volcengineDateTimeNow, queryParamsToString, uriEscape,
  normalizeVolcengineKey, normalizeVolcResetAt, normalizeVolcWindowName,
  parseVolcengineUsage, queryVolcenginePlan, VOLC_WINDOW_LABELS,
} from '../volcengine.js'

let failures = 0
const passed = []
function ok(cond, msg) {
  if (cond) passed.push(msg)
  else { failures += 1; console.error('FAIL: ' + msg) }
}
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`) }

// ---------- 1. 常量与端点白名单 ----------
{
  eq(VOLCENGINE_HOST, 'open.volcengineapi.com', '常量: host')
  eq(VOLCENGINE_SERVICE, 'ark', '常量: service = ark')
  eq(VOLCENGINE_REGION, 'cn-beijing', '常量: region')
  eq(VOLCENGINE_VERSION, '2024-01-01', '常量: 版本')
  eq(VOLCENGINE_ACTIONS[0], 'GetCodingPlanUsage', '常量: CodingPlan 官方接口置于首位')
  ok(VOLCENGINE_ACTIONS.indexOf('GetAFPUsage') >= 0, '常量: AgentPlan 兜底在列')
  ok(VOLCENGINE_KEY_ENVS.indexOf('VOLC_ACCESSKEY') >= 0, '常量: AK 环境变量含 VOLC_ACCESSKEY')
  ok(VOLCENGINE_SECRET_ENVS.indexOf('VOLC_SECRETKEY') >= 0, '常量: SK 环境变量含 VOLC_SECRETKEY')
}

// ---------- 2. 签名（与火山官方 demo 逐字节一致） ----------
{
  // 官方 demo 对同一输入的输出（本向量由官方算法独立复算得出，已比对一致）
  const auth = volcengineAuthorization({
    accessKeyId: 'AKLTtest',
    secretAccessKey: 'secretkey',
    datetime: '20260925T120000Z',
    query: { Action: 'GetCodingPlanUsage', Version: '2024-01-01' },
  })
  eq(auth['X-Date'], '20260925T120000Z', '签名: X-Date 原样透传')
  eq(auth.Host, VOLCENGINE_HOST, '签名: Host')
  // sha256('') —— GET 无 body
  eq(auth['X-Content-Sha256'], 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855', '签名: 空 body 的 sha256')
  eq(
    auth.Authorization,
    'HMAC-SHA256 Credential=AKLTtest/20260925/cn-beijing/ark/request, SignedHeaders=host;x-content-sha256;x-date, Signature=b5cc5d1b6b0968a134d3212369cbb1cc9c7aa72bcfb5d1f85b9ac1c65a84ab31',
    '签名: 固定向量逐字节一致（与官方 demo 同口径）',
  )

  // 签名的三个必要性质：确定性 / 对时间敏感 / 对密钥敏感
  const again = volcengineAuthorization({ accessKeyId: 'AKLTtest', secretAccessKey: 'secretkey', datetime: '20260925T120000Z', query: { Action: 'GetCodingPlanUsage', Version: '2024-01-01' } })
  eq(again.Authorization, auth.Authorization, '签名: 同输入确定性')
  const otherTime = volcengineAuthorization({ accessKeyId: 'AKLTtest', secretAccessKey: 'secretkey', datetime: '20260925T120001Z', query: { Action: 'GetCodingPlanUsage', Version: '2024-01-01' } })
  ok(otherTime.Authorization !== auth.Authorization, '签名: 时间变则签名变')
  const otherKey = volcengineAuthorization({ accessKeyId: 'AKLTtest', secretAccessKey: 'secretkez', datetime: '20260925T120000Z', query: { Action: 'GetCodingPlanUsage', Version: '2024-01-01' } })
  ok(otherKey.Authorization !== auth.Authorization, '签名: 密钥变则签名变')

  // 日期戳必须取自 X-Date 前 8 位（跨时区/跨日错位会直接 403）
  ok(auth.Authorization.includes('/20260925/cn-beijing/ark/request'), '签名: 凭证范围日期取自 X-Date')
  ok(auth.Authorization.includes(`/${VOLCENGINE_REGION}/${VOLCENGINE_SERVICE}/request`), '签名: 凭证范围含 region/service')

  // X-Date 格式：YYYYMMDDTHHMMSSZ（无冒号/无毫秒）
  const now = volcengineDateTimeNow(new Date(Date.UTC(2026, 8, 25, 12, 0, 0)))
  eq(now, '20260925T120000Z', '签名: X-Date 格式 YYYYMMDDTHHMMSSZ')
}

// ---------- 2b. 查询串规范化 / 转义 ----------
{
  eq(queryParamsToString({ Version: '2024-01-01', Action: 'GetCodingPlanUsage' }),
    'Action=GetCodingPlanUsage&Version=2024-01-01', '查询串: 按键排序')
  eq(queryParamsToString({ B: '2', a: '1' }), 'B=2&a=1', '查询串: 大写键排在前面（按码位排序）')
  eq(queryParamsToString({ a: undefined, b: null, c: 'x' }), 'c=x', '查询串: 空值剔除')
  eq(queryParamsToString({ a: ['b', 'a'] }), 'a=a&a=b', '查询串: 数组值各自转义后排序')
  // RFC3986：!'()* 必须转义（encodeURIComponent 默认不转义）
  eq(uriEscape("a!b'c(d)e*f"), 'a%21b%27c%28d%29e%2Af', '转义: 严格 RFC3986')
  eq(uriEscape('a b'), 'a%20b', '转义: 空格')
  eq(uriEscape('a-b_c.d~e'), 'a-b_c.d~e', '转义: unreserved 不转义')
}

// ---------- 3. 凭据归一 ----------
{
  const a = normalizeVolcengineKey({ accessKeyId: 'AK', secretAccessKey: 'SK' })
  ok(a !== null && a.accessKeyId === 'AK' && a.secretAccessKey === 'SK', '凭据: 对象形态')
  const b = normalizeVolcengineKey({ accessKeyID: 'AK', secretKey: 'SK' })
  ok(b !== null && b.accessKeyId === 'AK' && b.secretAccessKey === 'SK', '凭据: 字段名兼容')
  const c = normalizeVolcengineKey('AKID:SKID')
  ok(c !== null && c.accessKeyId === 'AKID' && c.secretAccessKey === 'SKID', '凭据: "AK:SK" 字符串')
  const d = normalizeVolcengineKey('  AKID : SKID  ')
  ok(d !== null && d.accessKeyId === 'AKID' && d.secretAccessKey === 'SKID', '凭据: 冒号两侧空白裁剪')
  const e = normalizeVolcengineKey('AKID SKID')
  ok(e !== null && e.accessKeyId === 'AKID', '凭据: 空格分隔（AK 前缀）')
  // 残缺凭据必须判 null —— 绝不能拿半套凭据去签名，否则只会得到误导性的 403
  ok(normalizeVolcengineKey(null) === null, '凭据: null → null')
  ok(normalizeVolcengineKey('') === null, '凭据: 空串 → null')
  ok(normalizeVolcengineKey({ accessKeyId: 'AK' }) === null, '凭据: 缺 SK → null')
  ok(normalizeVolcengineKey({ secretAccessKey: 'SK' }) === null, '凭据: 缺 AK → null')
  ok(normalizeVolcengineKey('SKID-only') === null, '凭据: 只有 SK 的字符串 → null')
  ok(normalizeVolcengineKey(12345) === null, '凭据: 非法类型 → null')
}

// ---------- 4. 重置时刻与窗口名归一 ----------
{
  eq(normalizeVolcResetAt(1782226478), '2026-06-23T14:54:38.000Z', '重置: unix 秒')
  eq(normalizeVolcResetAt(1785686400000), '2026-08-02T16:00:00.000Z', '重置: unix 毫秒')
  eq(normalizeVolcResetAt('2026-08-02T16:00:00Z'), '2026-08-02T16:00:00.000Z', '重置: ISO 字符串')
  // -1 是方舟「该窗口无重置（零用量）」的哨兵值，必须归一为「无」而不是 1969 年
  eq(normalizeVolcResetAt(-1), '', '重置: -1（无重置）→ 空')
  eq(normalizeVolcResetAt(0), '', '重置: 0 → 空')
  eq(normalizeVolcResetAt(undefined), '', '重置: undefined → 空')
  eq(normalizeVolcResetAt('abc'), '', '重置: 非法串 → 空')

  eq(normalizeVolcWindowName('session'), 'fiveHour', '窗口名: session → fiveHour')
  eq(normalizeVolcWindowName('AFPFiveHour'), 'fiveHour', '窗口名: AFPFiveHour → fiveHour')
  eq(normalizeVolcWindowName('weekly'), 'weekly', '窗口名: weekly')
  eq(normalizeVolcWindowName('AFPWeekly'), 'weekly', '窗口名: AFPWeekly')
  eq(normalizeVolcWindowName('monthly'), 'monthly', '窗口名: monthly')
  eq(normalizeVolcWindowName('AFPMonthly'), 'monthly', '窗口名: AFPMonthly')
  eq(normalizeVolcWindowName('AFPDaily'), 'daily', '窗口名: AFPDaily → daily')
  eq(normalizeVolcWindowName('5小时'), 'fiveHour', '窗口名: 中文「5小时」')
  eq(normalizeVolcWindowName('本周'), 'weekly', '窗口名: 中文「本周」')
  eq(normalizeVolcWindowName('乱码窗口'), null, '窗口名: 无法识别 → null')
  ok(Object.keys(VOLC_WINDOW_LABELS).length >= 4, '窗口名: 中文展示名齐备')
}

// ---------- 5. 响应解析：四种形态 ----------
{
  // 形态 ①：GetCodingPlanUsage 官方（只有 Percent + Level + ResetTimestamp）
  const official = {
    ResponseMetadata: { RequestId: 'r1', Action: 'GetCodingPlanUsage' },
    Result: {
      Status: 'Running',
      UpdateTimestamp: 1782226444,
      QuotaUsage: [
        { Level: 'session', Percent: 12.5, ResetTimestamp: 1782226478 },
        { Level: 'weekly', Percent: 0.5, ResetTimestamp: -1 },
        { Level: 'monthly', Percent: 88, ResetTimestamp: 1785686400000 },
      ],
    },
  }
  const w1 = parseVolcengineUsage(official)
  ok(w1 !== null, '解析①: 官方 QuotaUsage 形态可解析')
  eq(w1.fiveHour.percent, 12.5, '解析①: session → fiveHour 12.5%')
  eq(w1.weekly.percent, 0.5, '解析①: **0.5 是 0.5%**（不能按小数放大成 50%）')
  eq(w1.weekly.resetsAt, '', '解析①: ResetTimestamp=-1 → 无重置')
  eq(w1.monthly.percent, 88, '解析①: monthly 88%')
  eq(w1.monthly.resetsAt, '2026-08-02T16:00:00.000Z', '解析①: monthly 重置时刻')

  // 形态 ②：UsageDetails（Total/Used/Remaining）
  const details = { Result: { UsageDetails: [
    { QuotaType: 'session', Total: 1000, Used: 250, ResetTime: 1782226478 },
    { QuotaType: 'weekly', Total: 1000, Remaining: 100, ResetTime: 1782226478 },
  ] } }
  const w2 = parseVolcengineUsage(details)
  ok(w2 !== null, '解析②: UsageDetails 可解析')
  eq(w2.fiveHour.percent, 25, '解析②: used/total → 25%')
  eq(w2.weekly.percent, 90, '解析②: (total-remaining)/total → 90%')

  // 形态 ③：arkcli（items → coding-plan.periods）
  const arkcli = { items: [
    { product: 'other', periods: [{ label: 'session', percent: 99 }] },
    { product: 'coding-plan', periods: [
      { label: 'session', percent: 10, reset_at: 1782226478 },
      { label: 'weekly', percent: 20, reset_at: 1782226478 },
    ] },
  ] }
  const w3 = parseVolcengineUsage(arkcli)
  ok(w3 !== null && w3.fiveHour.percent === 10, '解析③: 选中 coding-plan 而非第一个 item')
  eq(w3.weekly.percent, 20, '解析③: weekly')

  // 形态 ④：扁平窗口对象（AgentPlan 的 AFP* 与规范名两种写法）
  const flat = { Result: {
    PlanType: 'medium',
    AFPFiveHour: { Quota: 10000, Used: 0, ResetTime: -1 },
    AFPWeekly: { Quota: 35000, Used: 8750, ResetTime: 1785686400000 },
    AFPMonthly: { Quota: 100000, Used: 25000, ResetTime: 1787846399000 },
    AFPDaily: { Quota: 50000, Used: 0, ResetTime: 1785340800000 },
  } }
  const w4 = parseVolcengineUsage(flat)
  ok(w4 !== null, '解析④: AFP 扁平窗口可解析')
  eq(w4.fiveHour.percent, 0, '解析④: AFPFiveHour 0%')
  eq(w4.fiveHour.resetsAt, '', '解析④: AFPFiveHour ResetTime=-1 → 无重置')
  eq(w4.fiveHour.quota, 10000, '解析④: 绝对值 Quota 一并透传')
  eq(w4.weekly.percent, 25, '解析④: AFPWeekly 8750/35000 = 25%')
  eq(w4.monthly.percent, 25, '解析④: AFPMonthly 25000/100000 = 25%')
  eq(w4.daily.percent, 0, '解析④: AFPDaily 不被丢弃')

  const flatNamed = { Result: { fiveHour: { percent: 5 }, weekly: { percent: 6 } } }
  const w4b = parseVolcengineUsage(flatNamed)
  ok(w4b !== null && w4b.fiveHour.percent === 5, '解析④: 规范窗口名形态')

  // 非法/异常一律不产出窗口，也不能抛异常
  for (const [input, label] of [
    [null, 'null'], [undefined, 'undefined'], ['str', '字符串'], [42, '数字'],
    [{}, '空对象'], [{ Result: {} }, '空 Result'],
    [{ Result: { QuotaUsage: [] } }, '空数组'],
    [{ Result: { QuotaUsage: [{ Level: 'session' }] } }, '缺 Percent'],
    [{ Result: { QuotaUsage: [{ Level: 'session', Percent: 'abc' }] } }, 'Percent 非数字'],
    [{ Result: { QuotaUsage: [{ Level: 'session', Percent: -5 }] } }, '负数 Percent（非法数据，不可钳位成 0 假装正常）'],
    [{ Result: { QuotaUsage: [{ Percent: 10 }] } }, '缺窗口名'],
  ]) {
    ok(parseVolcengineUsage(input) === null, '解析容错: ' + label + ' → null')
  }

  // 边界：百分比钳位到 0-100，且不会被「≤1 视为小数」的规则误放大
  const clamp = parseVolcengineUsage({ Result: { QuotaUsage: [
    { Level: 'session', Percent: 150 },
    { Level: 'weekly', Percent: 0.1 },
  ] } })
  eq(clamp.fiveHour.percent, 100, '解析: >100 钳位到 100')
  eq(clamp.weekly.percent, 0.1, '解析: 0.1 保持 0.1%（不放大成 10%）')

  // 未识别的窗口名不静默丢弃（接口结构变化时可被发现）
  const unknownWin = parseVolcengineUsage({ Result: { QuotaUsage: [
    { Level: 'session', Percent: 10 },
    { Level: 'somethingNew', Percent: 20 },
  ] } })
  ok(unknownWin !== null && unknownWin.fiveHour.percent === 10, '解析: 已知窗口正常')
  ok(Object.keys(unknownWin).length === 1, '解析: 未识别窗口名不产出（避免污染展示）')
}

// ---------- 6. 查询编排（假 fetch，绝不真发网络） ----------
{
  /** 造一个按 (Action) 分派响应的假 fetch，并记录所有请求 */
  function fakeFetch(handler) {
    const calls = []
    const fn = async (url, init) => {
      calls.push({ url, init })
      const action = new URL(url).searchParams.get('Action')
      const r = handler(action, url, init) || {}
      return {
        status: r.status ?? 200,
        ok: (r.status ?? 200) >= 200 && (r.status ?? 200) < 300,
        text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body ?? {})),
      }
    }
    fn.calls = calls
    return fn
  }

  const CREDS = { accessKeyId: 'AKLTtest', secretAccessKey: 'secretkey' }

  // 首选 Action 命中即返回，不再试后续 Action
  {
    const f = fakeFetch(() => ({ body: { Result: { QuotaUsage: [{ Level: 'session', Percent: 7, ResetTimestamp: 1782226478 }] } } }))
    const r = await queryVolcenginePlan({ ...CREDS, fetchImpl: f })
    eq(r.action, 'GetCodingPlanUsage', '查询: 首选 Action 命中')
    eq(r.windows.fiveHour.percent, 7, '查询: 返回解析后的窗口')
    eq(f.calls.length, 1, '查询: 命中后不再试其它 Action')
    // 凭据只发往硬编码域名
    ok(f.calls[0].url.startsWith(`https://${VOLCENGINE_HOST}/`), '安全: 端点固定为官方域名')
    eq(new URL(f.calls[0].url).host, VOLCENGINE_HOST, '安全: host 白名单')
    ok(f.calls[0].init.headers.authorization.startsWith('HMAC-SHA256 Credential=AKLTtest/'), '查询: 带签名 Authorization 头')
    ok(typeof f.calls[0].init.headers['x-date'] === 'string', '查询: 带 X-Date 头')
    ok(typeof f.calls[0].init.headers['x-content-sha256'] === 'string', '查询: 带 X-Content-Sha256 头')
    ok(!JSON.stringify(f.calls[0].init.headers).includes('Bearer'), '查询: 不用 Bearer（管控面是 HMAC 签名）')
  }

  // 403 视为「该 Action 不可用」继续换下一个（多 Action 变体权限语义不同）
  {
    const f = fakeFetch((action) => {
      if (action === 'GetCodingPlanUsage') return { status: 403, body: { ResponseMetadata: { Error: { Code: 'AccessDenied' } } } }
      if (action === 'GetAFPUsage') return { body: { Result: { AFPWeekly: { Quota: 100, Used: 50, ResetTime: 1785686400000 } } } }
      return { status: 404, body: {} }
    })
    const r = await queryVolcenginePlan({ ...CREDS, fetchImpl: f })
    eq(r.action, 'GetAFPUsage', '查询: 403 后继续下一个 Action 并成功')
    eq(r.windows.weekly.percent, 50, '查询: 兜底 Action 的窗口可用')
    eq(f.calls.length, 2, '查询: 恰好尝试前两个 Action')
  }

  // 200 但业务信封报错：优先透出服务端 msg（比后续 404 更有诊断价值）
  {
    const f = fakeFetch((action) => {
      if (action === 'GetCodingPlanUsage') return { body: { ResponseMetadata: { Error: { Code: 'InvalidParameter', Message: 'missing Filter.StartTime' } } } }
      return { status: 404, body: {} }
    })
    let err = null
    try { await queryVolcenginePlan({ ...CREDS, fetchImpl: f }) } catch (e) { err = e }
    ok(err !== null, '查询: 全变体失败时抛错')
    ok(err.message.includes('InvalidParameter'), '查询: 优先透出业务信封而非末尾 404')
    ok(err.message.includes('missing Filter.StartTime'), '查询: 保留服务端原文 msg')
    eq(f.calls.length, VOLCENGINE_ACTIONS.length, '查询: 依次试完全部 Action 变体')
  }

  // 200 但结构不认识 → 提示「结构可能已变化」，而不是静默无数据
  {
    const f = fakeFetch(() => ({ body: { Result: { Weird: true } } }))
    let err = null
    try { await queryVolcenginePlan({ ...CREDS, fetchImpl: f }) } catch (e) { err = e }
    ok(err !== null && /未解析出用量窗口/.test(err.message), '查询: 结构变化给出明确原因')
  }

  // 凭据不全：软失败（error.soft），且**根本不发请求**
  {
    const f = fakeFetch(() => ({ body: {} }))
    for (const bad of [null, { accessKeyId: 'AK' }, { secretAccessKey: 'SK' }, '']) {
      let err = null
      try { await queryVolcenginePlan({ accessKeyId: (bad || {}).accessKeyId, secretAccessKey: (bad || {}).secretAccessKey, fetchImpl: f }) } catch (e) { err = e }
      ok(err !== null && err.soft === true, '查询: 残缺凭据 → 软失败')
    }
    eq(f.calls.length, 0, '安全: 残缺凭据下不发任何请求')
  }

  // 网络异常：换下一个 Action；全部异常时抛出最后一个错误
  {
    const f = async () => { throw new Error('ECONNRESET') }
    let err = null
    try { await queryVolcenginePlan({ ...CREDS, fetchImpl: f }) } catch (e) { err = e }
    ok(err !== null && /ECONNRESET/.test(err.message), '查询: 网络异常最终抛出')
  }

  // 200 但响应不是 JSON
  {
    const f = async () => ({ status: 200, ok: true, text: async () => 'not json' })
    let err = null
    try { await queryVolcenginePlan({ ...CREDS, fetchImpl: f }) } catch (e) { err = e }
    ok(err !== null && /不是合法 JSON/.test(err.message), '查询: 非 JSON 响应给出明确原因')
  }

  // 5xx：继续换 Action
  {
    const f = fakeFetch((action) => {
      if (action === 'GetCodingPlanUsage') return { status: 500, body: {} }
      return { body: { Result: { QuotaUsage: [{ Level: 'weekly', Percent: 3 }] } } }
    })
    const r = await queryVolcenginePlan({ ...CREDS, fetchImpl: f })
    eq(r.action, 'GetAFPUsage', '查询: 5xx 后换下一个 Action')
  }
}

console.log('\n' + passed.length + ' passed, ' + failures + ' failed')
if (failures > 0) process.exit(1)
