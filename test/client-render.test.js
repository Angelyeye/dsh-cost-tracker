// ============================================================
// client.js 渲染冒烟测试（零依赖，直接 node 运行）
//
// 背景：1.8.0 的「花费统计」页在所有人机器上都是白屏。根因是渲染期
// ReferenceError —— Dashboard 把 sync 作为 prop 传给 PeakPanel，但 PeakPanel
// 内部又用了一个裸 `sync`（未从 props 解构），React 渲染时直接抛出，
// 整块面板被卸载成空白。这类错误 ESLint 之外没人拦得住：`node --check`
// 只查语法，注册名测试只查 bundle id，于是它一路发到了 npm。
//
// 本测试用一个极小的 React 替身把 client.js 真实跑起来：
//   - createElement 只建树；函数组件会被**真正调用**（渲染期代码全部执行）
//   - useState 取默认值、useRef 给 {current}、useEffect 跳过（等价 SSR）
// 然后断言：apply 完整、settings.section 注册成功、渲染无异常且关键文案在位。
// 只要渲染期出现任何未定义变量/属性访问错误，这里就会红。
//
// 运行：node test/client-render.test.js
// ============================================================
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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

// ---------- 在沙箱里加载 bundle，拿到 factory ----------
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
  fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({}) }),
  console, setTimeout, clearTimeout, setInterval, clearInterval,
}
sandbox.globalThis = sandbox
runInContext(source, createContext(sandbox), { filename: 'client.js' })

/** 极简 React 替身：useState 按组件持久化，从而能模拟「点击后二次渲染」 */
const hookSlots = new Map() // 组件函数 -> 状态数组
let currentSlots = null
let hookIndex = 0
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
let pendingEffects = []
const reqShim = (spec) => {
  if (spec === 'react') return React
  throw new Error('未预期的模块: ' + spec)
}

console.log('[1] bundle 加载与 apply')
check('模块以 scoped 包名注册', captured !== null && captured.id === '@angelyeye/dsh-cost-tracker', `id=${captured && captured.id}`)

let sectionRender = null
let registeredCard = null
let cardRender = null
const injected = []
const slots = {
  entries: () => [],
  inject: (name, cb) => { injected.push(name); try { cb() } catch (e) { injected.push('!!' + name + ':' + e.message) } return () => {} },
  register: (meta, render) => {
    if (meta && meta.name === 'settings.section') sectionRender = render
    if (meta && meta.name === 'settings.plugin.item') { registeredCard = meta; cardRender = render }
    return () => {}
  },
}
const ctx = { get: (n) => (n === 'slots' ? slots : undefined), effect: () => () => {} }

const mod = captured ? captured.factory(reqShim) : null
let applyError = ''
try { mod.apply(ctx) } catch (e) { applyError = String(e && e.message ? e.message : e) }
check('apply() 不抛错', applyError === '', applyError)
check('无条件 inject settings.plugin.item（插件配置卡片）', injected.includes('settings.plugin.item'), `injected=${JSON.stringify(injected)}`)
check('卡片条目键 = cost-tracker', !!registeredCard && registeredCard.key === 'cost-tracker', JSON.stringify(registeredCard))
check('注册了 settings.section（左侧「花费统计」入口）', typeof sectionRender === 'function')

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
 * 带副作用的一轮挂载：渲染 → 执行 useEffect（触发 apiCall）→ 等微任务落地 → 再渲染一次。
 * 等价于 React 的「挂载 → effect 拉数据 → setState → 重渲染」，用于验证拉到状态后的表单渲染。
 */
async function renderAsync(component, props) {
  pendingEffects = []
  const first = render(component, props)
  for (const fn of pendingEffects.splice(0)) {
    try { fn() } catch (e) { first.errors.push({ comp: 'useEffect', path: '', message: e && e.message }) }
  }
  for (let i = 0; i < 5; i++) await new Promise((resolve) => setImmediate(resolve))
  const second = render(component, props)
  second.errors.push(...first.errors)
  return second
}

console.log('[2] 渲染「花费统计」页（默认空数据态）')
hookSlots.clear()
const dash = typeof sectionRender === 'function' ? render(sectionRender, {}) : { text: '', nodes: [], errors: [] }
check('渲染期无异常（组件内未定义变量/属性访问）', dash.errors.length === 0, describeErrors(dash.errors))
check('渲染出页面标题「花费统计」', dash.text.includes('花费统计'), `文本=${JSON.stringify(dash.text.trim().slice(0, 80))}`)
check('渲染出时间范围切换', dash.text.includes('近 7 天') || dash.text.includes('近7天'))
check('渲染出三态视图入口文案', dash.text.includes('仅显示本机数据') || dash.text.includes('本机'), JSON.stringify(dash.text.trim().slice(0, 120)))

console.log('[3] 插件配置卡片外壳（与宿主卡片同款：li > 可点击 header > 折叠 body）')
if (typeof cardRender !== 'function') {
  check('卡片渲染函数已注册', false, 'settings.plugin.item 未注册渲染函数')
} else {
  hookSlots.clear()
  const first = render(cardRender, {})
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

  // 模拟点击 header：状态持久化 → 二次渲染应展开出配置表单
  if (headNode && typeof headNode.props.onClick === 'function') {
    headNode.props.onClick()
    const second = await renderAsync(cardRender, {})
    check('点击 header 后展开出 body', second.nodes.some((n) => String(n.props.className || '').includes('cost-pcard-body')), describeErrors(second.errors))
    check('展开后渲染期无异常', second.errors.length === 0, describeErrors(second.errors))
    check('展开后出现「服务地址」字段', second.text.includes('服务地址'), JSON.stringify(second.text.trim().slice(0, 100)))
  }
}

console.log('')
if (failures > 0) {
  console.log(`FAILED: ${failures} 项断言未通过`)
  process.exit(1)
}
console.log('OK: 全部断言通过')
