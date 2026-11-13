// ============================================================
// dsh-cost-tracker GPT Fast 档识别 单测（零依赖，直接 node 运行）
//   node test/fast-tier.test.js
//
// 拦的是「档位判错 → 金额系统性偏离」这类问题：
//   ① dsh-fast-tier 的 steered 事件必须能折叠出档位，ultrafast 也要归到 fast；
//   ② 宿主没有档位信息时一律 standard，绝不能默认按 Fast 计（会虚高）；
//   ③ 任何依赖缺失 / 抛错都降级 standard，不得向上抛异常；
//   ④ 只读：解析过程不写会话、不注册投影。
// ============================================================
import {
  billableTierOf, createTierResolver, resolveTier, tierFromEvents,
  tierOfProjectionState, tierOfSteeredEvent, FAST_TIER_PROJECTION_KEY, FAST_TIER_SOURCE_KIND,
} from '../fast-tier.js'

let failures = 0
const passed = []
function ok(cond, msg) {
  if (cond) passed.push(msg)
  else { failures += 1; console.error('FAIL: ' + msg) }
}
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`) }

const steered = (tier) => ({ type: 'steered', seq: 1, data: { role: 'user', content: [], source: { kind: 'fast-tier', tier } } })

// ---------- 1. 档位映射 ----------
{
  eq(billableTierOf('default'), 'standard', '映射: default → standard')
  eq(billableTierOf('priority'), 'fast', '映射: priority → fast')
  eq(billableTierOf('fast'), 'fast', '映射: fast → fast')
  eq(billableTierOf('ultrafast'), 'fast', '映射: ultrafast → fast（按 Fast 价计）')
  eq(billableTierOf('auto'), 'standard', '映射: auto → standard')
  eq(billableTierOf('FLEX'), '', '映射: 未知档位 flex → 空（不猜）')
  eq(billableTierOf(''), '', '映射: 空 → 空')
  eq(billableTierOf(undefined), '', '映射: undefined → 空')
  eq(FAST_TIER_SOURCE_KIND, 'fast-tier', '常量: source.kind')
  eq(FAST_TIER_PROJECTION_KEY, 'fastTier', '常量: 投影键')
}

// ---------- 2. steered 事件解析 ----------
{
  eq(tierOfSteeredEvent(steered('priority')), 'priority', '事件: 取到 priority')
  eq(tierOfSteeredEvent(steered('ultrafast')), 'ultrafast', '事件: 取到 ultrafast')
  eq(tierOfSteeredEvent({ type: 'steered', data: { source: { kind: 'other', tier: 'priority' } } }), '', '事件: 别的插件不认')
  eq(tierOfSteeredEvent({ type: 'user', data: { source: { kind: 'fast-tier', tier: 'priority' } } }), '', '事件: 非 steered 不认')
  eq(tierOfSteeredEvent({ type: 'steered', data: { source: { kind: 'fast-tier' } } }), '', '事件: 缺 tier 不认')
  eq(tierOfSteeredEvent(null), '', '事件: null 不抛错')
  eq(tierOfSteeredEvent({ type: 'steered', data: null }), '', '事件: data 为 null 不抛错')
}

// ---------- 3. 日志折叠：后写覆盖 ----------
{
  const events = [steered('priority'), { type: 'user', seq: 2 }, steered('default'), steered('ultrafast')]
  eq(tierFromEvents(events), 'ultrafast', '折叠: 取最后一次选择')
  eq(tierFromEvents([]), '', '折叠: 空日志 → 空')
  eq(tierFromEvents([steered('priority')]), 'priority', '折叠: 单条')
}

// ---------- 4. 投影状态 ----------
{
  eq(tierOfProjectionState({ tier: 'priority', seq: 3 }), 'priority', '投影: 取 tier')
  eq(tierOfProjectionState({ tier: null, seq: 3 }), '', '投影: tier 为 null → 空')
  eq(tierOfProjectionState(null), '', '投影: null → 空')
}

// ---------- 5. 解析器：投影优先 ----------
{
  let wrote = 0
  const ctx = {
    sessions: {
      get: () => ({
        events: () => [steered('default')],
        append: () => { wrote += 1 },
      }),
    },
    sessionProjections: { stateOf: (session, key) => (key === 'fastTier' ? { tier: 'priority', seq: 9 } : undefined) },
  }
  const resolve = createTierResolver(ctx)
  const r = resolve('s1')
  eq(r.tier, 'fast', '解析: 投影命中 → fast')
  eq(r.source, 'projection', '解析: 来源标 projection')
  eq(wrote, 0, '解析: 只读，不写会话')
}

// ---------- 6. 解析器：投影缺失时折叠日志 ----------
{
  const ctx = {
    sessions: { get: () => ({ events: () => [steered('priority')] }) },
    sessionProjections: { stateOf: () => undefined },
  }
  const r = createTierResolver(ctx)('s2')
  eq(r.tier, 'fast', '解析: 投影无值 → 回退日志折叠')
  eq(r.source, 'log', '解析: 来源标 log')
}

// ---------- 7. 解析器：各种缺依赖都降级 standard ----------
{
  const cases = [
    ['无 ctx', null],
    ['无 sessions', {}],
    ['sessions.get 抛错', { sessions: { get: () => { throw new Error('boom') } } }],
    ['会话不存在', { sessions: { get: () => undefined }, sessionProjections: { stateOf: () => ({ tier: 'priority' }) } }],
    ['无事件且投影无值', { sessions: { get: () => ({}) }, sessionProjections: { stateOf: () => undefined } }],
  ]
  for (const [name, ctx] of cases) {
    const r = createTierResolver(ctx)('s3')
    eq(r.tier, 'standard', '降级: ' + name + ' → standard')
    eq(r.source, 'none', '降级: ' + name + ' 来源 none')
  }
  eq(createTierResolver(null)('').tier, 'standard', '降级: 空 sessionId → standard')
}

// ---------- 8. resolveTier 优先级 ----------
{
  const resolve = () => ({ tier: 'fast', source: 'projection', raw: 'priority' })
  eq(resolveTier({ serviceTier: 'standard' }, resolve, 's').tier, 'standard', '优先级: 请求参数 standard 覆盖会话 fast')
  eq(resolveTier({}, resolve, 's').tier, 'fast', '优先级: 无请求参数时用会话选择')
  eq(resolveTier({}, () => ({ tier: 'standard', source: 'none' }), 's').tier, 'standard', '优先级: 会话无选择 → standard')
  eq(resolveTier({}, null, 's').tier, 'standard', '优先级: 无解析器 → standard')
  const ultra = resolveTier({}, () => ({ tier: 'fast', source: 'projection', raw: 'ultrafast' }), 's')
  eq(ultra.ultrafast, true, '优先级: ultrafast 打标（实际倍率更高，金额偏低）')
}

// ---------- 9. 非 GPT 路由不受影响 ----------
{
  const resolve = () => ({ tier: 'standard', source: 'none' })
  eq(resolveTier({ provider: 'deepseek', model: 'deepseek-flash' }, resolve, 's').tier, 'standard', '隔离: DeepSeek 路由恒 standard')
}

console.log('\n' + passed.length + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
