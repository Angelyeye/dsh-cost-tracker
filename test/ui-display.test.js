// ============================================================
// dsh-cost-tracker 前端显隐开关（界面显示）契约测试
//   node test/ui-display.test.js
//
// 这组断言拦的是「开关只写进配置、界面却不读」这类假功能，共四层：
//   ① 宿主确实把三个开关接进了 HTTP 面（ui-config 路由 / sync 状态 / peak 快照）；
//   ② 三个开关与峰谷、云端字段**同存一份配置文件**，互不覆盖；
//   ③ 老配置文件（没有 ui* 键）升级后界面不变 —— 全部可见；
//   ④ 客户端三个落点分别在渲染期读对应的开关（胶囊 / 时段条 / 看板）。
//
// 用真实文件而不是替身：这份配置的读写路径（loadConfig / saveConfig / normalize）
// 正是历史上反复出问题的地方（1.8.2 的 timeLabel、1.8.4 的水位短路都属同一类）。
// ============================================================
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

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

// ---------- 沙箱：独立的 DSH_HOME，真实的进程内 HTTP 往返 ----------
const home = mkdtempSync(join(tmpdir(), 'cost-ui-'))
process.env.DSH_HOME = home

const realFetch = globalThis.fetch
let creds = null
globalThis.fetch = async (url) => {
  const u = String(url)
  if (u.includes('.credentials.yaml')) {
    if (!creds) throw new Error('no credentials in sandbox')
    return { ok: true, status: 200, text: async () => creds }
  }
  throw new Error('沙箱内不应发起网络请求: ' + u)
}

const configFile = join(home, 'storages', 'cost-tracker-config.json')
// 预置一份**老版本**配置文件：只有峰谷与云端字段，没有任何 ui* 键
mkdirSync(join(home, 'storages'), { recursive: true })
writeFileSync(configFile, JSON.stringify({
  peakStyle: 'classic',
  peakEnabled: true,
  cloudEnabled: false,
  cloudUrl: 'https://cost.example.com',
  syncIntervalSec: 120,
  deviceName: '测试机',
}), 'utf8')

// ctx.effect 必须**立即执行**回调：插件把 HTTP 路由注册写在
// `ctx.effect(() => ctx.webServer.register(...))` 里（与宿主 cordis 的语义一致），
// 写成惰性 stub 就拿不到 handler。回调返回值只当销毁函数，不执行。
const effectNow = (fn) => { try { fn() } catch (e) { /* 销毁函数不可调用 */ } return () => {} }

const ctx = {
  get: () => undefined,
  inject: () => {},
  effect: effectNow,
  on: () => {},                 // llm/stream 包装钩子（本测试不跑真实 LLM 调用）
  tools: { register: () => {} },
  commands: { register: () => {} },
  settings: undefined,
  logger: undefined,
}
let webHandler = null
// 宿主契约：ctx.webServer.register({ kind:'prefix', path, handler })
ctx.webServer = { register: (route) => { webHandler = route && (route.handler || route); return () => {} } }

/** 直接调用插件注册的 HTTP 处理器，等价于客户端的 fetch('/api/cost-tracker/<name>') */
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

console.log('dsh-cost-tracker 界面显示开关契约测试')
console.log(`  DSH_HOME = ${home}`)
console.log('')

const mod = await import(pathToFileURL(join(root, 'index.js')).href)
mod.default.apply(ctx)

