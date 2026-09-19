// ============================================================
// dsh-cost-tracker 官方价格同步 单测
//   node test/price-sync.test.js
//
// 覆盖 price-sync.js 的解析器与时代构建：
//   ① 转置价格表解析（模型列顺序 × 三个指标 × 两个时段）；
//   ② 各类页面改版/脏数据必须**抛错**（宁可不更新，也不能把错价写进账本）；
//   ③ 旧模型名路由（脚注「旧模型名 … 仍可调用」）；
//   ④ buildSyncedEra → pricing.setSyncedEras 后按时间戳生效，历史不回改；
//   ⑤ diffAgainstEra 报差异；
//   ⑥ 若本机存在真实抓取页（%TEMP%/ds-pricing.html）则额外跑一遍真实数据。
//
// 全程离线：不发任何网络请求（fetchOfficialPrices 用注入的桩）。
// ============================================================
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripHtmlLines, parsePricingLines, parsePricingHtml, buildSyncedEra, diffAgainstEra, fetchOfficialPrices } from '../price-sync.js'
import { eraAt, priceFor, setSyncedEras, computeCost, isPeak } from '../pricing.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`)
  else {
    failures++
    console.log(`  FAIL  ${name}`)
    if (detail !== undefined) console.log(`        ${detail}`)
  }
}
function throws(name, fn) {
  try { fn(); check(name, false, '未抛错') } catch (e) { check(name, true) }
}

console.log('dsh-cost-tracker 官方价格同步测试')
console.log('')

/**
 * 合成一份与真实页面同结构的定价 HTML（转置表：列=模型，行=指标×时段）。
 * @param {{models:Array<{name:string, input:number, output:number, cacheHit:number}>, oldNames?:string[], inlineLabels?:boolean}} o
 *   models[i] 为第 i 列，价格为**高峰**价（空闲档按官方规则自动写半价）
 */
function syntheticPage(o) {
  const half = (v) => String(v / 2)
  const cols = o.models
  const names = cols.map((c) => '<td>' + c.name + '</td>').join('')
  const oldNote = o.oldNames && o.oldNames.length
    ? `<p>(1) 旧模型名 ${o.oldNames.join('、')} 仍可调用，由 ${cols[0].name} 提供服务并按 Flash 价格计费。</p>`
    : ''
  const row = (label, secondCell, pick) => {
    const cells = cols.map((c) => '<td>' + pick(c) + '元</td>').join('')
    const label2 = o.inlineLabels ? '' : '<td>' + secondCell + '</td>'
    const labelCell = o.inlineLabels ? '<td>' + label + secondCell + '</td>' : '<td>' + label + '</td>' + label2
    return '<tr>' + labelCell + '</tr>'
  }
  const priceRow = (label, secondCell, pick) => {
    const cells = cols.map((c) => '<td>' + pick(c) + '元</td>').join('')
    const labelCell = o.inlineLabels ? '<td>' + label + secondCell + '</td>' : '<td>' + label + '</td><td>' + secondCell + '</td>'
    const head = o.inlineLabels ? '<tr>' + labelCell + '</tr>' : '<tr>' + labelCell + '</tr>'
    return head.replace('</tr>', '') + '</tr>'
  }
  const metric = (label, secondCell, key, inline) => {
    const head = (inline || o.inlineLabels)
      ? '<tr><td>' + label + secondCell + '</td></tr>'
      : '<tr><td>' + label + '</td><td>' + secondCell + '</td></tr>'
    const off = '<tr><td>空闲时段</td>' + cols.map((c) => '<td>' + half(c[key]) + '元</td>').join('') + '</tr>'
    const peak = '<tr><td>高峰时段</td>' + cols.map((c) => '<td>' + c[key] + '元</td>').join('') + '</tr>'
    return head + off + peak
  }
  return `<!doctype html><html><head><style>.x{color:red}</style><script>var a=1</script></head><body>
<h1>模型 &amp; 价格 | DeepSeek API Docs</h1>
<h2>模型细节</h2>
<table>
<tr><td>模型</td>${names}</tr>
<tr><td>BASE URL (OpenAI 格式)</td>${cols.map(() => '<td>https://api.deepseek.com</td>').join('')}</tr>
</table>
<h2>价格</h2>(2)
<table>
${metric('百万tokens输入', '（缓存命中）', 'cacheHit')}
${metric('百万tokens输入', '（缓存未命中）', 'input')}
${metric('百万tokens输出', '', 'output', true)}
</table>
<h2>并发限制</h2>(3)
<table><tr>${cols.map(() => '<td>2500</td>').join('')}</tr></table>
<p>(2) 空闲时段价格为高峰时段价格的一半。北京时间周一至周五（不含中国法定节假日）9:00 - 12:00、14:00 - 18:00 为高峰时段；其余时段，包含周末，为优惠时段。</p>
${oldNote}
</body></html>`
}

