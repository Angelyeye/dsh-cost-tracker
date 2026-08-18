# 花费统计 · 设置导航图标

图标文件：`icon.svg`（16×16，`currentColor`，深浅主题自适应）。
设计：双柱（统计图表）+ 描边 ¥（花费），与 DSH 内置 16px outline 图标风格一致。
多尺寸 / 深浅色 / 导航行效果预览：`icon-preview.html`。

## 生效方式（已打补丁）

DSH 设置外壳的侧边导航图标由 `navIcon(sectionId)` 按 id 硬编码，
未知 id 一律回退为齿轮，slot 注册项（`id` / `order` / `label`）不支持自带图标。
因此图标通过直接给外壳产物打补丁接入：

- 文件：`<dsh 安装目录>/node_modules/@deepseek-ai/dsh-client-ui-settings-general/lib/client.js`
- 位置：`function navIcon(id)` 内，在 `if (id === "models")` 之前插入 `cost-dashboard` 分支
- 当前安装目录：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`
- `/plugins/<id>/client.js` 每次请求实时读盘且 `no-cache`，**刷新页面即生效**，无需重启

## 升级后重新应用

DSH 升级 / 重装会覆盖该文件。重新打补丁：在同一函数开头插入下面的分支
（`react_jsx_runtime` 与 `SettingsRoot_module_css_default` 为该文件内已有变量）：

```js
if (id === "cost-dashboard") return (0, react_jsx_runtime.jsxs)("svg", {
	className: SettingsRoot_module_css_default.navIcon,
	width: 16,
	height: 16,
	viewBox: "0 0 16 16",
	fill: "none",
	xmlns: "http://www.w3.org/2000/svg",
	children: [(0, react_jsx_runtime.jsx)("rect", {
		x: 1.5, y: 8.6, width: 3.1, height: 5.9, rx: 0.9, fill: "currentColor"
	}), (0, react_jsx_runtime.jsx)("rect", {
		x: 5.9, y: 5.2, width: 3.1, height: 9.3, rx: 0.9, fill: "currentColor"
	}), (0, react_jsx_runtime.jsxs)("g", {
		fill: "none", stroke: "currentColor", strokeWidth: 1.3,
		strokeLinecap: "round", strokeLinejoin: "round",
		children: [(0, react_jsx_runtime.jsx)("path", { d: "M10.7 4.9 L12.3 7.2 L13.9 4.9" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M12.3 7.2 L12.3 10.9" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M10.9 7.8 L13.7 7.8" }),
			(0, react_jsx_runtime.jsx)("path", { d: "M10.9 9.5 L13.7 9.5" })]
	})]
});
```
