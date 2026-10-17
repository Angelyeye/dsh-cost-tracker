// ============================================================
// 跨版本读取 profile 条目的「生效配置」（DSH settings 服务）
//
// 背景：插件有几处「按用户配置决定用哪个 Key 名」的逻辑（DeepSeek / Kimi /
// 火山方舟），旧实现直接 `ctx.get('settings').get('llm-deepseek')`。
// 但 0.2.x 的 SettingsForms 已经**没有 `get()`**（只剩 configure / describe /
// update / replace / mutate / write / prepareDocument），那段代码抛 TypeError
// 被各自的 try/catch 吞掉 → **静默**退化成永远使用硬编码默认名。
// 标准部署（默认名与官方一致）看不出问题；自定义 `apiKeyEnv` 的部署会去查
// 一个不存在的 Key 名，表现为「明明配了 Key 却报未找到」。
//
// 0.2.x 的正确读法：`settings.describe()` 返回所有条目的表单描述，
// 其中 `value` 是该条目 **volatile 字段的生效值** —— `apiKeyEnv` 正是
// `.volatile()` 字段（见 dsh-llm-deepseek-api-key 的 Config）。旧宿主（0.1.x）
// 则保留 `get(namespace)`。因此这里做一次「双 API 兼容读」：
//
//   1) settings.describe() 命中 ns → 用 row.value（0.2.x）
//   2) 否则 settings.get(ns)（旧版）
//   3) 都没有 / 都失败 → null，由调用方回落各自默认名
//
// describe() 要遍历全部 profile 条目并逐条做 schema 投影，比一次 `get` 重得多，
// 而余额 / Kimi / 火山三个入口在一次面板刷新里会各调一次 —— 所以按 settings
// 实例做 10s 短缓存，避免重复做全量投影。
// ============================================================

/** describe() 结果的缓存时长（毫秒）。配置变更在设置页写入后最迟 10s 生效。 */
const CACHE_TTL_MS = 10000

/** settings 实例 → { rows: Array|null, at: number } */
const rowsCache = new WeakMap()

/**
 * 取 describe() 的行数组（带短缓存）。
 * @param {object} settings - settings 服务
 * @param {number} now - 当前时刻（毫秒）
 * @returns {Array|null} 行数组；describe 不可用或抛错时为 null
 */
function describedRows(settings, now) {
  const hit = rowsCache.get(settings)
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.rows
  let rows = null
  try {
    const out = settings.describe()
    if (Array.isArray(out)) rows = out
  } catch (e) {
    rows = null
  }
  rowsCache.set(settings, { rows, at: now })
  return rows
}

/**
 * 读取某个 profile 条目（ns）的生效配置对象。
 *
 * @param {object|undefined} settings - `ctx.get('settings')`
 * @param {string} ns - profile 条目 id（如 `llm-deepseek` / `llm-pi-ai`）
 * @param {number} [now] - 仅测试用：注入当前时刻
 * @returns {object|null} 配置对象；不可得时 null
 */
export function readSettingsSection(settings, ns, now) {
  if (!settings || typeof ns !== 'string' || !ns) return null
  const at = typeof now === 'number' ? now : Date.now()
  // ---- 0.2.x：describe() 的 value 是 volatile 字段的生效值 ----
  if (typeof settings.describe === 'function') {
    const rows = describedRows(settings, at)
    if (rows) {
      for (const row of rows) {
        if (!row || row.ns !== ns) continue
        const value = row.value
        return value && typeof value === 'object' ? value : null
      }
      // describe() 正常返回但没有该条目：不要再回退 get()（0.2.x 上它一定抛错，
      // 而且在「条目确实不存在」时也更该返回 null）
      return null
    }
  }
  // ---- 旧宿主：get(namespace) ----
  if (typeof settings.get === 'function') {
    try {
      const value = settings.get(ns)
      return value && typeof value === 'object' ? value : null
    } catch (e) {
      return null
    }
  }
  return null
}

/**
 * 清掉某个 settings 实例的缓存（仅测试/显式失效用）。
 * @param {object} settings
 */
export function resetSettingsCache(settings) {
  if (settings && typeof settings === 'object') rowsCache.delete(settings)
}
