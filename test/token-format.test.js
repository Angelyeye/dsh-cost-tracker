// ============================================================
// dsh-cost-tracker Token 中文单位 单测（零依赖，直接 node 运行）
//   node test/token-format.test.js
//
// 拦的是「单位口径不一致」这一类问题：
//   ① 边界值（1万 / 1亿 / 100万 / 10亿）必须按约定跳档；
//   ② 不得出现英文单位 M/K 与多余尾随 0（1.50亿 是错的，应为 1.5亿）；
//   ③ 精确显示必须无损（用于 tooltip / CSV / 明细）；
//   ④ 非法输入（负数、NaN、空串、对象）不得抛错。
// ============================================================
import { formatTokenCN, formatTokenExact, WAN, YI } from '../token-format.js'

let failures = 0
const passed = []
function ok(cond, msg) {
  if (cond) passed.push(msg)
  else { failures += 1; console.error('FAIL: ' + msg) }
}
function eq(a, b, msg) { ok(a === b, `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`) }

// ---------- 1. 常量 ----------
{
  eq(WAN, 10000, '常量: 1万 = 10000')
  eq(YI, 100000000, '常量: 1亿 = 100000000')
}

// ---------- 2. 一万以下：千分位整数 ----------
{
  eq(formatTokenCN(0), '0', '<1万: 0')
  eq(formatTokenCN(1), '1', '<1万: 1')
  eq(formatTokenCN(999), '999', '<1万: 999')
  eq(formatTokenCN(1000), '1,000', '<1万: 1000 加千分位')
  eq(formatTokenCN(9300), '9,300', '<1万: 9300')
  eq(formatTokenCN(9999), '9,999', '<1万: 9999')
  eq(formatTokenCN(9999.9), '9,999', '<1万: 小数向下取整')
}

// ---------- 3. 一万到一亿：万 ----------
{
  eq(formatTokenCN(10000), '1万', '万: 10000 → 1万')
  eq(formatTokenCN(12500), '1.3万', '万: 12500 → 1.3万（四舍五入 1 位）')
  eq(formatTokenCN(31400), '3.1万', '万: 31400 → 3.1万')
  eq(formatTokenCN(314200), '31.4万', '万: 314200 → 31.4万')
  eq(formatTokenCN(1000000), '100万', '万: 100万 边界取整')
  eq(formatTokenCN(1500000), '150万', '万: 150万')
  eq(formatTokenCN(31382777), '3138万', '万: 31382777 → 3138万')
  eq(formatTokenCN(99999999), '10000万', '万: 99999999 → 10000万（1亿以下最高档）')
  ok(formatTokenCN(31382777) === '3138万', '万: 不出现小数点冗余（3138万）')
}

// ---------- 4. 一亿以上：亿 ----------
{
  eq(formatTokenCN(100000000), '1亿', '亿: 1亿')
  eq(formatTokenCN(150000000), '1.5亿', '亿: 1.5亿（不留尾随 0）')
  eq(formatTokenCN(1234567890), '12.3亿', '亿: ≥10亿 保留 1 位')
  eq(formatTokenCN(32768000000), '327.7亿', '亿: 327.7亿')
  ok(!formatTokenCN(150000000).includes('.50'), '亿: 不出现 1.50亿 这种尾随 0')
}

// ---------- 5. 不得出现英文单位 ----------
{
  const samples = [0, 999, 1000, 9999, 10000, 314200, 1500000, 31382777, 100000000, 32768000000]
  const bad = samples.filter((n) => /[KMB]\b/.test(formatTokenCN(n).replace(/[,，]/g, '')))
  ok(bad.length === 0, '英文单位: 任一档位都不含 K/M/B（' + JSON.stringify(bad) + '）')
}

// ---------- 6. 精确显示 ----------
{
  eq(formatTokenExact(0), '0', '精确: 0')
  eq(formatTokenExact(31382777), '31,382,777', '精确: 千分位完整数字')
  eq(formatTokenExact(1500000000), '1,500,000,000', '精确: 十亿也完整')
  eq(formatTokenCN(31382777, { exact: true }), '31,382,777', '精确: 等价于 formatTokenExact')
}

// ---------- 7. 非法输入容错 ----------
{
  eq(formatTokenCN(undefined), '0', '容错: undefined → 0')
  eq(formatTokenCN(null), '0', '容错: null → 0')
  eq(formatTokenCN(NaN), '0', '容错: NaN → 0')
  eq(formatTokenCN(-5), '0', '容错: 负数 → 0')
  eq(formatTokenCN('12345'), '1.2万', '容错: 数字字符串按数值处理')
  eq(formatTokenCN('abc'), '0', '容错: 非数字字符串 → 0')
  eq(formatTokenCN({}), '0', '容错: 对象 → 0')
}

console.log('\n' + passed.length + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
