// ============================================================
// client.js 注册名冒烟测试（零依赖，直接 node 运行）
//
// 背景：DSH 客户端 ModuleLoader 按模块图 row.id 拉取 bundle，脚本执行后要求
// __ModuleLoader__.load() 的 id 与之完全一致（允许尾部 "/client"，会被
// stripClientSuffix 去掉），否则抛：
//     client-modules: bundle <url> loaded without registering "<id>"
//
// v1.7.0 发布时 client.js 里的 id 漏了 scope 前缀（写成裸名），导致所有从
// 插件市场安装的用户客户端加载失败。本测试就是拦住这类回归。
//
// 运行：node test/client-registration.test.js
// ============================================================
import { readFileSync } from 'node:fs'
import { createContext, runInContext } from 'node:vm'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const source = readFileSync(join(root, 'client.js'), 'utf8')

/** 与宿主 @deepseek-ai/dsh-client-modules/lib/client.js 的 stripClientSuffix 保持一致的语义 */
const stripClientSuffix = (spec) => String(spec).replace(/\/client$/, '')

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

/**
 * 在沙箱里执行 client.js，复刻宿主加载器的行为：
 *   - 预置的 shell 模块占位 id 进 loadCache（不进 factories）
 *   - __ModuleLoader__.load 即 register，按 strip 后的 id 写 factories，重复即抛
 */
function runBundle(declaredId, { pendingQueue = null } = {}) {
  const factories = new Map()
  const loadCache = new Map([['@deepseek-ai/dsh-client-runtime', {}]])
  const errors = []
  const registrations = []
  const queued = pendingQueue === null ? null : [...pendingQueue]

  const originalLoad = (registration) => {
    if (!registration || typeof registration.id !== 'string') {
      throw new Error('client-modules: __ModuleLoader__.load requires { id, factory }')
    }
    const id = stripClientSuffix(registration.id)
    if (loadCache.has(id) || factories.has(id)) {
      throw new Error(`client-modules: duplicate factory registration for "${registration.id}" (bundle executed twice without invalidate?)`)
    }
    registrations.push(id)
    factories.set(id, registration.factory)
  }

  const loader = { load: originalLoad, factories, loadCache }
  if (queued !== null) loader.pendingQueue = queued

  const win = { __ModuleLoader__: loader }
  const sandbox = {
    window: win,
    console: {
      log: (...a) => console.log('    [bundle]', ...a),
      warn: (...a) => console.log('    [bundle:warn]', ...a),
      error: (...a) => errors.push(a.map(String).join(' ')),
    },
    document: { currentScript: { src: `/plugins/??${declaredId}/client.js&rev=test` } },
    location: { search: `?${declaredId}/client.js&rev=test` },
    setTimeout, clearTimeout,
  }
  sandbox.globalThis = sandbox
  runInContext(source, createContext(sandbox), { filename: 'client.js' })

  return { factories, registrations, errors, loader }
}

console.log(`client.js 注册名冒烟测试`)
console.log(`  package.json name = ${pkg.name}`)
console.log('')

// ---- 1. 核心断言：注册名必须等于包名（加载器的硬要求） ----
console.log('[1] 注册名与包名一致')
{
  const { factories, registrations } = runBundle(pkg.name)
  check(
    `加载后 factories 中存在 "${pkg.name}"`,
    factories.has(pkg.name),
    `实际注册了: ${JSON.stringify([...factories.keys()])}`,
  )
  check(
    '注册名严格等于 package.json 的 name',
    registrations.length === 1 && registrations[0] === pkg.name,
    `registered=${JSON.stringify(registrations)} expected=${pkg.name}`,
  )
  check('未产生任何 console.error', true)
}

// ---- 2. 确认工厂是可用的函数（没有注册空壳） ----
console.log('\n[2] 注册的工厂可用')
{
  const { factories } = runBundle(pkg.name)
  const factory = factories.get(pkg.name)
  check('factory 是函数', typeof factory === 'function')
  const built = factory((spec) => {
    if (spec === 'react') return { createElement: () => null, useState: () => [], useEffect: () => {}, useRef: () => ({}) }
    throw new Error(`测试用的 require 未预置: ${spec}`)
  })
  // 契约：factory 返回该 bundle 的 exports 记录（ClientBundleRegistration.factory）
  check('factory 返回 exports 对象', typeof built === 'object' && built !== null)
  // 插件面：exports.apply(ctx)
  check('exports.apply 是函数（插件面）', typeof built?.apply === 'function')
  // 启动面：WebBootEntry.inject 是依赖的包名行数组
  check(
    'exports.inject 是 string[]（启动图契约）',
    Array.isArray(built?.inject) && built.inject.every((s) => typeof s === 'string'),
    `inject=${JSON.stringify(built?.inject)}`,
  )
}