console.log('[1] 宿主 HTTP 面：三个开关可读可写')
{
  check('webServer 已注册处理器', typeof webHandler === 'function')

  // 老配置（无 ui* 键）→ 同步状态里读出全部可见
  const sync0 = await api('sync', {})
  check('sync 状态带出三个界面开关',
    sync0.uiDockEnabled === true && sync0.uiPeakEnabled === true && sync0.uiDashboardEnabled === true,
    JSON.stringify({ d: sync0.uiDockEnabled, p: sync0.uiPeakEnabled, b: sync0.uiDashboardEnabled }))
  check('sync 状态仍保留云端字段（未被界面开关挤掉）',
    sync0.url === 'https://cost.example.com' && sync0.intervalSec === 120 && sync0.deviceName === '测试机',
    JSON.stringify({ url: sync0.url, intervalSec: sync0.intervalSec, deviceName: sync0.deviceName }))

  const peak0 = await api('peak', {})
  check('peak 快照带出 ui 开关（看板门卫的数据源）',
    peak0.ok === true && peak0.ui && peak0.ui.uiDashboardEnabled === true,
    JSON.stringify(peak0.ui))
  check('peak 快照的峰谷语义未受影响', peak0.enabled === true && peak0.style === 'classic', JSON.stringify({ enabled: peak0.enabled, style: peak0.style }))

  // 关掉胶囊与看板，只留时段条
  const saved = await api('ui-config', { uiDockEnabled: false, uiDashboardEnabled: false })
  check('ui-config 返回 ok 与规范化后的三个开关',
    saved.ok === true && saved.uiDockEnabled === false && saved.uiDashboardEnabled === false && saved.uiPeakEnabled === true,
    JSON.stringify(saved))

  const sync1 = await api('sync', {})
  check('改完后 sync 状态立刻反映新值',
    sync1.uiDockEnabled === false && sync1.uiDashboardEnabled === false && sync1.uiPeakEnabled === true,
    JSON.stringify({ d: sync1.uiDockEnabled, p: sync1.uiPeakEnabled, b: sync1.uiDashboardEnabled }))
  const peak1 = await api('peak', {})
  check('改完后 peak 快照立刻反映新值', peak1.ui.uiDockEnabled === false, JSON.stringify(peak1.ui))

  const back = await api('ui-config', { uiDockEnabled: true, uiDashboardEnabled: true })
  check('可以再打开（不是单向开关）',
    back.uiDockEnabled === true && back.uiDashboardEnabled === true && back.uiPeakEnabled === true,
    JSON.stringify(back))
}

console.log('[2] 落盘：三个开关与峰谷 / 云端字段同存一份文件')
{
  const onDisk = JSON.parse(readFileSync(configFile, 'utf8'))
  check('新增了 ui* 键', 'uiDockEnabled' in onDisk && 'uiPeakEnabled' in onDisk && 'uiDashboardEnabled' in onDisk,
    JSON.stringify(Object.keys(onDisk)))
  check('峰谷字段仍在（classic 未被界面开关覆盖）', onDisk.peakStyle === 'classic' && onDisk.peakEnabled === true, JSON.stringify({ style: onDisk.peakStyle, enabled: onDisk.peakEnabled }))
  check('云端字段仍在（地址 / 间隔 / 设备名）',
    onDisk.cloudUrl === 'https://cost.example.com' && onDisk.syncIntervalSec === 120 && onDisk.deviceName === '测试机',
    JSON.stringify({ url: onDisk.cloudUrl, intervalSec: onDisk.syncIntervalSec, deviceName: onDisk.deviceName }))
}

console.log('[3] 重新加载：开关能读回来（跨重启持久）')
{
  // 带 query 重新 import 一份全新实例，模拟 dsh 重启后的新进程
  const fresh = await import(pathToFileURL(join(root, 'index.js')).href + '?fresh=' + Date.now())
  let handler2 = null
  const ctx2 = {
    get: () => undefined, inject: () => {}, effect: effectNow, on: () => {},
    tools: { register: () => {} }, commands: { register: () => {} },
    webServer: { register: (route) => { handler2 = route && (route.handler || route); return () => {} } },
  }
  fresh.default.apply(ctx2)
  await api('ui-config', { uiPeakEnabled: false }, handler2)
  const sync2 = await api('sync', {}, handler2)
  check('新实例读回上次保存的开关（时段条=关，其余=开）',
    sync2.uiPeakEnabled === false && sync2.uiDockEnabled === true && sync2.uiDashboardEnabled === true,
    JSON.stringify({ d: sync2.uiDockEnabled, p: sync2.uiPeakEnabled, b: sync2.uiDashboardEnabled }))
}

