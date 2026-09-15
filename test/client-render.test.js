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
  byDay: [{ date: '2026-09-15', label: '09/15', peak: 3.2, off: 2.1, flat: 0.51 }],
  byModel: [{ model: 'deepseek-v4.1-flash', calls: 391, tokens: 31382777, cost: 5.81 }],
  byModelDay: [{ model: 'deepseek-v4.1-flash', days: [{ date: '2026-09-15', label: '09/15', calls: 391, tokens: 31382777, input: 100, output: 50, cacheRead: 900, cacheWrite: 0, cost: 5.81 }] }],
  recent: [], devices: [], sources: [],
}
const CLOUD = {
  ok: true, range: '7d', days: 7, asOf: Date.now(),
  realCost: 2.0, realCalls: 100, realTokens: 5000000, subEquivalent: 0, subCalls: 0, subTokens: 0,
  peakCost: 1.0, offCost: 0.8, flatCost: 0.2,
  today: { real: 0.5, calls: 10, tokens: 100000, sub: 0, subCalls: 0, subTokens: 0 },
  month: { real: 1.0, calls: 50, tokens: 2000000, sub: 0, subCalls: 0, subTokens: 0 },
  all: { real: 2.0, calls: 100, tokens: 5000000, sub: 0, subCalls: 0, subTokens: 0 },
  byDay: [{ date: '2026-09-15', label: '09/15', peak: 1.0, off: 0.8, flat: 0.2 }],
  byModel: [{ model: 'deepseek-v4.1-flash', calls: 100, tokens: 5000000, cost: 2.0 }],
  byModelDay: [{ model: 'deepseek-v4.1-flash', days: [{ date: '2026-09-15', label: '09/15', calls: 100, tokens: 5000000, input: 10, output: 5, cacheRead: 90, cacheWrite: 0, cost: 2.0 }] }],
  recent: [], devices: [{ device: 'other-machine', name: '另一台', cost: 2.0, calls: 100 }], sources: [{ source: 'dsh', cost: 2.0, calls: 100 }],
}
const payloadFor = (name, syncView) => {
  if (name === 'sync') return Object.assign({}, SYNC, { view: syncView })
  if (name === 'dashboard') return DASH
  if (name === 'cloud') return CLOUD
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
    fetch: (url) => {
      const name = String(url).split('/').pop()
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payloadFor(name, syncView)) })
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

  const out = { bundleId: captured && captured.id, section: null, card: null, cardMeta: null, injected: [], applyError: '' }
  const slots = {
    entries: () => [],
    inject: (name, cb) => { out.injected.push(name); try { cb() } catch (e) { out.injected.push('!!' + name + ':' + e.message) } return () => {} },
    register: (meta, render) => {
      if (meta && meta.name === 'settings.section') out.section = render
      if (meta && meta.name === 'settings.plugin.item') { out.cardMeta = meta; out.card = render }
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
      state.nodes.push({ name, props: p || {}, path })
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
    state.nodes.push({ name: String(type), props: p || {}, path })
    walk(children, path)
  }
  try { walk(component(props), 'root') } catch (e) { state.errors.push({ comp: 'root', path: '', message: e && e.message }) }
  return state
}
const describeErrors = (errors) => errors.map((e) => `${e.comp}@${e.path}: ${e.message}`).join(' | ')

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
check('无条件 inject settings.plugin.item（插件配置卡片）', mod.injected.includes('settings.plugin.item'), `injected=${JSON.stringify(mod.injected)}`)
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

console.log('[3] 插件配置卡片外壳（li > 可点击 header > 折叠 body）')
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
  }
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

console.log('')
if (failures > 0) {
  console.log(`FAILED: ${failures} 项断言未通过`)
  process.exit(1)
}
console.log('OK: 全部断言通过')
// 组件里的 setInterval（如云端同步状态每分钟刷新）会挂住事件循环，显式退出
process.exit(0)