const FLASH = { name: 'deepseek-flash', input: 2, output: 8, cacheHit: 0.04 }
const PRO = { name: 'deepseek-v4-pro', input: 9, output: 27, cacheHit: 0.3 }
const page2 = (extra) => syntheticPage(Object.assign({ models: [FLASH, PRO] }, extra || {}))
const GOOD = page2({ oldNames: ['deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'] })

// ---------- 1. 解析 ----------
console.log('[1] 转置价格表解析')
{
  const lines = stripHtmlLines(GOOD)
  check('HTML 标签被剥离', lines.every((l) => l.indexOf('<') < 0))
  check('实体还原（&amp; → &）', lines.some((l) => l.indexOf('模型 & 价格') >= 0))
  const p = parsePricingLines(lines)
  check('模型列顺序按表头', p.order.join(',') === 'deepseek-flash,deepseek-v4-pro', p.order.join(','))
  check('flash 高峰价正确', JSON.stringify(p.models['deepseek-flash'].peak) === JSON.stringify({ input: 2, output: 8, cacheRead: 0.04 }), JSON.stringify(p.models['deepseek-flash'].peak))
  check('pro 高峰价正确', JSON.stringify(p.models['deepseek-v4-pro'].peak) === JSON.stringify({ input: 9, output: 27, cacheRead: 0.3 }), JSON.stringify(p.models['deepseek-v4-pro'].peak))
  check('空闲价正确（半价）', p.models['deepseek-v4-pro'].offpeak.output === 13.5, String(p.models['deepseek-v4-pro'].offpeak.output))
  check('币种为人民币', p.currency === 'CNY')
  check('脚注解析出旧名路由', p.routes['deepseek-v4-flash'] === 'deepseek-flash' && p.routes['deepseek-v4-flash-vision-exp'] === 'deepseek-flash', JSON.stringify(p.routes))
  check('峰段文案被捕获', /9:00 - 12:00/.test(p.peakWindowsLabel), p.peakWindowsLabel.slice(0, 60))
}

// 脚注分行（真实页面排版）
console.log('[1a] 脚注分行排版')
{
  const split = GOOD.replace(/<p>\(1\) 旧模型名 [^<]*<\/p>/, '<p>(1) 旧模型名<br/>deepseek-v4-flash<br/>、<br/>deepseek-v4-flash-vision-exp<br/>仍可调用，由 deepseek-flash 提供服务并按 Flash 价格计费。</p>')
  const p = parsePricingHtml(split)
  check('分行脚注同样解析出路由', p.routes['deepseek-v4-flash'] === 'deepseek-flash' && p.routes['deepseek-v4-flash-vision-exp'] === 'deepseek-flash', JSON.stringify(p.routes))
}

// 同行连写的标签（页面另一种排版）也要能解析
console.log('[1b] 标签同行连写的排版')
{
  const p = parsePricingHtml(page2({ inlineLabels: true }))
  check('同行标签同样解析正确', p.models['deepseek-flash'].peak.cacheRead === 0.04 && p.models['deepseek-flash'].peak.input === 2, JSON.stringify(p.models['deepseek-flash'].peak))
}

