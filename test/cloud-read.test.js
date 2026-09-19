// ============================================================
// 云端只读路径契约护栏（零依赖，直接 node 运行）
//
// 背景：插件的云端聚合读取（「仅云端 / 本机+云端」）走 /api/v1/overview|matrix|devices
// （概览路由在云端支持时优先用 /api/v1/plugin-view，见下），用**设备令牌**鉴权。
// 而 /api/admin/* 只认管理员会话 cookie —— 采集端手里只有设备令牌，走那条必然 401，
// 这正是 1.8.0~1.8.2 里那两种视图拿不到数据的根因。
//
// fetchCloud / listCloudDevices 定义在 index.js 的 apply() 内部（依赖宿主 ctx），
// 无法直接单测，所以这里对源码做契约断言：一旦有人把读取路径改回 /api/admin，
// 或者把 404（云端版本过旧）的提示去掉，本测试立刻报红。
//
// 运行：node test/cloud-read.test.js
// ============================================================
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const index = readFileSync(join(root, 'index.js'), 'utf8')

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

console.log('[1] 云端只读接口路径')
check('聚合读取使用设备令牌可读的 /api/v1/<endpoint>',
  /cloudConfig\.cloudUrl\s*\+\s*'\/api\/v1\/'\s*\+\s*(query\.route|endpoint)/.test(index),
  "应为 cloudConfig.cloudUrl + '/api/v1/' + <endpoint>")
check('概览在云端支持时优先用 /api/v1/plugin-view（图表/分模型数据来源）',
  /endpoint\s*=\s*'plugin-view'/.test(index) && /devicePluginView/.test(index),
  'plugin-view 一次返回卡片 + byDay/byModel/byModelDay/recent；旧云端回退 overview')
check('带 union 的并集口径仍走 overview（卡片保持全网口径）',
  /query\.route === 'overview' && !unionParts/.test(index))
check('设备维度清单同样走 /api/v1/devices',
  /cloudConfig\.cloudUrl\s*\+\s*'\/api\/v1\/devices'/.test(index))
check('不再用设备令牌去读管理接口 /api/admin',
  !/cloudConfig\.cloudUrl\s*\+\s*'\/api\/admin\//.test(index),
  '管理接口只认管理员会话 cookie，设备令牌读它必然 401')
// ---- 「Token 用量统计」热力图的云端按天明细（v1.8.12） ----
// 热力图此前恒为本机（数据源是宿主的 usage → buildUsageHeat，纯本地），
// 于是「本机+云端」下热力图说 98M、上方卡片说 955M，屏内自相矛盾。
check('热力图云端明细走 plugin-view（只有它有 byDay 的 token 类型拆分）',
  /query\.route === 'usage'/.test(index) && /endpoint = 'plugin-view'/.test(index))
check('热力图固定 range=all（全时段累计口径，与页面区间选择无关）',
  /qs\.set\('range', 'all'\)/.test(index) && /qs\.delete\('days'\)/.test(index))
check('union 并集对 overview（卡片）与 usage（热力图）同时生效',
  /unionParts && \(query\.route === 'overview' \|\| query\.route === 'usage'\)/.test(index))
check('云端按天数据归一成热力图形状且 tokens 按本地口径重算',
  /function cloudUsageHeat/.test(index) && /input \+ output \+ cacheRead \+ cacheWrite/.test(index))
check('cost_stats 兼容 overview.summary 与 plugin-view 顶层两种形状',
  /const s = \(c && c\.summary\) \? c\.summary : \(c \|\| \{\}\)/.test(index),
  '1.8.11 只读 c.summary，云端返回 plugin-view 时必然抛 realCost 取值异常')

console.log('[2] 云端版本过旧的提示')
check('404 时给出可操作的升级提示', /云端版本过旧/.test(index) && /CLOUD_TOO_OLD/.test(index))
check('错误对象仍保留 ok:false 契约', /const out = \{ ok: false, error:/.test(index))

console.log('[3] 上报与读取互不影响')
check('上报仍走 /api/v1/ingest/records', /\/api\/v1\/ingest\/records/.test(readFileSync(join(root, 'sync.js'), 'utf8')))

console.log('')
if (failures > 0) {
  console.log(`FAILED: ${failures} 项断言未通过`)
  process.exit(1)
}
console.log('OK: 全部断言通过')
