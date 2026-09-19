# 第三方组件与数据来源声明

本插件（`@angelyeye/dsh-cost-tracker`）自身以 MIT 许可发布（见仓库根 `LICENSE`）。
以下列出**随包分发**的第三方成果及其许可，按要求保留原始版权声明。

---

## 1. 多厂商模型价格目录（数据）

- **文件**：`docs/provider-pricing.json`（由 `vendor-catalog.js` 读取，随 npm 包分发）
- **上游**：`dsh-cost-meter` v1.5.41 · <https://github.com/Han-1413141/dsh-cost-meter>
- **用途**：本插件在其基础上**改编**为该目录：字段保持（`input` / `cachedInput` /
  `output` / `billingMode` / `sourceUrl` / `checkedAt`），并在运行时按
  `catalogFxRate`（默认 7.2）把 USD/1M tokens 折算为人民币入账；
  provider 别名归一与匹配逻辑为本项目自行实现（`vendor-catalog.js`）。
- **许可**：MIT

```
MIT License

Copyright (c) 2026 dsh-cost-meter contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

> 目录中的单价来自各厂商公开定价页（每条带 `sourceUrl` / `checkedAt` 便于溯源），
> 仅作**参考折算**用途；实际账单请以各厂商控制台为准。

---

## 2. 会话日志回放思路（技术参考，无代码拷贝）

`import.js` 的 zstd frame 边界扫描（`scanZstdFrames`）**改编自** `dsh-cost-meter`
的 `lib/backfill.js`（MIT，同上许可），用于逐个追加批次解压宿主会话日志；
其余解析/去重/覆盖判定逻辑为本项目自行实现，并针对本插件的「实时记录 + 导入记录」
双源口径做了重新设计（清单快跳、逐调用键去重、覆盖判定）。

---

## 3. 其他

- 官方价格同步（`price-sync.js`）解析的是 DeepSeek 官方定价页的公开 HTML，
  不包含第三方代码。
- 运行时**零第三方 npm 依赖**：仅使用 Node 内置模块。
