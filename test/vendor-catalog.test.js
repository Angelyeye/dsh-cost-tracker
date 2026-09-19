// ============================================================
// dsh-cost-tracker 多厂商价格目录 单测
//   node test/vendor-catalog.test.js
//
// 覆盖：目录数据可解析、provider 别名归一、exact/fuzzy 两种匹配、
// 跨厂商同名（唯一才命中）、USD→CNY 折算、指纹稳定、以及**目录优先级**
// 在 pricing.priceFor 里确实生效（catalog 注入 → source='catalog'、
// estimated=false；不注入时行为与 v1.8.x 完全一致）。
// ============================================================
import { catalogEntryFor, catalogProviders, catalogFingerprint, catalogProviderKey, catalogModelsFor, normalizeModelName, PROVIDER_ALIASES, CATALOG_FX_DEFAULT } from '../vendor-catalog.js'
import { priceFor, setPriceOverrides, setSyncedEras } from '../pricing.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`)
  else {
    failures++
    console.log(`  FAIL  ${name}`)
    if (detail !== undefined) console.log(`        ${detail}`)
  }
}

console.log('dsh-cost-tracker 多厂商价格目录测试')
console.log('')

// ---------- 1. 数据 ----------
console.log('[1] 目录数据')
{
  const providers = catalogProviders()
  const ids = providers.map((p) => p.id)
  check('目录含多个厂商（≥10）', providers.length >= 10, JSON.stringify(ids))
  check('openai / anthropic / google 在列', ['openai', 'anthropic', 'google'].every((x) => ids.indexOf(x) >= 0), JSON.stringify(ids))
  const total = providers.reduce((a, p) => a + p.count, 0)
  check('条目总数 ≥80', total >= 80, String(total))
  const fp = catalogFingerprint()
  check('指纹形如 sha256:16hex', /^sha256:[0-9a-f]{16}$/.test(fp), fp)
  check('指纹可重复（同数据同值）', catalogFingerprint() === fp)
  check('缺数据时不炸（未知 provider 返回空）', catalogModelsFor('nonexistent-provider-xyz').length === 0)
}

// ---------- 2. provider 别名 ----------
console.log('[2] provider 别名归一')
{
  check('openai ← gpt', catalogProviderKey('gpt') === 'openai', catalogProviderKey('gpt'))
  check('anthropic ← claude', catalogProviderKey('claude') === 'anthropic', catalogProviderKey('claude'))
  check('google ← gemini', catalogProviderKey('gemini') === 'google', catalogProviderKey('gemini'))
  check('moonshot ← kimi', catalogProviderKey('kimi') === 'moonshot', catalogProviderKey('kimi'))
  check('z-ai ← zhipu / glm / bigmodel', ['zhipu', 'glm', 'bigmodel'].every((x) => catalogProviderKey(x) === 'z-ai'))
  check('alibaba ← qwen / dashscope', catalogProviderKey('qwen') === 'alibaba' && catalogProviderKey('dashscope') === 'alibaba')
  check('带 -official 后缀也算（大小写不敏感）', catalogProviderKey('OpenAI') === 'openai', catalogProviderKey('OpenAI'))
  check('未登记的 provider → 空', catalogProviderKey('my-private-gateway') === '', catalogProviderKey('my-private-gateway'))
  check('别名表里的键都已归一（无大写/短横线）', Object.keys(PROVIDER_ALIASES).every((k) => k === k.toLowerCase().replace(/[^a-z0-9-]/g, '')))
}

