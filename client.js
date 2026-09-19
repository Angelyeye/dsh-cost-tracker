// ============================================================
// DSH 花费统计插件 —— Client 半端（静态版）
// 由动态版 cost-tracker.client.js 改造而来：
//   host.call     → fetch('/api/cost-tracker/<method>')
//   styles.insert → 原生 <style> 标签注入
//   React         → require('react')
// 输出为浏览器 ModuleLoader bundle：exports.apply / exports.inject
// ============================================================
window.__ModuleLoader__.load({
	id: "@angelyeye/dsh-cost-tracker",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const React = require("react");

		// ---------- api helper (replaces host.call) ----------
		function apiCall(method, args) {
			return fetch("/api/cost-tracker/" + method, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify(args || {}),
			}).then((r) => r.json());
		}

		const e = React.createElement;
		const useState = React.useState;
		const useEffect = React.useEffect;
		const useRef = React.useRef;

		const BLUE = "var(--dsw-alias-state-business-primary, #4176e6)";
		const AMBER = "var(--dsw-alias-state-warn-primary, #d97706)";
		const GREEN = "var(--dsw-alias-state-success-primary, #16a34a)";
		const RED = "var(--dsw-alias-state-error-primary, #dc2626)";
		const GRAY = "var(--dsw-alias-label-tertiary, #9ca3af)";
		const INK2 = "var(--dsw-alias-label-secondary, #6b7280)";
		const GRID = "var(--dsw-alias-border-l1, #e5e7eb)";
		const TOKEN_COLORS = ["rgb(30,64,175)", "rgb(37,99,235)", "rgb(96,165,250)", "rgb(191,219,254)"];
		const TOKEN_NAMES = ["输入", "缓存写入", "输出", "缓存命中"];
		// 「顺序渐变色阶」配色方案：第 1 名（总消费最高）最深垫底，名次越靠后越浅，
		// 色相按各自方向轻微漂移。三套可选（页内切换，localStorage 记忆）：
		//   橙→黄：hue 20°→64°  蓝→紫：hue 212°→250°  蓝→浅蓝：hue 212°→200°
		const COLOR_SCHEMES = {
			"orange-yellow": { label: "橙→黄", dot: "#F96100", hue: 20, sat: 95, hueStep: 4 },
			"blue-purple": { label: "蓝→紫", dot: "#2E7CE6", hue: 212, sat: 75, hueStep: 3.5 },
			"blue-light": { label: "蓝→浅蓝", dot: "#7CC0F5", hue: 212, sat: 75, hueStep: -1 },
		};
		function schemeColor(i, s) {
			const light = Math.min(50 + i * 5, 78);
			const hue = s.hue + i * s.hueStep;
			const sat = Math.max(s.sat - i * 2, 65);
			return "hsl(" + hue + ", " + sat + "%, " + light + "%)";
		}
		// 色款：该方案从深（底）到浅（顶）的渐变条，直观展示色阶走向
		function schemeSwatch(k) {
			const s = COLOR_SCHEMES[k];
			return "linear-gradient(to top, " + schemeColor(0, s) + ", " + schemeColor(7, s) + ")";
		}
		const MEMBERSHIP = { LEVEL_FREE: "免费版", LEVEL_BASIC: "基础版", LEVEL_INTERMEDIATE: "进阶版", LEVEL_ADVANCED: "高级版" };

		// ---------- 前端显隐开关（服务端 ui-config，见 config.js 的 UI_SURFACES） ----------
		// 配置改动后由配置卡片广播，已挂载的部件立刻响应，不必等下一次轮询。
		const UI_EVENT = "dsh-cost-tracker-ui";
		/**
		 * 取显隐标志：只有显式 false 才算关闭。
		 * snap 还没加载完 / 老服务端不返回该字段时按「可见」处理 —— 否则界面会先闪一下再出现。
		 */
		function uiOn(ui, key) {
			return !(ui && ui[key] === false);
		}
		/**
		 * 「界面显示」分组的开关清单。
		 * 说明书（label/desc）在浏览器里必须有本地副本：配置卡片渲染时不该为了拿一段
		 * 文案再往返一次服务端。key 与 config.js 的 UI_SURFACES 必须逐字一致 ——
		 * test/client-render.test.js 的 [8] 会把两份清单对起来，漂移即报红。
		 */
		const UI_SURFACES = [
			{
				key: "uiDockEnabled",
				label: "输入框上方的花费胶囊",
				desc: "本会话花费与模型明细（会话输入区上方）。关闭后输入区不再显示任何花费信息。",
			},
			{
				key: "uiPeakEnabled",
				label: "侧边栏峰谷时段条",
				desc: "侧边栏底部的当前档位 / 倒计时。关闭后峰谷切换弹窗与系统通知一并停用；只想留提醒不想要时段条时，请改用「峰谷计价与提示」里的提示开关。",
			},
			{
				key: "uiDashboardEnabled",
				label: "设置页「花费统计」看板",
				desc: "设置页左侧导航的花费统计入口与看板。关闭后该入口隐藏，插件仍照常记账并同步云端。",
			},
		];

		// ---------- styles ----------
		function applyStyles(ctx) {
			const css = `
.cost-wrap { padding: 4px 2px 28px; color: var(--dsw-alias-label-primary, #171a1f); font-size: 13px; }
.cost-h1 { font-size: 16px; font-weight: 600; margin: 2px 0 12px; display: flex; align-items: center; gap: 8px; }
.cost-h1 .cost-icon { flex: none; }
.cost-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cost-spacer { flex: 1; }
.cost-hint { color: var(--dsw-alias-label-secondary, #5b6472); font-size: 12px; }
.cost-err { color: var(--dsw-alias-state-error-primary, #dc2626); font-size: 12px; }
.cost-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin: 12px 0; }
.cost-card { background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 10px; padding: 14px 16px; }
.cost-card-title { color: var(--dsw-alias-label-secondary, #5b6472); font-size: 12px; }
.cost-card-value { font-size: 24px; font-weight: 650; margin-top: 6px; font-variant-numeric: tabular-nums; }
.cost-card-sub { color: var(--dsw-alias-label-secondary, #5b6472); font-size: 12px; margin-top: 6px; }
.cost-panel { background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 10px; padding: 14px 16px; margin: 12px 0; }
.cost-panel-title { font-size: 14px; font-weight: 600; }
.cost-tabs { display: inline-flex; border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 999px; overflow: hidden; }
.cost-tab { padding: 3px 12px; font-size: 12px; cursor: pointer; background: transparent; border: none; color: var(--dsw-alias-label-secondary, #5b6472); }
.cost-tab-on { background: var(--dsw-alias-state-business-primary, #4176e6); color: #fff; }
.cost-badge { display: inline-block; padding: 1px 8px; border-radius: 999px; font-size: 11px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); color: var(--dsw-alias-label-secondary, #5b6472); }
.cost-btn { padding: 4px 12px; font-size: 12px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #171a1f); cursor: pointer; }
.cost-btn:hover { background: var(--dsw-alias-bg-layer-2, #f3f4f6); }
.cost-btn-primary { background: var(--dsw-alias-state-business-primary, #4176e6); border-color: var(--dsw-alias-state-business-primary, #4176e6); color: #fff; }
.cost-btn-primary:hover { background: var(--dsw-alias-state-business-primary, #4176e6); color: #fff; opacity: .9; }
.cost-btn:disabled { opacity: 0.6; cursor: default; }
.cost-select { padding: 4px 8px; font-size: 12px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #171a1f); }
.cost-input { padding: 4px 8px; font-size: 12px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); background: var(--dsw-alias-bg-layer-1, #fff); color: var(--dsw-alias-label-primary, #171a1f); width: 220px; }
.cost-legend { display: flex; gap: 14px; flex-wrap: wrap; margin-top: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary, #5b6472); }
.cost-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; margin-right: 5px; }
.cost-bar-track { height: 8px; border-radius: 999px; background: var(--dsw-alias-bg-layer-2, #eef0f3); overflow: hidden; margin-top: 6px; }
.cost-bar-fill { height: 100%; border-radius: 999px; }
.cost-grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
.cost-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.cost-table th { text-align: left; color: var(--dsw-alias-label-secondary, #5b6472); font-weight: 500; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, #e5e7eb); }
.cost-table td { padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1, #eef0f2); font-variant-numeric: tabular-nums; }
.cost-dock { font-size: 12px; color: var(--dsw-alias-label-secondary, #5b6472); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; line-height: 1; }
.cost-seg { display: inline-flex; align-items: center; gap: 6px; padding-right: 2px; }
.cost-seg + .cost-seg::before { content: ""; display: inline-block; width: 1px; height: 14px; margin-right: 6px; background: var(--dsw-alias-border-l2, #d1d5db); vertical-align: middle; }
.cost-pill { display: inline-flex; align-items: center; gap: 6px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); background: var(--dsw-alias-bg-layer-2, #f3f4f6); line-height: 1.3; }
.cost-dock-main { color: var(--dsw-alias-label-primary, #171a1f); font-weight: 500; font-variant-numeric: tabular-nums; letter-spacing: 0.2px; }
.cost-pill-sub { font-variant-numeric: tabular-nums; }
.cost-chip { display: inline-block; padding: 1px 7px; border-radius: 999px; font-size: 11px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); color: var(--dsw-alias-label-secondary, #5b6472); background: var(--dsw-alias-bg-layer-1, #fff); font-variant-numeric: tabular-nums; }
.cost-pill-sub-badge { border-color: var(--dsw-alias-state-warn-primary, #d97706); color: var(--dsw-alias-state-warn-primary, #d97706); background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #d97706) 8%, transparent); font-weight: 500; }
.cost-model-toggle { padding: 1px 6px; font-size: 11px; line-height: 1.4; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2, #d1d5db); background: transparent; color: var(--dsw-alias-label-secondary, #5b6472); cursor: pointer; }
.cost-model-toggle:hover { background: var(--dsw-alias-bg-layer-2, #f3f4f6); }
.cost-chart-host { position: relative; }
.cost-tip { position: absolute; top: 4px; background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 10px; padding: 9px 12px; box-shadow: 0 6px 20px rgba(15, 23, 42, .10); font-size: 12px; pointer-events: none; white-space: nowrap; z-index: 10; }
.cost-tip-title { display: flex; justify-content: space-between; align-items: baseline; gap: 20px; font-weight: 600; margin-bottom: 5px; }
.cost-tip-title .cost-tip-total { font-variant-numeric: tabular-nums; }
.cost-tip-row { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
.cost-tip-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; flex: none; }
.cost-tip-name { flex: 1; color: var(--dsw-alias-label-secondary, #5b6472); padding-right: 20px; }
.cost-tip-val { font-variant-numeric: tabular-nums; text-align: right; }
/* 用量热力图（Codex 风格 26 周方格） */
.cost-ug { display: flex; flex-direction: column; gap: 12px; }
.cost-ug-total { font-size: 13px; color: var(--dsw-alias-label-primary, #171a1f); }
.cost-ug-grid { display: grid; grid-auto-flow: column; grid-template-rows: repeat(7, auto); gap: 3px; width: 100%; }
.cost-ug-cell { width: 100%; aspect-ratio: 1/1; border-radius: 3px; box-sizing: border-box; background: color-mix(in srgb, var(--dsw-alias-label-primary, #171a1f) 8%, transparent); border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); cursor: default; }
.cost-ug-cell.l1 { background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 25%, var(--dsw-alias-bg-layer-3, #eef0f3)); border-color: transparent; }
.cost-ug-cell.l2 { background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 50%, var(--dsw-alias-bg-layer-3, #eef0f3)); border-color: transparent; }
.cost-ug-cell.l3 { background: color-mix(in srgb, var(--dsw-alias-state-business-primary, #4176e6) 75%, var(--dsw-alias-bg-layer-3, #eef0f3)); border-color: transparent; }
.cost-ug-cell.l4 { background: var(--dsw-alias-state-business-primary, #4176e6); border-color: transparent; }
.cost-ug-cell.today { outline: 1px solid var(--dsw-alias-label-secondary, #6b7280); outline-offset: 1px; }
.cost-ug-months { display: grid; grid-auto-flow: column; gap: 3px; width: 100%; font-size: 10px; color: var(--dsw-alias-label-tertiary, #9ca3af); margin-top: 4px; }
.cost-ug-month { white-space: nowrap; }
.cost-ug-host { position: relative; }
.cost-ug-tip { position: absolute; background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 10px; padding: 9px 12px; box-shadow: 0 6px 20px rgba(15, 23, 42, .10); font-size: 12px; pointer-events: none; white-space: nowrap; z-index: 10; }
.cost-ug-tip-total { font-weight: 600; font-variant-numeric: tabular-nums; margin-bottom: 4px; }
.cost-ug-tip-row { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
.cost-ug-tip-name { flex: 1; color: var(--dsw-alias-label-secondary, #5b6472); padding-right: 16px; }
.cost-ug-tip-val { font-variant-numeric: tabular-nums; text-align: right; }
/* 峰谷时段条（侧边栏 / 设置面板）——对标 dsh-cost-meter */
.cost-ps { display: flex; align-items: center; gap: 6px; min-width: 0; flex-wrap: wrap; }
.cost-ps-stack { flex-direction: column; align-items: stretch; gap: 4px; }
/* 双行紧凑：column 布局下轨道的 flex-basis(72px) 会落到纵轴变成高度，须收回，保持与单行一致的 6px 细条 */
.cost-ps-stack .cost-ps-track { flex: 0 0 auto; width: 100%; min-width: 0; }
.cost-ps-track { position: relative; display: flex; flex: 1 1 72px; min-width: 72px; height: 6px; border-radius: 999px; overflow: hidden; border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); background: var(--dsw-alias-bg-layer-3, #eef0f3); }
.cost-ps-seg { height: 100%; flex: 1; }
/* 单行紧凑：24h 比例轨道（橙=高峰/蓝=平价按窗口比例绝对定位，白线=实时进度） */
.cost-ps-track .cost-ps-seg { position: absolute; top: 0; bottom: 0; flex: none; }
.cost-ps-peakseg { background: #ff9800; }
.cost-ps-offseg { background: var(--dsw-alias-state-business-primary, #4176e6); }
.cost-ps-marker { position: absolute; top: 0; left: 50%; width: 2px; height: 100%; background: var(--dsw-alias-bg-base, #fff); box-shadow: 0 0 0 1px var(--dsw-alias-label-tertiary, #9ca3af); transform: translateX(-50%); transition: left .4s ease; z-index: 2; }
.cost-ps-chip { font-size: 11px; font-weight: 600; line-height: 1.2; white-space: nowrap; color: var(--dsw-alias-label-secondary, #5b6472); }
.cost-ps.peak .cost-ps-chip { color: #ff9800; }
.cost-ps.off .cost-ps-chip { color: var(--dsw-alias-state-business-primary, #4176e6); }
.cost-ps.weekend .cost-ps-chip { color: #34a853; }
.cost-ps-foot { font-size: 11px; color: var(--dsw-alias-label-tertiary, #9ca3af); white-space: nowrap; }
/* 环形表盘（classic 改造）：24h 中空圆环，蓝=平价、橙=高峰、绿=周末 */
.cost-ps-ring { flex-direction: column; align-items: center; justify-content: center; gap: 4px; }
.cost-ps-ring svg { display: block; max-width: 100%; }
.cost-ps-ringfoot { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: center; }
/* 窄栏（rail）态：只显示竖排短词 */
.cost-ps-rail { display: inline-flex; flex-direction: column; gap: 1px; }
.cost-ps-rail .cost-ps-word { font-size: 10px; font-weight: 600; line-height: 1.1; white-space: nowrap; color: var(--dsw-alias-label-secondary, #5b6472); }
.cost-ps-rail.peak .cost-ps-word { color: #ff9800; }
.cost-ps-rail.off .cost-ps-word { color: var(--dsw-alias-state-business-primary, #4176e6); }
.cost-ps-rail.weekend .cost-ps-word { color: #34a853; }
/* 侧边栏底部(sidebar.footer.action)多插件 UI 兼容：
   DSH 渲染器把该槽锚点设为 display:contents(见 dsh-client-ui-renderer ANCHOR_STYLE)，
   多个插件内容会被并进同一行(如与 linxin666/dsh-web-ui-all 冲突)；改为纵向堆叠即可共存。
   采用稳定 data-slot 选择器，收起(rail)态仅显示短词、内容极窄，天然不受影响。 */
[data-slot="sidebar.footer.action"] { display: flex !important; flex-direction: column !important; align-items: stretch !important; gap: 4px !important; flex: 1 1 auto !important; min-width: 0 !important; }
/* 峰谷切换前弹窗 */
.cost-pa { position: fixed; z-index: 9999; width: 340px; max-width: calc(100vw - 32px); padding: 14px 16px; border-radius: 14px; background: var(--dsw-alias-bg-layer-2, #fff); border: 1px solid var(--dsw-alias-border-l2, #d1d5db); box-shadow: 0 14px 36px rgba(0,0,0,.22); display: flex; flex-direction: column; gap: 8px; font-size: 13px; animation: cost-pa-in .22s cubic-bezier(.2,.8,.2,1); }
.cost-pa.cost-pa-corner { right: 20px; bottom: 20px; }
.cost-pa.cost-pa-center { top: 50%; left: 50%; transform: translate(-50%,-50%); animation-name: cost-pa-in-center; }
.cost-pa-peak { border-top: 3px solid var(--dsw-alias-state-warn-primary, #d97706); }
.cost-pa-offpeak { border-top: 3px solid var(--dsw-alias-state-info-primary, #3b82f6); }
.cost-pa-badge { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; font-weight: 600; letter-spacing: .4px; text-transform: uppercase; }
.cost-pa-badge::before { content: ""; width: 8px; height: 8px; border-radius: 50%; background: currentColor; box-shadow: 0 0 0 4px color-mix(in srgb, currentColor 16%, transparent); }
.cost-pa-peak .cost-pa-badge { color: var(--dsw-alias-state-warn-primary, #d97706); }
.cost-pa-offpeak .cost-pa-badge { color: var(--dsw-alias-state-info-primary, #3b82f6); }
.cost-pa-title { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary, #171a1f); }
.cost-pa-body { color: var(--dsw-alias-label-secondary, #5b6472); line-height: 1.55; }
.cost-pa-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
@keyframes cost-pa-in { from { opacity: 0; transform: translateY(10px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }
@keyframes cost-pa-in-center { from { opacity: 0; transform: translate(-50%, calc(-50% + 10px)); } to { opacity: 1; transform: translate(-50%,-50%); } }
/* ---------- 云端同步与三态视图 ---------- */
.cost-cloudnote { margin-top: 6px; font-size: 12px; color: var(--dsw-alias-state-warn-primary, #d97706); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cost-matrix { margin-top: 8px; border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 8px; overflow: hidden; font-size: 12px; }
.cost-matrix-row { display: flex; align-items: center; gap: 8px; padding: 5px 10px; border-top: 1px solid var(--dsw-alias-border-l2, #f1f3f6); }
.cost-matrix-row:first-child { border-top: none; }
.cost-matrix-head { background: var(--dsw-alias-bg-layer-2, #f7f8fa); color: var(--dsw-alias-label-secondary, #5b6472); font-weight: 600; }
.cost-matrix-key { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cost-matrix-num { flex: 0 0 88px; text-align: right; font-variant-numeric: tabular-nums; }
.cost-matrix-note { flex: 0 0 110px; text-align: right; color: var(--dsw-alias-label-tertiary, #9ca3af); }
.cost-matrix-total { font-weight: 650; }
.cost-sync-ro { display: grid; grid-template-columns: 132px 1fr; gap: 5px 10px; font-size: 12px; margin-top: 8px; }
.cost-sync-ro .k { color: var(--dsw-alias-label-secondary, #5b6472); }
.cost-sync-ro .v { word-break: break-all; }
.cost-sync-card { border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 10px; padding: 12px 14px; margin-top: 8px; }
.cost-sync-fields { display: grid; grid-template-columns: 132px 1fr; gap: 8px 10px; align-items: center; font-size: 12px; margin-top: 10px; }
.cost-sync-fields .k { color: var(--dsw-alias-label-secondary, #5b6472); }
.cost-sync-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
.cost-sync-state { margin-top: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary, #5b6472); }
/* 插件配置卡片外壳：照搬宿主 PluginCard 的设计 token 与结构，保证与「插件市场」等卡片同款 */
.cost-pcard { border: .5px solid var(--dsw-alias-border-l4, #e5e7eb); background: var(--dsw-alias-bg-layer-3, transparent); border-radius: 16px; list-style: none; margin: 0; transition: border-color .16s, background .16s; }
.cost-pcard:hover { border-color: var(--dsw-alias-label-dimmed, #9aa3af); }
.cost-pcard.is-open { background: var(--dsw-alias-bg-layer-2, transparent); border-color: var(--dsw-alias-label-dimmed, #9aa3af); }
.cost-pcard-head { appearance: none; width: 100%; font: inherit; color: inherit; text-align: left; cursor: pointer; background: none; border: 0; border-radius: 12px; display: flex; align-items: center; gap: 12px; padding: 14px 16px; }
.cost-pcard-head:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary, #2563eb); outline-offset: -2px; }
.cost-pcard-headtext { display: flex; flex-direction: column; flex: 1; gap: 4px; min-width: 0; }
.cost-pcard-name { color: var(--dsw-alias-label-primary, #171a1f); font-size: 15px; font-weight: 600; line-height: 1.4; }
.cost-pcard-desc { color: var(--dsw-alias-label-tertiary, #8b93a1); font-size: 13px; line-height: 1.5; }
.cost-pcard-chevron { color: var(--dsw-alias-label-tertiary, #8b93a1); flex: none; transition: transform .16s; }
.cost-pcard-chevron.is-open { transform: rotate(180deg); }
.cost-pcard-body { border-top: .5px solid var(--dsw-alias-border-l2, #e5e7eb); margin: 0 16px; padding: 12px 0 10px; }
`;
			const tag = document.createElement("style");
			tag.setAttribute("data-plugin-css", "cost-tracker-plugin");
			tag.textContent = css;
			document.head.appendChild(tag);
			ctx.effect(() => () => { tag.remove(); }, "cost-tracker: styles");
		}

		function pluginIcon(size) {
			const s = size || 16;
			return e("svg", {
				className: "cost-icon", width: s, height: s, viewBox: "0 0 16 16",
				fill: "none", xmlns: "http://www.w3.org/2000/svg", "aria-hidden": "true",
			},
				e("rect", { x: 1.5, y: 8.6, width: 3.1, height: 5.9, rx: 0.9, fill: "currentColor" }),
				e("rect", { x: 5.9, y: 5.2, width: 3.1, height: 9.3, rx: 0.9, fill: "currentColor" }),
				e("g", { fill: "none", stroke: "currentColor", strokeWidth: 1.3, strokeLinecap: "round", strokeLinejoin: "round" },
					e("path", { d: "M10.7 4.9 L12.3 7.2 L13.9 4.9" }),
					e("path", { d: "M12.3 7.2 L12.3 10.9" }),
					e("path", { d: "M10.9 7.8 L13.7 7.8" }),
					e("path", { d: "M10.9 9.5 L13.7 9.5" })));
		}

		function fmtInt(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ","); }
		function fmtMoney(n) {
			const x = Number(n) || 0;
			const s = Math.abs(x) >= 1 ? x.toFixed(2) : x.toFixed(4);
			const parts = s.split(".");
			parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",");
			return parts.join(".");
		}
		function fmtCompact(n) {
			n = Number(n) || 0;
			if (n >= 1000000) return (n / 1000000).toFixed(1) + "M";
			if (n >= 1000) return (n / 1000).toFixed(1) + "K";
			return String(Math.round(n));
		}
		// 热力图 token 显示：<1000 原样；≥1000 用 K（≥100 时取整），≥1000000 用 M（≥100 时取整）
		function fmtTokens(n) {
			const v = Math.max(0, Number(n) || 0);
			const scaled = (x) => (x >= 100 ? String(Math.round(x)) : String(Math.round(x * 10) / 10));
			if (v < 1000) return String(Math.round(v));
			if (v < 1000000) return scaled(v / 1000) + "K";
			return scaled(v / 1000000) + "M";
		}
		function fmtAxisMoney(v) {
			if (v <= 0) return "0";
			if (v >= 1000) return (v / 1000).toFixed(1) + "k";
			if (v >= 100) return String(Math.round(v));
			if (v >= 1) return v.toFixed(1);
			return v.toFixed(2);
		}
		function fmtTickInt(v) { return v >= 1000 ? fmtCompact(v) : String(Math.round(v)); }
		/** 绝对时间标签：MM-DD HH:mm（本地时区） */
		function fmtClock(ts) {
			const d = new Date(Number(ts) || 0);
			const p = (n) => String(n).padStart(2, "0");
			return p(d.getMonth() + 1) + "-" + p(d.getDate()) + " " + p(d.getHours()) + ":" + p(d.getMinutes());
		}
		/**
		 * 人类可读的时间标签（「上次同步 / 云端数据时间」都用它）。
		 * 一天内给相对时间（刚刚 / N 分钟前 / N 小时前），更早给 MM-DD HH:mm。
		 * 注意：v1.8.0/v1.8.1 里这个函数被引用却从未定义 —— 只有在首次同步成功
		 * （lastSyncAt > 0）之后才会执行到，于是「一保存配置、同步一成功，客户端渲染
		 * 就抛 ReferenceError、两个面板同时消失」。补上定义即修复。
		 */
		function timeLabel(ts) {
			const t = Number(ts) || 0;
			if (t <= 0) return "从未";
			const diff = Date.now() - t;
			if (diff < 0) return fmtClock(t);
			const min = Math.floor(diff / 60000);
			if (min < 1) return "刚刚";
			if (min < 60) return min + " 分钟前";
			const hr = Math.floor(min / 60);
			if (hr < 24) return hr + " 小时前";
			return fmtClock(t);
		}
		// 档位文案。官方**只有两档**：peak = 高峰（工作日 9-12 / 14-18），off-peak = 闲时（高峰 × 0.5，含周末全天）。
		// flat 不是「第三个时段」，而是「这笔计价不分峰谷」（订阅套餐、非 DeepSeek provider 的兜底价、
		// 未识别模型的通用兜底价：price.tiered === false）。此前译作「平峰」——电价语境里「平段」指峰谷
		// 之间的那一档，会让人以为 DeepSeek 有三个时段，故改为「不分峰谷」。
		function periodText(p) { return p === "peak" ? "高峰" : p === "off-peak" ? "闲时" : "不分峰谷"; }
		function shortModel(m) { const i = m.lastIndexOf("/"); return i >= 0 ? m.slice(i + 1) : m; }
		// 订阅套餐友好名称：kimi-coding / kimi → Kimi Coding Plan，其余保留 provider 名
		function subPlanName(p) {
			const np = String(p || "").toLowerCase().replace(/-official$/, "");
			if (np === "kimi-coding" || np === "kimi") return "Kimi Coding Plan";
			return np || "订阅";
		}
		function countdown(resetTime, now) {
			const t = Date.parse(resetTime);
			if (!t) return "";
			let ms = t - now;
			if (ms <= 0) return "即将重置";
			const d = Math.floor(ms / 86400000); ms -= d * 86400000;
			const h = Math.floor(ms / 3600000); ms -= h * 3600000;
			const m = Math.floor(ms / 60000);
			return (d > 0 ? d + " 天 " : "") + h + " 小时 " + m + " 分钟后重置";
		}
		function windowLabel(w) {
			if (w.timeUnit === "TIME_UNIT_MINUTE") {
				return (w.duration >= 60 ? (Math.round(w.duration / 6) / 10) + " 小时" : w.duration + " 分钟") + "滚动窗口限额";
			}
			if (w.timeUnit === "TIME_UNIT_HOUR") return w.duration + " 小时滚动窗口限额";
			if (w.timeUnit === "TIME_UNIT_DAY") return w.duration + " 天滚动窗口限额";
			return w.duration + " " + (w.timeUnit || "") + " 窗口限额";
		}

		function legendRow(segs) {
			return e("div", { className: "cost-legend" }, segs.map((s, i) =>
				e("span", { key: i }, e("span", { className: "cost-dot", style: { background: s.color } }), s.name)));
		}

		function StackedBarsChart(props) {
			const labels = props.labels;
			const titles = props.titles || props.labels;
			const segs = props.segs;
			const rows = props.rows;
			const daySegs = props.daySegs; // 可选：按天预排好的段列表 [{name,color,value}]（大段在前/底部）
			const fmtY = props.fmtY;
			const fmtValue = props.fmtValue || props.fmtY;
			const [hover, setHover] = useState(-1);
			const W = 640, H = 200, ml = 44, mr = 6, mt = 8, mb = 20;
			const pw = W - ml - mr, ph = H - mt - mb;
			const n = daySegs ? daySegs.length : rows.length;
			const perDay = (i) => daySegs ? daySegs[i] : rows[i].map((v, j) => ({ name: segs[j].name, color: segs[j].color, value: v }));
			let max = 0;
			for (let i = 0; i < n; i++) { let s = 0; for (const sg of perDay(i)) s += sg.value; if (s > max) max = s; }
			if (max <= 0) max = 1;
			const step = n > 0 ? pw / n : 0;
			const children = [];
			const ticks = [0, max / 2, max];
			for (let ti = 0; ti < 3; ti++) {
				const t = ticks[ti];
				const y = mt + ph - (t / max) * ph;
				children.push(e("line", { key: "g" + ti, x1: ml, y1: y, x2: W - mr, y2: y, strokeWidth: 1, style: { stroke: GRID } }));
				children.push(e("text", { key: "t" + ti, x: ml - 5, y: y + 3, textAnchor: "end", fontSize: 10, style: { fill: INK2 } }, fmtY(t)));
			}
			if (n > 0) {
				const bw = Math.max(2, Math.min(36, step * 0.55));
				const stride = Math.max(1, Math.ceil(n / 6));
				for (let i = 0; i < n; i++) {
					let acc = 0;
					const x = ml + i * step + (step - bw) / 2;
					const r = perDay(i);
					for (let j = 0; j < r.length; j++) {
						const v = r[j].value;
						if (v > 0) {
							const h = Math.max(0.6, (v / max) * ph);
							const y = mt + ph - ((acc + v) / max) * ph;
							children.push(e("rect", { key: "b" + i + "-" + j, x: x, y: y, width: bw, height: h, rx: 1, style: { fill: r[j].color } }));
						}
						acc += v;
					}
					if (i % stride === 0 || i === n - 1) {
						children.push(e("text", { key: "x" + i, x: ml + i * step + step / 2, y: H - 5, textAnchor: "middle", fontSize: 10, style: { fill: INK2 } }, labels[i]));
					}
				}
			}
			if (hover >= 0 && hover < n) {
				const ix = ml + hover * step + step / 2;
				children.push(e("line", { key: "hover", x1: ix, y1: mt, x2: ix, y2: mt + ph, strokeDasharray: "3 3", strokeWidth: 1, style: { stroke: INK2 } }));
			}
			function onMove(ev) {
				if (n <= 0) { setHover(-1); return; }
				const rect = ev.currentTarget.getBoundingClientRect();
				const vx = (ev.clientX - rect.left) / rect.width * W;
				const i = Math.floor((vx - ml) / step);
				setHover(i >= 0 && i < n ? i : -1);
			}
			function onLeave() { setHover(-1); }
			let tip = null;
			if (hover >= 0 && hover < n) {
				const row = perDay(hover);
				let total = 0;
				for (const sg of row) total += sg.value;
				const segRows = [];
				for (let j = 0; j < row.length; j++) {
					const sg = row[j];
					if (sg.value <= 0) continue;
					segRows.push(e("div", { key: j, className: "cost-tip-row" },
						e("span", { className: "cost-tip-dot", style: { background: sg.color } }),
						e("span", { className: "cost-tip-name" }, sg.name),
						e("span", { className: "cost-tip-val" }, fmtValue(sg.value))));
				}
				const pct = (ml + hover * step + step / 2) / W * 100;
				const flip = pct > 62;
				tip = e("div", { className: "cost-tip", style: { left: pct + "%", transform: flip ? "translateX(calc(-100% - 8px))" : "translateX(8px)" } },
					e("div", { className: "cost-tip-title" },
						e("span", null, titles[hover] !== undefined ? titles[hover] : labels[hover]),
						e("span", { className: "cost-tip-total" }, fmtValue(total))),
					segRows);
			}
			return e("div", { className: "cost-chart-host", onMouseMove: onMove, onMouseLeave: onLeave },
				e("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", preserveAspectRatio: "xMidYMid meet" }, children),
				tip);
		}

		function AreaChart(props) {
			const labels = props.labels;
			const titles = props.titles || props.labels;
			const values = props.values;
			const fmtY = props.fmtY;
			const fmtValue = props.fmtValue || props.fmtY;
			const valueLabel = props.valueLabel || "";
			const gid = props.gid;
			const [hover, setHover] = useState(-1);
			const W = 640, H = 180, ml = 40, mr = 6, mt = 8, mb = 20;
			const pw = W - ml - mr, ph = H - mt - mb;
			const n = values.length;
			let max = 0;
			for (const v of values) if (v > max) max = v;
			if (max <= 0) max = 1;
			const stepX = n > 1 ? pw / (n - 1) : 0;
			const children = [];
			const ticks = [0, max / 2, max];
			for (let ti = 0; ti < 3; ti++) {
				const t = ticks[ti];
				const y = mt + ph - (t / max) * ph;
				children.push(e("line", { key: "g" + ti, x1: ml, y1: y, x2: W - mr, y2: y, strokeWidth: 1, style: { stroke: GRID } }));
				children.push(e("text", { key: "t" + ti, x: ml - 5, y: y + 3, textAnchor: "end", fontSize: 10, style: { fill: INK2 } }, fmtY(t)));
			}
			const pts = [];
			if (n > 0) {
				for (let i = 0; i < n; i++) {
					pts.push({ x: n > 1 ? ml + i * stepX : ml + pw / 2, y: mt + ph - (values[i] / max) * ph });
				}
				let line = "";
				for (let i = 0; i < pts.length; i++) line += (i === 0 ? "M" : "L") + pts[i].x.toFixed(1) + " " + pts[i].y.toFixed(1);
				const base = mt + ph;
				const area = line + "L" + pts[pts.length - 1].x.toFixed(1) + " " + base + "L" + pts[0].x.toFixed(1) + " " + base + "Z";
				children.push(e("defs", { key: "d" }, e("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
					e("stop", { offset: "0%", style: { stopColor: BLUE, stopOpacity: 0.3 } }),
					e("stop", { offset: "100%", style: { stopColor: BLUE, stopOpacity: 0.02 } }))));
				children.push(e("path", { key: "a", d: area, style: { fill: "url(#" + gid + ")" } }));
				children.push(e("path", { key: "l", d: line, fill: "none", strokeWidth: 1.5, style: { stroke: BLUE } }));
				if (n === 1) children.push(e("circle", { key: "p0", cx: pts[0].x, cy: pts[0].y, r: 2.5, style: { fill: BLUE } }));
				const stride = Math.max(1, Math.ceil(n / 6));
				for (let i = 0; i < n; i++) {
					if (i % stride === 0 || i === n - 1) {
						children.push(e("text", { key: "x" + i, x: pts[i].x, y: H - 5, textAnchor: "middle", fontSize: 10, style: { fill: INK2 } }, labels[i]));
					}
				}
			}
			if (hover >= 0 && hover < n) {
				const px = pts[hover].x, py = pts[hover].y;
				children.push(e("line", { key: "hover", x1: px, y1: mt, x2: px, y2: mt + ph, strokeDasharray: "3 3", strokeWidth: 1, style: { stroke: INK2 } }));
				children.push(e("circle", { key: "hoverdot", cx: px, cy: py, r: 3.5, strokeWidth: 2, style: { fill: BLUE, stroke: "var(--dsw-alias-bg-layer-1, #fff)" } }));
			}
			function onMove(ev) {
				if (n <= 0) { setHover(-1); return; }
				if (n === 1) { setHover(0); return; }
				const rect = ev.currentTarget.getBoundingClientRect();
				const vx = (ev.clientX - rect.left) / rect.width * W;
				const i = Math.round((vx - ml) / stepX);
				setHover(i >= 0 && i < n ? i : -1);
			}
			function onLeave() { setHover(-1); }
			let tip = null;
			if (hover >= 0 && hover < n) {
				const pct = pts[hover].x / W * 100;
				const flip = pct > 62;
				tip = e("div", { className: "cost-tip", style: { left: pct + "%", transform: flip ? "translateX(calc(-100% - 8px))" : "translateX(8px)" } },
					e("div", { className: "cost-tip-title" },
						e("span", null, titles[hover] !== undefined ? titles[hover] : labels[hover])),
					e("div", { className: "cost-tip-row" },
						e("span", { className: "cost-tip-dot", style: { background: BLUE } }),
						e("span", { className: "cost-tip-name" }, valueLabel),
						e("span", { className: "cost-tip-val" }, fmtValue(values[hover]))));
			}
			return e("div", { className: "cost-chart-host", onMouseMove: onMove, onMouseLeave: onLeave },
				e("svg", { viewBox: "0 0 " + W + " " + H, width: "100%", preserveAspectRatio: "xMidYMid meet" }, children),
				tip);
		}

		function progressBar(label, used, limit, remaining, resetTime, now) {
			const pct = limit > 0 ? Math.min(100, Math.round(used / limit * 100)) : 0;
			const color = pct >= 90 ? RED : pct >= 70 ? AMBER : BLUE;
			return e("div", { style: { marginTop: "10px" } },
				e("div", { className: "cost-row" },
					e("span", { className: "cost-hint" }, label),
					e("span", { className: "cost-spacer" }),
					e("span", { style: { fontVariantNumeric: "tabular-nums" } }, fmtInt(used) + " / " + fmtInt(limit) + " · " + pct + "%")),
				e("div", { className: "cost-bar-track" },
					e("div", { className: "cost-bar-fill", style: { width: Math.max(pct, used > 0 ? 1 : 0) + "%", background: color } })),
				e("div", { className: "cost-hint", style: { marginTop: "4px" } }, "剩余 " + fmtInt(remaining) + (resetTime ? " · " + countdown(resetTime, now) : "")));
		}

		function statCard(title, value, sub) {
			return e("div", { className: "cost-card" },
				e("div", { className: "cost-card-title" }, title),
				e("div", { className: "cost-card-value" }, value),
				e("div", { className: "cost-card-sub" }, sub));
		}

		// ---------- 三态视图：本机 / 本机+云端 / 仅云端 ----------
		// 数据源归一与相加逻辑在 view.js（纯函数，node 可独立测试）；
		// 这里只负责取数、切视图与渲染，渲染逻辑对三种视图完全不分叉。
		function requireLocal(id, fallback) {
			try { return require(id) } catch (e) { return fallback || {} }
		}
		// ---- 三态视图纯逻辑：bundle 必须自带一份完整实现 ----
		// 宿主的客户端模块加载器只会加载本插件的**客户端 bundle**（client.js）；view.js 是宿主侧
		// ESM 模块，浏览器里 require("./view") 必然取不到。1.8.0~1.8.2 在这里退化成了只含「本机」
		// 的空桩 —— 三态开关只剩一个按钮，而且 normalizeCloudDash / mergeDash 被空实现顶掉，
		// 即便云端数据取回来也永远合并不进来（表现为「只有本机这个选项」）。
		// 现在把 view.js 的纯逻辑完整内联为兜底值：取不到模块时行为与 view.js 完全一致；
		// 两者的一致性由 test/client-render.test.js「有无 view 模块渲染结果必须完全相同」钉住。
		function vZeroSlice() { return { real: 0, calls: 0, tokens: 0, sub: 0, subCalls: 0, subTokens: 0 }; }
		function vR2(x) { return Math.round((Number(x) || 0) * 100) / 100; }
		function vAddSlice(a, b) {
			const x = a || vZeroSlice(), y = b || vZeroSlice();
			return {
				real: (x.real || 0) + (y.real || 0),
				calls: (x.calls || 0) + (y.calls || 0),
				tokens: (x.tokens || 0) + (y.tokens || 0),
				sub: (x.sub || 0) + (y.sub || 0),
				subCalls: (x.subCalls || 0) + (y.subCalls || 0),
				subTokens: (x.subTokens || 0) + (y.subTokens || 0),
			};
		}
		/** 把云端返回补齐成本地 buildDashboard 形状（缺字段一律 0，避免渲染时报错）
		 *
		 *  ⚠️ 字段名必须**逐项映射**，不能只靠 Object.assign 透传：
		 *   · 云端 overview/plugin-view 的按量金额叫 `realCost`、订阅等效叫 `subEquivalent`，
		 *     而本地 buildDashboard 与所有卡片读的是 `real` / `sub`；
		 *   · 归一化函数此前把整个对象重建，只搬运 today/month/all/byDay/byModel/…，
		 *     于是 `summary.realCost`、`today.real` 一起丢掉 —— 卡片与底部汇总行双双显示
		 *     ¥0.0000，而「调用次数 / Tokens」因为两边同名（calls/tokens）显示正常。
		 *     这个组合（次数对、金额 0）就是「仅云端只有次数没有费用」的根因。
		 */
		function vCloudSlices(cloud) {
			// 概览口径：realCost/subEquivalent；插件形状口径：real/sub。两种都接受。
			const pick = (s) => {
				if (!s) return null;
				return Object.assign(vZeroSlice(), s, {
					real: Number(s.real != null ? s.real : (s.realCost != null ? s.realCost : 0)) || 0,
					sub: Number(s.sub != null ? s.sub : (s.subCost != null ? s.subCost : (s.subEquivalent != null ? s.subEquivalent : 0))) || 0,
					calls: Number(s.calls) || 0,
					tokens: Number(s.tokens) || 0,
					subCalls: Number(s.subCalls) || 0,
					subTokens: Number(s.subTokens) || 0,
				});
			};
			const all = pick(cloud.all) || vZeroSlice();
			const allRaw = cloud.all || {};
			const summary = cloud.summary || {};
			const summaryMapped = {
				real: Number(summary.real != null ? summary.real : (summary.realCost != null ? summary.realCost : all.real)) || 0,
				realCalls: Number(summary.realCalls != null ? summary.realCalls : (allRaw.calls != null ? allRaw.calls : all.calls)) || 0,
				realTokens: Number(summary.realTokens != null ? summary.realTokens : (allRaw.tokens != null ? allRaw.tokens : all.tokens)) || 0,
				sub: Number(summary.sub != null ? summary.sub : (summary.subEquivalent != null ? summary.subEquivalent : summary.subCost != null ? summary.subCost : all.sub)) || 0,
				subCalls: Number(summary.subCalls != null ? summary.subCalls : all.subCalls) || 0,
				subTokens: Number(summary.subTokens != null ? summary.subTokens : all.subTokens) || 0,
				cost: Number(summary.cost != null ? summary.cost : all.real + all.sub) || 0,
				calls: Number(summary.calls != null ? summary.calls : all.calls + all.subCalls) || 0,
				tokens: Number(summary.tokens != null ? summary.tokens : all.tokens + all.subTokens) || 0,
				peakCost: Number(summary.peakCost != null ? summary.peakCost : 0) || 0,
				offCost: Number(summary.offCost != null ? summary.offCost : 0) || 0,
				flatCost: Number(summary.flatCost != null ? summary.flatCost : 0) || 0,
				driftAbs: Number(summary.driftAbs) || 0,
				estimatedRows: Number(summary.estimatedRows) || 0,
				input: Number(summary.input) || 0,
				output: Number(summary.output) || 0,
				cacheRead: Number(summary.cacheRead) || 0,
				cacheWrite: Number(summary.cacheWrite) || 0,
				reasoning: Number(summary.reasoning) || 0,
			};
			return { today: pick(cloud.today) || vZeroSlice(), month: pick(cloud.month) || vZeroSlice(), all, summary: summaryMapped };
		}
		function vNormalizeCloudDash(cloud, fallbackDays) {
			if (!cloud || cloud.ok === false) return null;
			const s = vCloudSlices(cloud);
			// 最近记录：云端 recent 的字段名与本地一致（{ts,time,...}），本地 mock 也走同一契约
			return Object.assign({}, cloud, {
				days: cloud.days || fallbackDays || 7,
				today: s.today,
				month: s.month,
				all: s.all,
				summary: s.summary,
				byDay: cloud.byDay || [],
				byModel: cloud.byModel || [],
				byModelDay: (cloud.byModelDay || []).map((m) => Object.assign({}, m, {
					days: (m.days || []).map((d) => Object.assign({ calls: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }, d)),
				})),
				recent: cloud.recent || [],
				devices: cloud.devices || [],
				sources: cloud.sources || [],
			});
		}
		/** 合并两份 buildDashboard 形状的数据（本地 + 云端_排除本机 = 全网，本机恰好计一次） */
		function vMergeDash(local, cloud) {
			if (!local) return cloud;
			if (!cloud) return local;
			const byDayMap = new Map();
			for (const d of (local.byDay || [])) byDayMap.set(d.date, { date: d.date, label: d.label, peak: d.peak || 0, off: d.off || 0, flat: d.flat || 0 });
			for (const d of (cloud.byDay || [])) {
				const cur = byDayMap.get(d.date) || { date: d.date, label: d.label, peak: 0, off: 0, flat: 0 };
				cur.peak += d.peak || 0; cur.off += d.off || 0; cur.flat += d.flat || 0;
				byDayMap.set(d.date, cur);
			}
			const byModelMap = new Map();
			const addModel = (m) => {
				const cur = byModelMap.get(m.model) || { model: m.model, subscription: !!m.subscription, estimated: !!m.estimated, calls: 0, tokens: 0, cost: 0 };
				cur.calls += m.calls || 0; cur.tokens += m.tokens || 0; cur.cost += m.cost || 0;
				cur.subscription = cur.subscription && !!m.subscription;
				cur.estimated = cur.estimated || !!m.estimated;
				byModelMap.set(m.model, cur);
			};
			for (const m of (local.byModel || [])) addModel(m);
			for (const m of (cloud.byModel || [])) addModel(m);
			// byModelDay：以日期为并集键合并，保证图表按天轴拼得上
			const byModelDayMap = new Map();
			const addModelDay = (m) => {
				const cur = byModelDayMap.get(m.model) || { model: m.model, subscription: !!m.subscription, estimated: !!m.estimated, days: new Map() };
				for (const d of (m.days || [])) {
					const cell = cur.days.get(d.date) || { date: d.date, label: d.label, calls: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
					cell.calls += d.calls || 0; cell.tokens += d.tokens || 0; cell.input += d.input || 0; cell.output += d.output || 0;
					cell.cacheRead += d.cacheRead || 0; cell.cacheWrite += d.cacheWrite || 0; cell.cost += d.cost || 0;
					cur.days.set(d.date, cell);
				}
				byModelDayMap.set(m.model, cur);
			};
			for (const m of (local.byModelDay || [])) addModelDay(m);
			for (const m of (cloud.byModelDay || [])) addModelDay(m);
			const dates = Array.from(byDayMap.keys()).sort();
			const byModelDay = Array.from(byModelDayMap.values()).map((m) => Object.assign({}, m, {
				days: dates.map((d) => m.days.get(d) || { date: d, label: byDayMap.get(d).label, calls: 0, tokens: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 }),
			}));
			return Object.assign({}, local, {
				source: "merged",
				realCost: vR2((local.realCost || 0) + (cloud.realCost || 0)),
				realCalls: (local.realCalls || 0) + (cloud.realCalls || 0),
				realTokens: (local.realTokens || 0) + (cloud.realTokens || 0),
				subEquivalent: vR2((local.subEquivalent || 0) + (cloud.subEquivalent || 0)),
				subCalls: (local.subCalls || 0) + (cloud.subCalls || 0),
				subTokens: (local.subTokens || 0) + (cloud.subTokens || 0),
				peakCost: vR2((local.peakCost || 0) + (cloud.peakCost || 0)),
				offCost: vR2((local.offCost || 0) + (cloud.offCost || 0)),
				flatCost: vR2((local.flatCost || 0) + (cloud.flatCost || 0)),
				today: vAddSlice(local.today, cloud.today),
				month: vAddSlice(local.month, cloud.month),
				all: vAddSlice(local.all, cloud.all),
				byDay: dates.map((d) => byDayMap.get(d)),
				byModel: Array.from(byModelMap.values()).sort((a, b) => b.cost - a.cost),
				byModelDay,
				recent: (cloud.recent || []).concat(local.recent || []).slice(0, 20),
				devices: cloud.devices || [],
				sources: cloud.sources || [],
				asOf: cloud.asOf || 0,
			});
		}
		// 「Token 用量统计」热力图的跨视图合并（与 view.js 的 mergeUsageHeat 逐行等价，
		// 浏览器里 require("./view") 取不到时必须自带一份，否则云端用量永远并不进来）
		function vR4(x) { return Math.round((Number(x) || 0) * 10000) / 10000; }
		function vMergeUsageHeat(local, cloud) {
			if (!cloud || !Array.isArray(cloud.days)) return local || null;
			if (!local || !Array.isArray(local.days)) return cloud;
			const per = new Map();
			const add = (d) => {
				if (!d || !d.date) return;
				const cur = per.get(d.date) || { date: d.date, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, cost: 0, tokens: 0 };
				cur.input += d.input || 0;
				cur.output += d.output || 0;
				cur.cacheRead += d.cacheRead || 0;
				cur.cacheWrite += d.cacheWrite || 0;
				cur.calls += d.calls || 0;
				cur.cost += d.cost || 0;
				// tokens 一律按本地口径重算：云端 byDay 的 tokens 含 reasoning，直接相加会不同源
				cur.tokens = cur.input + cur.output + cur.cacheRead + cur.cacheWrite;
				per.set(d.date, cur);
			};
			for (const d of local.days) add(d);
			for (const d of cloud.days) add(d);
			const days = Array.from(per.values())
				.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
				.map((d) => Object.assign({}, d, { cost: vR4(d.cost) }));
			const lt = local.total || {};
			const ct = cloud.total || {};
			const n = (v) => Number(v) || 0;
			return {
				ok: true,
				source: "merged",
				days,
				total: {
					tokens: n(lt.tokens) + n(ct.tokens),
					input: n(lt.input) + n(ct.input),
					cache: n(lt.cache) + n(ct.cache),
					output: n(lt.output) + n(ct.output),
					calls: n(lt.calls) + n(ct.calls),
					cost: vR4(n(lt.cost) + n(ct.cost)),
				},
				asOf: cloud.asOf || 0,
			};
		}
		const VIEW = requireLocal("./view", {
			BOARD_VIEWS: [
				{ id: "local", label: "本机" },
				{ id: "local+cloud", label: "本机+云端" },
				{ id: "cloud", label: "仅云端" },
			],
			BOARD_DIMS: [
				{ id: "total", label: "合计" },
				{ id: "device", label: "按机器" },
				{ id: "agent", label: "按 Agent" },
				{ id: "model", label: "按模型" },
				{ id: "project", label: "按项目" },
			],
			zeroSlice: vZeroSlice,
			addSlice: vAddSlice,
			r2: vR2,
			normalizeCloudDash: vNormalizeCloudDash,
			mergeDash: vMergeDash,
			mergeUsageHeat: vMergeUsageHeat,
		});
		const BOARD_VIEWS = VIEW.BOARD_VIEWS;
		const BOARD_DIMS = VIEW.BOARD_DIMS;
		const normalizeCloudDash = VIEW.normalizeCloudDash;
		const mergeDash = VIEW.mergeDash;
		const mergeUsageHeat = VIEW.mergeUsageHeat || vMergeUsageHeat;

		function filterRow(days, setDays, onExport, onRefresh, msg, busy, peakWindows, viewCtl) {
			const views = viewCtl && viewCtl.available ? BOARD_VIEWS : [BOARD_VIEWS[0]];
			return e("div", { className: "cost-row" },
				e("select", { className: "cost-select", value: String(days), onChange: ev => setDays(parseInt(ev.target.value, 10)) },
					e("option", { value: "7" }, "近 7 天"),
					e("option", { value: "14" }, "近 14 天"),
					e("option", { value: "30" }, "近 30 天"),
					e("option", { value: "0" }, "全部")),
				e("span", { className: "cost-tabs", title: "数据来源：本机=只统计这台电脑；本机+云端=加上其他电脑（不重复计数）；仅云端=以云端记录为准" },
					views.map(v => e("button", {
						key: v.id,
						className: "cost-tab" + (viewCtl && viewCtl.view === v.id ? " cost-tab-on" : ""),
						onClick: () => viewCtl && viewCtl.setView(v.id),
					}, v.label))),
				viewCtl && viewCtl.available && viewCtl.view !== "local"
					? e("select", { className: "cost-select", value: viewCtl.dimension, onChange: ev => viewCtl.setDimension(ev.target.value), title: "维度：查看合计，或按机器 / Agent / 模型 / 项目拆分" },
						BOARD_DIMS.map(d => e("option", { key: d.id, value: d.id }, d.label)))
					: null,
				e("button", { className: "cost-btn", onClick: onExport, disabled: busy }, "导出 CSV"),
				e("button", { className: "cost-btn", onClick: onRefresh, disabled: busy }, busy ? "刷新中…" : "刷新"),
				msg ? e("span", { className: "cost-hint" }, msg) : null,
				e("span", { className: "cost-spacer" }),
				viewCtl && viewCtl.view !== "local" && viewCtl.asOf
					? e("span", { className: "cost-hint" }, "云端数据时间 " + timeLabel(viewCtl.asOf))
					: e("span", { className: "cost-hint" }, "峰谷时段（北京时间）：" + peakWindows + " · 闲时半价"));
		}

		function statCards(dash, balance, viewCtl) {
			const today = dash.today || { real: 0, calls: 0, tokens: 0, sub: 0, subCalls: 0, subTokens: 0 };
			const month = dash.month || { real: 0, calls: 0, tokens: 0, sub: 0, subCalls: 0, subTokens: 0 };
			const all = dash.all || { real: 0, calls: 0, tokens: 0, sub: 0, subCalls: 0, subTokens: 0 };
			// 金额卡：主值为按量消费（不含订阅会员等效费用）；副行附注订阅等效
			const moneySub = (t) => "调用 " + fmtInt(t.calls) + " 次 · Tokens " + fmtCompact(t.tokens) + (t.sub > 0 ? " · 订阅 ¥" + fmtMoney(t.sub) : "");
			// 余额卡
			let balValue = "—", balSub = "查询中…";
			if (balance && balance.ok) {
				balValue = "¥" + (balance.total || "0");
				balSub = (balance.available ? "可用" : "不可用") + " · 充值 ¥" + (balance.toppedUp || "0") + " · 赠送 ¥" + (balance.granted || "0") + " · " + (balance.keySource || "");
			} else if (balance && balance.error) {
				balSub = balance.error;
			}
			// 视图来源标注：云端数据必须显式说明包含哪些机器，避免与本机数字混淆
			const isUnion = !!(viewCtl && viewCtl.union);
			const scopeNote = viewCtl && viewCtl.view === "cloud"
				? "仅云端 · " + (viewCtl.devices || []).length + " 台设备"
				: viewCtl && viewCtl.view === "local+cloud"
					? (isUnion
						? "本机 + 云端并集（" + ((viewCtl.unionParts || []).length || 2) + " 部分相加，不重复计数）"
						: "本机 + 云端 " + Math.max(0, (viewCtl.devices || []).length - 1) + " 台其他设备")
					: "本机";
			const tag = (t) => scopeNote + (viewCtl && viewCtl.pending > 0 && viewCtl.view !== "local" ? " · 待同步 " + viewCtl.pending + " 条" : "");
			return e("div", { className: "cost-cards" },
				statCard("今日费用（CNY）[" + tag() + "]", "¥" + fmtMoney(today.real), moneySub(today)),
				statCard("本月费用（CNY）", "¥" + fmtMoney(month.real), moneySub(month)),
				statCard("总花费（CNY）", "¥" + fmtMoney(all.real), "调用 " + fmtInt(all.calls) + " 次 · Tokens " + fmtCompact(all.tokens) + (all.sub > 0 ? " · 订阅 ¥" + fmtMoney(all.sub) : "")),
				statCard("API 请求次数", fmtInt(all.calls + all.subCalls),
					"按量 " + fmtInt(all.calls) + " · 订阅 " + fmtInt(all.subCalls)),
				statCard("Tokens", fmtInt(all.tokens + all.subTokens),
					"按量 " + fmtCompact(all.tokens) + " · 订阅 " + fmtCompact(all.subTokens)),
				statCard("总余额（CNY）", balValue, balSub));
		}

		function mainPanel(dash, tab, setTab, scheme, setScheme) {
			let chart = null;
			let legend = [];
			const labels = dash.byDay.map(d => d.label);
			const titles = dash.byDay.map(d => d.date);
			const fmtMoneyValue = (v) => "¥" + fmtMoney(v);
			if (tab === "period") {
				// 图例只列真实存在的档位：官方定价只有「高峰 / 闲时」两档；
				// flat（不分峰谷：订阅套餐、非 DeepSeek provider 兜底价等）**为 0 时不占图例位置**——
				// 常驻一个恒为 0 的第三项，会被读成「还有第三个时段」，与计费规则不符。
				const flatTotal = dash.byDay.reduce((s, d) => s + (Number(d.flat) || 0), 0);
				const hasFlat = flatTotal > 0;
				const segs = [{ name: "闲时", color: BLUE }, { name: "高峰", color: AMBER }]
					.concat(hasFlat ? [{ name: "不分峰谷", color: GRAY }] : []);
				const rows = dash.byDay.map(d => hasFlat ? [d.off, d.peak, d.flat] : [d.off, d.peak]);
				chart = e(StackedBarsChart, { labels, titles, segs, rows, fmtY: fmtAxisMoney, fmtValue: fmtMoneyValue });
				legend = segs;
			} else {
				// 模型按总消费降序排名（byModelDay 已按费用降序），全部展示、不合并、不循环：
				// 第 1 名取色阶首色（最深，垫底），名次越靠后越浅；色相按所选方案漂移
				const models = dash.byModelDay.filter(m => !m.subscription);
				const sc = COLOR_SCHEMES[scheme] || COLOR_SCHEMES["orange-yellow"];
				const segs = models.map((m, i) => ({ name: shortModel(m.model), color: schemeColor(i, sc) }));
				const daySegs = dash.byDay.map((d, di) => {
					const list = [];
					for (let i = 0; i < models.length; i++) {
						const c = models[i].days[di] ? models[i].days[di].cost : 0;
						if (c > 0) list.push({ name: segs[i].name, color: segs[i].color, value: c });
					}
					return list;
				});
				chart = e(StackedBarsChart, { labels, titles, segs, daySegs, rows: [], fmtY: fmtAxisMoney, fmtValue: fmtMoneyValue });
				legend = segs;
			}
			return e("div", { className: "cost-panel" },
				e("div", { className: "cost-row" },
					e("span", { className: "cost-panel-title" }, "消费金额（CNY）¥" + fmtMoney(dash.realCost)),
					tab === "model" ? e("span", { style: { display: "inline-flex", alignItems: "center", gap: "4px", marginLeft: "10px" } },
						Object.keys(COLOR_SCHEMES).map(k => e("button", {
							key: k,
							className: "cost-tab" + (scheme === k ? " cost-tab-on" : ""),
							onClick: () => setScheme(k),
							title: COLOR_SCHEMES[k].label,
							style: { padding: "3px 4px" },
						},
							e("span", { style: { display: "block", width: "20px", height: "14px", borderRadius: "2px", background: schemeSwatch(k) } })))) : null,
					e("span", { className: "cost-spacer" }),
					e("span", { className: "cost-tabs" },
						e("button", { className: "cost-tab" + (tab === "period" ? " cost-tab-on" : ""), onClick: () => setTab("period") }, "按峰谷"),
						e("button", { className: "cost-tab" + (tab === "model" ? " cost-tab-on" : ""), onClick: () => setTab("model") }, "按模型"))),
				e("div", { style: { marginTop: "10px" } }, chart),
				legendRow(legend),
				e("div", { className: "cost-hint", style: { marginTop: "6px" } }, "仅含按量计费模型；订阅制套餐不计入消费金额。"));
		}

		function subPanel(kimi, dash, now, onForce) {
			const ok = kimi && kimi.ok;
			const level = ok ? (MEMBERSHIP[kimi.membership] || kimi.membership || "未知等级") : "";
			let body;
			if (!kimi) {
				body = e("div", { className: "cost-hint", style: { marginTop: "8px" } }, "配额查询中…");
			} else if (!kimi.ok) {
				body = e("div", { style: { marginTop: "8px" } },
					e("div", { className: "cost-err" }, "配额查询不可用：" + (kimi.error || "未知错误")),
					e("div", { className: "cost-hint", style: { marginTop: "4px" } }, "需要 Kimi Coding Plan 的 API Key（形如 sk-kimi-…，通常配置为 KIMI_CODING_API_KEY）。当前尝试的 Key：" + (kimi.keyEnv || "未知") + "（来源：" + (kimi.keySource || "无") + "）。"));
			} else {
				const bars = [progressBar("本周配额", kimi.weekly.used, kimi.weekly.limit, kimi.weekly.remaining, kimi.weekly.resetTime, now)];
				const wins = kimi.windows || [];
				for (let i = 0; i < wins.length; i++) {
					const w = wins[i];
					bars.push(e("div", { key: "w" + i }, progressBar(windowLabel(w), w.used, w.limit, w.remaining, w.resetTime, now)));
				}
				body = e("div", null, bars);
			}
			const stats = dash
				? "累计请求 " + fmtInt(dash.subCalls) + " 次 · Tokens " + fmtInt(dash.subTokens) + " · 等效按量费用 ¥" + fmtMoney(dash.subEquivalent)
				: "加载中…";
			return e("div", { className: "cost-panel" },
				e("div", { className: "cost-row" },
					e("span", { className: "cost-panel-title" }, "订阅套餐用量 · Kimi Coding Plan"),
					ok ? e("span", { className: "cost-badge" }, level) : null,
					ok && kimi.parallel ? e("span", { className: "cost-badge" }, "并发上限 " + kimi.parallel) : null,
					e("span", { className: "cost-spacer" }),
					e("button", { className: "cost-btn", onClick: onForce }, "刷新配额")),
				body,
				e("div", { className: "cost-hint", style: { marginTop: "10px" } }, "订阅用量统计：" + stats + "（订阅已覆盖，等效费用仅供参考）"));
		}

		// 火山方舟 Coding Plan 配额面板。
		// 与 Kimi 面板的关键差别：管控面**主口径是百分比**（Level + Percent + Cap），
		// 实测 Percent 常落在 0.05–0.4 这种小数区间，且没有各模型的 used/limit 绝对值。
		// 所以不能直接套 progressBar 的「整数 / 总数」文案，这里用同一套
		// cost-bar-track / cost-bar-fill 样式自己画百分比条，视觉保持一致。
		function pctBar(label, percent, resetsAt, now, used, quota) {
			const pct = Math.max(0, Math.min(100, Number(percent) || 0));
			const color = pct >= 90 ? RED : pct >= 70 ? AMBER : BLUE;
			// 百分比按实际精度展示（0.05% 也要看得见，不能四舍五入成 0%）
			const pctText = pct > 0 && pct < 1 ? pct.toFixed(2).replace(/0+$/, "").replace(/\.$/, "") : String(Math.round(pct * 100) / 100);
			// 有 Cap 时补一句绝对量：百分比太小的时候更直观
			const absText = (typeof used === "number" && typeof quota === "number" && quota > 0)
				? (" · " + fmtInt(used) + " / " + fmtInt(quota)) : "";
			return e("div", { style: { marginTop: "10px" } },
				e("div", { className: "cost-row" },
					e("span", { className: "cost-hint" }, label),
					e("span", { className: "cost-spacer" }),
					e("span", { style: { fontVariantNumeric: "tabular-nums" } },
						"已用 " + pctText + "% · 剩余 " + (Math.round((100 - pct) * 100) / 100) + "%" + absText)),
				e("div", { className: "cost-bar-track" },
					e("div", { className: "cost-bar-fill", style: { width: Math.max(pct, pct > 0 ? 1 : 0) + "%", background: color } })),
				resetsAt ? e("div", { className: "cost-hint", style: { marginTop: "4px" } }, countdown(resetsAt, now)) : null);
		}

		function volcenginePanel(volc, dash, now, onForce) {
			const ok = volc && volc.ok;
			let body;
			if (!volc) {
				body = e("div", { className: "cost-hint", style: { marginTop: "8px" } }, "配额查询中…");
			} else if (!volc.ok) {
				body = e("div", { style: { marginTop: "8px" } },
					e("div", { className: "cost-err" }, "配额查询不可用：" + (volc.error || "未知错误")),
					e("div", { className: "cost-hint", style: { marginTop: "4px" } },
						"配额查询走方舟**管控面** OpenAPI，需要火山引擎 AccessKeyID / SecretAccessKey"
						+ "（IAM 子用户授予 ArkReadOnlyAccess + BillingCenterReadOnlyAccess），"
						+ "与推理用的 ARK API Key 是两套凭据。当前尝试的变量：" + (volc.keyEnv || "未知")
						+ "（来源：" + (volc.keySource || "无") + "）。"));
			} else {
				const list = volc.windowList || [];
				if (list.length === 0) {
					body = e("div", { className: "cost-hint", style: { marginTop: "8px" } }, "接口未返回任何用量窗口（可能账号没有生效中的 Coding Plan）。");
				} else {
					body = e("div", null, list.map(w => e("div", { key: w.name }, pctBar(w.label, w.percent, w.resetsAt, now, w.used, w.quota))));
				}
			}
			const stats = dash
				? "累计请求 " + fmtInt(dash.subCalls) + " 次 · Tokens " + fmtInt(dash.subTokens) + " · 等效按量费用 ¥" + fmtMoney(dash.subEquivalent)
				: "加载中…";
			return e("div", { className: "cost-panel" },
				e("div", { className: "cost-row" },
					e("span", { className: "cost-panel-title" }, "订阅套餐用量 · 火山方舟 Coding Plan"),
					ok && volc.action ? e("span", { className: "cost-badge" }, volc.action) : null,
					e("span", { className: "cost-spacer" }),
					e("button", { className: "cost-btn", onClick: onForce }, "刷新配额")),
				body,
				e("div", { className: "cost-hint", style: { marginTop: "10px" } },
					"订阅用量统计：" + stats + "（订阅已覆盖，等效费用仅供参考）"));
		}

		function kv(k, v) {
			return e("span", { style: { marginRight: "18px" } },
				e("span", { className: "cost-hint" }, k + "："),
				e("span", { style: { fontWeight: 600 } }, v));
		}

		function balancePanel(balance, manualKey, setManualKey, onQuery) {
			let body;
			if (!balance) {
				body = e("div", { className: "cost-hint" }, "查询中…");
			} else if (!balance.ok) {
				body = e("div", { className: "cost-err" }, "余额查询失败：" + (balance.error || "未知错误"));
			} else {
				body = e("div", { className: "cost-row", style: { gap: "4px" } },
					kv("总余额", "¥" + balance.total),
					kv("充值余额", "¥" + balance.toppedUp),
					kv("赠送余额", "¥" + balance.granted),
					kv("状态", balance.available ? "可用" : "不可用"),
					e("span", { className: "cost-hint" }, "Key 来源：" + balance.keySource));
			}
			return e("div", { className: "cost-panel" },
				e("div", { className: "cost-row" }, e("span", { className: "cost-panel-title" }, "账户余额 · DeepSeek")),
				e("div", { style: { marginTop: "8px" } }, body),
				e("div", { className: "cost-row", style: { marginTop: "10px" } },
					e("input", { className: "cost-input", placeholder: "手动输入 DeepSeek API Key（sk-…）", value: manualKey, onChange: ev => setManualKey(ev.target.value) }),
					e("button", { className: "cost-btn", onClick: () => onQuery(manualKey) }, "查询")));
		}

		function modelSections(dash) {
			if (!dash.byModelDay || dash.byModelDay.length === 0) return null;
			return dash.byModelDay.map((m, idx) => {
				const badge = m.subscription ? "订阅制 · 金额为等效按量参考" : (m.estimated ? "按量计费 · 价格为估算" : "按量计费");
				const labels = [];
				const titles = [];
				const calls = [];
				const tokenRows = [];
				for (const d of m.days) {
					labels.push(d.label);
					titles.push(d.date);
					calls.push(d.calls);
					tokenRows.push([d.input, d.cacheWrite, d.output, d.cacheRead]);
				}
				const gid = "cost-g-" + idx;
				const tokenSegs = TOKEN_NAMES.map((name, i) => ({ name, color: TOKEN_COLORS[i] }));
				return e("div", { className: "cost-panel", key: m.model },
					e("div", { className: "cost-row" },
						e("span", { className: "cost-panel-title" }, m.model),
						e("span", { className: "cost-badge" }, badge)),
					e("div", { className: "cost-grid2", style: { marginTop: "10px" } },
						e("div", null,
							e("div", { className: "cost-hint" }, "API 请求次数"),
							e(AreaChart, { labels, titles, values: calls, fmtY: fmtTickInt, fmtValue: fmtInt, valueLabel: "请求次数", gid })),
						e("div", null,
							e("div", { className: "cost-hint" }, "Tokens"),
							e(StackedBarsChart, { labels, titles, segs: tokenSegs, rows: tokenRows, fmtY: fmtCompact, fmtValue: fmtInt }),
							legendRow(tokenSegs))));
			});
		}

		function recentPanel(dash) {
			const rows = [];
			for (let i = 0; i < dash.recent.length; i++) {
				const r = dash.recent[i];
				rows.push(e("tr", { key: i },
					e("td", null, r.time),
					e("td", null, r.provider + "/" + r.model),
					e("td", null, r.subscription ? e("span", { className: "cost-badge" }, "订阅") : periodText(r.period)),
					e("td", null, fmtInt(r.input + r.cacheRead + r.cacheWrite) + " / " + fmtInt(r.output)),
					e("td", null, "¥" + fmtMoney(r.cost))));
			}
			return e("div", { className: "cost-panel" },
				e("div", { className: "cost-row" }, e("span", { className: "cost-panel-title" }, "最近记录")),
				e("div", { style: { marginTop: "8px", overflowX: "auto" } },
					e("table", { className: "cost-table" },
						e("thead", null, e("tr", null,
							e("th", null, "时间"), e("th", null, "模型"), e("th", null, "时段"), e("th", null, "入/出 Tokens"), e("th", null, "费用"))),
						e("tbody", null, rows.length ? rows : e("tr", null, e("td", { colSpan: 5 }, e("span", { className: "cost-hint" }, "暂无记录")))))));
		}

		function UsageHeatmap(props) {
			const data = props.data;
			const days = Array.isArray(data.days) ? data.days : [];
			const byDate = new Map();
			for (const d of days) byDate.set(d.date, d);
			const total = data.total || { tokens: 0, input: 0, cache: 0, output: 0, calls: 0, cost: 0 };
			const [tip, setTip] = useState(null);
			const hostRef = useRef(null);

			// 与服务端 dayKey 同口径：一律按北京时间（UTC+8）生成 YYYY-MM-DD，
			// 以「北京日序号」D = floor((ts+8h)/天) 表示，读 UTC 分量即为北京日期。
			const DAY_MS = 86400000;
			const pad2 = (n) => String(n).padStart(2, "0");
			const keyOfDay = (D) => {
				const d = new Date(D * DAY_MS);
				return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
			};
			const D0 = Math.floor((Date.now() + 28800000) / DAY_MS); // 今天的北京日序号
			const todayDOW = new Date(D0 * DAY_MS).getUTCDay(); // 0=周日
			const Dend = D0 + (6 - ((todayDOW + 6) % 7)); // 本周周日（北京）

			const WEEKS = 26;
			const columns = [];
			const monthLabels = [];
			let lastMonth = -1;
			for (let w = WEEKS - 1; w >= 0; w -= 1) {
				for (let i = 0; i < 7; i += 1) {
					const Dcell = Dend - (w * 7 + (6 - i));
					const key = keyOfDay(Dcell);
					const day = byDate.get(key);
					columns.push(day !== undefined ? { day, tokens: day.tokens } : { day: { date: key, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, calls: 0, cost: 0, tokens: 0 }, tokens: 0 });
				}
				const m = new Date((Dend - (w * 7 + 6)) * DAY_MS);
				monthLabels.push(m.getUTCMonth() !== lastMonth ? String(m.getUTCMonth() + 1) + "月" : "");
				lastMonth = m.getUTCMonth();
			}
			const todayKey = keyOfDay(D0);

			let maxDay = 0;
			for (const c of columns) if (c.tokens > maxDay) maxDay = c.tokens;
			if (maxDay <= 0) maxDay = 1;
			const levelOf = (tokens) => {
				const ratio = tokens / maxDay;
				return ratio < 0.25 ? 1 : ratio < 0.5 ? 2 : ratio < 0.75 ? 3 : 4;
			};

			function onCellEnter(ev, entry) {
				const host = hostRef.current;
				if (!host) return;
				const hr = host.getBoundingClientRect();
				const cr = ev.currentTarget.getBoundingClientRect();
				const cellLeft = cr.left - hr.left;
				const cellRight = cr.right - hr.left;
				const cellCenter = cellLeft + cr.width / 2;
				const top = cr.top - hr.top;
				const hostWidth = hr.width;
				setTip({ entry, cellLeft, cellRight, cellCenter, top, hostWidth });
			}

			const t = total;
			const cells = columns.map((entry, i) => {
				const day = entry.day;
				const tokens = entry.tokens;
				const cls = "cost-ug-cell" + (tokens > 0 ? " l" + levelOf(tokens) : "") + (day.date === todayKey ? " today" : "");
				return e("div", {
					key: i, className: cls,
					onMouseEnter: (ev) => onCellEnter(ev, entry),
					onMouseLeave: () => setTip(null),
				});
			});

			let tipEl = null;
			if (tip) {
				const day = tip.entry.day;
				const tokens = tip.entry.tokens;
				const top = tip.top;
				// 浮层自适应水平定位：默认以格中心居中；若靠近左/右边界则改为贴边对齐，避免被裁剪
				const tipWidth = 170; // 估算浮层宽度（px）
				let left = tip.cellCenter;
				let transform = "translate(-50%, -100%)";
				if (tip.cellCenter - tipWidth / 2 < 4) {
					left = tip.cellLeft;
					transform = "translate(0, -100%)";
				} else if (tip.cellCenter + tipWidth / 2 > tip.hostWidth - 4) {
					left = tip.cellRight;
					transform = "translate(-100%, -100%)";
				}
				// 顶部格子：浮层上移后可能顶到容器顶边，改为贴底显示，避免被上边界裁掉
				if (top < 60) {
					transform = transform.replace(", -100%)", ", 8px)");
				}
				tipEl = e("div", {
					className: "cost-ug-tip",
					style: { left: left + "px", top: top + "px", transform: transform },
				},
					e("div", { className: "cost-ug-tip-total" }, day.date + " · " + fmtTokens(tokens) + " tokens" + (day.calls ? " · " + fmtInt(day.calls) + " 次调用" : "")),
					e("div", { className: "cost-ug-tip-row" }, e("span", { className: "cost-ug-tip-name" }, "输入"), e("span", { className: "cost-ug-tip-val" }, fmtTokens(day.input))),
					e("div", { className: "cost-ug-tip-row" }, e("span", { className: "cost-ug-tip-name" }, "缓存"), e("span", { className: "cost-ug-tip-val" }, fmtTokens((day.cacheRead || 0) + (day.cacheWrite || 0)))),
					e("div", { className: "cost-ug-tip-row" }, e("span", { className: "cost-ug-tip-name" }, "输出"), e("span", { className: "cost-ug-tip-val" }, fmtTokens(day.output))),
					e("div", { className: "cost-ug-tip-row" }, e("span", { className: "cost-ug-tip-name" }, "费用"), e("span", { className: "cost-ug-tip-val" }, "¥" + fmtMoney(day.cost))));
			}

			return e("div", { className: "cost-ug" },
				e("div", { className: "cost-ug-total" },
					"累计 " + fmtTokens(t.tokens) + " tokens · 输入 " + fmtTokens(t.input) + " · 缓存 " + fmtTokens(t.cache) + " · 输出 " + fmtTokens(t.output) + " · " + fmtInt(t.calls) + " 次调用"),
				e("div", { className: "cost-ug-host", ref: hostRef },
					e("div", { className: "cost-ug-grid", style: { gridTemplateColumns: "repeat(" + WEEKS + ", 1fr)" } }, cells),
					tipEl),
				e("div", { className: "cost-ug-months", style: { gridTemplateColumns: "repeat(" + WEEKS + ", 1fr)" } },
					monthLabels.map((m, i) => e("span", { key: "m" + i, className: "cost-ug-month" }, m))));
		}

		// ---------- 峰谷计价提示 ----------
		// 相位助记（与 dsh-cost-meter 一致）：weekend → 「周末全谷」；inPeak → 「峰时」；否则「平价」。
		function peakWord(p) {
			if (!p) return "";
			if (p.weekend) return "周末全谷";
			return p.inPeak ? "峰时" : "平价";
		}
		function peakWordClass(p) {
			if (!p) return "";
			return p.weekend ? " weekend" : p.inPeak ? " peak" : " off";
		}
		// 倒计时文本：向上取整到分钟。与 dsh-cost-meter 一致：{time}后进入高峰/平价。
		function peakCountdown(p, now) {
			if (!p) return "";
			return peakCountdownTime(p, now) + "后进入" + (p.nextIntoPeak ? "高峰" : "平价");
		}
		// 仅倒计时（分钟粒度的时长文本），用于弹窗正文「约 X 后…」。
		function peakCountdownTime(p, now) {
			if (!p) return "";
			const ms = Math.max(0, p.nextAtMs - now);
			const totalMin = Math.max(1, Math.ceil(ms / 60000));
			const h = Math.floor(totalMin / 60);
			const m = totalMin % 60;
			return h > 0 ? (m > 0 ? h + "小时" + m + "分" : h + "小时") : m + "分";
		}
		// 当前相位在轨道上的标记位置：峰=25%、平价=75%；周末中点=50%。
		function peakMarkerLeft(p) {
			if (!p) return "50%";
			if (p.weekend) return "50%";
			return p.inPeak ? "25%" : "75%";
		}
		// 24h 环形表盘（classic 改造）：中空圆环。底环蓝=平价铺满 24h，高峰窗口叠加橙色弧段，
		// 指针随当前时刻旋转，圆心显示相位 + 倒计时。窗口缺口数据来自后端 peakHours，与 isPeak/peakPhaseAt 同口径。
		function peakBeijingMinute(now) {
			const d = new Date((Number.isFinite(now) ? now : Date.now()) + 28800000);
			return d.getUTCHours() * 60 + d.getUTCMinutes();
		}
		function PeakDial(props) {
			const p = props.phase;
			if (!p) return null;
			const now = props.now || Date.now();
			const windows = props.windows && props.windows.length ? props.windows : [{ start: 9, end: 12 }, { start: 14, end: 18 }];
			const size = props.size || 150;
			const showTimeLabels = props.showTimeLabels !== false;
			const CX = 90, CY = 90, R = 62, SW = 18; // viewBox 180
			const peakC = "#ff9800", offC = "#4176e6", weekC = "#34a853";
			const dim = "#9ca3af";
			const deg = (h) => h * 15; // 0:00 = 顶部，顺时针；6:00 右 · 12:00 底 · 18:00 左
			const polar = (d, r) => [CX + r * Math.sin(d * Math.PI / 180), CY - r * Math.cos(d * Math.PI / 180)];
			const children = [
				// 平价底环（蓝）
				e("circle", { cx: CX, cy: CY, r: R, fill: "none", stroke: offC, "stroke-width": SW }),
			];
			// 高峰弧（橙）；周末则不画任何峰时弧段
			if (!p.weekend) {
				for (const w of windows) {
					const a = deg(w.start), b = deg(w.end);
					const s = polar(a, R), e2 = polar(b, R);
					const large = ((b - a) % 360) > 180 ? 1 : 0;
					children.push(e("path", { d: "M " + s[0] + " " + s[1] + " A " + R + " " + R + " 0 " + large + " 1 " + e2[0] + " " + e2[1], fill: "none", stroke: peakC, "stroke-width": SW }));
				}
			}
			// 时间刻度（每 3h 一个标签，随缩放等比；可由「显示时间」开关控制）
			if (showTimeLabels) {
				for (let h = 0; h < 24; h += 3) {
					const pt = polar(deg(h), R + SW / 2 + 13);
					children.push(e("text", { x: pt[0], y: pt[1], "text-anchor": "middle", "dominant-baseline": "middle", "font-size": "8.5", fill: dim }, (h < 10 ? "0" : "") + h + ":00"));
				}
			}
			// 当前相位颜色（峰橙 / 平蓝 / 周末绿）—— 同时用于标记点与圆心文案
			const color = p.weekend ? weekC : p.inPeak ? peakC : offC;
			const word = p.weekend ? "周末全谷" : p.inPeak ? "高峰时段" : "平价时段";
			// 当前时刻标记：相位色点（环上，随相位变色 + 白色描边）
			const m = peakBeijingMinute(now);
			const tip = polar(m / 1440 * 360, R);
			children.push(e("circle", { cx: tip[0], cy: tip[1], r: "7", fill: color, stroke: "#fff", "stroke-width": "2.5" }));
			// 圆心：当前相位 + 倒计时
			children.push(e("text", { x: CX, y: CY - 4, "text-anchor": "middle", "dominant-baseline": "middle", "font-size": "12", "font-weight": "700", fill: color }, word));
			children.push(e("text", { x: CX, y: CY + 12, "text-anchor": "middle", "dominant-baseline": "middle", "font-size": "8.5", fill: dim }, peakCountdown(p, now)));
			return e("svg", { viewBox: "0 0 180 180", width: size, height: size, role: "img", style: { overflow: "visible" } }, ...children);
		}
		// 单行时段条：两段轨道（橙+蓝）+ 标记线 + 着色 chip。对标 dsh-cost-meter 简洁款。
		function PeakStrip(props) {
			const snap = props.snap;
			const style = props.style || "compact";
			const wide = props.wide !== false;
			if (!snap || !snap.phase || snap.notice === false) return null;
			const p = snap.phase;
			const now = props.now || Date.now();
			const countdown = peakCountdown(p, now);
			const wordClass = peakWordClass(p);
			if (!wide) {
				// 窄栏（rail）：竖排短词
				return e("div", { className: "cost-ps-rail" + wordClass, title: peakWord(p) + " · " + countdown },
					e("span", { className: "cost-ps-word" }, peakWord(p)));
			}
			if (style === "classic") {
				// 环形表盘（classic 改造）：24h 中空圆环 + 圆心相位/倒计时
				return e("div", { className: "cost-ps cost-ps-ring" + wordClass, title: countdown },
					e(PeakDial, { phase: p, windows: snap.peakHours, now: now, size: props.ringSize || 150, showTimeLabels: !snap.config || snap.config.peakShowTickLabels !== false }),
					e("div", { className: "cost-ps-ringfoot" },
						e("span", { className: "cost-ps-chip" }, peakWord(p) + " · " + countdown)));
			}
			// compact：单行「24h 比例轨道（橙=高峰/蓝=平价）+ 白色实时进度线 + chip·倒计时」
			const win = snap.peakHours && snap.peakHours.length ? snap.peakHours : [{ start: 9, end: 12 }, { start: 14, end: 18 }];
			const segs = [
				// 平价底（蓝）铺满 24h
				e("div", { className: "cost-ps-seg cost-ps-offseg", style: { left: "0%", width: "100%" } }),
			];
			// 高峰段（橙）按窗口在 24h 中的比例定位
			if (!p.weekend) {
				for (const w of win) {
					segs.push(e("div", { className: "cost-ps-seg cost-ps-peakseg", style: { left: (w.start / 24 * 100) + "%", width: ((w.end - w.start) / 24 * 100) + "%" } }));
				}
			}
			// 白色分割线：实时进度（北京时间当日占比）
			segs.push(e("div", { className: "cost-ps-marker", style: { left: (peakBeijingMinute(now) / 1440 * 100) + "%" } }));
			const track = e("div", { className: "cost-ps-track" }, segs);
			const chip = e("span", { className: "cost-ps-chip" }, peakWord(p) + " · " + countdown);
			const cfg = snap.config || {};
			// 双行紧凑：勾选后由左右单行改为上下布局，可选「条上文下」或「文上条下」
			if (cfg.peakCompactStack === true) {
				const kids = cfg.peakCompactOrder === "text-first" ? [chip, track] : [track, chip];
				return e("div", { className: "cost-ps cost-ps-stack" + wordClass, title: countdown }, kids[0], kids[1]);
			}
			return e("div", { className: "cost-ps" + wordClass, title: countdown }, track, chip);
		}

		// ---------- 峰谷切换前弹窗（真实 + 预览） ----------
		// 常驻挂在 sidebar.footer.action；用 nextAtMs 作为唯一提醒点，同一切换点只提醒一次。
		const PEAK_PREVIEW_EVENT = "dsh-cost-tracker-peak-preview";
		let lastPeakNotifyAtMs = 0;
		function PeakAlertPopup(props) {
			const snap = props.snap;
			const now = props.now || Date.now();
			const onDismiss = props.onDismiss || (() => {});
			if (!snap) return null;
			const cfg = snap.config || {};
			const alert = snap.alert || {};
			// 定位/外观统一由宿主 snap 决定；可被预览配置覆盖。
			const intoPeak = props.preview
				? props.preview === "peak"
				: (snap.phase ? snap.phase.nextIntoPeak === true : false);
			const position = props.position || (alert.position === "center" ? "cost-pa-center" : "cost-pa-corner");
			const title = intoPeak ? "即将进入峰时" : "即将进入谷时";
			const body = "约 " + (props.countdownText || (snap.phase ? peakCountdownTime(snap.phase, now) : "2 分")) + " 后计费档位切换为" + (intoPeak ? "峰时" : "谷时") + "价，请注意本时段调用成本。";
			const badge = intoPeak ? "峰价提醒" : "谷价提醒";
			return e("div", { className: "cost-pa " + position + " " + (intoPeak ? "cost-pa-peak" : "cost-pa-offpeak"), role: "alert" },
				e("div", { className: "cost-pa-badge" }, badge),
				e("div", { className: "cost-pa-title" }, title),
				e("div", { className: "cost-pa-body" }, body),
				e("div", { className: "cost-pa-actions" },
					e("button", { className: "cost-btn", onClick: onDismiss }, "知道了")));
		}

		// 侧边栏峰谷组件：时段条 + 切换前弹窗宿主（常驻，无需活跃会话）。
		function PeakSidebar(props) {
			const wide = props && props.wide !== false;
			const [snap, setSnap] = useState(null);
			const [now, setNow] = useState(Date.now());
			const [dismissedAt, setDismissedAt] = useState(null);
			const [preview, setPreview] = useState(null);
			useEffect(() => {
				let alive = true;
				function load() {
					apiCall("peak", {}).then(v => { if (alive && v && v.ok) setSnap(v); }).catch(() => {});
				}
				load();
				const id = setInterval(load, 30000);
				return () => { alive = false; clearInterval(id); };
			}, []);
			useEffect(() => {
				const id = setInterval(() => setNow(Date.now()), 10000);
				return () => clearInterval(id);
			}, []);
			// 预览通道（设置面板触发）
			useEffect(() => {
				const onPreview = (event) => {
					const kind = event.detail && event.detail.kind === "offpeak" ? "offpeak" : "peak";
					setPreview(kind);
					// 预览系统通知
					const cfg = snap && snap.config;
					if (cfg && cfg.peakAlertWebNotify === true && window.Notification && Notification.permission === "granted") {
						try {
							new Notification((kind === "peak" ? "即将进入峰时" : "即将进入谷时") + "（预览）",
								{ body: "约 2 分 后计费档位切换为" + (kind === "peak" ? "峰时" : "谷时") + "价。" });
						} catch (_) {}
					}
				};
				window.addEventListener(PEAK_PREVIEW_EVENT, onPreview);
				return () => window.removeEventListener(PEAK_PREVIEW_EVENT, onPreview);
			}, [snap]);
			// 真实弹窗判定：提醒开启 + 峰谷启用生效 + 距下次切换 <= ahead + 类型匹配 + 未关闭过该切换点
			let real = null;
			if (snap && snap.enabled && snap.effective && snap.alert && snap.alert.enabled && snap.phase) {
				const aheadMs = (Number.isFinite(snap.alert.ahead) && snap.alert.ahead >= 1 ? snap.alert.ahead : 2) * 60000;
				const tgt = snap.alert.target || "both";
				const intoPeak = snap.phase.nextIntoPeak === true;
				if ((tgt === "both" || tgt === (intoPeak ? "peak" : "offpeak"))
					&& now >= snap.phase.nextAtMs - aheadMs && now < snap.phase.nextAtMs && dismissedAt !== snap.phase.nextAtMs) real = snap.phase;
			}
			// 系统通知（Web）：与弹窗同判定，用 nextAtMs 去重
			useEffect(() => {
				if (!snap || !snap.enabled || !snap.effective) return;
				const alert = snap.alert || {};
				if (alert.enabled !== true || alert.webNotify !== true || !window.Notification || Notification.permission !== "granted") return;
				if (!snap.phase) return;
				const aheadMs = (Number.isFinite(alert.ahead) && alert.ahead >= 1 ? alert.ahead : 2) * 60000;
				const intoPeak = snap.phase.nextIntoPeak === true;
				const tgt = alert.target || "both";
				if (now < snap.phase.nextAtMs - aheadMs || now >= snap.phase.nextAtMs) return;
				if ((tgt !== "both" && tgt !== (intoPeak ? "peak" : "offpeak"))) return;
				if (lastPeakNotifyAtMs === snap.phase.nextAtMs) return;
				lastPeakNotifyAtMs = snap.phase.nextAtMs;
				try {
					new Notification(intoPeak ? "即将进入峰时" : "即将进入谷时",
						{ body: peakCountdownTime(snap.phase, now) + " 后计费档位切换为" + (intoPeak ? "峰时" : "谷时") + "价。" });
				} catch (_) {}
			}, [now, snap]);
			let popup = null;
			if (real !== null) {
				popup = e(PeakAlertPopup, { snap, now, onDismiss: () => setDismissedAt(real.nextAtMs) });
			} else if (preview !== null) {
				// 预览跟随用户配置的弹窗位置（右下角 / 屏幕中心），不强制覆盖
				popup = e(PeakAlertPopup, { snap, preview, now: now + 120000, countdownText: "2 分", onDismiss: () => setPreview(null) });
			}
			// 显隐开关（在所有 hook 之后判定，避免条件式 hook 顺序漂移）：
			// 时段条、切换弹窗与系统通知同属这一个落点，关闭即整体停用；
			// 想「只留提醒、不要时段条」请关掉「峰谷计价与提示 → 峰时高价时段显著提示」。
			if (!uiOn(snap && snap.ui, "uiPeakEnabled")) return null;
			return e("div", null,
				e(PeakStrip, { snap, style: snap ? snap.style : "compact", wide, now, ringSize: 112 }),
				popup);
		}

		// 设置面板：峰谷计价与提示
		function PeakPanel(props) {
			const [snap, setSnap] = useState(null);
			const [draft, setDraft] = useState(null);
			const [now, setNow] = useState(Date.now());
			const [savedMsg, setSavedMsg] = useState("");
			function load() {
				apiCall("peak", {}).then(v => {
					if (v && v.ok) {
						setSnap(v);
						setDraft(Object.assign({}, v.config || {}));
					}
				}).catch(() => {});
			}
			useEffect(() => { load(); }, []);
			useEffect(() => {
				const id = setInterval(() => setNow(Date.now()), 30000);
				return () => clearInterval(id);
			}, []);
			function setField(k, v) {
				setDraft(d => Object.assign({}, d, { [k]: v }));
			}
			function save() {
				apiCall("peak-config", draft || {}).then(v => {
					if (v && typeof v === 'object') {
						setSnap(s => Object.assign({}, s, { config: v, enabled: v.peakEnabled, notice: v.peakNotice, style: v.peakStyle, alert: { enabled: v.peakAlertEnabled, ahead: v.peakAlertAhead, target: v.peakAlertTarget, position: v.peakAlertPosition, webNotify: v.peakAlertWebNotify } }));
						setDraft(Object.assign({}, v));
						setSavedMsg("已保存");
						setTimeout(() => setSavedMsg(""), 2000);
					}
				}).catch(() => setSavedMsg("保存失败"));
			}
			function preview(kind) {
				window.dispatchEvent(new CustomEvent(PEAK_PREVIEW_EVENT, { detail: { kind } }));
			}
			const d = draft || {};
			const cfgSnap = snap ? Object.assign({}, snap, { config: d }) : null;
			const noticeOn = snap && snap.notice !== false && d.peakNotice !== false;
			return e("div", { className: "cost-panel" },
				e("div", { className: "cost-row" },
					e("span", { className: "cost-panel-title" }, "峰谷计价与提示"),
					e("span", { className: "cost-spacer" }),
					e("button", { className: "cost-btn", onClick: save, disabled: !draft }, "保存设置")),
				e("div", { style: { marginTop: "8px", display: "grid", gap: "6px" } },
					e("label", { className: "cost-row", style: { gap: "8px" } },
						e("input", { type: "checkbox", checked: d.peakEnabled !== false, onChange: ev => setField("peakEnabled", ev.target.checked) }),
						e("span", null, "启用 DeepSeek 峰谷时段价格")),
					e("label", { className: "cost-row", style: { gap: "8px" } },
						e("input", { type: "checkbox", checked: d.peakNotice !== false, onChange: ev => setField("peakNotice", ev.target.checked) }),
						e("span", null, "峰时高价时段显著提示（时段条显示）")),
					e("div", { className: "cost-row", style: { gap: "8px" } },
						e("span", null, "时段条样式"),
						e("select", { className: "cost-select", value: d.peakStyle === "classic" ? "classic" : "compact", onChange: ev => setField("peakStyle", ev.target.value) },
							e("option", { value: "compact" }, "简洁（单行紧凑）"),
							e("option", { value: "classic" }, "环形表盘（24h）"))),
					d.peakStyle === "classic" ? e("label", { className: "cost-row", style: { gap: "8px" } },
						e("input", { type: "checkbox", checked: d.peakShowTickLabels !== false, onChange: ev => setField("peakShowTickLabels", ev.target.checked) }),
						e("span", null, "显示时间（00:00–21:00 刻度）"))
						: e("label", { className: "cost-row", style: { gap: "8px" } },
							e("input", { type: "checkbox", checked: d.peakCompactStack === true, onChange: ev => setField("peakCompactStack", ev.target.checked) }),
							e("span", null, "双行紧凑（上下布局）"),
							d.peakCompactStack === true ? e("select", { className: "cost-select", value: d.peakCompactOrder === "text-first" ? "text-first" : "bar-first", onChange: ev => setField("peakCompactOrder", ev.target.value) },
								e("option", { value: "bar-first" }, "时段条在上·文字在下"),
								e("option", { value: "text-first" }, "文字在上·时段条在下"))
								: null),
					e("label", { className: "cost-row", style: { gap: "8px" } },
						e("input", { type: "checkbox", checked: d.peakAlertEnabled !== false, onChange: ev => setField("peakAlertEnabled", ev.target.checked) }),
						e("span", null, "峰/谷切换前弹窗提醒")),
					d.peakAlertEnabled !== false ? e("div", { className: "cost-row", style: { gap: "8px" } },
						e("span", null, "提前提醒（分钟，1-30）"),
						e("input", { className: "cost-input", style: { width: "80px" }, type: "number", min: 1, max: 30, value: String(d.peakAlertAhead == null ? 2 : d.peakAlertAhead), onChange: ev => { const n = parseInt(ev.target.value, 10); if (Number.isInteger(n) && n >= 1 && n <= 30) setField("peakAlertAhead", n); } }),
						e("span", null, "提醒类型"),
						e("select", { className: "cost-select", value: d.peakAlertTarget === "peak" || d.peakAlertTarget === "offpeak" ? d.peakAlertTarget : "both", onChange: ev => setField("peakAlertTarget", ev.target.value) },
							e("option", { value: "both" }, "峰和谷"),
							e("option", { value: "peak" }, "进入峰时"),
							e("option", { value: "offpeak" }, "进入谷时")),
						e("span", null, "弹窗位置"),
						e("select", { className: "cost-select", value: d.peakAlertPosition === "center" ? "center" : "corner", onChange: ev => setField("peakAlertPosition", ev.target.value) },
							e("option", { value: "corner" }, "右下角"),
							e("option", { value: "center" }, "屏幕中心")))
						: null,
					e("label", { className: "cost-row", style: { gap: "8px" } },
						e("input", { type: "checkbox", checked: d.peakAlertWebNotify === true, onChange: ev => setField("peakAlertWebNotify", ev.target.checked) }),
						e("span", null, "同步发送系统通知（需授权通知权限）")),
					e("div", { className: "cost-row", style: { gap: "8px", marginTop: "4px" } },
						e("span", null, "预览弹窗"),
						e("button", { className: "cost-btn", onClick: () => preview("peak") }, "预览进入峰"),
						e("button", { className: "cost-btn", onClick: () => preview("offpeak") }, "预览进入谷"),
						savedMsg ? e("span", { className: "cost-hint" }, savedMsg) : null),
					e("div", { className: "cost-hint", style: { marginTop: "6px" } },
						"峰时段（北京时间）：" + (snap ? snap.peakWindows : "周一至周五 9:00-12:00 · 14:00-18:00（周末全天闲时）") + "。生效时间：" + (snap ? snap.effectiveAt : "2026-08-01T00:00:00Z") + "。当前：" + (cfgSnap && cfgSnap.phase ? (cfgSnap.phase.weekend ? "周末全谷价" : cfgSnap.phase.inPeak ? "高峰时段" : "平价时段") : "…"))),
				noticeOn ? e("div", { style: { marginTop: "8px" } }, e(PeakStrip, { snap: cfgSnap, style: d.peakStyle || "compact", wide: true, now, ringSize: 150 }))
					: e("p", { className: "cost-hint", style: { marginTop: "8px" } }, "提示已隐藏：需启用峰谷计价并开启「峰时高价时段显著提示」。"),
				e(SyncReadonlyCard, { sync: props.sync }));
		}

		// ============================================================
		// 云端同步（只读回显）—— 花费统计设置页
		// 编辑入口在「设置 → 插件 → 插件配置 → 花费统计」卡片，这里只回显当前状态，
		// 避免两处都能改造成口径不一致。
		// ============================================================
		function SyncReadonlyCard(props) {
			const [st, setSt] = useState(props && props.sync ? props.sync : null);
			useEffect(() => {
				let alive = true;
				function load() { apiCall("sync", {}).then(v => { if (alive && v) setSt(v); }).catch(() => {}); }
				load();
				const id = setInterval(load, 60000);
				return () => { alive = false; clearInterval(id); };
			}, []);
			if (!st) return null;
			const line = (k, v) => [e("span", { key: "k" + k, className: "k" }, k), e("span", { key: "v" + k, className: "v" }, v)];
			return e("div", { className: "cost-sync-card" },
				e("div", { className: "cost-row" },
					e("span", { className: "cost-panel-title" }, "云端同步"),
					e("span", { className: "cost-spacer" }),
					e("span", { className: "cost-hint" }, st.enabled ? "已启用" : "未启用")),
				e("div", { className: "cost-sync-ro" },
					line("设备名", st.deviceName || "（未命名）"),
					line("设备 ID", st.deviceId || "（未生成）"),
					line("服务地址", st.url || "（未配置）"),
					line("令牌", st.hasToken ? "已配置" : "未配置"),
					line("上次同步", st.lastSyncAt ? timeLabel(st.lastSyncAt) : "从未"),
					line("待上报", st.pending + " 条 · 水位 seq=" + st.watermark),
					line("会话脱敏", st.maskSessionId ? "已开启（不可逆哈希）" : "关闭"),
					line("上报项目", st.includePurpose ? "含 purpose" : "不含 purpose")),
				st.lastError ? e("div", { className: "cost-err", style: { marginTop: "6px" } }, "最近错误：" + st.lastError) : null,
				e("div", { className: "cost-hint", style: { marginTop: "8px" } },
					"编辑入口：设置 → 插件 → 插件配置 → 花费统计" + (st.dataDir ? "（身份文件：" + st.identityFile + "）" : "")));
		}

		// ============================================================
		// 插件配置卡（设置 → 插件 → 插件配置）
		// 卡片自绘内部结构、表单走本插件自己的 host API（/api/cost-tracker/sync-*），
		// 不硬依赖 settings UI 包的内部实现，避免版本耦合。
		// ============================================================
		function PluginConfigCard() {
			const [st, setSt] = useState(null);
			const [draft, setDraft] = useState({});
			const [msg, setMsg] = useState("");
			const [busy, setBusy] = useState(false);
			const [testing, setTesting] = useState("");
			// 界面显示三开关（独立于云端同步草稿：勾选即刻生效并落盘）
			const [uiDraft, setUiDraft] = useState({ uiDockEnabled: true, uiPeakEnabled: true, uiDashboardEnabled: true });
			const [uiMsg, setUiMsg] = useState("");
			// 折叠态：与宿主「插件配置」里其它卡片一致——默认收起，点标题展开
			const [open, setOpen] = useState(false);
			function load() {
				apiCall("sync", {}).then(v => {
					if (!v) return;
					setSt(v);
					setDraft({
						deviceName: v.deviceName || "",
						cloudEnabled: !!v.enabled,
						cloudUrl: v.url || "",
						cloudToken: "",
						syncIntervalSec: v.intervalSec || 60,
						maskSessionId: !!v.maskSessionId,
						includePurpose: v.includePurpose !== false,
						cloudView: v.view || "local",
					});
					// 界面显示：缺省视为可见（与 normalizeUiConfig 同一真值语义）
					setUiDraft({
						uiDockEnabled: v.uiDockEnabled !== false,
						uiPeakEnabled: v.uiPeakEnabled !== false,
						uiDashboardEnabled: v.uiDashboardEnabled !== false,
					});
				}).catch(() => {});
			}
			useEffect(() => { load(); }, []);
			const set = (k, v) => setDraft(prev => Object.assign({}, prev, { [k]: v }));
			const field = (label, node, hint) => [
				e("span", { key: "k" + label, className: "k" }, label),
				e("span", { key: "v" + label }, node, hint ? e("span", { className: "cost-hint", style: { marginLeft: "8px" } }, hint) : null),
			];
			function save() {
				setBusy(true); setMsg("");
				const patch = Object.assign({}, draft);
				if (!patch.cloudToken) delete patch.cloudToken; // 留空 = 不改令牌
				if (!patch.cloudUrl) patch.cloudEnabled = false;
				apiCall("sync-config", patch).then(v => {
					setBusy(false);
					setMsg(v && v.ok ? "已保存" : "保存失败：" + ((v && v.error) || "未知错误"));
					load();
				}).catch(err => { setBusy(false); setMsg("保存失败：" + String(err && err.message ? err.message : err)); });
			}
			function test() {
				setBusy(true); setTesting("测试中…");
				apiCall("sync-test", { config: Object.assign({}, draft, { cloudToken: draft.cloudToken || undefined }) }).then(v => {
					setBusy(false);
					setTesting(v && v.ok ? ("连接正常 · 服务端 " + (v.serviceVersion || "?") + (v.selfRegister ? " · 允许自注册" : "")) : ("连接失败：" + ((v && v.error) || "未知错误")));
				}).catch(err => { setBusy(false); setTesting("连接失败：" + String(err && err.message ? err.message : err)); });
			}
			function syncNow(full) {
				setBusy(true); setMsg("同步中…");
				apiCall("sync-now", full ? { full: true } : {}).then(v => {
					setBusy(false);
					const r = (v && v.result) || {};
					setMsg(r.error ? ("同步失败：" + r.error) : ("已同步：新增 " + (r.accepted || 0) + " · 去重 " + (r.duplicates || 0) + " · 日汇总 " + (r.rollups || 0)));
					load();
				}).catch(err => { setBusy(false); setMsg("同步失败：" + String(err && err.message ? err.message : err)); });
			}
			/**
			 * 界面显示开关：勾选即刻提交并落盘（无需点「保存」），随后广播 UI_EVENT，
			 * 让已经挂载的胶囊 / 时段条 / 看板立刻跟着显隐。
			 * 关掉看板后本卡片仍在原位（它不受这三个开关控制），随时能改回来。
			 */
			function saveUi(patch) {
				const next = Object.assign({}, uiDraft, patch);
				setUiDraft(next);
				setUiMsg("保存中…");
				apiCall("ui-config", patch).then(v => {
					if (v && v.ok) {
						setUiDraft({
							uiDockEnabled: v.uiDockEnabled !== false,
							uiPeakEnabled: v.uiPeakEnabled !== false,
							uiDashboardEnabled: v.uiDashboardEnabled !== false,
						});
						setUiMsg("已保存，界面立即生效");
						try { window.dispatchEvent(new CustomEvent(UI_EVENT)); } catch (_) {}
					} else {
						setUiMsg("保存失败：" + ((v && v.error) || "未知错误"));
					}
					setTimeout(() => setUiMsg(""), 2500);
				}).catch(err => {
					setUiMsg("保存失败：" + String(err && err.message ? err.message : err));
				});
			}
			// 卡片外壳对齐宿主 PluginCard：li.cost-pcard > button.cost-pcard-head（标题+副标题+箭头）> body
			const head = e("button", { type: "button", className: "cost-pcard-head", "aria-expanded": open, onClick: () => setOpen(v => !v) },
				e("span", { className: "cost-pcard-headtext" },
					e("span", { className: "cost-pcard-name" }, "花费统计" + (st && st.enabled ? " · 云端同步已开启" : "")),
					e("span", { className: "cost-pcard-desc" }, "把本机用量汇总到自建云端服务；多台电脑共用同一个地址与令牌，即可在「花费统计」看板切换查看全网数据。")),
				e("svg", { className: "cost-pcard-chevron" + (open ? " is-open" : ""), width: 14, height: 14, viewBox: "0 0 14 14", fill: "none", "aria-hidden": "true" },
					e("path", { d: "M3.5 5.25 7 8.75l3.5-3.5", stroke: "currentColor", strokeWidth: 1.4, strokeLinecap: "round", strokeLinejoin: "round" })));
			const body = !st
				? e("div", { className: "cost-hint", style: { margin: "12px 0" } }, "加载云端同步状态…")
				: e("div", {},
					e("div", { className: "cost-hint" }, "填好地址与令牌后点「保存」，再点「测试连接」确认可达；首次同步会自动回补历史明细。"),
				e("div", { className: "cost-sync-fields" },
					field("设备名", e("input", {
						className: "cost-input", style: { width: "200px" }, value: draft.deviceName || "", placeholder: "如：办公台式机",
						onChange: ev => set("deviceName", ev.target.value),
					}), "看板上显示的名字"),
					field("启用同步", e("input", { type: "checkbox", checked: !!draft.cloudEnabled, onChange: ev => set("cloudEnabled", ev.target.checked) })),
					field("服务地址", e("input", {
						className: "cost-input", style: { width: "320px" }, value: draft.cloudUrl || "", placeholder: "https://cost.example.com",
						onChange: ev => set("cloudUrl", ev.target.value),
					}), "仅 http/https"),
					field("共享令牌", e("input", {
						className: "cost-input", type: "password", style: { width: "320px" }, value: draft.cloudToken || "",
						placeholder: st.hasToken ? "已配置（留空则不修改）" : "dshc_...",
						onChange: ev => set("cloudToken", ev.target.value),
					}), "在云端看板「设置」页生成"),
					field("同步间隔", e("select", { className: "cost-select", value: String(draft.syncIntervalSec || 60), onChange: ev => set("syncIntervalSec", parseInt(ev.target.value, 10)) },
						[15, 30, 60, 120, 300, 600, 1800, 3600].map(s => e("option", { key: "iv" + s, value: String(s) }, s < 60 ? s + " 秒" : (s / 60) + " 分钟")))),
					field("会话脱敏", e("input", { type: "checkbox", checked: !!draft.maskSessionId, onChange: ev => set("maskSessionId", ev.target.checked) }), "上报前把 sessionId 换成不可逆哈希"),
					field("上报 purpose", e("input", { type: "checkbox", checked: draft.includePurpose !== false, onChange: ev => set("includePurpose", ev.target.checked) }), "项目/用途归属"),
					field("默认视图", e("select", { className: "cost-select", value: draft.cloudView || "local", onChange: ev => set("cloudView", ev.target.value) },
						BOARD_VIEWS.map(v => e("option", { key: v.id, value: v.id }, v.label))))),
				e("div", { className: "cost-sync-actions" },
					e("button", { className: "cost-btn cost-btn-primary", onClick: save, disabled: busy }, "保存"),
					e("button", { className: "cost-btn", onClick: test, disabled: busy }, "测试连接"),
					e("button", { className: "cost-btn", onClick: () => syncNow(false), disabled: busy }, "立即同步"),
					e("button", { className: "cost-btn", onClick: () => syncNow(true), disabled: busy }, "全量补传")),
				msg ? e("div", { className: "cost-sync-state" }, msg) : null,
				testing ? e("div", { className: "cost-sync-state" }, testing) : null,
				e("div", { className: "cost-sync-state" },
					"设备 ID " + (st.deviceId || "（未生成）") + " · 水位 seq=" + st.watermark + " · 待上报 " + st.pending + " 条 · 上次同步 " + (st.lastSyncAt ? timeLabel(st.lastSyncAt) : "从未")),
				st.lastError ? e("div", { className: "cost-err" }, "最近错误：" + st.lastError) : null,
				st.needAuth ? e("div", { className: "cost-err" }, "令牌无效：请在云端看板重新生成共享引导令牌后填入上方「共享令牌」。") : null,
				st.url ? e("div", { className: "cost-hint", style: { marginTop: "6px" } }, "云端看板：" + st.url) : null,
				// ---------- 界面显示：三个前端落点各自显隐，勾选即刻生效 ----------
				// 只影响渲染，不影响记账 / 云端同步 / Agent 工具；本卡片不受这三个开关控制
				// （否则关掉之后就再没有入口能打开了）。
				e("div", { className: "cost-sync-card" },
					e("div", { className: "cost-panel-title" }, "界面显示"),
					e("div", { className: "cost-hint", style: { marginTop: "6px" } },
						"控制插件在 DSH 界面上的落点，勾选后立即生效（无需点上面的「保存」）。关闭只影响显示：记账、云端同步与 Agent 工具照常工作。"),
					e("div", { style: { marginTop: "8px", display: "grid", gap: "6px" } },
						UI_SURFACES.map(s => e("label", { key: s.key, className: "cost-row", style: { gap: "8px", alignItems: "flex-start" } },
							e("input", {
								type: "checkbox",
								checked: uiDraft[s.key] !== false,
								onChange: ev => saveUi({ [s.key]: ev.target.checked }),
							}),
							e("span", null,
								e("span", null, s.label),
								e("div", { className: "cost-hint" }, s.desc))))),
					e("div", { className: "cost-row", style: { gap: "8px", marginTop: "6px" } },
						e("button", { className: "cost-btn", onClick: () => saveUi({ uiDockEnabled: true, uiPeakEnabled: true, uiDashboardEnabled: true }) }, "全部显示"),
						uiMsg ? e("span", { className: "cost-hint" }, uiMsg) : null)));
			return e("li", { className: "cost-pcard" + (open ? " is-open" : "") },
				head,
				open ? e("div", { className: "cost-pcard-body" }, body) : null);
		}

		/**
		 * 「花费统计」看板的插槽门卫。
		 * 关掉界面显示时**不能注册成空渲染**（会留下一个点不开的空白导航项），
		 * 所以这里保留设置项但只渲染一句说明 —— 用户随时能在插件配置卡片里改回来。
		 * 宿主不重启插件、插槽注册也无法撤销，因此显隐必须在渲染期判定。
		 */
		function DashGate() {
			const [ui, setUi] = useState(null);
			useEffect(() => {
				let alive = true;
				function load() {
					apiCall("peak", {}).then(v => { if (alive && v && v.ok) setUi(v.ui || {}); }).catch(() => {});
				}
				load();
				const id = setInterval(load, 30000);
				window.addEventListener(UI_EVENT, load);
				return () => { alive = false; clearInterval(id); window.removeEventListener(UI_EVENT, load); };
			}, []);
			if (!uiOn(ui, "uiDashboardEnabled")) {
				return e("div", { className: "cost-wrap" },
					e("div", { className: "cost-h1" }, pluginIcon(18), "花费统计"),
					e("div", { className: "cost-hint", style: { marginTop: "8px" } },
						"花费统计看板已在设置里关闭显示。记账与云端同步不受影响；要重新打开：" +
						"设置 → 插件 → 插件配置 → 花费统计 → 界面显示 → 打开「设置页花费统计看板」。"));
			}
			return e(Dashboard, {});
		}

		function Dashboard() {
			const [days, setDays] = useState(7);
			const [dash, setDash] = useState(null);
			const [dashErr, setDashErr] = useState("");
			const [kimi, setKimi] = useState(null);
			const [volc, setVolc] = useState(null);
			const [balance, setBalance] = useState(null);
			const [tab, setTab] = useState("period");
			const [scheme, setSchemeState] = useState(() => {
				try { return localStorage.getItem("dsh-cost-tracker-scheme") || "orange-yellow" } catch (e) { return "orange-yellow" }
			});
			function setScheme(k) {
				setSchemeState(k);
				try { localStorage.setItem("dsh-cost-tracker-scheme", k) } catch (e) {}
			}
			const [msg, setMsg] = useState("");
			const [busy, setBusy] = useState(false);
			const [now, setNow] = useState(Date.now());
			const [manualKey, setManualKey] = useState("");
			const [usage, setUsage] = useState(null);
			const [usageErr, setUsageErr] = useState("");
			// ---- 云端三态视图 ----
			const [sync, setSync] = useState(null);
			const [cloudDash, setCloudDash] = useState(null);
			const [cloudErr, setCloudErr] = useState("");
			const [cloudMatrix, setCloudMatrix] = useState(null);
			const [cloudUsage, setCloudUsage] = useState(null);
			const [cloudUsageErr, setCloudUsageErr] = useState("");
			const [view, setViewState] = useState(() => {
				try { return localStorage.getItem("dsh-cost-tracker-view") || "local" } catch (e) { return "local" }
			});
			const [dimension, setDimensionState] = useState(() => {
				try { return localStorage.getItem("dsh-cost-tracker-dim") || "total" } catch (e) { return "total" }
			});
			function setView(v) {
				setViewState(v);
				try { localStorage.setItem("dsh-cost-tracker-view", v) } catch (e) {}
				apiCall("sync-config", { cloudView: v }).catch(() => {});
			}
			function setDimension(d) {
				setDimensionState(d);
				try { localStorage.setItem("dsh-cost-tracker-dim", d) } catch (e) {}
			}
			const viewInitRef = useRef(false);

			function loadDash(d) {
				apiCall("dashboard", { days: d }).then(v => {
					if (v && v.ok) { setDash(v); setDashErr(""); }
					else setDashErr(v && v.error ? String(v.error) : "数据加载失败");
				}).catch(err => setDashErr(String(err && err.message ? err.message : err)));
			}
			function loadSync() {
				apiCall("sync", {}).then(v => {
					if (!v) return;
					setSync(v);
					// 首次进入：以配置里的视图为准（三态开关的权威值在配置，便于多机一致）
					if (!viewInitRef.current && (v.view === "local" || v.view === "local+cloud" || v.view === "cloud")) {
						viewInitRef.current = true;
						if (v.view !== view) setViewState(v.view);
					}
				}).catch(() => {});
			}
			/**
			 * 云端只读聚合。
			 *  · view=cloud        → 全网
			 *  · view=local+cloud  → 「本机 DSH + 其他整机 + 本机其它 agent」
			 *                        （宿主侧用 cloud-rest 口径：排除本机 DSH 来源，保留本机其它 agent）
			 *  · view=local        → 不请求云端
			 */
			function loadCloud(d, mode) {
				if (!mode || mode === "local") { setCloudErr(""); return; }
				const cloudView = mode === "local+cloud" ? "cloud-rest" : "cloud";
				apiCall("cloud", { route: "overview", days: d, view: cloudView }).then(v => {
					if (v && v.ok !== false) { setCloudDash(v); setCloudErr(""); }
					else { setCloudDash(null); setCloudErr((v && v.error) || "云端不可用"); }
				}).catch(err => { setCloudDash(null); setCloudErr(String(err && err.message ? err.message : err)); });
			}
			function loadCloudMatrix(d) {
				apiCall("cloud", { route: "matrix", days: d, view: view === "local+cloud" ? "cloud-rest" : "cloud" }).then(v => {
					if (v && v.ok !== false) setCloudMatrix(v); else setCloudMatrix(null);
				}).catch(() => setCloudMatrix(null));
			}
			/**
			 * 云端「按天用量明细」（热力图数据源）。
			 *  · view=local+cloud → cloud-rest：其他整机 ∪ 本机其它 agent（与卡片同一并集口径）
			 *  · view=cloud       → 全网
			 * 宿主把它归一成与本地 buildUsageHeat 同形的 {days:[{date,input,output,cacheRead,cacheWrite,...}], total}，
			 * 客户端再按视图合并，热力图与上方卡片口径才能一致（此前热力图恒为本机，屏内自相矛盾）。
			 */
			function loadCloudUsage(mode) {
				if (!mode || mode === "local") { setCloudUsage(null); setCloudUsageErr(""); return; }
				apiCall("cloud", { route: "usage", view: mode === "local+cloud" ? "cloud-rest" : "cloud" }).then(v => {
					if (v && v.ok !== false && Array.isArray(v.days)) { setCloudUsage(v); setCloudUsageErr(""); }
					else { setCloudUsage(null); setCloudUsageErr((v && v.error) || "云端用量明细不可用"); }
				}).catch(err => { setCloudUsage(null); setCloudUsageErr(String(err && err.message ? err.message : err)); });
			}
			function loadKimi(force) {
				apiCall("kimi-usage", { force: !!force }).then(v => setKimi(v)).catch(() => {});
			}
			function loadVolc(force) {
				apiCall("volcengine-usage", { force: !!force }).then(v => setVolc(v)).catch(() => {});
			}
			function loadUsage() {
				apiCall("usage", {}).then(v => {
					if (v && v.ok) { setUsage(v); setUsageErr(""); }
					else setUsageErr(v && v.error ? String(v.error) : "数据加载失败");
				}).catch(err => setUsageErr(String(err && err.message ? err.message : err)));
			}
			function loadBalance(key) {
				apiCall("balance", key ? { apiKey: key } : {}).then(v => setBalance(v)).catch(() => {});
			}
			function onExport() {
				setBusy(true); setMsg("导出中…");
				apiCall("export", {}).then(v => {
					setBusy(false);
					setMsg(v && v.ok ? "已导出 " + v.count + " 条到 " + v.path : "导出失败：" + (v && v.error ? v.error : "未知错误"));
				}).catch(err => { setBusy(false); setMsg("导出失败：" + String(err && err.message ? err.message : err)); });
			}
			function onRefresh() {
				setBusy(true);
				apiCall("dashboard", { days }).then(v => { if (v && v.ok) setDash(v); }).catch(() => {});
				apiCall("usage", {}).then(v => {
					if (v && v.ok) { setUsage(v); setUsageErr(""); }
					else setUsageErr(v && v.error ? String(v.error) : "数据加载失败");
				}).catch(err => setUsageErr(String(err && err.message ? err.message : err)));
				apiCall("kimi-usage", { force: false }).then(v => setKimi(v)).catch(() => {});
				apiCall("volcengine-usage", { force: false }).then(v => setVolc(v)).catch(() => {});
				loadCloudUsage(view);
				apiCall("balance", {}).then(v => { setBalance(v); setBusy(false); }).catch(() => setBusy(false));
			}

			useEffect(() => { loadDash(days); }, [days]);
			useEffect(() => { loadKimi(false); loadVolc(false); loadBalance(""); loadUsage(); loadSync(); }, []);
			// 视图切换：local+cloud 需要额外拉「排除本机」的云端聚合、矩阵与按天用量明细
			useEffect(() => { loadCloud(days, view); loadCloudMatrix(days); loadCloudUsage(view); }, [view, days]);
			useEffect(() => {
				const id = setInterval(() => setNow(Date.now()), 30000);
				return () => clearInterval(id);
			}, []);

			// 数据源合并：仅本机时 viewDash === dash（完全不改现有口径）
			const cloudNorm = normalizeCloudDash(cloudDash, days);
			const viewDash = view === "local"
				? dash
				: view === "cloud"
					? cloudNorm
					: (cloudNorm ? mergeDash(dash, cloudNorm) : dash);
			// 热力图同样跟随三态视图：本机 / 本机+云端 / 仅云端。
			// 云端明细取不到时退回本机，并在标题右侧注明口径，避免与上方卡片数字打架。
			const viewUsage = view === "local"
				? usage
				: view === "cloud"
					? cloudUsage
					: (usage && cloudUsage ? mergeUsageHeat(usage, cloudUsage) : (cloudUsage || usage));
			const usageScope = view === "local"
				? "本机"
				: view === "cloud"
					? ("仅云端" + (cloudUsageErr ? "（" + cloudUsageErr + "）" : ""))
					: (cloudUsage ? "本机 + 云端（不重复计数）" : "本机（云端明细加载中或不可用）");
			const cloudAvailable = !!(sync && sync.enabled && sync.hasToken);
			const viewCtl = {
				view, setView, dimension, setDimension,
				available: cloudAvailable,
				asOf: cloudDash ? cloudDash.asOf : 0,
				devices: (cloudDash && cloudDash.devices) || [],
				sources: (cloudDash && cloudDash.sources) || [],
				union: !!(cloudDash && cloudDash.union),
				unionParts: (cloudDash && cloudDash.parts) || [],
				cloudMode: (cloudDash && cloudDash.cloudMode) || "",
				pending: sync ? sync.pending : 0,
			};

			// 火山方舟面板只在「用得上」时出现：存在火山订阅调用（宿主判定并在
			// summary 里回传 volcengineActive），或已有窗口数据 / 已尝试过凭据。
			// 只跑 DeepSeek 或 Kimi 的用户界面保持不变，不会被一个无关面板撑长。
			const showVolc = !!(volc || (viewDash && viewDash.volcengineActive === true));

			return e("div", { className: "cost-wrap" },
				e("div", { className: "cost-h1" }, pluginIcon(18), "花费统计"),
				filterRow(days, setDays, onExport, onRefresh, msg, busy, dash ? dash.peakWindows : "周一至周五 9:00-12:00 · 14:00-18:00（周末全天闲时）", viewCtl),
				!cloudAvailable
					? e("div", { className: "cost-hint", style: { marginTop: "4px" } },
						"仅显示本机数据。在多台电脑/多个 Agent 之间汇总：到「设置 → 插件 → 插件配置 → 花费统计」填写云端服务地址与令牌。")
					: null,
				sync && sync.enabled && sync.pending > 0 && view !== "local"
					? e("div", { className: "cost-cloudnote" },
						"本机还有 " + sync.pending + " 条尚未同步，云端数字会偏小 —— ",
						e("button", { className: "cost-btn", onClick: () => { apiCall("sync-now", {}).then(() => { loadSync(); loadCloud(days, view); loadCloudMatrix(days); loadCloudUsage(view); }); } }, "立即同步"))
					: null,
				cloudErr && view !== "local"
					? e("div", { className: "cost-err", style: { marginTop: "6px" } }, "云端数据不可用（已显示本机数据）：" + cloudErr)
					: null,
				sync && sync.needAuth
					? e("div", { className: "cost-err", style: { marginTop: "6px" } }, "云端令牌无效：请在「设置 → 插件 → 插件配置 → 花费统计」更新令牌。")
					: null,
				dashErr ? e("div", { className: "cost-err", style: { marginTop: "8px" } }, dashErr) : null,
				(!viewDash && !dashErr) ? e("div", { className: "cost-hint", style: { marginTop: "12px" } }, "加载中…") : null,
				viewDash ? statCards(viewDash, balance, viewCtl) : null,
				view !== "local" && dimension !== "total" && viewDash ? dimensionPanel(viewDash, dimension, cloudMatrix, loadingCloud => loadingCloud) : null,
				viewDash ? mainPanel(viewDash, tab, setTab, scheme, setScheme) : null,
				e("div", { className: "cost-panel" },
					e("div", { className: "cost-row" },
						e("span", { className: "cost-panel-title" }, "Token 用量统计"),
						e("span", { className: "cost-spacer" }),
						e("span", { className: "cost-hint" }, usageScope)),
					e("div", { style: { marginTop: "8px" } },
						viewUsage ? e(UsageHeatmap, { data: viewUsage })
							: usageErr ? e("div", { className: "cost-err" }, "加载失败：" + usageErr)
							: e("div", { className: "cost-hint" }, "加载中…"))),
				subPanel(kimi, viewDash, now, () => loadKimi(true)),
				showVolc ? volcenginePanel(volc, viewDash, now, () => loadVolc(true)) : null,
				balancePanel(balance, manualKey, setManualKey, k => loadBalance(k)),
				viewDash ? modelSections(viewDash) : null,
				viewDash ? recentPanel(viewDash) : null,
				e(PeakPanel, { sync }));
		}

		/** 分维度面板：合计之外的「按机器 / 按 Agent / 按模型 / 按项目」拆分 */
		function dimensionPanel(dash, dimension, matrix, onReload) {
			let rows = [];
			if (dimension === "model") {
				rows = dash.byModel.map(m => ({ key: m.model, cost: m.cost, calls: m.calls, tokens: m.tokens, tag: m.subscription ? "订阅" : (m.estimated ? "估算" : "") }));
			} else if (dimension === "agent") {
				rows = (dash.sources || []).map(s => ({ key: s.source, cost: s.cost, calls: s.calls, tokens: s.tokens, tag: (s.devices || []).length + " 台设备" }));
			} else if (dimension === "device") {
				rows = (dash.devices || []).map(d => ({ key: d.name || d.device, cost: d.cost, calls: d.calls, tokens: d.tokens, tag: (d.sources || []).join(" · ") }));
			} else if (dimension === "project") {
				// 记录里的 purpose 维度（云端 recent 不覆盖全部，这里用 byModel 之外的近似提示）
				rows = [];
			}
			const head = dimension === "device" ? "按机器" : dimension === "agent" ? "按 Agent" : dimension === "model" ? "按模型" : "按项目";
			return e("div", { className: "cost-panel" },
				e("div", { className: "cost-row" },
					e("span", { className: "cost-panel-title" }, head + " 明细"),
					e("span", { className: "cost-spacer" }),
					e("span", { className: "cost-hint" }, "数据来源：" + (matrix ? "云端" : "本地+云端"))),
				rows.length === 0
					? e("div", { className: "cost-hint", style: { marginTop: "6px" } }, "暂无该维度的数据（项目维度需要在云端「记录」页按 purpose 筛选查看）")
					: e("div", { className: "cost-matrix" },
						e("div", { className: "cost-matrix-row cost-matrix-head" },
							e("span", { className: "cost-matrix-key" }, head),
							e("span", { className: "cost-matrix-num" }, "花费"),
							e("span", { className: "cost-matrix-num" }, "调用"),
							e("span", { className: "cost-matrix-num" }, "Tokens"),
							e("span", { className: "cost-matrix-note" }, "备注")),
						rows.sort((a, b) => b.cost - a.cost).slice(0, 50).map((r, i) =>
							e("div", { key: "dim" + i, className: "cost-matrix-row" },
								e("span", { className: "cost-matrix-key", title: r.key }, r.key),
								e("span", { className: "cost-matrix-num" }, "¥" + fmtMoney(r.cost)),
								e("span", { className: "cost-matrix-num" }, fmtInt(r.calls)),
								e("span", { className: "cost-matrix-num" }, fmtCompact(r.tokens)),
								e("span", { className: "cost-matrix-note" }, r.tag || "")))),
				matrix && matrix.rows && e("div", { style: { marginTop: "10px" } },
					e("div", { className: "cost-hint" }, "设备 × Agent 矩阵（行=设备，列=Agent，点击云端「设备 × Agent」页可下钻到记录）"),
					e("div", { className: "cost-matrix" },
						e("div", { className: "cost-matrix-row cost-matrix-head" },
							e("span", { className: "cost-matrix-key" }, "设备"),
							(matrix.cols || []).map(c => e("span", { key: "c" + c, className: "cost-matrix-num" }, c)),
							e("span", { className: "cost-matrix-num" }, "合计")),
						(matrix.rows || []).map((r, i) =>
							e("div", { key: "m" + i, className: "cost-matrix-row" },
								e("span", { className: "cost-matrix-key", title: r.device }, r.name || r.device),
								(matrix.cols || []).map(c => e("span", { key: "m" + i + c, className: "cost-matrix-num" }, "¥" + fmtMoney((r.cells[c] || {}).cost || 0))),
								e("span", { className: "cost-matrix-num cost-matrix-total" }, "¥" + fmtMoney(r.cost)))),
						e("div", { className: "cost-matrix-row cost-matrix-total" },
							e("span", { className: "cost-matrix-key" }, "合计"),
							(matrix.cols || []).map(c => e("span", { key: "t" + c, className: "cost-matrix-num" }, "¥" + fmtMoney((matrix.rows || []).reduce((s, r) => s + (((r.cells || {})[c] || {}).cost || 0), 0)))),
							e("span", { className: "cost-matrix-num" }, "¥" + fmtMoney((matrix.totals || {}).cost || 0))))));
		}

		/**
		 * 输入框上方的花费胶囊（conversation.composer.dock）。
		 * 显隐只在本部件内部判定：StatusLine 始终注册，快照说关就渲染 null ——
		 * 用户改配置后无需重载页面（宿主不重启插件，插槽注册也无法撤销）。
		 */
		function CostDock(props) {
			const sessionId = props && props.sessionId ? String(props.sessionId) : "";
			const [s, setS] = useState(null);
			const [expanded, setExpanded] = useState(false);
			useEffect(() => {
				let alive = true;
				function load() {
					apiCall("summary", { sessionId }).then(v => { if (alive) setS(v); }).catch(() => {});
				}
				load();
				const id = setInterval(load, 30000);
				const onUi = () => load();
				window.addEventListener(UI_EVENT, onUi);
				return () => { alive = false; clearInterval(id); window.removeEventListener(UI_EVENT, onUi); };
			}, [sessionId]);
			if (!s) return null;
			if (!uiOn(s.ui, "uiDockEnabled")) return null;
			// 按会话实际内容决定显示（而不是按当前选中的模型）：
			//  - realModels 按量模型 / subModels 订阅模型（分开）
			//  - 订阅只用一个着色徽标展示套餐名 + 总等效费用，订阅模型不再单独进模型区（避免重复）
			// 布局：胶囊分段（主胶囊 / 订阅胶囊 / 模型胶囊），用细竖线分隔，悬停或点击展开模型。
			const realModels = Array.isArray(s.sessionRealModels) ? s.sessionRealModels : [];
			const subModels = Array.isArray(s.sessionSubModels) ? s.sessionSubModels : [];
			const hasReal = realModels.length > 0 || s.sessionCost > 0;
			const hasSub = subModels.length > 0 || s.sessionSub > 0;
			const chip = (m, i) => e("span", { key: "r" + i, className: "cost-chip", title: m.model },
				shortModel(m.model) + " ¥" + fmtMoney(m.cost));
			// 主胶囊：标明「本会话」+ 本会话花费（不需要累计）
			const costPill = e("span", { className: "cost-pill" },
				e("span", { className: "cost-hint" }, "本会话"),
				e("span", { className: "cost-dock-main" }, "¥" + fmtMoney(s.sessionCost)));
			// 订阅徽标（单个着色胶囊，不再把订阅模型放进模型区）
			let subPill = null;
			if (hasSub) {
				const plan = subPlanName(subModels.length ? subModels[0].provider : s.provider);
				subPill = e("span", { className: "cost-badge cost-pill-sub-badge" }, plan + " · ¥" + fmtMoney(s.sessionSub));
			}
			// 模型胶囊：默认 top2 汇总，点击展开全部（仅按量模型）
			let modelPill = null;
			const modelCount = realModels.length;
			if (realModels.length > 0) {
				const topN = realModels.slice(0, 2);
				const extraReal = realModels.length - 2;
				const toggle = e("button", {
					className: "cost-model-toggle",
					onClick: () => setExpanded(!expanded),
					title: expanded ? "收起模型明细" : "展开模型明细",
					"aria-expanded": expanded,
				}, expanded ? "▾" : "▸");
				const modelLabel = e("span", { className: "cost-hint" }, "模型 ×" + modelCount + " ");
				if (expanded) {
					modelPill = e("span", { className: "cost-pill" }, modelLabel,
						realModels.map((m, i) => chip(m, i)), toggle);
				} else {
					const topChips = topN.map((m, i) => chip(m, i));
					const more = extraReal > 0 ? e("span", { className: "cost-hint" }, "+" + extraReal) : null;
					modelPill = e("span", { className: "cost-pill" }, modelLabel, topChips, more, toggle);
				}
			}
			// 分段组装：主胶囊 | 订阅胶囊 | 模型胶囊（细竖线分隔，换行时自动分段）
			// hasReal 为假时（本会话还没有任何按量花费）不渲染主胶囊，避免出现 ¥0.0000 的空壳
			const segs = [];
			if (hasReal || !hasSub) segs.push(costPill);
			if (subPill) segs.push(subPill);
			if (modelPill) segs.push(modelPill);
			return e("div", { className: "cost-dock" }, segs.map((seg, i) => e("span", { key: "seg" + i, className: "cost-seg" }, seg)));
		}

		/** 插槽入口：插槽本身始终注册，显隐在 CostDock 内判定 */
		function StatusLine(props) {
			return e(CostDock, props || {});
		}

		const inject = ["slots"];
		function apply(ctx) {
			applyStyles(ctx);
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			slots.inject("settings.section", () => slots.register(
				{ name: "settings.section", id: "cost-dashboard", order: 30, label: "花费统计" },
				() => e(DashGate, {}),
			));
			// 插件配置卡片（设置 → 插件 → 插件配置）：以 settings 命名空间为键。
			// 这里必须**无条件** inject，不能拿 slots.entries(key).length 当"插槽是否存在"的探测：
			// entries 数的是"已经注册进该槽的条目"，而条目正是由各插件在插槽声明后才注册的，
			// 所以在插件 apply 阶段它恒为空 —— 用探测就会把卡片永远挡在门外（1.8.0 的缺陷）。
			// 宿主的官方卡片（dsh-client-ui-settings-plugins）与 dsh-context 都是无条件 inject：
			// 插槽未声明时回调不触发、声明时自动触发，既不会误判也不需要重试。
			const pluginItemKey = "settings.plugin.item";
			slots.inject(pluginItemKey, () => slots.register(
				{ name: pluginItemKey, key: "cost-tracker" },
				() => e(PluginConfigCard, {}),
			));
			slots.inject("conversation.composer.dock", () => slots.register(
				{ name: "conversation.composer.dock", id: "cost", order: 1 },
				(props) => e(StatusLine, props || {}),
			));
			// 侧边栏底部峰谷时段条 + 切换前弹窗（常驻，无需活跃会话；wide=false 为窄栏态）
			slots.inject("sidebar.footer.action", () => slots.register(
				{ name: "sidebar.footer.action", id: "cost-peak", order: 8 },
				(props) => e(PeakSidebar, props || {}),
			));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

// ------------------------------------------------------------
// 注册名护栏（防回归）
//
// 背景：DSH 客户端 ModuleLoader 按模块图里的 row.id 拉取 bundle，脚本执行后要求
// __ModuleLoader__.load() 的 id 与之「完全一致」（允许尾部带 "/client"，会被
// stripClientSuffix 去掉），否则抛：
//     client-modules: bundle <url> loaded without registering "<id>" via __ModuleLoader__.load
//
// 该 id 历史上是手写字符串。v1.7.0 发布时漏了 scope 前缀（写成裸名
// "dsh-cost-tracker"），导致所有从插件市场安装的用户客户端加载失败、插件无法加载。
//
// 下面两层都指向同一个单一事实源 _DSH_BUNDLE_ID，改动包名时只需改这一处；
// 同时若宿主将来改变约定，也能在控制台给出明确指引，而不是只留一句加载器报错。
// ------------------------------------------------------------
(function () {
	/** 单一事实源：必须与 package.json 的 name 完全一致。 */
	var _DSH_BUNDLE_ID = "@angelyeye/dsh-cost-tracker";
	/** v1.7.0 发布时用过的旧裸名，仅用于给出针对性提示。 */
	var _DSH_LEGACY_BARE_ID = "dsh-cost-tracker";

	var loader = (typeof window !== "undefined" && window.__ModuleLoader__) || null;
	if (!loader || typeof loader.load !== "function") return;

	/** 实际写入 factories 的 id：与加载器内部 stripClientSuffix 保持一致（尾部 "/client" 会被去掉）。 */
	function storedIdOf(id) {
		return String(id).replace(/\/client$/, "");
	}

	function report(registeredId) {
		var detail = '  bundle 内注册的 id = "' + registeredId + '"（strip 后 = "' + storedIdOf(registeredId) + '"）'
			+ "\n  包名（加载器期望的 id） = \"" + _DSH_BUNDLE_ID + "\"";
		if (registeredId === _DSH_LEGACY_BARE_ID) {
			detail += "\n  这是 v1.7.0 的历史缺陷：包改成 scoped 名后，bundle 内的 id 忘了同步加上 scope 前缀。"
				+ "\n  修复：把 client.js 里 __ModuleLoader__.load({ id: ... }) 改成包名全称（含 scope）。";
		}
		if (typeof console !== "undefined" && console.error) {
			console.error("[dsh-cost-tracker] client bundle 注册名与包名不一致，插件将无法加载。\n" + detail);
		}
	}

	// 第 1 层：自检本次 load() 实际写进 factories 的 id。
	// 只在确认不一致时才动，避免覆盖别人的 loader 行为或产生误报。
	if (typeof loader.factories !== "undefined") {
		if (loader.factories.has(storedIdOf(_DSH_BUNDLE_ID))) return;
		report(_DSH_BUNDLE_ID);
		var originalLoad = loader.load;
		loader.load = function (registration) {
			var r = originalLoad.apply(this, arguments);
			if (registration && typeof registration.id === "string"
				&& storedIdOf(registration.id) !== storedIdOf(_DSH_BUNDLE_ID)) {
				report(registration.id);
			}
			return r;
		};
		return;
	}

	// 第 2 层：loader 尚未就绪（HTML 里的 pending queue 模式）。
	// load() 此时只是入队，等模块系统构造时会逐条重放；这里同样不改变原行为。
	var queue = loader.pendingQueue;
	if (!Array.isArray(queue)) return;
	var queuedLoad = loader.load;
	loader.load = function (registration) {
		var r = queuedLoad.apply(this, arguments);
		if (registration && typeof registration.id === "string"
			&& storedIdOf(registration.id) !== storedIdOf(_DSH_BUNDLE_ID)) {
			report(registration.id);
		}
		return r;
	};
	if (queue.length === 0) return;
	if (storedIdOf(queue[queue.length - 1].id) === storedIdOf(_DSH_BUNDLE_ID)) return;
	report(queue[queue.length - 1].id);
})();
