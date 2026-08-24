# 峰谷「环形表盘」设计方案

> 插件：`dsh-cost-tracker` · 目标：把「时段条样式」下拉框里的 **经典（两行）** 选项，改造成一个按 24h 划分的**中空圆环**。
> 预览页：`docs/peak-dial-preview.html`（已用浏览器逐项渲染验证）。

---

## 1. 需求

- 现有「经典（两行）」是一段固定宽度的线性轨道 + 两行文字（chip / 倒计时），无法直观看出一天中峰谷的分布与当前所处位置。
- 期望改为**中空圆形（环形 / 甜甜圈状）表盘**，按 24h 划分；
  - **橙色** = 高峰时段（工作日 9:00-12:00、14:00-18:00）
  - **蓝色** = 平价时段（其余时间）
  - **周末** = 全天谷价（整体蓝色）
  - 一根**指针**指向「当前时刻」，圆心展示「当前相位 + 倒计时」。

## 2. 设计要点

### 2.1 造型
- **SVG 环形**：一条铺满 24h 的蓝色底环，再按高峰窗口叠加橙色弧段（`[9,12]`、`[14,18]`）。
- **坐标系**：`0:00` 在顶部，`6:00` 在右，`12:00` 在底部，`18:00` 在左（标准 24h 时钟）。每 3h 一个刻度标签。
- **指针**：由圆心指向当前时刻的细杆 + 顶端圆点，随 `now` 旋转。
- **圆心内容**：当前相位词（`高峰时段 / 平价时段 / 周末全谷`）+ 倒计时（如「1小时30分后进入平价」）。
- **等比缩放**：用 SVG `viewBox`，同一份代码可自适应设置面板（wide）与窄栏（rail）两种宽度。

### 2.2 配色（沿用插件现有色板）
| 用途 | 值 |
| --- | --- |
| 高峰橙 | `#ff9800`（对应 `.cost-ps-peakseg`） |
| 平价蓝 | `--dsw-alias-state-business-primary, #4176e6` |
| 周末绿 | `#34a853` |
| 主/次/弱文字 | `#171a1f / #5b6472 / #9ca3af` |

### 2.3 数据口径
- 后端已有一套与 `isPeak / peakPhaseAt` 同口径的窗口：`pricing.js` 的 `PEAK_HOUR_WINDOWS = [{start:9,end:12},{start:14,end:18}]`。
- **新增**：在 `index.js` 的 `peakSnapshot()` 里下发结构化窗口数组 `peakHours: PEAK_HOUR_WINDOWS` 给前端，前端据此画弧，避免把窗口写死在前端、与计费口径不同步。
- 周末判定沿用 `snap.phase.weekend`：为真则**不画任何橙色弧**，整环蓝。

## 3. 实现改动（面）

| 文件 | 改动 |
| --- | --- |
| `index.js` | `peakSnapshot()` 增加 `peakHours: PEAK_HOUR_WINDOWS`；从 `./pricing.js` 补充导入 `PEAK_HOUR_WINDOWS`。 |
| `config.js` | 仅更新注释；`peakStyle` 值仍为 `classic`，但语义改为「环形表盘」，并保持 `compact` 不变（老配置无需迁移）。 |
| `client.js` | ① 新增 `PeakDial` SVG 组件与 `cost-ps-ring*` 样式；② 重写 `classic` 分支为该圆环；③ 下拉框标签改为「环形表盘（24h）」；④ 设置面板说明文案同步。 |

### 3.1 `client.js` 关键片段

```js
// 24h 环形表盘：底环蓝色铺满，高峰窗口叠加橙色弧段，指针指向当前时刻。
function PeakDial(props) {
  const p = props.phase;                       // { inPeak, weekend, nextAtMs, ... }
  const now = props.now;
  const windows = props.windows || [{start:9,end:12},{start:14,end:18}];
  const size = props.size || 150;
  const CX = 90, CY = 90, R = 62, SW = 18;     // viewBox 180
  const deg = (h) => h * 15;                    // 0:00 顶部，顺时针
  const polar = (d, r) => [CX + r*Math.sin(d*Math.PI/180), CY - r*Math.cos(d*Math.PI/180)];
  const arc = (a, b) => { const s = polar(deg(a), R), e2 = polar(deg(b), R);
    return `M ${s[0]} ${s[1]} A ${R} ${R} 0 ${(b-a)%360>180?1:0} 1 ${e2[0]} ${e2[1]}`; };
  const minuteOfDay = /* from now (Beijing) */;
  const marker = polar(minuteOfDay / 1440 * 360, R);
  const color = p.weekend ? GREEN : p.inPeak ? AMBER : BLUE;
  // ... 组装 SVG：底环 + 橙色弧 + 刻度 + 指针 + 圆心文字
}
```

```js
if (style === "classic") {                     // 改造后：环形表盘
  return e("div", { className: "cost-ps cost-ps-ring" + wordClass, title: countdown },
    e(PeakDial, { phase: p, windows: snap.peakHours, now }),
    e("div", { className: "cost-ps-ringfoot" },
      e("span", { className: "cost-ps-chip" }, peakWord(p) + " · " + countdown)));
}
```

## 4. 交互与边界

- **指针实时性**：`PeakSidebar` 已有 `now` 定时器（10s），圆环复用 `now`，指针平滑随当前时刻移动。
- **切换前后**：圆心倒计时与既有 `peakCountdown` 使用同一份相位数据，口径一致。
- **周末**：整环蓝色、圆心显示「周末全谷」，不渲染橙色弧。
- **窄栏（rail）态**：仍是竖排短词，不显示圆环（保持窄栏简洁）。
- **可访问性**：外层 `title` 保留倒计时提示；环形为主视觉，`aria-label` 可后续补充。

## 5. 验收

- [ ] 设置面板选择「环形表盘（24h）」后，设置面板出现圆环 + 圆心相位/倒计时。
- [ ] 侧边栏（wide）同样展示圆环；窄栏（rail）仍为竖排短词。
- [ ] 工作日高峰/平价两个时刻，橙/蓝弧与指针正确，圆心文案随相位切换。
- [ ] 周末整环无橙色，圆心显示「周末全谷」。
- [ ] `npm test`（config / pricing / storage）全部通过。
