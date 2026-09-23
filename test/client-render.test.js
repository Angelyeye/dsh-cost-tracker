// ============================================================
// client.js 渲染冒烟测试（零依赖，直接 node 运行）
//
// 这个文件拦的是三类真实事故：
//
// ① 渲染期 ReferenceError：1.8.0 的「花费统计」页对所有人白屏 —— Dashboard 把 sync
//    作为 prop 传给 PeakPanel，PeakPanel 内部却用了裸 sync；1.8.2 又出现 timeLabel
//    从未定义（只有首次同步成功后才会执行到）。`node --check` 只查语法，查不出这个。
// ② 插件配置卡片结构：必须是宿主的 li > 可点击 header > 折叠 body，且默认收起。
// ③ 三态视图被静默降级：宿主的客户端模块加载器只加载本插件的客户端 bundle，
//    view.js 在浏览器里 require 不到。1.8.0~1.8.2 因此退化成只含「本机」的空桩 ——
//    工具栏只剩一个按钮、云端数据也永远合并不进来。见 [4] 的一致性断言。
//
// 做法：用极小的 React 替身把 client.js 真正跑起来
//   - createElement 只建树；函数组件会被**真正调用**（渲染期代码全部执行）
//   - useState 按组件持久化（可模拟点击后的二次渲染）、useEffect 会执行并等微任务落地
//   - fetch 按路由返回**真实形态**的响应（空对象会绕开 lastSyncAt > 0 这类路径）
//   - 分别构造「能取到 view 模块」与「取不到」两个模块实例，渲染结果必须完全一致
//
// 运行：node test/client-render.test.js
// ============================================================
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import * as REAL_VIEW from '../view.js'
import { UI_SURFACES, defaultUiConfig } from '../config.js'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const source = readFileSync(join(root, 'client.js'), 'utf8')

