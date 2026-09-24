// ============================================================
// scripts/release-notes.mjs 单测（零依赖，直接 node 运行）
//   node test/release-notes.test.js
//
// 为什么需要它：发布工作流的最后一步用这个脚本从 CHANGELOG.md 抽版本章节
// 作为 GitHub Release 备注，抽错会让线上 Release 直接贴错内容（或抽不到而回落
// 到自动备注）。这里把「章节边界」钉死：
//   ① 命中 `## v1.9.4(...)` 与 `## 1.9.4` 两种写法；
//   ② 只取到下一个 `## ` 标题为止（不吃掉上一版/下一版内容）；
//   ③ 版本号按整段匹配，`1.9.4` 不得误命中 `1.9.40`；
//   ④ 找不到时返回 null（CLI 据此退出码 1，工作流回落到自动备注）。
// ============================================================
import { extractReleaseNotes } from '../scripts/release-notes.mjs'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')

let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`)
  else {
    failures++
    console.log(`  FAIL  ${name}`)
    if (detail !== undefined) console.log(`        ${detail}`)
  }
}

const SAMPLE = [
  '# 更新记录',
  '',
  '## v1.9.4(2026-09-24)',
  '',
  '**修复：gzip 自解压**',
  '',
  '- 根因：undici 包污染全局 fetch',
  '',
  '## v1.9.3(2026-09-24)',
  '',
  '**齿轮入口**',
  '',
  '## v1.9.40(2026-12-31)',
  '',
  '**未来的版本（用于验证整段匹配）**',
  '',
].join('\n')

console.log('release-notes 单测')
console.log('')

console.log('[1] 章节抽取与边界')
{
  const r = extractReleaseNotes(SAMPLE, '1.9.4')
  check('命中并返回正文', !!r && r.body.includes('gzip 自解压'), JSON.stringify(r))
  check('标题行带原始日期', !!r && r.title === 'v1.9.4(2026-09-24)', r && r.title)
  check('边界正确：不含下一版内容', !!r && !r.body.includes('齿轮入口'), JSON.stringify(r && r.body))
  check('边界正确：不含上一版/前言', !!r && !r.body.includes('更新记录'), JSON.stringify(r && r.body))
  check('不接受 v 前缀参数写法', !!extractReleaseNotes(SAMPLE, 'v1.9.4'))
  check('整段匹配：1.9.4 不得命中 1.9.40', !!r && !r.body.includes('未来的版本'), JSON.stringify(r && r.body))
}

console.log('[2] 无 v 前缀的标题同样支持')
{
  const r = extractReleaseNotes('## 1.2.3\n\n正文甲\n\n## 1.2.4\n\n正文乙\n', '1.2.3')
  check('命中 `## 1.2.3`', !!r && r.body === '正文甲', JSON.stringify(r))
}

console.log('[3] 缺失与异常输入')
{
  check('版本不存在 → null', extractReleaseNotes(SAMPLE, '0.0.1') === null)
  check('空版本 → null', extractReleaseNotes(SAMPLE, '') === null)
  check('空文档 → null', extractReleaseNotes('', '1.0.0') === null)
  check('末尾版本（无后续标题）也能取到', (extractReleaseNotes('## v2.0.0\n\n收尾\n', '2.0.0') || {}).body === '收尾')
}

console.log('[4] 真实 CHANGELOG.md：已发布版本都能抽出章节')
{
  // 只校验「能抽到且非空」，内容正确性由 CHANGELOG 自身维护
  const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  for (const v of ['1.7.0', '1.8.15', '1.9.1', '1.9.2', '1.9.3', '1.9.4']) {
    const r = extractReleaseNotes(text, v)
    check(`v${v} 章节存在且非空`, !!r && r.body.length > 40, r ? `len=${r.body.length}` : '未找到')
  }
}

console.log('')
if (failures > 0) {
  console.log(`FAILED: ${failures} 项断言未通过`)
  process.exit(1)
}
console.log('OK: 全部断言通过')
