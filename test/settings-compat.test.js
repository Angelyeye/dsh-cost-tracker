// ============================================================
// settings 跨版本读取兼容测试
//   node test/settings-compat.test.js
//
// 拦的事故（0.2.x 实测）：SettingsForms 已移除 `get()`，插件的
// `settings.get('llm-deepseek'|'llm-pi-ai')` 抛 TypeError 被自身 try/catch 吞掉，
// 「按用户配置决定 Key 名」静默退化成硬编码默认名 —— 标准部署无感，
// 自定义 `apiKeyEnv` 的部署会去查不存在的 Key 名。
//
// 0.2.x 的正确读法是 `settings.describe()`：它返回所有条目的表单描述，
// `row.value` 是该条目 volatile 字段的**生效值**（apiKeyEnv 正是 volatile 字段）。
// 本文件把两套 API 的行为、优先级与缓存都钉死。
// ============================================================
import { readSettingsSection, resetSettingsCache } from '../settings.js'

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`)
  else {
    failures++
    console.log(`  FAIL  ${name}`)
    if (detail !== undefined) console.log(`        ${detail}`)
  }
}
function eq(a, b, msg) { check(msg + '（' + JSON.stringify(a) + ' === ' + JSON.stringify(b) + '）', a === b) }

console.log('dsh-cost-tracker settings 读取兼容测试')
console.log('')

console.log('[1] 旧宿主：只有 get(namespace)')
{
  const settings = { get: (ns) => (ns === 'llm-deepseek' ? { apiKeyEnv: 'OLD_KEY' } : undefined) }
  const v = readSettingsSection(settings, 'llm-deepseek')
  eq(v && v.apiKeyEnv, 'OLD_KEY', 'get() 命中并返回配置对象')
  eq(readSettingsSection(settings, 'llm-pi-ai'), null, '条目不存在 → null')
  const throwing = { get: () => { throw new Error('nope') } }
  eq(readSettingsSection(throwing, 'llm-deepseek'), null, 'get() 抛错 → null（不把异常抛给调用方）')
  const weird = { get: () => 'string-value' }
  eq(readSettingsSection(weird, 'llm-deepseek'), null, 'get() 返回非对象 → null')
}

console.log('[2] 0.2.x：describe() 生效值（无 get）')
{
  const settings = {
    describe: () => ([
      { ns: 'ui-settings', value: { theme: 'dark' } },
      { ns: 'llm-deepseek', value: { apiKeyEnv: 'NEW_KEY', models: [] } },
    ]),
  }
  const v = readSettingsSection(settings, 'llm-deepseek')
  eq(v && v.apiKeyEnv, 'NEW_KEY', 'describe() 命中返回 value')
  eq(readSettingsSection(settings, 'llm-pi-ai'), null, 'describe() 无该条目 → null')
  check('没有 get() 也不抛错（旧实现在这里抛 TypeError）', typeof settings.get === 'undefined')

  const nullValue = { describe: () => ([{ ns: 'llm-deepseek', value: null }]) }
  eq(readSettingsSection(nullValue, 'llm-deepseek'), null, 'row.value 为 null → null')

  const throwing = { describe: () => { throw new Error('settings not ready') } }
  eq(readSettingsSection(throwing, 'llm-deepseek'), null, 'describe() 抛错 → null（调用方回落默认名）')

  const notArray = { describe: () => ({ nope: true }), get: () => ({ apiKeyEnv: 'FALLBACK' }) }
  eq(readSettingsSection(notArray, 'llm-deepseek') && readSettingsSection(notArray, 'llm-deepseek').apiKeyEnv, 'FALLBACK',
    'describe() 返回非数组 → 回落 get()')
}

console.log('[3] 两套 API 都在：describe 优先')
{
  let getCalls = 0
  const settings = {
    describe: () => ([{ ns: 'llm-deepseek', value: { apiKeyEnv: 'FROM_DESCRIBE' } }]),
    get: (ns) => { getCalls++; return { apiKeyEnv: 'FROM_GET' } },
  }
  eq(readSettingsSection(settings, 'llm-deepseek').apiKeyEnv, 'FROM_DESCRIBE', '优先 describe')
  eq(getCalls, 0, 'describe 命中时不再调用 get()')

  // describe 正常返回但没有该条目 → 权威为空，不偷偷回退 get()
  const empty = {
    describe: () => [],
    get: () => ({ apiKeyEnv: 'FROM_GET' }),
  }
  eq(readSettingsSection(empty, 'llm-deepseek'), null, 'describe 权威：无该条目即 null')
}

console.log('[4] describe() 短缓存（避免每次查询都做全量投影）')
{
  let calls = 0
  const settings = { describe: () => { calls++; return [{ ns: 'llm-deepseek', value: { apiKeyEnv: 'K' } }] } }
  readSettingsSection(settings, 'llm-deepseek', 1000)
  readSettingsSection(settings, 'llm-deepseek', 2000)
  eq(calls, 1, 'TTL 内复用缓存')
  readSettingsSection(settings, 'llm-pi-ai', 3000)
  eq(calls, 1, '同实例不同 ns 也复用同一份 describe 结果')

  readSettingsSection(settings, 'llm-deepseek', 1000 + 10001)
  eq(calls, 2, '超过 TTL 后重新 describe')
  resetSettingsCache(settings)
  readSettingsSection(settings, 'llm-deepseek', 1000 + 10002)
  eq(calls, 3, '显式失效后重新 describe')

  // 不同实例各自缓存（服务被替换/HMR 后不能读到旧实例的缓存）
  const other = { describe: () => [{ ns: 'llm-deepseek', value: { apiKeyEnv: 'OTHER' } }] }
  eq(readSettingsSection(other, 'llm-deepseek', 1000).apiKeyEnv, 'OTHER', '不同实例独立读取')
}

console.log('[5] 边界输入')
{
  eq(readSettingsSection(undefined, 'llm-deepseek'), null, 'settings 缺失 → null')
  eq(readSettingsSection(null, 'llm-deepseek'), null, 'settings 为 null → null')
  eq(readSettingsSection({ get: () => ({}) }, ''), null, 'ns 为空串 → null')
  eq(readSettingsSection({ get: () => ({}) }, 123), null, 'ns 非字符串 → null')
  eq(readSettingsSection({}, 'llm-deepseek'), null, '两套 API 都没有 → null')
}

console.log('')
if (failures > 0) {
  console.log(`FAILED: ${failures} 项断言未通过`)
  process.exit(1)
}
console.log('OK: 全部断言通过')
process.exit(0)