let failures = 0
function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`)
  } else {
    failures++
    console.log(`  FAIL  ${name}`)
    if (detail !== undefined) console.log(`        ${detail}`)
  }
}

// ---------- 假数据：真实形态的路由响应 ----------
const SYNC = {
  ok: true, enabled: true, url: 'https://cost.example.com', hasToken: true,
  deviceId: 'a55a81f9725fa272', deviceName: '测试机', watermark: 1224, maxSeq: 1225,
  pending: 1, lastSyncAt: Date.now() - 120000, lastOkAt: Date.now() - 120000,
  lastError: '', needAuth: false, backoffMs: 0, failures: 0, intervalSec: 60,
  view: 'local', maskSessionId: false, includePurpose: true, syncSinceDays: 180,
}
const DASH = {
  ok: true, days: 7, range: '7d',
  peakWindows: '周一至周五 9:00-12:00 · 14:00-18:00（周末全天闲时）',
  realCost: 5.81, realCalls: 391, realTokens: 31382777, subEquivalent: 0.5, subCalls: 12, subTokens: 100000,
  peakCost: 3.2, offCost: 2.1, flatCost: 0.51,
  today: { real: 1.2, calls: 20, tokens: 100000, sub: 0, subCalls: 0, subTokens: 0 },
  month: { real: 4.0, calls: 100, tokens: 900000, sub: 0.5, subCalls: 12, subTokens: 100000 },
  all: { real: 5.81, calls: 391, tokens: 31382777, sub: 0.5, subCalls: 12, subTokens: 100000 },
  byDay: [{ date: '2026-09-15', label: '09/15', peak: 3.2, off: 2.1, flat: 0.51, sub: 0.5 }],
  byModel: [{ model: 'deepseek-v4.1-flash', calls: 391, tokens: 31382777, cost: 5.81 }],
  byModelDay: [{ model: 'deepseek-v4.1-flash', days: [{ date: '2026-09-15', label: '09/15', calls: 391, tokens: 31382777, input: 100, output: 50, cacheRead: 900, cacheWrite: 0, cost: 5.81 }] }],
  recent: [
    { time: '09-15 10:20', provider: 'deepseek', model: 'deepseek-flash', period: 'peak', input: 100, cacheRead: 900, cacheWrite: 0, output: 50, cost: 0.5, subscription: false },
    { time: '09-15 11:40', provider: 'openai', model: 'gpt-5-codex', period: 'flat', input: 100, cacheRead: 0, cacheWrite: 0, output: 20, cost: 0.2, subscription: false },
  ], devices: [], sources: [],
}
// 云端响应按**线上真实形态**构造：概览口径的金额字段是 realCost/subEquivalent，
// 不是本地 buildDashboard 的 real/sub。早先的假数据误用了 real/sub，
// 于是「字段名没映射」这个真实缺陷在测试里被掩盖（线上表现为：仅云端视图次数正常、
// 费用全为 ¥0.0000）。此处的形状必须与 dsh-cost-cloud 的 overview 保持一致。
const CLOUD = {
  ok: true, range: '7d', days: 7, asOf: Date.now(),
  realCost: 2.0, realCalls: 100, realTokens: 5000000, subEquivalent: 0.3, subCalls: 5, subTokens: 90000,
  peakCost: 1.0, offCost: 0.8, flatCost: 0.2,
  today: { realCost: 0.5, cost: 0.5, calls: 10, tokens: 100000, subCost: 0, subCalls: 0, subTokens: 0 },
  month: { realCost: 1.0, cost: 1.0, calls: 50, tokens: 2000000, subCost: 0, subCalls: 0, subTokens: 0 },
  all: { realCost: 2.0, cost: 2.3, calls: 100, tokens: 5000000, subCost: 0.3, subCalls: 5, subTokens: 90000 },
  summary: { realCost: 2.0, realCalls: 100, realTokens: 5000000, subEquivalent: 0.3, subCalls: 5, subTokens: 90000, cost: 2.3, calls: 105, tokens: 5090000, peakCost: 1.0, offCost: 0.8, flatCost: 0.2 },
  byDay: [{ date: '2026-09-15', label: '09/15', peak: 1.0, off: 0.8, flat: 0.2 }],
  byModel: [{ model: 'deepseek-v4.1-flash', calls: 100, tokens: 5000000, cost: 2.0 }],
  byModelDay: [{ model: 'deepseek-v4.1-flash', days: [{ date: '2026-09-15', label: '09/15', calls: 100, tokens: 5000000, input: 10, output: 5, cacheRead: 90, cacheWrite: 0, cost: 2.0 }] }],
  recent: [], devices: [{ device: 'other-machine', name: '另一台', cost: 2.0, calls: 100 }], sources: [{ source: 'dsh', cost: 2.0, calls: 100 }],
}
// 前端显隐开关（v1.8.12）。默认全可见 —— 每条断言都必须能在「显式 false」下看到消失，
// 否则「关掉前端显示」这个能力就只是配置里多了一个没人读的字段。
let uiFlags = { uiDockEnabled: true, uiPeakEnabled: true, uiDashboardEnabled: true }
const uiPayload = (name) => {
  // peak 的响应按**真实形态**构造：PeakStrip 依赖 phase（峰谷判定 + 倒计时）才渲染，
  // 只回 { ok:true } 会让"可见"的断言假红。这里把弹窗关掉，避免测试随真实时间抖动。
  if (name === 'peak') return {
    ok: true, enabled: true, effective: true, notice: true, style: 'compact',
    alert: { enabled: false, ahead: 2, target: 'both', position: 'corner', webNotify: false },
    phase: peakPhaseOverride || { inPeak: false, weekend: false, nextAtMs: Date.now() + 3600000, nextIntoPeak: true, label: '平价时段' },
    config: { peakStyle: 'compact', peakShowTickLabels: true, peakCompactStack: false, peakAlertWebNotify: false, peakHolidays: '' },
    peakWindows: '周一至周五 9:00-12:00 · 14:00-18:00（周末与法定节假日全天闲时）',
    peakHours: [{ start: 9, end: 12 }, { start: 14, end: 18 }],
    // 法定节假日回显（官方口径：节假日全天闲时）
    holidays: { dates: ['2026-10-01', '2026-10-02', '2026-10-03'], mode: 'builtin', builtin: true, disabled: false, count: 33, invalid: [] },
    effectiveAt: '2026-08-01T00:00:00Z',
    ui: Object.assign({}, uiFlags),
    now: Date.now(),
  }
  if (name === 'summary') return Object.assign({ ok: true, sessionCost: 1.23, sessionSub: 0, provider: 'deepseek', sessionRealModels: [{ model: 'deepseek-flash', cost: 1.23 }] }, { ui: Object.assign({}, uiFlags) })
  return null
}
let dashPayload = DASH
// 峰谷相位按用例覆写（默认：工作日闲时；节假日用例覆写为 holiday/allDayOff）
let peakPhaseOverride = null
// 「Token 用量统计」热力图：本机按天明细（宿主 usage 路由 → buildUsageHeat）
const LOCAL_USAGE = {
  ok: true,
  total: { tokens: 3650, input: 1100, cache: 2000, output: 550, calls: 4, cost: 1.7 },
  days: [
    { date: '2026-09-12', input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0, calls: 3, cost: 1.5, tokens: 3500 },
    { date: '2026-09-15', input: 100, output: 50, cacheRead: 0, cacheWrite: 0, calls: 1, cost: 0.2, tokens: 150 },
  ],
}
// 云端按天明细（v1.3.2 起 byDay 才带 input/output/cacheRead/cacheWrite 拆分）
const CLOUD_USAGE = {
  ok: true, source: 'cloud', asOf: Date.now(),
  total: { tokens: 8000, input: 7500, cache: 300, output: 200, calls: 7, cost: 4.2 },
  days: [
    { date: '2026-08-18', input: 5500, output: 200, cacheRead: 300, cacheWrite: 0, calls: 5, cost: 3.3, tokens: 6000 },
    { date: '2026-09-12', input: 1500, output: 200, cacheRead: 300, cacheWrite: 0, calls: 2, cost: 0.9, tokens: 2000 },
  ],
}
const payloadFor = (name, syncView, args) => {
  // 界面显示开关的写入口：按服务端语义回显（ui-config → Object.assign({ok:true}, 规范化结果)）
  if (name === 'ui-config') return Object.assign({ ok: true }, uiFlags, args || {})
  const ui = uiPayload(name)
  if (ui) return ui
  if (name === 'sync') return Object.assign({}, SYNC, { view: syncView }, uiFlags)
  if (name === 'dashboard') return dashPayload
  if (name === 'usage') return LOCAL_USAGE
  if (name === 'cloud') return (args && args.route === 'usage') ? CLOUD_USAGE : CLOUD
  return { ok: false }
}

// ---------- 极简 React 替身（useState 按组件持久化，从而能模拟交互） ----------
const hookSlots = new Map()
let currentSlots = null
let hookIndex = 0
let pendingEffects = []
const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => {
    const i = hookIndex++
    const slots = currentSlots
    if (slots && !(i in slots)) slots[i] = typeof init === 'function' ? init() : init
    const value = slots ? slots[i] : (typeof init === 'function' ? init() : init)
    const set = (v) => { if (slots) slots[i] = typeof v === 'function' ? v(slots[i]) : v }
    return [value, set]
  },
  useEffect: (fn) => { pendingEffects.push(fn) },
  useRef: (v) => ({ current: v }),
}

/**
 * 构造一个 client.js 模块实例。
 * view 模块是在 bundle factory 里**一次性**解析的（requireLocal），所以要验证
 * 「取到 / 取不到」两条路径，必须分别实例化，而不是事后切换。
 */
function makeModule({ view = null, syncView = 'local' } = {}) {
  let captured = null
  const apiLog = []
  const sandbox = {
    window: {
      __ModuleLoader__: { load: (reg) => { captured = reg } },
      Notification: function () {},
      addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => {},
      setTimeout, clearTimeout, setInterval, clearInterval,
      location: { search: '' },
    },
    document: {
      createElement: () => ({ style: {}, set textContent(v) {}, appendChild() {}, setAttribute() {}, click() {}, remove() {} }),
      head: { appendChild() {} },
      body: { appendChild() {}, removeChild() {} },
      querySelector: () => null,
      addEventListener: () => {}, removeEventListener: () => {},
    },
    localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
    fetch: (url, init) => {
      const name = String(url).split('/').pop()
      let args = {}
      try { args = init && init.body ? JSON.parse(init.body) : {} } catch (e) { args = {} }
      apiLog.push({ name, args })
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payloadFor(name, syncView, args)) })
    },
    console, setTimeout, clearTimeout, setInterval, clearInterval,
  }
  sandbox.globalThis = sandbox
  runInContext(source, createContext(sandbox), { filename: 'client.js' })

  const reqShim = (spec) => {
    if (spec === 'react') return React
    if (view && (spec === './view' || String(spec).endsWith('/view'))) return view
    throw new Error('未预期的模块: ' + spec)
  }

  const out = { bundleId: captured && captured.id, section: null, card: null, cardMeta: null, injected: [], applyError: '', surfaces: {}, apiLog }
  const slots = {
    entries: () => [],
    inject: (name, cb) => { out.injected.push(name); try { cb() } catch (e) { out.injected.push('!!' + name + ':' + e.message) } return () => {} },
    register: (meta, render) => {
      if (meta && meta.name === 'settings.section') out.section = render
      if (meta && meta.name === 'settings.plugin.item') { out.cardMeta = meta; out.card = render }
      // 常驻落点（输入区胶囊 / 侧边栏时段条）：显隐必须能在渲染期判定，所以这里要拿到渲染函数
      if (meta && (meta.name === 'conversation.composer.dock' || meta.name === 'sidebar.footer.action')) out.surfaces[meta.name] = render
      return () => {}
    },
  }
  if (captured) {
    try {
      const mod = captured.factory(reqShim)
      try { mod.apply({ get: (n) => (n === 'slots' ? slots : undefined), effect: () => () => {} }) } catch (e) { out.applyError = String(e && e.message ? e.message : e) }
    } catch (e) { out.applyError = String(e && e.message ? e.message : e) }
  }
  return out
}

// ---------- 渲染器：函数组件被真正调用，任何 ReferenceError 都会被抓到 ----------
function render(component, props) {
  const state = { text: '', nodes: [], errors: [] }
  function walk(node, path) {
    if (node === null || node === undefined || typeof node === 'boolean') return
    if (typeof node === 'string' || typeof node === 'number') { state.text += String(node) + ' '; return }
    if (Array.isArray(node)) { node.forEach((c, i) => walk(c, `${path}[${i}]`)); return }
    const { type, props: p, children } = node
    if (typeof type === 'function') {
      const name = type.name || 'anon'
      state.nodes.push({ name, props: p || {}, children, path })
      const prevSlots = currentSlots, prevIndex = hookIndex
      if (!hookSlots.has(type)) hookSlots.set(type, [])
      currentSlots = hookSlots.get(type); hookIndex = 0
      let out
      try { out = type(p || {}) } catch (e) {
        state.errors.push({ comp: name, path, message: e && e.message })
        currentSlots = prevSlots; hookIndex = prevIndex
        return
      }
      currentSlots = prevSlots; hookIndex = prevIndex
      walk(out, `${path}>${name}`)
      return
    }
    state.nodes.push({ name: String(type), props: p || {}, children, path })
    walk(children, path)
  }
  try { walk(component(props), 'root') } catch (e) { state.errors.push({ comp: 'root', path: '', message: e && e.message }) }
  return state
}
const describeErrors = (errors) => errors.map((e) => `${e.comp}@${e.path}: ${e.message}`).join(' | ')

/**
 * 取节点子树里的全部文本（用于按按钮文案定位可点击节点）
 */
function flatText(node) {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(flatText).join('')
  return flatText(node.children)
}

/** 子树里是否含有某个标签（用于断言「按钮里画了图标」这类结构） */
function hasTag(node, tag) {
  if (node === null || node === undefined || typeof node !== 'object') return false
  if (Array.isArray(node)) return node.some((child) => hasTag(child, tag))
  if (String(node.type) === tag) return true
  return hasTag(node.children, tag)
}

/** 按 className 片段找 DOM 节点（齿轮 / 返回键 / 卡片头这类壳节点） */
function byClass(state, tag, cls) {
  return state.nodes.find((n) => n.name === tag && String(n.props.className || '').includes(cls))
}

/** 配置面板的七个折叠分组标题（两处入口必须逐一一致） */
const CFG_GROUPS = ['多机汇总（云端同步）', '峰谷计价与提示', '订阅套餐与配额', '计价与价格目录', '历史导入', '数据与界面', '安全与凭据']

/**
 * 带副作用的一轮挂载：渲染 → 执行 useEffect（触发 apiCall）→ 等微任务落地 → 再渲染。
 * 等价于 React 的「挂载 → effect 拉数据 → setState → 重渲染」。
 * rounds 默认 4：切到「本机+云端」是**链式** effect（loadSync 定 view → 渲染 → loadCloud
 * 取云端 → 渲染 → 合并），只跑 2 轮会停在"已切视图但云端还没并进来"的中间态。
 */
async function renderAsync(component, props, rounds = 4) {
  let last = null
  for (let r = 0; r < rounds; r++) {
    pendingEffects = []
    last = render(component, props)
    for (const fn of pendingEffects.splice(0)) {
      try { fn() } catch (e) { last.errors.push({ comp: 'useEffect', path: '', message: e && e.message }) }
    }
    for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  }
  return last
}

// ============================================================
console.log('[1] bundle 加载与 apply')
const mod = makeModule({ view: null, syncView: 'local' })
check('模块以 scoped 包名注册', mod.bundleId === '@angelyeye/dsh-cost-tracker', `id=${mod.bundleId}`)
check('apply() 不抛错', mod.applyError === '', mod.applyError)
// 兼容入口：DSH 0.1.7-alpha.2 起宿主不再声明该插槽（内置插件页改成只读清单），
// 回调不触发即自动失效；仍声明它的旧宿主照旧显示卡片。因此这条注册必须保留。
check('无条件 inject settings.plugin.item（旧宿主兼容入口）', mod.injected.includes('settings.plugin.item'), `injected=${JSON.stringify(mod.injected)}`)
check('卡片条目键 = cost-tracker', !!mod.cardMeta && mod.cardMeta.key === 'cost-tracker', JSON.stringify(mod.cardMeta))
check('注册了 settings.section（左侧「花费统计」入口）', typeof mod.section === 'function')

console.log('[2] 渲染「花费统计」页（已配置且已同步成功）')
hookSlots.clear()
const dash = typeof mod.section === 'function' ? await renderAsync(mod.section, {}) : { text: '', nodes: [], errors: [] }
check('渲染期无异常（组件内未定义变量/属性访问）', dash.errors.length === 0, describeErrors(dash.errors))
check('渲染出页面标题「花费统计」', dash.text.includes('花费统计'), `文本=${JSON.stringify(dash.text.trim().slice(0, 80))}`)
check('渲染出时间范围切换', dash.text.includes('近 7 天') || dash.text.includes('近7天'))
check('三态开关三个按钮都在（本机 / 本机+云端 / 仅云端）',
  dash.text.includes('本机') && dash.text.includes('本机+云端') && dash.text.includes('仅云端'),
  JSON.stringify(dash.text.trim().slice(0, 140)))
check('已同步状态下渲染「上次同步」时间标签（timeLabel 必须已定义）',
  /上次同步\s*(刚刚|\d+\s*(分钟|小时)前|\d{2}-\d{2} \d{2}:\d{2})/.test(dash.text.replace(/\s+/g, ' ')),
  JSON.stringify(dash.text.replace(/\s+/g, ' ').slice(0, 200)))

console.log('[3] 兼容入口：插件配置卡片外壳（li > 可点击 header > 折叠 body）')
if (typeof mod.card !== 'function') {
  check('卡片渲染函数已注册', false, 'settings.plugin.item 未注册渲染函数')
} else {
  hookSlots.clear()
  const first = render(mod.card, {})
  check('渲染期无异常', first.errors.length === 0, describeErrors(first.errors))
  const rootNode = first.nodes.find((n) => n.name === 'li' && String(n.props.className || '').includes('cost-pcard'))
  check('根节点是 li.cost-pcard（宿主把卡片放在 ul 列表里）', !!rootNode, first.nodes.slice(0, 4).map((n) => n.name).join(','))
  const headNode = first.nodes.find((n) => n.name === 'button' && String(n.props.className || '').includes('cost-pcard-head'))
  check('有可点击的 header 按钮', !!headNode && typeof headNode.props.onClick === 'function')
  check('header 带 aria-expanded 语义且默认收起', !!headNode && headNode.props['aria-expanded'] === false, JSON.stringify(headNode && headNode.props['aria-expanded']))
  check('标题显示插件名「花费统计」', first.text.includes('花费统计'))
  check('副标题说明云端同步用途', first.text.includes('云端'))
  check('默认折叠：初始不渲染 body', !first.nodes.some((n) => String(n.props.className || '').includes('cost-pcard-body')),
    first.nodes.filter((n) => String(n.props.className || '').includes('cost-pcard')).map((n) => n.props.className).join(' | '))

  if (headNode && typeof headNode.props.onClick === 'function') {
    headNode.props.onClick()
    const second = await renderAsync(mod.card, {})
    check('点击 header 后展开出 body', second.nodes.some((n) => String(n.props.className || '').includes('cost-pcard-body')), describeErrors(second.errors))
    check('展开后渲染期无异常', second.errors.length === 0, describeErrors(second.errors))
    check('展开后出现「服务地址」字段', second.text.includes('服务地址'), JSON.stringify(second.text.trim().slice(0, 100)))
    check('展开后渲染「上次同步」时间标签', /上次同步\s*(刚刚|\d+\s*(分钟|小时)前|\d{2}-\d{2} \d{2}:\d{2})/.test(second.text.replace(/\s+/g, ' ')),
      JSON.stringify(second.text.replace(/\s+/g, ' ').slice(0, 200)))

    check('展开后出现「界面显示」分组', second.text.includes('界面显示'))
    // 「界面显示」分组：三个开关都要在卡片里，勾选后必须真的提交给宿主并广播事件。
    // 卡片里共 6 个 checkbox（云端同步 3 个 + 界面显示 3 个），界面显示这组是**立即提交**的：
    // 用它提交的内容是不是单个 ui* 键来把这 3 个挑出来（顺带断言了云端那组没有变成即提交）。
    const uiBoxes = []
    for (const n of second.nodes) {
      if (n.name !== 'input' || !n.props || n.props.type !== 'checkbox' || typeof n.props.onChange !== 'function') continue
      const writesUi = []
      const probe = mod.apiLog.length
      n.props.onChange({ target: { checked: false } })
      for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r))
      for (const c of mod.apiLog.slice(probe)) if (c.name === 'ui-config') writesUi.push(c)
      if (writesUi.length) uiBoxes.push({ node: n, call: writesUi[writesUi.length - 1] })
    }
    check('「界面显示」分组渲染出三个开关', uiBoxes.length === 3, `立即提交型 checkbox 数=${uiBoxes.length}`)
    check('分组文案点明三个落点（胶囊 / 时段条 / 看板）',
      second.text.includes('输入框上方的花费胶囊') && second.text.includes('侧边栏峰谷时段条') && second.text.includes('设置页「花费统计」看板'),
      JSON.stringify(second.text.replace(/\s+/g, ' ').slice(-260)))
    check('分组说明点明「只影响显示、不影响记账」', second.text.includes('照常工作'))
    if (uiBoxes.length === 3) {
      const keys = uiBoxes.map((b) => Object.keys(b.call.args || {}).join(','))
      check('三个开关各自提交自己的键（不整包覆盖）',
        keys.join('|') === 'uiDockEnabled|uiPeakEnabled|uiDashboardEnabled', JSON.stringify(keys))
      check('提交内容就是被点开关的新值（false）',
        uiBoxes.every((b) => Object.values(b.call.args)[0] === false), JSON.stringify(uiBoxes.map((b) => b.call.args)))
    }

    // ---- 法定节假日（v1.9.2）：官方口径把节假日全天计入闲时 ----
    check('「峰谷计价与提示」分组渲染出法定节假日输入框', second.text.includes('法定节假日（全天闲时）'),
      JSON.stringify(second.text.replace(/\s+/g, ' ').slice(-320)))
    check('分组标题摘要回显节假日条数与来源', second.text.includes('节假日 33 天'),
      JSON.stringify(second.text.replace(/\s+/g, ' ').slice(0, 220)))
    check('提供「恢复内置」与「停用」两个预设按钮', second.text.includes('恢复内置') && second.text.includes('停用'))
    check('说明点明「不含法定节假日才算高峰」与调休口径',
      second.text.includes('不含法定节假日') && second.text.includes('调休补班'))
    const stopBtn = second.nodes.find((n) => n.name === 'button' && flatText(n).indexOf('停用') >= 0)
    if (stopBtn) {
      // 「停用」只改草稿，「保存」才提交。这里用**同步渲染**取新一轮闭包：
      // renderAsync 会重跑 useEffect（loadPeak 会用服务端值覆盖草稿），而真实用户点
      // 「停用」后 React 只重渲染、不重跑挂载 effect —— 同步 render 才是等价语义。
      stopBtn.props.onClick()
      const fresh = render(mod.card, {})
      const idx = fresh.nodes.findIndex((n) => n.name === 'button' && flatText(n).indexOf('停用') >= 0)
      const saveBtn = fresh.nodes.slice(idx).find((n) => n.name === 'button' && flatText(n).trim() === '保存')
      check('同组内能找到「保存」按钮', !!saveBtn)
      if (saveBtn) {
        const probe = mod.apiLog.length
        saveBtn.props.onClick()
        for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r))
        const call = mod.apiLog.slice(probe).filter((c) => c.name === 'peak-config').pop()
        check('「停用」后保存提交 peakHolidays = none',
          !!call && call.args && call.args.peakHolidays === 'none',
          JSON.stringify(call ? call.args && call.args.peakHolidays : mod.apiLog.slice(probe).map((c) => c.name)))
      }
    } else {
      check('找到「停用」按钮', false, '渲染树中未找到')
    }
  }
}

// ---------- [3b] v1.9.3 内迁的配置入口：看板页头齿轮 → 配置页 → 返回键 ----------
// 背景：DSH 0.1.7-alpha.2 删除了「插件配置」插槽（内置插件分区改成只读清单），
// 原卡片在新宿主上永远不显示 ⇒ 配置入口内迁到本插件自己的设置分区。
// 宿主设置外壳渲染分区时只传 close（renderSlot('settings.section', { close }, { only: active })），
// 分区没有程序化切换导航的能力 ⇒ 只能是分区内子视图 + 返回键，而不是第二个左侧导航项。
// 这组断言钉住：齿轮可达、配置页完整、返回键可用、两个视图互斥（不是同时渲染）。
console.log('[3b] 齿轮入口：看板 ⇄ 配置页（含返回键）')
{
  hookSlots.clear()
  const modGear = makeModule({ view: REAL_VIEW, syncView: 'local' })
  const dashView = await renderAsync(modGear.section, {}, 3)
  check('看板渲染无异常', dashView.errors.length === 0, describeErrors(dashView.errors))

  const gear = byClass(dashView, 'button', 'cost-gear')
  check('看板页头渲染出设置齿轮', !!gear, dashView.nodes.slice(0, 6).map((n) => n.name + '.' + String(n.props.className || '')).join(' | '))
  check('齿轮带可访问名与悬浮说明（图标按钮，无可见文字）',
    !!gear && gear.props['aria-label'] === '花费统计设置' && gear.props.title === '花费统计设置' && flatText(gear).trim() === '',
    JSON.stringify(gear && { aria: gear.props['aria-label'], title: gear.props.title, text: flatText(gear) }))
  check('齿轮是图标按钮（内部画了 svg）', !!gear && hasTag(gear, 'svg'), '齿轮子树里没有 svg')
  check('齿轮挂在页头标题行（cost-h1 的右侧操作位）',
    !!gear && (() => {
      const actions = dashView.nodes.find((n) => n.name === 'span' && String(n.props.className || '').includes('cost-h1-actions'))
      // 操作位里挂的是 <GearButton/> 组件节点（函数型 children），说明齿轮确实在标题行右侧，
      // 而不是被渲染到页面别处
      return !!actions && Array.isArray(actions.children) && actions.children.some((c) => c && typeof c.type === 'function')
    })(),
    '未找到 .cost-h1-actions 包裹的齿轮')

  if (!gear) {
    check('齿轮可点击并进入配置页', false, '没有齿轮节点，后续断言无法进行')
  } else {
    gear.props.onClick()
    const cfg = await renderAsync(modGear.section, {}, 3)
    check('点齿轮后进入配置页且渲染无异常', cfg.errors.length === 0, describeErrors(cfg.errors))
    check('配置页不再渲染看板统计内容（两视图互斥，不是同时渲染）',
      !cfg.text.includes('Token 用量统计'), JSON.stringify(cfg.text.replace(/\s+/g, ' ').slice(0, 160)))

    const back = byClass(cfg, 'button', 'cost-back')
    check('配置页有返回键（真按钮 + 可访问名 + 含图标）',
      !!back && typeof back.props.onClick === 'function' && back.props['aria-label'] === '返回花费统计看板' && hasTag(back, 'svg'),
      JSON.stringify(back && { aria: back.props['aria-label'], text: flatText(back) }))
    check('配置页标题标明是设置', cfg.text.includes('花费统计 · 设置'), JSON.stringify(cfg.text.replace(/\s+/g, ' ').slice(0, 120)))
    check('配置页渲染出全部七个折叠分组',
      CFG_GROUPS.every((t) => cfg.text.includes(t)),
      JSON.stringify(CFG_GROUPS.filter((t) => !cfg.text.includes(t))))
    check('配置页说明点明旧宿主卡片的同一份设置（兼容提示）',
      cfg.text.includes('插件配置') && cfg.text.includes('同一份设置'),
      JSON.stringify(cfg.text.replace(/\s+/g, ' ').slice(0, 240)))

    if (back && typeof back.props.onClick === 'function') {
      back.props.onClick()
      const dashBack = await renderAsync(modGear.section, {}, 3)
      check('点返回键回到看板（统计内容回来，无渲染异常）',
        dashBack.text.includes('Token 用量统计') && dashBack.errors.length === 0,
        describeErrors(dashBack.errors))
      check('返回后齿轮仍在（可再次进入配置页）', !!byClass(dashBack, 'button', 'cost-gear'))
    }
  }
}

// ---------- [3c] 两个入口同源：配置页与旧卡片渲染同一套分组 ----------
// 一处实现两种外壳（ConfigPanel mode='page' | 'card'），这里把两边的分组标题集合对起来：
// 将来加字段只改一处，若有人给其中一边单独加分组/字段，这条会立刻报红。
console.log('[3c] 两入口一致性：配置页与兼容卡片的分组集合相同')
{
  hookSlots.clear()
  const modBoth = makeModule({ view: REAL_VIEW, syncView: 'local' })

  const dashForPage = await renderAsync(modBoth.section, {}, 3)
  const gearBtn = byClass(dashForPage, 'button', 'cost-gear')
  if (gearBtn) gearBtn.props.onClick()
  const pageView = await renderAsync(modBoth.section, {}, 3)
  check('配置页渲染无异常', pageView.errors.length === 0, describeErrors(pageView.errors))

  hookSlots.clear()
  const cardFirst = render(modBoth.card, {})
  const cardHead = byClass(cardFirst, 'button', 'cost-pcard-head')
  if (cardHead && typeof cardHead.props.onClick === 'function') cardHead.props.onClick()
  const cardView = await renderAsync(modBoth.card, {}, 3)
  check('兼容卡片展开后渲染无异常', cardView.errors.length === 0, describeErrors(cardView.errors))

  const pageText = pageView.text.replace(/\s+/g, ' ')
  const cardText = cardView.text.replace(/\s+/g, ' ')
  check('七个分组标题在两边都存在',
    CFG_GROUPS.every((t) => pageText.includes(t) && cardText.includes(t)),
    JSON.stringify({
      page: CFG_GROUPS.filter((t) => !pageText.includes(t)),
      card: CFG_GROUPS.filter((t) => !cardText.includes(t)),
    }))
  check('顶部状态条在两边都存在（同一份摘要）',
    pageText.includes('已记账') && pageText.includes('待上报') && cardText.includes('已记账') && cardText.includes('待上报'),
    JSON.stringify({ page: pageText.slice(0, 120), card: cardText.slice(0, 120) }))
  check('两边的多机汇总字段一致（服务地址 / 共享令牌）',
    pageText.includes('服务地址') && cardText.includes('服务地址') && pageText.includes('共享令牌') && cardText.includes('共享令牌'))
}

console.log('[4] 三态视图一致性：取不到 view 模块时的内联实现必须与 view.js 完全等价')
hookSlots.clear()
const withFallback = await renderAsync(makeModule({ view: null, syncView: 'local+cloud' }).section, {})
hookSlots.clear()
const withModule = await renderAsync(makeModule({ view: REAL_VIEW, syncView: 'local+cloud' }).section, {})
check('两条路径都无渲染异常',
  withFallback.errors.length === 0 && withModule.errors.length === 0,
  `fallback=${describeErrors(withFallback.errors)} | module=${describeErrors(withModule.errors)}`)
check('两条路径渲染结果逐字一致（内联实现未与 view.js 漂移）',
  withFallback.text === withModule.text,
  `fallback=${JSON.stringify(withFallback.text.trim().slice(0, 120))} | module=${JSON.stringify(withModule.text.trim().slice(0, 120))}`)
check('「本机+云端」视图确实把云端数字并了进来（合并逻辑未退化成直通）',
  withFallback.text.includes('7.81') || withFallback.text.includes('7.8'),
  JSON.stringify(withFallback.text.replace(/\s+/g, ' ').slice(0, 200)))

// ---------- [5] 「仅云端」视图：金额必须来自云端口径（回归：曾整列显示 ¥0.0000） ----------
// 线上故障现场：云端返回的是 realCost/subEquivalent，本地卡片读 real/sub，
// 归一化只透传原字段 → 次数（同名 calls）正常、**三个金额卡与底部汇总全为 ¥0.0000**。
// 这里用真实云端口径渲染「仅云端」，逐项断言金额与汇总都非 0。
console.log('[5] 「仅云端」视图金额映射（云端 realCost → 本地 real）')
hookSlots.clear()
const cloudOnly = await renderAsync(makeModule({ view: REAL_VIEW, syncView: 'cloud' }).section, {})
const cloudText = cloudOnly.text.replace(/\s+/g, ' ')
check('仅云端渲染无异常', cloudOnly.errors.length === 0, describeErrors(cloudOnly.errors))
check('今日费用取到云端金额（¥0.50）', cloudText.includes('¥0.50'), JSON.stringify(cloudText.slice(0, 260)))
check('总花费取到云端金额（¥2.00）', cloudText.includes('¥2.00'), JSON.stringify(cloudText.slice(0, 260)))
check('顶部不再出现 ¥0.0000 的金额卡', !cloudText.includes('¥0.0000'), JSON.stringify(cloudText.slice(0, 260)))
check('底部汇总行按 realCost 口径显示（¥2.00 · 请求 100 次）',
  /¥2\.00/.test(cloudText) && /100\s*次/.test(cloudText) && !/¥0\.00\s*·\s*请求\s*0\s*次/.test(cloudText),
  JSON.stringify(cloudText.slice(-320)))
// 内联实现（取不到 view 模块）必须给出同样结果
hookSlots.clear()
const cloudOnlyFallback = await renderAsync(makeModule({ view: null, syncView: 'cloud' }).section, {})
check('内联实现与 view.js 的云端金额口径一致',
  cloudOnlyFallback.text.replace(/\s+/g, ' ') === cloudText,
  `fallback=${JSON.stringify(cloudOnlyFallback.text.replace(/\s+/g, ' ').slice(0, 160))}`)

// ---------- [6] 档位文案：官方只有「高峰 / 闲时」两档 ----------
// 事故背景：图例第三项曾写作「平峰」（内部 period='flat' 的直译）。flat 的真实含义是
// 「这笔计价不分峰谷」（订阅套餐、非 DeepSeek provider 兜底价、未识别模型的通用兜底价），
// 而「平峰/平段」在电价语境里是**峰谷之间的第三个时段** —— 会让人以为 DeepSeek 有三档价。
// 另外它常驻图例却不参与计费（恒为 0 时也要占一个色块），进一步强化了误解。
console.log('[6] 档位文案与图例：不得出现「平峰」')
hookSlots.clear()
const periodTexts = await renderAsync(makeModule({ view: REAL_VIEW, syncView: 'local' }).section, {})
const pText = periodTexts.text.replace(/\s+/g, ' ')
check('渲染期无异常', periodTexts.errors.length === 0, describeErrors(periodTexts.errors))
check('flat 档位显示为「不分峰谷」', pText.includes('不分峰谷'), JSON.stringify(pText.slice(0, 300)))
check('图例/记录里不再出现「平峰」', !pText.includes('平峰'), JSON.stringify(pText.match(/.{0,20}平峰.{0,20}/) || ''))

// flat 全为 0（只有 DeepSeek 按量调用时的真实情况）→ 图例只留高峰/闲时两项
dashPayload = Object.assign({}, DASH, {
  flatCost: 0,
  byDay: [{ date: '2026-09-15', label: '09/15', peak: 3.2, off: 2.1, flat: 0 }],
  recent: DASH.recent.filter((r) => r.period !== 'flat'),
})
hookSlots.clear()
const noFlat = await renderAsync(makeModule({ view: REAL_VIEW, syncView: 'local' }).section, {})
const nText = noFlat.text.replace(/\s+/g, ' ')
check('flat 为 0 时渲染无异常', noFlat.errors.length === 0, describeErrors(noFlat.errors))
check('flat 为 0 时图例不再出现第三项', !nText.includes('不分峰谷') && !nText.includes('平峰'), JSON.stringify(nText.slice(0, 300)))
check('高峰与闲时始终在', nText.includes('高峰') && nText.includes('闲时'))
dashPayload = DASH

// ---------- [7] 「Token 用量统计」热力图跟随三态视图 ----------
// 事故背景：热力图的数据源是宿主的 usage → buildUsageHeat()，**纯本地**；页面其余卡片却走
// viewDash（本机+云端合并）。于是「本机+云端」下热力图说 98.4M、上方卡片说 955M，
// 同一屏自相矛盾。现改为按视图取数并合并（云端 byDay 提供 token 类型拆分）。
console.log('[7] 「Token 用量统计」热力图跟随三态视图')
const heatOf = (state) => {
  const node = state.nodes.find((n) => n.name === 'UsageHeatmap')
  return node ? node.props.data : null
}
const dayOf = (data, date) => (data.days || []).find((d) => d.date === date)

hookSlots.clear()
const heatLocal = await renderAsync(makeModule({ view: REAL_VIEW, syncView: 'local' }).section, {}, 5)
const hLocal = heatOf(heatLocal)
check('本机视图渲染出热力图且渲染无异常', !!hLocal && heatLocal.errors.length === 0, describeErrors(heatLocal.errors))
check('本机视图累计 = 本机 total（3650 tokens · 4 次调用）',
  !!hLocal && hLocal.total.tokens === 3650 && hLocal.total.calls === 4,
  JSON.stringify(hLocal && hLocal.total))

hookSlots.clear()
const heatUnion = await renderAsync(makeModule({ view: REAL_VIEW, syncView: 'local+cloud' }).section, {}, 5)
const hUnion = heatOf(heatUnion)
check('本机+云端渲染出热力图且无异常', !!hUnion && heatUnion.errors.length === 0, describeErrors(heatUnion.errors))
check('本机+云端累计 = 本机 + 云端（3650 + 8000 = 11650）',
  !!hUnion && hUnion.total.tokens === 11650,
  JSON.stringify(hUnion && hUnion.total))
check('本机+云端累计调用 = 4 + 7 = 11',
  !!hUnion && hUnion.total.calls === 11, JSON.stringify(hUnion && hUnion.total))
check('云端独有的日期进入热力图（08-18 · 6000 tokens）',
  !!hUnion && !!dayOf(hUnion, '2026-08-18') && dayOf(hUnion, '2026-08-18').tokens === 6000,
  JSON.stringify(hUnion && hUnion.days))
check('两侧同日相加（09-12 = 3500 + 2000 = 5500）',
  !!hUnion && !!dayOf(hUnion, '2026-09-12') && dayOf(hUnion, '2026-09-12').tokens === 5500,
  JSON.stringify(dayOf(hUnion || { days: [] }, '2026-09-12')))
check('按天 tokens 与拆分项自洽（tokens = input+output+cacheRead+cacheWrite）',
  !!hUnion && hUnion.days.every((d) => d.tokens === d.input + d.output + d.cacheRead + d.cacheWrite),
  JSON.stringify(hUnion && hUnion.days))
check('卡片标题右侧标注口径「本机 + 云端」', heatUnion.text.includes('本机 + 云端'),
  JSON.stringify(heatUnion.text.replace(/\s+/g, ' ').slice(0, 200)))

hookSlots.clear()
const heatCloud = await renderAsync(makeModule({ view: REAL_VIEW, syncView: 'cloud' }).section, {}, 5)
const hCloud = heatOf(heatCloud)
check('仅云端累计 = 云端 total（8000 tokens），不含本机',
  !!hCloud && hCloud.total.tokens === 8000 && hCloud.total.calls === 7,
  JSON.stringify(hCloud && hCloud.total))
check('仅云端不再出现本机独有的 09-15（150 tokens）',
  !!hCloud && !dayOf(hCloud, '2026-09-15'), JSON.stringify(hCloud && hCloud.days))

// ---------- [8] 前端显隐开关：显式 false 必须真的让对应落点消失 ----------
// 这组断言拦的是"开关只写进了配置、界面却不读"这类假功能：每个落点都要能在
// 关掉后渲染出空（或设置项提示），并且重新打开后原样恢复。
console.log('[8] 前端显隐开关（uiDockEnabled / uiPeakEnabled / uiDashboardEnabled）')
const mod7 = makeModule({ view: REAL_VIEW, syncView: 'local' })
const dockRender = mod7.surfaces['conversation.composer.dock']
const peakRender = mod7.surfaces['sidebar.footer.action']
check('注册了常驻落点：输入区胶囊', typeof dockRender === 'function')
check('注册了常驻落点：侧边栏时段条', typeof peakRender === 'function')

const dockOn = await (async () => { hookSlots.clear(); return renderAsync(dockRender, { sessionId: 's1' }, 3) })()
check('胶囊默认可见且显示本会话金额（¥1.23）', dockOn.text.includes('1.23'), JSON.stringify(dockOn.text.trim().slice(0, 120)))
const peakOn = await (async () => { hookSlots.clear(); return renderAsync(peakRender, { wide: true }, 3) })()
check('时段条默认可见（渲染出内容）', peakOn.text.trim().length > 0, JSON.stringify(peakOn.text.trim().slice(0, 80)))

uiFlags = { uiDockEnabled: false, uiPeakEnabled: true, uiDashboardEnabled: true }
const dockOff = await (async () => { hookSlots.clear(); return renderAsync(dockRender, { sessionId: 's1' }, 3) })()
check('关掉 uiDockEnabled 后胶囊渲染为空', dockOff.text.trim() === '' && !dockOff.errors.length, `${JSON.stringify(dockOff.text)} | ${describeErrors(dockOff.errors)}`)

uiFlags = { uiDockEnabled: true, uiPeakEnabled: false, uiDashboardEnabled: true }
const peakOff = await (async () => { hookSlots.clear(); return renderAsync(peakRender, { wide: true }, 3) })()
check('关掉 uiPeakEnabled 后时段条渲染为空', peakOff.text.trim() === '' && !peakOff.errors.length, `${JSON.stringify(peakOff.text)} | ${describeErrors(peakOff.errors)}`)

uiFlags = { uiDockEnabled: true, uiPeakEnabled: true, uiDashboardEnabled: false }
const dashOff = await (async () => { hookSlots.clear(); return renderAsync(mod7.section, {}, 3) })()
const dashOffText = dashOff.text.replace(/\s+/g, ' ')
check('关掉 uiDashboardEnabled 后看板不再渲染统计内容', !dashOffText.includes('Token 用量统计') && !dashOffText.includes('总花费'), JSON.stringify(dashOffText.slice(0, 160)))
check('看板位置改为提示如何重新打开（不静默白屏，指向齿轮）', dashOffText.includes('关闭显示') && dashOffText.includes('齿轮'), JSON.stringify(dashOffText.slice(0, 200)))
check('关闭态渲染无异常', dashOff.errors.length === 0, describeErrors(dashOff.errors))

// 关闭态**必须**留着齿轮：原「插件配置」入口在 0.1.7-alpha.2 上已消失，
// 若齿轮也跟着看板一起藏起来，用户就再也打不开了（死亡入口）。
const offGear = byClass(dashOff, 'button', 'cost-gear')
check('关闭态仍渲染齿轮入口（否则关掉后无法再打开）', !!offGear, dashOff.nodes.map((n) => n.name + '.' + String(n.props.className || '')).slice(0, 8).join(' | '))
if (offGear) {
  offGear.props.onClick()
  const cfgFromOff = await renderAsync(mod7.section, {}, 3)
  check('关闭态下点齿轮仍能进配置页', cfgFromOff.text.includes('花费统计 · 设置') && cfgFromOff.errors.length === 0, describeErrors(cfgFromOff.errors))
  // 配置页「数据与界面」里的看板开关能真的写回服务端（真实服务端会落盘并回显）
  const boxes = cfgFromOff.nodes.filter((n) => n.name === 'input' && n.props && n.props.type === 'checkbox' && typeof n.props.onChange === 'function')
  let wroteUi = null
  for (const box of boxes) {
    const probe = mod7.apiLog.length
    box.props.onChange({ target: { checked: true } })
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r))
    const call = mod7.apiLog.slice(probe).filter((c) => c.name === 'ui-config').pop()
    if (call && call.args && call.args.uiDashboardEnabled === true) wroteUi = call
  }
  check('配置页里能把「设置页花费统计看板」重新打开（ui-config）', !!wroteUi, JSON.stringify(mod7.apiLog.filter((c) => c.name === 'ui-config').slice(-2)))
  // 点返回键回到看板，再让服务端落盘回显（uiFlags）——看板与齿轮一起恢复
  const backFromCfg = byClass(cfgFromOff, 'button', 'cost-back')
  if (backFromCfg && typeof backFromCfg.props.onClick === 'function') backFromCfg.props.onClick()
  uiFlags = { uiDockEnabled: true, uiPeakEnabled: true, uiDashboardEnabled: true }
  const reopened = await renderAsync(mod7.section, {}, 3)
  check('重新打开后看板恢复（统计内容回来）', reopened.text.includes('Token 用量统计'), JSON.stringify(reopened.text.replace(/\s+/g, ' ').slice(0, 160)))
} else {
  check('关闭态下点齿轮仍能进配置页', false, '关闭态没有齿轮入口')
}

uiFlags = { uiDockEnabled: true, uiPeakEnabled: true, uiDashboardEnabled: true }
const dashBack = await (async () => { hookSlots.clear(); return renderAsync(mod7.section, {}, 3) })()
check('重新打开后看板恢复（统计内容回来）', dashBack.text.includes('Token 用量统计'), JSON.stringify(dashBack.text.replace(/\s+/g, ' ').slice(0, 160)))

// ---------- [10] 双轨计费口径：「含 Plan 总额」开关 ----------
// 关闭（默认）＝只算按量真金白银；打开＝金额 = 按量 + 订阅等值，图表并入「订阅等值」段。
// 开关必须**同时**写 localStorage（本机偏好）与服务端配置（跨设备/看板默认一致）。
console.log('[10] 双轨计费口径开关（含 Plan 总额）')
{
  const mod10 = makeModule({ view: REAL_VIEW, syncView: 'local' })
  hookSlots.clear()
  const off = await renderAsync(mod10.section, {}, 3)
  const offText = off.text.replace(/\s+/g, ' ')
  check('默认按量口径：总花费 = 纯按量金额（¥5.81）', offText.includes('5.81'), JSON.stringify(offText.slice(0, 200)))
  check('默认金额卡不带「（含 Plan）」标记', !offText.includes('（含 Plan）'), JSON.stringify(offText.slice(0, 200)))
  check('默认图例不含「订阅等值」（订阅未并入金额）', !offText.includes('订阅等值'))
  check('看板上渲染了金额口径开关（且仅此一个 checkbox）',
    off.nodes.filter((n) => n.name === 'input' && n.props.type === 'checkbox').length === 1,
    `checkbox 数=${off.nodes.filter((n) => n.name === 'input' && n.props.type === 'checkbox').length}`)

  // 找到那个会写 billing-config 的开关并打开它
  const hits = []
  for (const n of off.nodes) {
    if (n.name !== 'input' || !n.props || n.props.type !== 'checkbox' || typeof n.props.onChange !== 'function') continue
    const probe = mod10.apiLog.length
    n.props.onChange({ target: { checked: true } })
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r))
    for (const c of mod10.apiLog.slice(probe)) if (c.name === 'billing-config') hits.push({ node: n, call: c })
  }
  check('金额口径开关写服务端配置（billing-config.showTotalWithPlan）',
    hits.length === 1 && hits[0].call.args && hits[0].call.args.showTotalWithPlan === true,
    JSON.stringify(hits.map((h) => h.call.args)))

  const on = await renderAsync(mod10.section, {}, 3)
  const onText = on.text.replace(/\s+/g, ' ')
  check('打开后总花费 = 按量 + 订阅等值（5.81 + 0.5 = ¥6.31）', onText.includes('6.31'), JSON.stringify(onText.slice(0, 260)))
  check('打开后金额卡标注「（含 Plan）」', onText.includes('（含 Plan）'), JSON.stringify(onText.slice(0, 200)))
  check('打开后图表图例出现「订阅等值」（订阅按天并入堆叠）', onText.includes('订阅等值'), JSON.stringify(onText.slice(0, 300)))
  check('打开后仍能看出订阅这部分是多少（附注「含订阅」）', onText.includes('含订阅'), JSON.stringify(onText.slice(0, 300)))

  // 关回来：金额回到纯按量（用最新一轮渲染的开关节点，避免拿到过期闭包）
  const onRendered = await renderAsync(mod10.section, {}, 3)
  const onBox = onRendered.nodes.find((n) => n.name === 'input' && n.props && n.props.type === 'checkbox' && n.props.checked === true)
  check('打开状态回显在开关上（checked=true）', !!onBox)
  if (onBox) {
    onBox.props.onChange({ target: { checked: false } })
    for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r))
    const back = await renderAsync(mod10.section, {}, 3)
    const backText = back.text.replace(/\s+/g, ' ')
    check('关回后金额恢复纯按量口径（¥5.81）', backText.includes('5.81'), JSON.stringify(backText.slice(0, 260)))
    check('关回后不再标注「（含 Plan）」', !backText.includes('（含 Plan）'), JSON.stringify(backText.slice(0, 200)))
  }
}

// ---------- [9] 显隐说明书的单一事实源：client.js 的 UI_SURFACES 必须与 config.js 对齐 ----------
// 文案在浏览器里有本地副本（配置卡片不该为一段文案再往返服务端），因此键名可能悄悄漂移：
// 漂移后卡片勾选的键服务端不认，表现是"勾了没反应"。这里把两份清单逐项对起来。
console.log('[9] 界面显示清单：client.js 与 config.js 一致')
{
  const clientKeys = [...source.matchAll(/key:\s*"(ui[A-Za-z]+Enabled)"/g)].map((m) => m[1])
  const serverKeys = UI_SURFACES.map((s) => s.key)
  check('client.js 与 config.js 的开关键完全相同',
    clientKeys.length === serverKeys.length && serverKeys.every((k) => clientKeys.includes(k)),
    `client=${JSON.stringify(clientKeys)} server=${JSON.stringify(serverKeys)}`)
  check('三个落点各自独立（不可只留一个）', serverKeys.length === 3, JSON.stringify(serverKeys))
  for (const s of UI_SURFACES) {
    check(`说明书中含有「${s.label}」`, source.includes(s.label), `client.js 缺少 ${s.key} 的文案`)
  }
  check('默认值语义一致：只有显式 false 才算关闭',
    /function uiOn\(ui, key\)\s*\{\s*return !\(ui && ui\[key\] === false\);/.test(source),
    'client.js 的 uiOn 必须按 === false 判定（缺省可见）')
  check('服务端默认全部可见（defaultUiConfig 全 true）',
    UI_SURFACES.every((s) => defaultUiConfig()[s.key] === true),
    JSON.stringify(defaultUiConfig()))
}

// ---------- [10] 法定节假日的相位文案（官方：节假日全天闲时） ----------
// 事故背景：峰谷相位原先只有 weekend / inPeak / off 三态，节假日落在工作日时只能显示
// 「平价时段」，看不出「今天其实是节假日全谷」。这里钉住三件事：
//   ① 后端给出 holiday/allDayOff 时，UI 必须说「节假日全谷」；
//   ② 周末仍说「周末全谷」（不得被节假日文案顶掉）；
//   ③ 老后端缺 allDayOff 字段时回落到 weekend 判定（向后兼容）。
console.log('[10] 法定节假日相位文案')
{
  const nowMs = Date.now()
  const phaseFor = (extra) => Object.assign({ inPeak: false, weekend: false, nextAtMs: nowMs + 3600000, nextIntoPeak: true }, extra)

  peakPhaseOverride = phaseFor({ holiday: true, allDayOff: true })
  hookSlots.clear()
  const holMod = makeModule({ view: REAL_VIEW, syncView: 'local' })
  const holSide = await renderAsync(holMod.surfaces['sidebar.footer.action'], {}, 3)
  check('节假日相位渲染无异常', holSide.errors.length === 0, describeErrors(holSide.errors))
  check('节假日显示「节假日全谷」', holSide.text.includes('节假日全谷'),
    JSON.stringify(holSide.text.replace(/\s+/g, ' ').slice(0, 120)))
  check('节假日不再被误称为「周末」', !holSide.text.includes('周末全谷'),
    JSON.stringify(holSide.text.replace(/\s+/g, ' ').slice(0, 120)))

  peakPhaseOverride = phaseFor({ weekend: true, holiday: false, allDayOff: true })
  hookSlots.clear()
  const wkSide = await renderAsync(holMod.surfaces['sidebar.footer.action'], {}, 3)
  check('周末仍显示「周末全谷」', wkSide.text.includes('周末全谷'),
    JSON.stringify(wkSide.text.replace(/\s+/g, ' ').slice(0, 120)))

  // 向后兼容：老后端只给 weekend、没有 allDayOff
  peakPhaseOverride = phaseFor({ weekend: true })
  hookSlots.clear()
  const legacySide = await renderAsync(holMod.surfaces['sidebar.footer.action'], {}, 3)
  check('缺 allDayOff 字段时按 weekend 回落', legacySide.text.includes('周末全谷'),
    JSON.stringify(legacySide.text.replace(/\s+/g, ' ').slice(0, 120)))

  peakPhaseOverride = null
}

console.log('')
if (failures > 0) {
  console.log(`FAILED: ${failures} 项断言未通过`)
  process.exit(1)
}
console.log('OK: 全部断言通过')
// 组件里的 setInterval（如云端同步状态每分钟刷新）会挂住事件循环，显式退出
process.exit(0)