console.log('[4] 客户端：三个落点各自读自己的开关')
{
  const client = readFileSync(join(root, 'client.js'), 'utf8')
  check('胶囊按 uiDockEnabled 判定',
    /uiOn\(s\.ui,\s*"uiDockEnabled"\)/.test(client), '未找到 CostDock 的 uiDockEnabled 判定')
  check('时段条按 uiPeakEnabled 判定',
    /uiOn\(snap && snap\.ui,\s*"uiPeakEnabled"\)/.test(client), '未找到 PeakSidebar 的 uiPeakEnabled 判定')
  check('看板按 uiDashboardEnabled 判定（渲染期判定，不是只在注册期）',
    /uiOn\(ui,\s*"uiDashboardEnabled"\)/.test(client), '未找到 DashboardGate 的 uiDashboardEnabled 判定')
  check('看板关闭时不是静默空渲染，而是给出重新打开的路径（指向齿轮）',
    /关闭显示/.test(client) && /齿轮/.test(client), '缺少关闭后的操作提示')
  check('配置面板提供三开关的写入口（ui-config）',
    /apiCall\("ui-config"/.test(client), '配置面板没有调用 ui-config')
  check('保存后广播事件，已挂载的部件立即响应',
    /new CustomEvent\(UI_EVENT\)/.test(client) && /addEventListener\(UI_EVENT/.test(client),
    '缺少 UI_EVENT 广播或监听')
  // 两个配置入口本身都不受这三个开关控制 —— 否则关掉看板后就没有入口再打开。
  // 断言"注册这一步与开关无关"：两处注册块里不得出现任何 ui* 开关判定。
  const regAt = client.indexOf('const pluginItemKey')
  const regBlock = regAt < 0 ? '' : client.slice(regAt, regAt + 320)
  check('插件配置卡片（旧宿主兼容入口）不受界面开关控制（注册时不读开关）',
    /slots\.inject\(pluginItemKey/.test(regBlock) && !/ui(Dock|Peak|Dashboard)Enabled/.test(regBlock),
    regBlock.replace(/\s+/g, ' ').slice(0, 200))
  // v1.9.3：宿主 0.1.7-alpha.2 删除了插件配置插槽，配置入口内迁到「花费统计」分区内的配置页；
  // 该分区的注册同样不得读开关（显隐必须在渲染期判定，交给 DashboardGate）。
  const secAt = client.indexOf('slots.inject("settings.section"')
  const secBlock = secAt < 0 ? '' : client.slice(secAt, secAt + 260)
  check('分区内配置入口不受界面开关控制（注册时不读开关）',
    /slots\.inject\("settings\.section"/.test(secBlock) && !/ui(Dock|Peak|Dashboard)Enabled/.test(secBlock),
    secBlock.replace(/\s+/g, ' ').slice(0, 200))
  check('关闭态下齿轮入口仍在同一渲染层（齿轮与看板内容互斥但同层）',
    /cost-gear/.test(client) && /className: "cost-h1-actions"/.test(client),
    '未找到页头齿轮 / 操作位')
}

console.log('[5] 安装辅助面：注册名与注册方式不受影响')
{
  const client = readFileSync(join(root, 'client.js'), 'utf8')
  check('bundle 注册 id 仍是 scoped 包名', /id:\s*"@angelyeye\/dsh-cost-tracker"/.test(client))
  check('四个插槽仍在 apply 里无条件注册（含旧宿主兼容的插件配置卡片）',
    ['settings.section', 'conversation.composer.dock', 'sidebar.footer.action'].every((s) => client.includes(`slots.inject("${s}"`))
      && /slots\.inject\(pluginItemKey/.test(client),
    '某个落点的插槽注册被条件化了')
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
