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
import { extractReleaseNotes, parseSections, mergeSections, buildReleaseBody } from '../scripts/release-notes.mjs'
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

console.log('[5] 分类标注 <!-- release: xxx --> 决定发布说明的分组')
{
  // 分类由 CHANGELOG 显式标注，不靠标题文本猜（v1.11.2 起）。
  const body = [
    '<!-- release: 问题修复 -->',
    '### 一、某技术主题',
    '',
    '- 修了 A ｜ Fixed A',
    '- 修了 B ｜ Fixed B',
    '',
    '<!-- release: 新增功能 -->',
    '### 二、另一个技术主题',
    '',
    '- 加了 C ｜ Added C',
  ].join('\n')
  const secs = mergeSections(parseSections(body))
  check('产出两个分类', secs.length === 2, '实际 ' + secs.length)
  const names = secs.map((s) => s.cn)
  check('分类名来自标注（非标题文本）', names.includes('问题修复') && names.includes('新增功能'), JSON.stringify(names))
  check('技术主题名不进入分类名', !names.some((n) => n.includes('某技术主题')), JSON.stringify(names))
  // 顺序：新增功能在问题修复之前（公告习惯）
  check('新增功能排在问题修复之前', names.indexOf('新增功能') < names.indexOf('问题修复'), JSON.stringify(names))
  const bug = secs.find((s) => s.cn === '问题修复')
  check('问题修复收纳了它下面的两条', bug && bug.items.length === 2, JSON.stringify(bug))
}

console.log('[6] 中英分栏：条目 `中文 ｜ English` 各取一边')
{
  const body = [
    '<!-- release: 新增功能 -->',
    '### 一、主题',
    '',
    '- 中文描述 ｜ English description',
  ].join('\n')
  const text = buildReleaseBody({ version: '9.9.9', body, prevVersion: '9.9.8' })
  check('含中文段锚点', text.includes('<h3 id="cn-v9.9.9">'), text.slice(0, 80))
  check('含英文段锚点', text.includes('<h3 id="en-v9.9.9">'))
  check('中文段只出现中文', text.includes('- 中文描述') && !/^- 中文描述 ｜/m.test(text))
  check('英文段只出现英文', text.includes('- English description'))
  // 取「英文段起点」之后的内容做检查（用 h3 标签定位，不能用 en-v9.9.9 这个字符串——
  // 顶部语言切换链接里也有它，会把中文段一起算进来）
  const enStart = text.indexOf('<h3 id="en-v9.9.9">')
  const enPart = enStart >= 0 ? text.slice(enStart) : ''
  check('英文段不混入中文', enPart.length > 0 && !enPart.includes('中文描述'), JSON.stringify(enPart.slice(0, 120)))
}

console.log('[7] 末尾 Full Changelog 对比链接')
{
  const body = '<!-- release: 修复 -->\n### 一、X\n\n- 条目\n'
  const text = buildReleaseBody({ version: '1.2.3', body, prevVersion: '1.2.2' })
  check('含 compare 链接', text.includes('/compare/v1.2.2...v1.2.3'), text.split('\n').pop())
  const noPrev = buildReleaseBody({ version: '1.2.3', body, prevVersion: '' })
  check('无上一版时不输出 compare 行', !noPrev.includes('Full Changelog'))
}

console.log('[8] 真实 CHANGELOG v1.11.2：分类与双语气节齐全')
{
  const text = readFileSync(join(root, 'CHANGELOG.md'), 'utf8')
  const found = extractReleaseNotes(text, '1.11.2')
  check('v1.11.2 章节存在', !!found)
  if (found) {
    const secs = mergeSections(parseSections(found.body))
    const names = secs.map((s) => s.cn)
    check('含新增功能', names.includes('新增功能'), JSON.stringify(names))
    check('含问题修复', names.includes('问题修复'), JSON.stringify(names))
    check('分类数量不超过 5（不因技术小标题膨胀）', secs.length <= 5, JSON.stringify(names))
    const out = buildReleaseBody({ version: '1.11.2', body: found.body, prevVersion: '1.11.1' })
    check('中英锚点都在', out.includes('<h3 id="cn-v1.11.2">') && out.includes('<h3 id="en-v1.11.2">'))
    check('compare 链接指向 v1.11.1...v1.11.2', out.includes('v1.11.1...v1.11.2'))
  }
}

console.log('')
if (failures > 0) {
  console.log(`FAILED: ${failures} 项断言未通过`)
  process.exit(1)
}
console.log('OK: 全部断言通过')
