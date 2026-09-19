// 端到端：云端 /api/v1/plugin-view → view.js normalizeCloudDash → 本地卡片字段
// 目的：把「仅云端显示 ¥0.0000」这条链路的每一环都钉住（字段名映射 + 互斥口径）。
//
// ⚠️ 跨仓库依赖：本用例需要**兄弟目录** dsh-cost-cloud（真实启动其服务）。
// CI（GitHub Actions）只检出插件仓库本身，因此这里**检测不到就跳过**并明确说明，
// 不能让发布流水线因为缺一个可选仓库而失败。
import assert from 'node:assert/strict'

import { normalizeCloudDash, mergeUsageHeat } from '../view.js'
import { cloudUsageHeat } from '../index.js'

let cloud = null
let helpers = null
try {
  cloud = await import('../../dsh-cost-cloud/src/server.js')
  helpers = await import('../../dsh-cost-cloud/test/helpers.js')
} catch (e) {
  cloud = null
}

if (!cloud) {
  const { test } = await import('node:test')
  test('跨仓库端到端（需要兄弟目录 dsh-cost-cloud）', { skip: '未找到 ../dsh-cost-cloud：本用例只在同时检出两个仓库时运行' }, () => {})
} else {
  const { test } = await import('node:test')
  const { listen } = cloud
  const { testConfig, tmpDir, addDevice, rec, ingestDirect } = helpers
  const { rmSync } = await import('node:fs')
  const T0 = Date.UTC(2026, 8, 12, 5, 0, 0)

  test('云端 plugin-view → normalizeCloudDash：卡片金额字段不再是 0', async () => {
    const dir = tmpDir()
    const config = testConfig(dir, {
      DSH_SYNC_TOKEN: 'shared-bootstrap-token-0123456789', ALLOW_DEVICE_SELF_REGISTER: '1',
      HOST: '127.0.0.1', PORT: '0',
    })
    const { server, app, url } = await listen(config, { log: () => {} })
    try {
      const tokenB = addDevice(app, 'machine-B', '笔记本')
      ingestDirect(app, {
        token: tokenB, deviceId: 'machine-B', source: 'dsh', records: [
          rec({ ts: T0, cost: 1.5, sessionId: 'b1' }),
          rec({ ts: T0 + 1000, cost: 0.4, sessionId: 'b2', subscription: true, model: 'kimi-coding', provider: 'moonshot-ai' }),
        ],
      })
      const res = await fetch(url + '/api/v1/plugin-view?range=all', { headers: { authorization: 'Bearer ' + tokenB } })
      const raw = await res.json()
      assert.equal(raw.ok, true)

      // 归一化后：本地卡片读的 real / sub / calls / subCalls 必须齐备且互斥
      const dash = normalizeCloudDash(raw, 7)
      assert.ok(Math.abs(dash.all.real - 1.5) < 1e-9, 'all.real=' + dash.all.real)
      assert.ok(Math.abs(dash.all.sub - 0.4) < 1e-9, 'all.sub=' + dash.all.sub)
      assert.equal(dash.all.calls, 1, '按量调用 1 次')
      assert.equal(dash.all.subCalls, 1, '订阅调用 1 次')
      assert.equal(dash.today.real, 0, '今天无调用（样本是 9-12）')
      assert.ok(dash.summary.real > 0, '底部汇总行金额非 0：' + dash.summary.real)
      assert.equal(dash.summary.realCalls, 1, '汇总按量次数')
      // 图表数据源必须在
      assert.ok(dash.byDay.length > 0 && dash.byModel.length === 2 && dash.byModelDay.length === 2,
        'byDay/byModel/byModelDay 齐备（仅云端才能画图）')
      assert.equal(dash.recent.length, 2, '最近记录 2 条')
    } finally {
      await new Promise((r) => server.close(r))
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) } catch (e) {}
    }
  })

  test('「本机+云端」走的 overview?union 路径不得重复计数（宿主实际调用形态）', async () => {
    const dir = tmpDir()
    const config = testConfig(dir, {
      DSH_SYNC_TOKEN: 'shared-bootstrap-token-0123456789', ALLOW_DEVICE_SELF_REGISTER: '1',
      HOST: '127.0.0.1', PORT: '0',
    })
    const { server, app, url } = await listen(config, { log: () => {} })
    try {
      const tokenA = addDevice(app, 'machine-A', '本机')
      const tokenB = addDevice(app, 'machine-B', '另一台')
      ingestDirect(app, { token: tokenA, deviceId: 'machine-A', source: 'dsh', records: [rec({ ts: T0, cost: 1.5, sessionId: 'a1' })] })
      ingestDirect(app, { token: tokenB, deviceId: 'machine-B', source: 'dsh', records: [rec({ ts: T0 + 1000, cost: 0.5, sessionId: 'b1' })] })

      // 宿主 cloud-rest 口径的并集：① 其他整机 ② 本机上的非 dsh 来源（此处为空）
      const union = JSON.stringify([
        { excludeDevice: 'machine-A' },
        { devices: 'machine-A', excludeSource: 'dsh' },
      ])
      const res = await fetch(url + '/api/v1/overview?range=all&union=' + encodeURIComponent(union), {
        headers: { authorization: 'Bearer ' + tokenA },
      })
      const body = await res.json()
      assert.equal(body.ok, true)
      // 只有 machine-B 那 0.5 —— 旧实现（切片取自全表）会给出 2.0/2 次，相加后本机被计两次
      assert.ok(Math.abs(body.all.real - 0.5) < 1e-9, 'union all.real 应为 0.5，实际 ' + body.all.real)
      assert.equal(body.all.calls, 1, 'union 不得重复计数，实际 ' + body.all.calls + ' 次')
      assert.ok(Math.abs(body.summary.realCost - 0.5) < 1e-9, 'union summary.realCost=' + body.summary.realCost)
      assert.ok(Math.abs(body.summary.realCalls - 1) < 1e-9, 'union summary.realCalls=' + body.summary.realCalls)
    } finally {
      await new Promise((r) => server.close(r))
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) } catch (e) {}
    }
  })

  test('云端按天明细 → cloudUsageHeat → mergeUsageHeat：「本机+云端」热力图不重不漏', async (t) => {
    const dir = tmpDir()
    const config = testConfig(dir, {
      DSH_SYNC_TOKEN: 'shared-bootstrap-token-0123456789', ALLOW_DEVICE_SELF_REGISTER: '1',
      HOST: '127.0.0.1', PORT: '0',
    })
    const { server, app, url } = await listen(config, { log: () => {} })
    try {
      const tokenA = addDevice(app, 'machine-A', '本机')
      const tokenB = addDevice(app, 'machine-B', '另一台')
      // 本机与另一台都在 9-12；另一台另有一天 9-14（本机没有 → 必须从云端补进热力图）
      ingestDirect(app, {
        token: tokenA, deviceId: 'machine-A', source: 'dsh',
        records: [rec({ ts: T0, cost: 1.5, sessionId: 'a1' })],
      })
      ingestDirect(app, {
        token: tokenB, deviceId: 'machine-B', source: 'dsh',
        records: [rec({ ts: T0 + 3600000, cost: 0.5, sessionId: 'b1' }), rec({ ts: T0 + 2 * 86400000, cost: 0.25, sessionId: 'b2' })],
      })

      const union = JSON.stringify([{ excludeDevice: 'machine-A' }, { devices: 'machine-A', excludeSource: 'dsh' }])
      const res = await fetch(url + '/api/v1/plugin-view?range=all&union=' + encodeURIComponent(union), {
        headers: { authorization: 'Bearer ' + tokenA },
      })
      const body = await res.json()
      assert.equal(body.ok, true)
      const cloudDay = body.byDay.find((d) => d.tokens > 0)
      assert.ok(cloudDay, 'byDay 必须带按天明细')
      // 云端 v1.3.2 起 byDay 才带 token 类型拆分。本地同时检出的是**旧版云端**时跳过，
      // 与文件头「跨仓库依赖」同一条原则：环境不满足就明确跳过，不让它变成发布闸门的假红。
      // 线上若真的连着旧云端，热力图会自动退回本机并在卡片上标注口径 —— 属于已声明的降级行为。
      if (!('input' in cloudDay)) {
        t.skip('本地 dsh-cost-cloud 早于 v1.3.2（byDay 无 token 类型拆分）：跳过本用例，请升级兄弟目录后重跑')
        return
      }
      for (const k of ['input', 'output', 'cacheRead', 'cacheWrite']) {
        assert.ok(k in cloudDay, 'byDay 必须含 ' + k + '（热力图悬停明细 + 按视图合并）')
      }

      const cloudHeat = cloudUsageHeat(body, 'cloud-rest')
      // 只有 machine-B 的两条记录（排除 machine-A）
      assert.equal(cloudHeat.total.calls, 2, '并集口径只含另一台的 2 次调用，实际 ' + cloudHeat.total.calls)
      assert.equal(cloudHeat.days.length, 2, '另一台有两天数据')
      assert.ok(cloudHeat.days.every((d) => d.tokens === d.input + d.output + d.cacheRead + d.cacheWrite),
        'tokens 必须按本地口径重算（云端 tokens 含 reasoning）')

      // 本机热力图（宿主 buildUsageHeat 形状）：只有 9-12 一天
      const localHeat = {
        ok: true,
        days: [{ date: '2026-09-12', input: 1000, output: 500, cacheRead: 2000, cacheWrite: 0, calls: 1, cost: 1.5, tokens: 3500 }],
        total: { tokens: 3500, input: 1000, cache: 2000, output: 500, calls: 1, cost: 1.5 },
      }
      const merged = mergeUsageHeat(localHeat, cloudHeat)
      const dates = merged.days.map((d) => d.date)
      assert.ok(dates.includes('2026-09-12') && dates.includes('2026-09-14'),
        '合并后既有本机的 9-12、也有云端独有的 9-14，实际 ' + dates.join(','))
      const d12 = merged.days.find((d) => d.date === '2026-09-12')
      assert.equal(d12.calls, 2, '9-12 两侧调用相加（本机 1 + 另一台 1）')
      assert.equal(d12.tokens, 3500 + 3500, '9-12 两侧 tokens 相加')
      assert.equal(merged.total.tokens, 3500 + 7000, '累计 = 本机 + 云端全时段')
      assert.equal(merged.total.calls, 1 + 2, '累计调用 = 本机 + 云端，不重不漏')
    } finally {
      await new Promise((r) => server.close(r))
      try { rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }) } catch (e) {}
    }
  })

  test('旧云端（概览口径 realCost）经归一化后金额同样非 0（向后兼容）', () => {
    const legacy = {
      ok: true, range: '7d', days: 7,
      realCost: 2.0, realCalls: 100, realTokens: 5000000, subEquivalent: 0.3, subCalls: 5, subTokens: 90000,
      today: { realCost: 0.5, calls: 10, tokens: 100000, subCost: 0, subCalls: 0, subTokens: 0 },
      month: { realCost: 1.0, calls: 50, tokens: 2000000, subCost: 0, subCalls: 0, subTokens: 0 },
      all: { realCost: 2.0, calls: 100, tokens: 5000000, subCost: 0.3, subCalls: 5, subTokens: 90000 },
      summary: { realCost: 2.0, realCalls: 100, realTokens: 5000000, subEquivalent: 0.3, subCalls: 5, subTokens: 90000, cost: 2.3, calls: 105, tokens: 5090000 },
      byDay: [], byModel: [], byModelDay: [], recent: [], devices: [], sources: [],
    }
    const dash = normalizeCloudDash(legacy, 7)
    assert.ok(Math.abs(dash.today.real - 0.5) < 1e-9, 'today.real 由 realCost 映射而来：' + dash.today.real)
    assert.ok(Math.abs(dash.all.real - 2.0) < 1e-9, 'all.real=' + dash.all.real)
    assert.ok(Math.abs(dash.all.sub - 0.3) < 1e-9, 'all.sub 由 subCost 映射而来：' + dash.all.sub)
    assert.ok(Math.abs(dash.summary.real - 2.0) < 1e-9, 'summary.real=' + dash.summary.real)
    assert.equal(dash.summary.realCalls, 100)
  })
}