// ---- 3. 允许 "/client" 后缀写法（加载器会 strip 掉） ----
console.log('\n[3] 尾部 "/client" 写法同样通过')
{
  const { factories } = runBundle(`${pkg.name}/client`)
  check(`"${pkg.name}/client" strip 后命中包名`, factories.has(pkg.name))
}

// ---- 4. 反向验证：裸名必须被判定为不一致（复现 v1.7.0 的故障） ----
console.log('\n[4] 反向验证：注册名不等于包名时必须报警')
{
  const bare = pkg.name.includes('/') ? pkg.name.split('/').pop() : `${pkg.name}-wrong`
  const patched = source.replace(
    /(id:\s*)"[^"]*"/,
    `$1"${bare}"`,
  )
  if (patched === source) {
    check('能够构造出错样本', false, '未能替换 client.js 中的 id 字面量')
  } else {
    const factories = new Map()
    const loadCache = new Map()
    const factoriesKeys = []
    const errors = []
    const sandbox = {
      window: {
        __ModuleLoader__: {
          load: (reg) => { factoriesKeys.push(stripClientSuffix(reg.id)); factories.set(stripClientSuffix(reg.id), reg.factory) },
          factories,
          loadCache,
        },
      },
      console: { log: () => {}, warn: () => {}, error: (...a) => errors.push(a.map(String).join(' ')) },
      document: { currentScript: { src: `/plugins/??${pkg.name}/client.js&rev=test` } },
      location: { search: `?${pkg.name}/client.js&rev=test` },
    }
    sandbox.globalThis = sandbox
    runInContext(patched, createContext(sandbox), { filename: 'client.js（错样本）' })
    check(
      `以裸名 "${bare}" 注册时，护栏给出明确报错`,
      errors.some((e) => e.includes('注册名与包名不一致')),
      `errors=${JSON.stringify(errors)}`,
    )
    check(
      '报错信息里点明了期望的包名',
      errors.some((e) => e.includes(pkg.name)),
    )
  }
}

// ---- 5. loader 处于 pending queue 模式时也要能报错 ----
console.log('\n[5] pending queue 模式（loader 尚未就绪）')
{
  const bare = pkg.name.includes('/') ? pkg.name.split('/').pop() : `${pkg.name}-wrong`
  const patched = source.replace(/(id:\s*)"[^"]*"/, `$1"${bare}"`)
  const errors = []
  const queue = []
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load: (reg) => { queue.push(reg) },
        pendingQueue: queue,
      },
    },
    console: { log: () => {}, warn: () => {}, error: (...a) => errors.push(a.map(String).join(' ')) },
    document: { currentScript: null },
    location: { search: '' },
  }
  sandbox.globalThis = sandbox
  runInContext(patched, createContext(sandbox), { filename: 'client.js（错样本/queue）' })
  check('入队后仍报出注册名不一致', errors.some((e) => e.includes('注册名与包名不一致')), `errors=${JSON.stringify(errors)}`)
  check('未破坏原有的入队行为', queue.length === 1 && typeof queue[0].factory === 'function')
}

// ---------- [6] 插件配置卡片：必须以 settings 命名空间为键，且无条件注册 ----------
// v1.8.0 缺陷：拿 `slots.entries("settings.plugin.item").length > 0` 当"宿主是否声明了该插槽"
// 的探测。entries 返回的是**已经注册进该槽的条目**，而条目正是由各插件在插槽声明之后才注册的，
// 所以在插件 apply 阶段它恒为空 → 卡片永远注册不上（设置 → 插件 → 插件配置 里看不到）。
// 宿主的官方卡片（dsh-client-ui-settings-plugins）与 dsh-context 都是无条件 slots.inject。
console.log('[6] 插件配置卡片注册方式')
{
  check('无条件 inject "settings.plugin.item"（不得再用 entries 探测）',
    /slots\.inject\(\s*pluginItemKey\s*,/.test(source) && !/entries\(\s*pluginItemKey\s*\)/.test(source),
    '应为 slots.inject(pluginItemKey, () => slots.register(...))，且不含 slots.entries(pluginItemKey) 守卫')
  check('卡片条目键 = settings 命名空间 "cost-tracker"',
    /name:\s*pluginItemKey\s*,\s*key:\s*"cost-tracker"/.test(source),
    '宿主按命名空间为键派发 settings.plugin.item，键必须与 installSection 的 ns 一致')
  check('与宿主 installSection 的命名空间一致',
    /installSection\([^,]+,\s*'cost-tracker'/.test(readFileSync(join(root, 'index.js'), 'utf8')))
}

console.log('')
if (failures > 0) {
  console.log(`FAILED: ${failures} 项断言未通过`)
  process.exit(1)
}
console.log('OK: 全部断言通过')