// ---------- 3. 匹配模式 ----------
console.log('[3] 匹配：exact / fuzzy / 跨厂商 / 汇率')
{
  const m = catalogModelsFor('google')
  check('google 目录里有模型可测', m.length > 0, JSON.stringify(m))
  const bare = m[0]

  // exact：只有归一化全等才命中
  const e1 = catalogEntryFor('google', bare.toUpperCase().replace(/[^a-z0-9]/gi, '-'), { mode: 'exact' })
  check('exact 命中（大小写/分隔符归一）', !!e1 && e1.via === 'exact', JSON.stringify(e1 && e1.via))
  const e2 = catalogEntryFor('google', bare + '-2026-01-01', { mode: 'exact' })
  check('exact 不命中带后缀的变体', e2 === null, JSON.stringify(e2))
  const e3 = catalogEntryFor('google', bare + '-2026-01-01', { mode: 'fuzzy' })
  check('fuzzy 命中带后缀的变体', !!e3 && e3.via === 'fuzzy', JSON.stringify(e3 && e3.via))

  // USD → CNY 折算
  const cnyFee = catalogEntryFor('google', bare, { fx: 7.2 })
  const usdFee = catalogEntryFor('google', bare, { fx: 1 })
  check('汇率生效（7.2 倍）', Math.abs(cnyFee.rates.input - usdFee.rates.input * 7.2) < 1e-9, cnyFee.rates.input + ' vs ' + usdFee.rates.input)
  check('缓存写入价 = 缓存命中价（目录口径）', cnyFee.rates.cacheWrite === cnyFee.rates.cacheRead)
  check('默认汇率为 7.2', CATALOG_FX_DEFAULT === 7.2 && Math.abs(cnyFee.rates.input / usdFee.rates.input - CATALOG_FX_DEFAULT) < 1e-9)
  check('带 sourceUrl / checkedAt 便于溯源', typeof cnyFee.sourceUrl === 'string' && cnyFee.sourceUrl.length > 0 && typeof cnyFee.checkedAt === 'string')

  // 非法 fx 回落默认
  const bad = catalogEntryFor('google', bare, { fx: -3 })
  check('非法汇率回落默认 7.2', Math.abs(bad.rates.input - usdFee.rates.input * 7.2) < 1e-9)

  // 短名不参与包含匹配（防误伤）
  const short = catalogEntryFor('openai', 'gpt', { mode: 'fuzzy' })
  check('超短名不因包含而误命中', short === null || short.via === 'exact', JSON.stringify(short && short.via))

  // 跨厂商同名：恰好唯一才命中
  const cross = catalogEntryFor('my-gateway', bare, { mode: 'fuzzy' })
  check('未登记 provider 不参与目录（宁缺勿错）', cross === null, JSON.stringify(cross))
  check('normalizeModelName 与 pricing.js 同规则', normalizeModelName('DeepSeek-V4.1 Flash') === 'deepseekv41flash')
}

// ---------- 4. 接入 pricing.priceFor ----------
console.log('[4] 目录接入 priceFor（优先级与兼容性）')
{
  setSyncedEras([])
  setPriceOverrides({})
  const cat = (np, m) => catalogEntryFor(np, m, { mode: 'fuzzy', fx: 7.2 })
  const ts = Date.UTC(2026, 8, 20)

  const models = catalogModelsFor('openai')
  const m0 = models[0]

  // 不注入：与 v1.8.x 一致（provider 兜底 → estimated）
  const before = priceFor('openai', m0, ts)
  check('不注入目录时走 provider 兜底（estimated=true）', before.estimated === true && before.source === 'provider', JSON.stringify({ s: before.source, e: before.estimated }))

  // 注入：目录命中 → 精确价、estimated=false、source='catalog'
  const after = priceFor('openai', m0, ts, { catalog: cat })
  check('注入目录后命中 catalog', after.source === 'catalog', after.source)
  check('目录命中 = 精确价（estimated=false）', after.estimated === false)
  check('目录命中带来源信息', !!after.catalog && typeof after.catalog.sourceUrl === 'string', JSON.stringify(after.catalog))
  check('目录价与直接查询一致', Math.abs(after.rates.input - cat('openai', m0).rates.input) < 1e-9)

  // DeepSeek 自有时代价优先于目录（内置权威价不被目录顶掉）
  const ds = priceFor('deepseek', 'deepseek-flash', ts, { catalog: cat })
  check('内置时代价优先于目录', ds.source === 'exact' && ds.estimated === false, ds.source)

  // 手动覆盖价 > 目录
  const ovMap = {}
  ovMap['openai/' + m0] = { input: 1, output: 2, cacheRead: 0.5 }
  setPriceOverrides(ovMap)
  const ov = priceFor('openai', m0, ts, { catalog: cat })
  check('手动覆盖价优先于目录', ov.source === 'override' && ov.rates.input === 1, JSON.stringify({ s: ov.source, r: ov.rates }))

  // 目录读取抛错不得阻断计费（先清掉上一步的覆盖价，否则命中的是 override）
  setPriceOverrides({})
  const boom = priceFor('openai', m0, ts, { catalog: () => { throw new Error('catalog down') } })
  check('目录读取异常时回落 provider 兜底', boom.source === 'provider' && boom.estimated === true, boom.source)

  setPriceOverrides({})
}

console.log('')
if (failures) { console.log('FAILED: ' + failures + ' 项断言未通过'); process.exit(1) }
console.log('全部通过')
