// ============================================================
// DSH 花费统计插件 —— Client 半端（静态版）
// 由动态版 cost-tracker.client.js 改造而来：
//   host.call     → fetch('/api/cost-tracker/<method>')
//   styles.insert → 原生 <style> 标签注入
//   React         → require('react')
// 输出为浏览器 ModuleLoader bundle：exports.apply / exports.inject
// ============================================================
window.__ModuleLoader__.load({
	id: "cost-tracker-plugin",
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
		const MODEL_COLORS = [BLUE, "rgb(37,99,235)", "rgb(96,165,250)", AMBER, "rgb(191,219,254)"];
		const MEMBERSHIP = { LEVEL_FREE: "免费版", LEVEL_BASIC: "基础版", LEVEL_INTERMEDIATE: "进阶版", LEVEL_ADVANCED: "高级版" };

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
.cost-dock { font-size: 12px; color: var(--dsw-alias-label-secondary, #5b6472); display: flex; gap: 6px; align-items: center; flex-wrap: wrap; }
.cost-chart-host { position: relative; }
.cost-tip { position: absolute; top: 4px; background: var(--dsw-alias-bg-layer-1, #fff); border: 1px solid var(--dsw-alias-border-l1, #e5e7eb); border-radius: 10px; padding: 9px 12px; box-shadow: 0 6px 20px rgba(15, 23, 42, .10); font-size: 12px; pointer-events: none; white-space: nowrap; z-index: 10; }
.cost-tip-title { display: flex; justify-content: space-between; align-items: baseline; gap: 20px; font-weight: 600; margin-bottom: 5px; }
.cost-tip-title .cost-tip-total { font-variant-numeric: tabular-nums; }
.cost-tip-row { display: flex; align-items: center; gap: 6px; margin-top: 3px; }
.cost-tip-dot { display: inline-block; width: 8px; height: 8px; border-radius: 2px; flex: none; }
.cost-tip-name { flex: 1; color: var(--dsw-alias-label-secondary, #5b6472); padding-right: 20px; }
.cost-tip-val { font-variant-numeric: tabular-nums; text-align: right; }
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
		function fmtAxisMoney(v) {
			if (v <= 0) return "0";
			if (v >= 1000) return (v / 1000).toFixed(1) + "k";
			if (v >= 100) return String(Math.round(v));
			if (v >= 1) return v.toFixed(1);
			return v.toFixed(2);
		}
		function fmtTickInt(v) { return v >= 1000 ? fmtCompact(v) : String(Math.round(v)); }
		function periodText(p) { return p === "peak" ? "高峰" : p === "off-peak" ? "闲时" : "平峰"; }
		function shortModel(m) { const i = m.lastIndexOf("/"); return i >= 0 ? m.slice(i + 1) : m; }
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
			const fmtY = props.fmtY;
			const fmtValue = props.fmtValue || props.fmtY;
			const [hover, setHover] = useState(-1);
			const W = 640, H = 200, ml = 44, mr = 6, mt = 8, mb = 20;
			const pw = W - ml - mr, ph = H - mt - mb;
			const n = rows.length;
			let max = 0;
			for (const r of rows) { let s = 0; for (const v of r) s += v; if (s > max) max = s; }
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
					const r = rows[i];
					for (let j = 0; j < r.length; j++) {
						const v = r[j];
						if (v > 0) {
							const h = Math.max(0.6, (v / max) * ph);
							const y = mt + ph - ((acc + v) / max) * ph;
							children.push(e("rect", { key: "b" + i + "-" + j, x: x, y: y, width: bw, height: h, rx: 1, style: { fill: segs[j].color } }));
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
				const row = rows[hover];
				let total = 0;
				for (const v of row) total += v;
				const segRows = [];
				for (let j = 0; j < segs.length; j++) {
					const v = row[j] || 0;
					if (v <= 0) continue;
					segRows.push(e("div", { key: j, className: "cost-tip-row" },
						e("span", { className: "cost-tip-dot", style: { background: segs[j].color } }),
						e("span", { className: "cost-tip-name" }, segs[j].name),
						e("span", { className: "cost-tip-val" }, fmtValue(v))));
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

		function filterRow(days, setDays, onExport, onRefresh, msg, busy, peakWindows) {
			return e("div", { className: "cost-row" },
				e("select", { className: "cost-select", value: String(days), onChange: ev => setDays(parseInt(ev.target.value, 10)) },
					e("option", { value: "7" }, "近 7 天"),
					e("option", { value: "14" }, "近 14 天"),
					e("option", { value: "30" }, "近 30 天"),
					e("option", { value: "0" }, "全部")),
				e("button", { className: "cost-btn", onClick: onExport, disabled: busy }, "导出 CSV"),
				e("button", { className: "cost-btn", onClick: onRefresh, disabled: busy }, busy ? "刷新中…" : "刷新"),
				msg ? e("span", { className: "cost-hint" }, msg) : null,
				e("span", { className: "cost-spacer" }),
				e("span", { className: "cost-hint" }, "峰谷时段（北京时间）：" + peakWindows + " · 闲时半价"));
		}

		function statCards(dash) {
			return e("div", { className: "cost-cards" },
				statCard("消费金额（CNY）", "¥" + fmtMoney(dash.realCost),
					"高峰 ¥" + fmtMoney(dash.peakCost) + " · 闲时 ¥" + fmtMoney(dash.offCost) + (dash.flatCost > 0 ? " · 平峰 ¥" + fmtMoney(dash.flatCost) : "") + " · 仅含按量模型"),
				statCard("API 请求次数", fmtInt(dash.realCalls + dash.subCalls),
					"按量 " + fmtInt(dash.realCalls) + " · 订阅 " + fmtInt(dash.subCalls)),
				statCard("Tokens", fmtInt(dash.realTokens + dash.subTokens),
					"按量 " + fmtCompact(dash.realTokens) + " · 订阅 " + fmtCompact(dash.subTokens)));
		}

		function mainPanel(dash, tab, setTab) {
			let chart = null;
			let legend = [];
			const labels = dash.byDay.map(d => d.label);
			const titles = dash.byDay.map(d => d.date);
			const fmtMoneyValue = (v) => "¥" + fmtMoney(v);
			if (tab === "period") {
				const segs = [{ name: "闲时", color: BLUE }, { name: "高峰", color: AMBER }, { name: "平峰", color: GRAY }];
				const rows = dash.byDay.map(d => [d.off, d.peak, d.flat]);
				chart = e(StackedBarsChart, { labels, titles, segs, rows, fmtY: fmtAxisMoney, fmtValue: fmtMoneyValue });
				legend = segs;
			} else {
				const models = dash.byModelDay.filter(m => !m.subscription);
				const top = models.slice(0, 5);
				const rest = models.slice(5);
				const segs = top.map((m, i) => ({ name: shortModel(m.model), color: MODEL_COLORS[i % MODEL_COLORS.length] }));
				if (rest.length) segs.push({ name: "其他", color: GRAY });
				const rows = dash.byDay.map((d, di) => {
					const row = top.map(m => (m.days[di] ? m.days[di].cost : 0));
					if (rest.length) {
						let s = 0;
						for (const m of rest) s += m.days[di] ? m.days[di].cost : 0;
						row.push(s);
					}
					return row;
				});
				chart = e(StackedBarsChart, { labels, titles, segs, rows, fmtY: fmtAxisMoney, fmtValue: fmtMoneyValue });
				legend = segs;
			}
			return e("div", { className: "cost-panel" },
				e("div", { className: "cost-row" },
					e("span", { className: "cost-panel-title" }, "消费金额（CNY）¥" + fmtMoney(dash.realCost)),
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

		function Dashboard() {
			const [days, setDays] = useState(7);
			const [dash, setDash] = useState(null);
			const [dashErr, setDashErr] = useState("");
			const [kimi, setKimi] = useState(null);
			const [balance, setBalance] = useState(null);
			const [tab, setTab] = useState("period");
			const [msg, setMsg] = useState("");
			const [busy, setBusy] = useState(false);
			const [now, setNow] = useState(Date.now());
			const [manualKey, setManualKey] = useState("");

			function loadDash(d) {
				apiCall("dashboard", { days: d }).then(v => {
					if (v && v.ok) { setDash(v); setDashErr(""); }
					else setDashErr(v && v.error ? String(v.error) : "数据加载失败");
				}).catch(err => setDashErr(String(err && err.message ? err.message : err)));
			}
			function loadKimi(force) {
				apiCall("kimi-usage", { force: !!force }).then(v => setKimi(v)).catch(() => {});
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
				apiCall("kimi-usage", { force: false }).then(v => setKimi(v)).catch(() => {});
				apiCall("balance", {}).then(v => { setBalance(v); setBusy(false); }).catch(() => setBusy(false));
			}

			useEffect(() => { loadDash(days); }, [days]);
			useEffect(() => { loadKimi(false); loadBalance(""); }, []);
			useEffect(() => {
				const id = setInterval(() => setNow(Date.now()), 30000);
				return () => clearInterval(id);
			}, []);

			return e("div", { className: "cost-wrap" },
				e("div", { className: "cost-h1" }, pluginIcon(18), "花费统计"),
				filterRow(days, setDays, onExport, onRefresh, msg, busy, dash ? dash.peakWindows : "9:00-12:00 · 14:00-18:00"),
				dashErr ? e("div", { className: "cost-err", style: { marginTop: "8px" } }, dashErr) : null,
				!dash && !dashErr ? e("div", { className: "cost-hint", style: { marginTop: "12px" } }, "加载中…") : null,
				dash ? statCards(dash) : null,
				dash ? mainPanel(dash, tab, setTab) : null,
				subPanel(kimi, dash, now, () => loadKimi(true)),
				balancePanel(balance, manualKey, setManualKey, k => loadBalance(k)),
				dash ? modelSections(dash) : null,
				dash ? recentPanel(dash) : null);
		}

		function StatusLine(props) {
			const sessionId = props && props.sessionId ? String(props.sessionId) : "";
			const [s, setS] = useState(null);
			useEffect(() => {
				let alive = true;
				function load() {
					apiCall("summary", { sessionId }).then(v => { if (alive) setS(v); }).catch(() => {});
				}
				load();
				const id = setInterval(load, 30000);
				return () => { alive = false; clearInterval(id); };
			}, [sessionId]);
			if (!s) return null;
			if (s.subscription) {
				return e("div", { className: "cost-dock" },
					e("span", null, "本会话 订阅套餐 · 等效 ¥" + fmtMoney(s.sessionSub) + "（仅供参考）"),
					s.kimiWeeklyRemaining !== null && s.kimiWeeklyRemaining !== undefined ? e("span", null, "· 周配额剩 " + fmtInt(s.kimiWeeklyRemaining)) : null);
			}
			return e("div", { className: "cost-dock" },
				e("span", null, "本会话 ¥" + fmtMoney(s.sessionCost) + " · 累计 ¥" + fmtMoney(s.totalCost)),
				s.isDeepSeek ? e("span", { style: { color: s.peak ? AMBER : GREEN } }, "· " + (s.peak ? "当前高峰价" : "当前闲时价（半价）")) : null);
		}

		const inject = ["slots"];
		function apply(ctx) {
			applyStyles(ctx);
			const slots = ctx.get("slots");
			if (slots === undefined) return;
			slots.inject("settings.section", () => slots.register(
				{ name: "settings.section", id: "cost-dashboard", order: 30, label: "花费统计" },
				() => e(Dashboard, {}),
			));
			slots.inject("conversation.composer.dock", () => slots.register(
				{ name: "conversation.composer.dock", id: "cost", order: 1 },
				(props) => e(StatusLine, props || {}),
			));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