// ---------- 2. 脏数据必须拒绝 ----------
console.log('[2] 页面改版/脏数据 → 抛错（绝不写错价）')
{
  throws('非中文定价页 → 抛错', () => parsePricingHtml('<html><body><h1>Some other page</h1></body></html>'))
  throws('缺「模型」表头 → 抛错', () => parsePricingHtml(GOOD.replace(/<td>模型<\/td>/, '<td>MODELX</td>')))
  throws('价格值少一个（列数不齐） → 抛错', () => parsePricingHtml(GOOD.replace(/<td>27元<\/td>/, '')))
  throws('空闲价不等于高峰半价 → 抛错', () => parsePricingHtml(GOOD.replace(/<td>13.5元<\/td>/, '<td>20元</td>')))
  throws('价格为 0 → 抛错', () => parsePricingHtml(GOOD.replace(/<td>9元<\/td>/, '<td>0元</td>')))
  throws('单位不是元 → 抛错', () => parsePricingHtml(GOOD.replace(/<td>8元<\/td>/, '<td>8美元</td>')))
  // 三列模型也要正确取齐
  const TINY = { name: 'deepseek-v4-tiny', input: 1, output: 4, cacheHit: 0.02 }
  const p3 = parsePricingHtml(syntheticPage({ models: [FLASH, PRO, TINY] }))
  check('模型列数变化也能对齐', p3.order.length === 3 && p3.models['deepseek-v4-tiny'].peak.input === 1 && p3.models['deepseek-v4-tiny'].peak.output === 4, JSON.stringify(p3.order))
  check('三列时 flash/pro 值不受影响', p3.models['deepseek-flash'].peak.output === 8 && p3.models['deepseek-v4-pro'].peak.input === 9)
}

// ---------- 3. 时代构建与生效 ----------
console.log('[3] buildSyncedEra → 生效与历史隔离')
{
  const parsed = parsePricingHtml(syntheticPage({
    models: [
      { name: 'deepseek-flash', input: 1.5, output: 6, cacheHit: 0.03 },
      { name: 'deepseek-v4-pro', input: 7, output: 21, cacheHit: 0.2 },
    ],
    oldNames: ['deepseek-v4-flash'],
  }))
  const since = Date.UTC(2026, 8, 19, 4, 0, 0)
  const era = buildSyncedEra(parsed, since, 'sync-test-1')
  check('时代带 id/since/models/routes', era.id === 'sync-test-1' && era.since === since && !!era.models['deepseek-flash'] && era.routes['deepseek-v4-flash'] === 'deepseek-flash', JSON.stringify(Object.keys(era)))
  check('cacheWrite 补齐为 cacheRead 同价', era.models['deepseek-flash'].cacheWrite === 0.03)

  const before = JSON.stringify(priceFor('deepseek', 'deepseek-flash', since - 86400000))
  setSyncedEras([era])
  const after = priceFor('deepseek', 'deepseek-flash', since + 3600000)
  check('生效后命中同步价', after.source === 'synced' && after.rates.input === 1.5, JSON.stringify({ s: after.source, r: after.rates.input }))
  check('时代前的时间戳仍走内置价（历史不回改）', JSON.stringify(priceFor('deepseek', 'deepseek-flash', since - 86400000)) === before)
  check('eraAt 在同步时刻后返回同步时代', eraAt(since + 1).id === 'sync-test-1', eraAt(since + 1).id)

  // 同步价下的实际计费（峰谷）
  const peak = isPeak(Date.UTC(2026, 8, 21, 2, 0, 0)) // 北京 10:00 周一
  const t = { input: 1000000, output: 1000000, cacheRead: 0, cacheWrite: 0, reasoning: 0 }
  const cost = computeCost(after.rates, after.tiered, peak, t)
  check('同步价计费 = 输入+输出（高峰）', Math.abs(cost - (1.5 + 6)) < 1e-9, String(cost))

  // 路由：旧名 → flash
  const routed = priceFor('deepseek', 'deepseek-v4-flash', since + 1000)
  check('同步时代的旧名路由生效', routed.model === 'deepseek-flash' && routed.rates.input === 1.5, JSON.stringify({ m: routed.model, i: routed.rates.input }))

  // 非法时代被丢弃（不阻断启动）
  setSyncedEras([null, { id: 'bad' }, era])
  check('非法时代条目被过滤', eraAt(since + 1).id === 'sync-test-1')
  setSyncedEras([])
}

