// ============================================================
// DSH 花费统计插件 —— Token 数量的中文单位显示（纯逻辑，可独立测试）
//
// 背景：以往 UI 把 token 显示成 `1.5M` / `314K`（英文单位），中英混排且
// 中文用户读起来不直观。v1.11.0 起统一为中文口径：
//
//   < 1万        千分位整数          9,300
//   ≥ 1万 <1亿   X.X万（≥100万取整）  31.4万 / 150万 / 3,138万
//   ≥ 1亿        X.XX亿（≥10亿 1 位） 1.50亿 / 327.7亿
//
// 设计取舍：
//   • 千分位分组**只用于** 1 万以下的原始整数（「9,300」易读），
//     万/亿口径里的数字不带分组（「3,138万」比「3,138万」更接近中文习惯，
//     实际取「3,138万」会与「万」字挤在一起，故超过 4 位时也不加逗号）。
//   • 单位与数字之间**不留空格**，便于在窄容器（气泡、胶囊、坐标轴）里换行。
//   • 纯函数、无 Intl 依赖：Node 与浏览器表现一致，单测可逐值断言。
//   • 精确数值（tooltip、CSV）另有 formatTokenExact，避免丢精度。
// ============================================================

/** 1 万 / 1 亿 */
export const WAN = 10000
export const YI = 100000000

/** 千分位（仅用于安全整数范围） */
function group3(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 去掉多余的尾随 0（1.50 → 1.5，2.0 → 2） */
function trimZeros(s) {
  return s.indexOf('.') >= 0 ? s.replace(/\.?0+$/, '') : s
}

/**
 * 把一个 token 数格式化为中文单位。
 * @param {number|string} value - token 数量（负数按 0 处理，非数按 0 处理）
 * @param {{exact?:boolean}} [opts] - exact=true 时返回完整千分位整数（不换算单位）
 * @returns {string} 例如 `0` / `9,300` / `31.4万` / `3,138万` / `1.5亿` / `327.7亿`
 */
export function formatTokenCN(value, opts) {
  const raw = Number(value)
  const v = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0
  if (opts && opts.exact === true) return group3(v)
  if (v < WAN) return group3(v)
  if (v < YI) {
    const w = v / WAN
    // ≥100 万不再保留小数：四舍五入到整数「万」
    return (w >= 100 ? String(Math.round(w)) : trimZeros(w.toFixed(1))) + '万'
  }
  const y = v / YI
  return (y >= 10 ? trimZeros(y.toFixed(1)) : trimZeros(y.toFixed(2))) + '亿'
}

/**
 * 相同语义的精确显示：完整千分位整数（用于 tooltip / CSV / 明细）。
 * @param {number|string} value
 * @returns {string}
 */
export function formatTokenExact(value) {
  return formatTokenCN(value, { exact: true })
}
