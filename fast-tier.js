// ============================================================
// DSH 花费统计插件 —— GPT 服务档位（Fast / priority）识别
//
// 背景：OpenAI 自 2026-07-30 起把 Priority processing 更名为 Fast mode，
// 请求可用 `service_tier: "fast"` 或 `"priority"`。同一模型的 Fast 档价格
// 与标准价不同（多数是 2x，个别模型更高），因此记账必须知道这一笔走的哪档。
//
// 宿主当前不给插件层提供档位（GenerateOptions / TokenUsage / stream 事件都没有
// serviceTier 字段），实际把档位写到线上的插件 `dsh-fast-tier` 会把**会话级选择**
// 追加进会话日志（`steered` 事件，source.kind = 'fast-tier'，tier 为
// default / priority / ultrafast）。本模块只做两件事：
//
//   1. `tierOfSteeredEvent` / `tierFromEvents`：纯函数，从日志事件折叠出档位；
//   2. `createTierResolver`：把 ctx 的可选服务包装成「给 sessionId 返回档位」的函数，
//      任一环节缺失或抛错都返回 'standard'，绝不影响记账主流程。
//
// 判定优先级：请求参数（未来宿主）> 会话选择 > 标准档。
// ============================================================

/** dsh-fast-tier 的 steered 事件 source.kind */
export const FAST_TIER_SOURCE_KIND = 'fast-tier'
/** dsh-fast-tier 注册的投影键（Host 侧状态即 { tier, seq }） */
export const FAST_TIER_PROJECTION_KEY = 'fastTier'

/**
 * UI 档位 → 计费档位。
 *   default  → standard（不发 service_tier）
 *   priority → fast（Fast mode 线上取值之一）
 *   ultrafast→ fast（有独立倍率，但本插件按 Fast 价计并标注偏低）
 *   fast     → fast（线上别名，dsh-fast-tier 也接受）
 * @param {string} tier - 日志里的档位 id
 * @returns {'standard'|'fast'|''} 未知档位返回 ''
 */
export function billableTierOf(tier) {
  switch (String(tier || '').toLowerCase()) {
    case 'default':
    case 'auto':
    case 'standard':
      return 'standard'
    case 'priority':
    case 'fast':
    case 'ultrafast':
      return 'fast'
    default:
      return ''
  }
}

/**
 * 判断一个日志事件是否为 dsh-fast-tier 的档位选择，是则返回其 tier。
 * @param {object} event - 会话事件
 * @returns {string} tier 或 ''（不是档位事件）
 */
export function tierOfSteeredEvent(event) {
  if (!event || event.type !== 'steered') return ''
  const source = event.data && event.data.source
  if (!source || typeof source !== 'object' || source.kind !== FAST_TIER_SOURCE_KIND) return ''
  const tier = source.tier
  return typeof tier === 'string' ? tier : ''
}

/**
 * 从会话事件序列折叠出最后一次档位选择（dsh-fast-tier 的语义：后写覆盖）。
 * @param {Iterable<object>} events - 会话事件（按 seq 升序）
 * @returns {string} tier 或 ''（从未选择）
 */
export function tierFromEvents(events) {
  let chosen = ''
  try {
    for (const ev of events) {
      const tier = tierOfSteeredEvent(ev)
      if (tier) chosen = tier
    }
  } catch {
    return chosen
  }
  return chosen
}

/**
 * 从投影状态（{ tier, seq }）取档位。
 * @param {unknown} state
 * @returns {string}
 */
export function tierOfProjectionState(state) {
  const t = state && typeof state === 'object' ? state.tier : null
  return typeof t === 'string' ? t : ''
}

/**
 * 创建「sessionId → 计费档位」解析器。
 *
 * 只读：读会话对象、读 dsh-fast-tier 已注册的投影，不注册新投影、不写会话日志。
 * 任何异常都降级为 { tier:'standard', source:'none' }，记账流程不会因此中断。
 *
 * @param {{sessions?:{get?:Function}, sessionProjections?:{stateOf?:Function}}} ctx - Cordis 上下文
 * @returns {(sessionId:string) => {tier:'standard'|'fast', source:string, raw?:string}}
 */
export function createTierResolver(ctx) {
  const none = { tier: 'standard', source: 'none' }
  const sessions = ctx && ctx.sessions
  const projections = ctx && ctx.sessionProjections
  return (sessionId) => {
    const sid = String(sessionId || '')
    if (!sid) return none
    try {
      const get = sessions && typeof sessions.get === 'function' ? sessions.get.bind(sessions) : null
      if (!get) return none
      const session = get(sid)
      if (!session) return none
      // ① 优先读 dsh-fast-tier 的投影（宿主缓存，O(1)）
      const stateOf = projections && typeof projections.stateOf === 'function' ? projections.stateOf.bind(projections) : null
      if (stateOf) {
        const raw = tierOfProjectionState(stateOf(session, FAST_TIER_PROJECTION_KEY))
        const tier = billableTierOf(raw)
        if (tier) return { tier, source: 'projection', raw }
      }
      // ② 兜底折叠会话日志（投影未注册 / 插件刚装上时）
      const events = typeof session.events === 'function' ? session.events() : session.events
      if (events && typeof events[Symbol.iterator] === 'function') {
        const raw = tierFromEvents(events)
        const tier = billableTierOf(raw)
        if (tier) return { tier, source: 'log', raw }
      }
      return none
    } catch {
      return none
    }
  }
}

/**
 * 解析一次调用的计费档位：请求参数优先，其次会话选择，最后标准档。
 * @param {{serviceTier?:string}} options - llm 调用参数
 * @param {(sessionId:string)=>{tier:string,source:string,raw?:string}} resolve - 会话解析器
 * @param {string} sessionId
 * @returns {{tier:'standard'|'fast', source:string, raw?:string, ultrafast?:boolean}}
 */
export function resolveTier(options, resolve, sessionId) {
  const fromRequest = billableTierOf(options && options.serviceTier)
  if (fromRequest) return { tier: fromRequest, source: 'request' }
  const hit = typeof resolve === 'function' ? resolve(sessionId) : null
  if (!hit || !hit.tier) return { tier: 'standard', source: 'none' }
  return { ...hit, ultrafast: String(hit.raw || '').toLowerCase() === 'ultrafast' }
}