// ---------- 4. 差异比对 ----------
console.log('[4] diffAgainstEra')
{
  const parsed = parsePricingHtml(page2())
  const same = diffAgainstEra(parsed, { models: { 'deepseek-flash': { input: 2, output: 8, cacheRead: 0.04 }, 'deepseek-v4-pro': { input: 9, output: 27, cacheRead: 0.3 } } })
  check('完全一致 → null', same === null, String(same))
  const changed = diffAgainstEra(parsed, { models: { 'deepseek-flash': { input: 2, output: 8, cacheRead: 0.04 } } })
  check('新增模型被报出', typeof changed === 'string' && /deepseek-v4-pro（新）/.test(changed), String(changed))
  const priceChanged = diffAgainstEra(parsed, { models: { 'deepseek-flash': { input: 3, output: 8, cacheRead: 0.04 }, 'deepseek-v4-pro': { input: 9, output: 27, cacheRead: 0.3 } } })
  check('改价被报出', /deepseek-flash\.input: 3 → 2/.test(priceChanged), String(priceChanged))
}

// ---------- 5. 抓取入口（打桩 fetch） ----------
console.log('[5] fetchOfficialPrices（打桩，不发真实请求）')
{
  const html = page2()
  const calls = []
  const fetchFn = async (url, init) => {
    calls.push({ url, init })
    return { status: 200, headers: { get: () => null }, text: async () => html }
  }
  const r = await fetchOfficialPrices('https://api-docs.deepseek.com/zh-cn/quick_start/pricing', fetchFn)
  check('返回解析结果与原文', r.parsed.order.length === 2 && typeof r.html === 'string' && r.fetchedAt > 0)
  check('强制 redirect=manual', calls[0].init.redirect === 'manual', String(calls[0].init.redirect))

  const bad = async () => ({ status: 302, headers: { get: () => 'https://evil.example.com/' }, text: async () => '' })
  let err = ''
  try { await fetchOfficialPrices('https://api-docs.deepseek.com/x', bad) } catch (e) { err = String(e.message) }
  check('非 200 → 抛错', /HTTP 302/.test(err), err)
}

// ---------- 6. 真实页面（若本机留存） ----------
console.log('[6] 真实抓取页（本机留存时）')
{
  const fixture = join(tmpdir(), 'ds-pricing.html')
  if (!existsSync(fixture)) {
    console.log('  SKIP  未找到 ' + fixture + '（并非失败）')
  } else {
    const p = parsePricingHtml(readFileSync(fixture, 'utf8'))
    check('真实页解析出模型列', p.order.length >= 1, JSON.stringify(p.order))
    check('真实页现役 Flash 价 = 2/8/0.04', p.models['deepseek-flash'] && p.models['deepseek-flash'].peak.input === 2 && p.models['deepseek-flash'].peak.output === 8 && p.models['deepseek-flash'].peak.cacheRead === 0.04, JSON.stringify(p.models['deepseek-flash']))
    check('真实页给出旧名路由', Object.keys(p.routes).length >= 1, JSON.stringify(p.routes))
    const diff = diffAgainstEra(p, eraAt(Date.now()))
    console.log('  INFO  与当前生效时代的差异：' + (diff || '无'))
  }
}

console.log('')
if (failures) { console.log('FAILED: ' + failures + ' 项断言未通过'); process.exit(1) }
console.log('全部通过')
