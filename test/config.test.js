// ============================================================
// dsh-cost-tracker 配置层单元测试（零依赖，直接 node 运行）
//   node test/config.test.js
// 覆盖：默认值、非法回退、生效门控
// ============================================================
import { defaultPeakConfig, normalizePeakConfig, peakEffective } from '../config.js'

let failures = 0
const passed = []
function ok(cond, msg) {
  if (cond) passed.push(msg)
  else { failures += 1; console.error('FAIL: ' + msg) }
}

// 1. 默认值
{
  const d = defaultPeakConfig()
  ok(d.peakEnabled === true, '默认: 启用峰谷计价')
  ok(d.peakNotice === true, '默认: 提示显示')
  ok(d.peakStyle === 'compact', '默认: 简洁样式')
  ok(d.peakCompactStack === false, '默认: 双行紧凑关闭（左右单行）')
  ok(d.peakCompactOrder === 'bar-first', '默认: 双行紧凑条上文下')
  ok(d.peakAlertEnabled === true, '默认: 切换前弹窗开启')
  ok(d.peakAlertAhead === 2, '默认: 提前提醒 2 分钟')
  ok(d.peakAlertTarget === 'both', '默认: 提醒峰和谷')
  ok(d.peakAlertPosition === 'corner', '默认: 弹窗右下角')
  ok(d.peakAlertWebNotify === false, '默认: 系统通知关闭')
  ok(d.peakEffectiveAt === '2026-08-01T00:00:00Z', '默认: 生效时间')
}

// 2. 非法回退
{
  const n = normalizePeakConfig({
    peakAlertAhead: 99,           // 超范围 → 回退 2
    peakAlertTarget: 'weird',      // 非法 → both
    peakStyle: 'fancy',            // 非法 → compact
    peakCompactStack: 'yes',       // 非布尔 → false
    peakCompactOrder: 'weird',     // 非法 → bar-first
    peakAlertPosition: 'top',      // 非法 → corner
    peakAlertWebNotify: 'yes',     // 非布尔 → false
    peakNotice: 'on',              // 非布尔 → true(默认)
  })
  ok(n.peakAlertAhead === 2, '回退: ahead 超范围 → 2')
  ok(n.peakAlertTarget === 'both', '回退: target 非法 → both')
  ok(n.peakStyle === 'compact', '回退: style 非法 → compact')
  ok(n.peakCompactStack === false, '回退: compactStack 非布尔 → false')
  ok(n.peakCompactOrder === 'bar-first', '回退: compactOrder 非法 → bar-first')
  ok(n.peakAlertPosition === 'corner', '回退: position 非法 → corner')
  ok(n.peakAlertWebNotify === false, '回退: webNotify 非布尔 → false')
  ok(n.peakNotice === true, '回退: notice 非布尔 → true')
  // null / 数组 → 全默认
  const nd = normalizePeakConfig(null)
  ok(nd.peakEnabled === true && nd.peakAlertAhead === 2, '回退: null → 全默认')
  const na = normalizePeakConfig([])
  ok(na.peakEnabled === true, '回退: 数组 → 全默认')
  // 合法值通过
  const g = normalizePeakConfig({ peakAlertAhead: 15, peakAlertTarget: 'peak', peakStyle: 'classic', peakAlertPosition: 'center', peakAlertWebNotify: true, peakEnabled: false, peakCompactStack: true, peakCompactOrder: 'text-first' })
  ok(g.peakAlertAhead === 15 && g.peakAlertTarget === 'peak' && g.peakStyle === 'classic' && g.peakAlertPosition === 'center' && g.peakAlertWebNotify === true && g.peakEnabled === false, '合法值: 全部保留')
  ok(g.peakCompactStack === true && g.peakCompactOrder === 'text-first', '合法值: 双行紧凑开启 + 文上条下')
}

// 3. 生效门控
{
  const cfg = normalizePeakConfig({ peakEnabled: true, peakEffectiveAt: '2026-08-01T00:00:00Z' })
  const after = Date.UTC(2026, 7, 3)   // 2026-08-03
  const before = Date.UTC(2026, 6, 1)  // 2026-07-01
  ok(peakEffective(cfg, after) === true, '生效: 有效期后 → true')
  ok(peakEffective(cfg, before) === false, '生效: 生效前 → false')
  ok(peakEffective(normalizePeakConfig({ peakEnabled: false }), after) === false, '生效: 停用时 → false')
}

console.log('\n' + passed.length + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
