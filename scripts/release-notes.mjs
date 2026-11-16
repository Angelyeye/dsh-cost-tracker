#!/usr/bin/env node
// ============================================================
// 从 CHANGELOG.md 提取某个版本的章节正文 —— 供 GitHub Release 备注使用。
//
// 背景：发布工作流原先只做 `npm publish`，从不创建 Release，于是 Releases 页
// 一直停在手动建的 v1.7.0（1.7.1 之后的 18 个版本全缺）。v1.9.4 起由 CI 自动建：
// 备注直接取本脚本从 CHANGELOG 抽出的该版章节，避免「仓库里写了、Release 里没有」。
//
// v1.11.2 起排成与 deepseek-ai/deepseek-harness 一致的版式：
//
//   [中文](#cn-v1.2.3) | [English](#en-v1.2.3)
//
//   <h3 id="cn-v1.2.3">新增功能</h3>
//   - …… @贡献者
//
//   ### 体验优化
//   - ……
//
//   ### 问题修复
//   - ……
//
//   <h3 id="en-v1.2.3">New Features</h3>
//   - … by @贡献者
//
//   Full Changelog: https://github.com/.../compare/v<prev>...v<this>
//
// 语言切换用锚点（故首个标题写成 <h3 id>，后续用普通 ###），这样点一下就能
// 跳到对应语言段，长 Release 页不必手动滚动。
//
// 用法：
//   node scripts/release-notes.mjs --version 1.11.2        # 打印该版章节正文
//   node scripts/release-notes.mjs --version 1.11.2 --check # 只校验章节存在（无输出）
//   node scripts/release-notes.mjs --version 1.11.2 --json  # 结构化输出（便于测试）
//
// 约定：CHANGELOG 的版本章节以 `## v<版本>(日期)` 起，直到下一个 `## ` 或文件末尾。
// 找不到时退出码 1（工作流据此回落到 --generate-notes，不会让发布变红）。
// ============================================================
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CHANGELOG = join(here, '..', 'CHANGELOG.md')

const REPO_URL = 'https://github.com/Angelyeye/dsh-cost-tracker'

/** 转义正则元字符（版本号里有点号） */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * 抽取某版本的章节正文（不含标题行）。
 * @param {string} changelog - CHANGELOG 全文
 * @param {string} version - 形如 `1.9.4`（也接受 `v1.9.4`）
 * @returns {{title:string, body:string}|null}
 */
export function extractReleaseNotes(changelog, version) {
  const v = String(version || '').trim().replace(/^v/i, '')
  if (!v) return null
  const lines = String(changelog || '').split(/\r?\n/)
  const head = new RegExp('^##\\s+v?' + escapeRe(v) + '(?![\\d.])')
  let start = -1
  for (let i = 0; i < lines.length; i += 1) {
    if (head.test(lines[i])) { start = i; break }
  }
  if (start < 0) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^##\s+/.test(lines[i])) { end = i; break }
  }
  const body = lines.slice(start + 1, end).join('\n').trim()
  return { title: lines[start].replace(/^##\s+/, '').trim(), body }
}

/** 上一个版本号（按 CHANGELOG 中出现顺序；没有则返回空串） */
export function previousVersionOf(changelog, version) {
  const v = String(version || '').trim().replace(/^v/i, '')
  const all = []
  for (const line of String(changelog || '').split(/\r?\n/)) {
    const m = /^##\s+v?(\d+\.\d+\.\d+(?:[-+][^\s(]*)?)/.exec(line)
    if (m) all.push(m[1])
  }
  const i = all.indexOf(v)
  return i >= 0 && i + 1 < all.length ? all[i + 1] : ''
}

// ---------- 分类来源 ----------------------------------------------------
// 分类由 **CHANGELOG 显式标注**，不靠猜：
//
//   <!-- release: 问题修复 -->
//   ### 三、云端区间真正生效
//   ...
//
// 标记作用于**紧随其后的那个 `###` 段落**，只是注释，不影响 CHANGELOG 阅读。
//
// 为何不按标题文本猜分类：v1.11.2 首次实现试过关键词匹配，结果「三张统计卡主值
// 跟随时间筛选」这类技术主题被判成「其他变更」、「新增「今天」选项」被判成
// 「新增功能」，同一版的技术细节被拆到不同分类里，读者看不出改动全貌。
//
// 未标注的段落回落到「其他变更」，生成时会给出提示（不阻断发布）。
const MARKER_RE = /^<!--\s*release:\s*(.+?)\s*-->$/

const KNOWN = {
  '新增功能': 'New Features',
  '体验优化': 'Improvements',
  '问题修复': 'Bug Fixes',
  '文档更新': 'Documentation',
  '测试': 'Tests',
  '其他变更': 'Chores',
  '破坏性变更': 'Breaking Changes',
}

function classify(heading) {
  const h = String(heading || '').trim()
  return { cn: h, en: KNOWN[h] || h }
}

/** 条目里已含 @xxx 就原样保留，否则追加作者（若给了 author） */
function withAuthor(line, author) {
  if (!author) return line
  if (/@[A-Za-z0-9-]+/.test(line)) return line
  const trimmed = line.replace(/[。.]?\s*$/, '')
  return trimmed + '。 @' + author
}

/**
 * 从条目里取出英文部分。
 *
 * 约定：CHANGELOG 条目可写成 `中文描述 ｜ English description`（全角竖线分隔），
 * 英文段取竖线右边；没有竖线时整条按原文输出。
 * 不用机翻 —— 发布说明里的技术描述翻错了比不翻更糟。
 */
const EN_SPLIT = /\s*[|｜]\s*/
function englishOf(line) {
  const parts = String(line || '').split(EN_SPLIT)
  return parts.length > 1 ? parts.slice(1).join(' | ').trim() : String(line || '')
}

/** 中文段取竖线左边；没有分隔则整条 */
function chineseOf(line) {
  const parts = String(line || '').split(EN_SPLIT)
  return parts.length > 1 ? parts[0].trim() : String(line || '')
}

/**
 * 把 CHANGELOG 章节正文解析成「按显式分类标注分组」的条目。
 *
 * 规则：
 *   · `<!-- release: 问题修复 -->` 设定**紧随其后的 `###` 段落**所属分类；
 *   · 一个 `###` 段落的正文里，`- ` 列表项是条目，加粗行并入条目；
 *   · 段落小标题本身不进条目（它是技术主题名，不是发布说明要展示的内容）；
 *   · 表格与代码块跳过（Release 页不适合承载表格）。
 *
 * 未标注 `<!-- release: -->` 的段落归入「其他变更」，并在 warn 里列出，
 * 方便补标 —— 但不阻断发布（老版本 CHANGELOG 本来就没有标记）。
 */
export function parseSections(body) {
  const out = []
  const unmarked = []
  let cur = null
  const push = (headingCn, headingEn) => {
    cur = { cn: headingCn, en: headingEn, items: [] }
    out.push(cur)
  }
  // 开头可能直接是正文（没有 ### 段落），先给一个兜底分类
  push('其他变更', 'Chores')
  let pending = null // 待绑定到下一个 ### 段落的分类

  let inFence = false
  for (const raw of String(body || '').split(/\r?\n/)) {
    const line = raw.trim()
    if (/^```/.test(line)) { inFence = !inFence; continue }
    if (inFence) continue
    if (!line) continue

    // 分类标注
    const mk = MARKER_RE.exec(line)
    if (mk) { pending = mk[1]; continue }

    // ### 段落：若有标记就开新分类，否则沿用当前分类
    const h3 = /^###\s+(.+)$/.exec(line)
    if (h3) {
      if (pending) {
        const c = classify(pending)
        // 同一分类只开一次，后续段落并进去
        const exist = out.find((s) => s.cn === c.cn && s !== out[0])
        if (exist) { cur = exist } else { push(c.cn, c.en) }
        pending = null
      } else if (cur !== out[0]) {
        unmarked.push(h3[1].trim())
      }
      // 段落标题只用于归类，本身不作为条目输出
      continue
    }

    if (/^\|/.test(line) || /^-{3,}$/.test(line)) continue

    const li = /^[-*]\s+(.+)$/.exec(line)
    if (li) { cur.items.push(li[1].trim()); continue }

    const bold = /^\*\*(.+?)\*\*[：:]?\s*(.*)$/.exec(line)
    if (bold) {
      const tail = (bold[2] || '').trim()
      cur.items.push(tail ? bold[1].trim() + '：' + tail : bold[1].trim())
      continue
    }
    cur.items.push(line)
  }

  const sections = out
    .map((s) => ({ ...s, items: Array.from(new Set(s.items.filter(Boolean))) }))
    .filter((s) => s.items.length > 0)
  sections.unmarkedSections = unmarked
  return sections
}

/**
 * 合并同类分类：多个技术主题可能都归到「问题修复」，
 * 发布说明里应当只出现一个「问题修复」标题，而不是重复若干次。
 */
export function mergeSections(sections) {
  const order = ['破坏性变更', '新增功能', '体验优化', '文档更新', '问题修复', '测试', '其他变更']
  const map = new Map()
  for (const s of sections || []) {
    const k = s.cn || '其他变更'
    if (!map.has(k)) map.set(k, { cn: k, en: s.en || k, items: [] })
    const t = map.get(k)
    for (const it of s.items || []) if (!t.items.includes(it)) t.items.push(it)
  }
  return Array.from(map.values())
    .filter((s) => s.items.length > 0)
    .sort((a, b) => {
      const ia = order.indexOf(a.cn), ib = order.indexOf(b.cn)
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib)
    })
}

/**
 * 生成与 deepseek-harness 版式一致的 Release 正文。
 * @param {object} opts { version, body, prevVersion, author, repoUrl }
 */
export function buildReleaseBody(opts) {
  const o = opts || {}
  const v = String(o.version || '').replace(/^v/i, '')
  const tag = 'v' + v
  const cnId = 'cn-' + tag
  const enId = 'en-' + tag
  const repo = o.repoUrl || REPO_URL
  const sections = o.sections || mergeSections(parseSections(o.body || ''))

  const lines = []
  lines.push(`[中文](#${cnId}) | [English](#${enId})`)
  lines.push('')

  // ---------- 中文 ----------
  // 条目若写成 `中文 ｜ English`，中文段只取竖线左边，避免中英混排。
  let first = true
  for (const s of sections) {
    lines.push(first ? `<h3 id="${cnId}">${s.cn}</h3>` : `### ${s.cn}`)
    first = false
    lines.push('')
    for (const it of s.items) lines.push('- ' + withAuthor(chineseOf(it), o.author))
    lines.push('')
  }

  // ---------- English ----------
  // 英文段优先用条目自带的英文（CHANGELOG 里 `- <中文> ｜ <English>` 的分隔写法），
  // 没有英文时退回原文 —— 宁可显示中文，也不要凭空机翻出不准的技术描述。
  first = true
  for (const s of sections) {
    lines.push(first ? `<h3 id="${enId}">${s.en}</h3>` : `### ${s.en}`)
    first = false
    lines.push('')
    for (const it of s.items) {
      const en = englishOf(it)
      const withBy = o.author && !/@[A-Za-z0-9-]+/.test(en)
        ? en.replace(/[。.]?\s*$/, '') + ' by @' + o.author
        : en
      lines.push('- ' + withBy)
    }
    lines.push('')
  }

  // ---------- Full Changelog ----------
  if (o.prevVersion) {
    const p = String(o.prevVersion).replace(/^v/i, '')
    lines.push(`Full Changelog: ${repo}/compare/v${p}...${tag}`)
    lines.push('')
  }

  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function main(argv) {
  const args = argv.slice(2)
  const i = args.findIndex((a) => a === '--version' || a === '-v')
  const version = i >= 0 ? args[i + 1] : ''
  const checkOnly = args.includes('--check')
  const asJson = args.includes('--json')
  const ai = args.findIndex((a) => a === '--author')
  const author = ai >= 0 ? (args[ai + 1] || '').replace(/^@/, '') : ''
  const wantTitle = args.includes('--title')
  if (!version) {
    console.error('用法：node scripts/release-notes.mjs --version <x.y.z> [--check] [--json] [--author <name>]')
    return 2
  }
  let text
  try {
    text = readFileSync(CHANGELOG, 'utf8')
  } catch (e) {
    console.error('读取 CHANGELOG.md 失败：' + (e && e.message ? e.message : e))
    return 1
  }
  const found = extractReleaseNotes(text, version)
  if (found === null) {
    console.error(`CHANGELOG.md 里没有 v${String(version).replace(/^v/i, '')} 的章节`)
    return 1
  }
  if (checkOnly) return 0

  // --title：只输出 Release 标题补充说明（章节标题里版本号之后的部分，通常是空的）。
  // 工作流用它拼 `v<版本> — <补充>`；没有补充就只显示版本号。
  if (wantTitle) {
    const t = String(found.title || '')
      .replace(/^v?[0-9][^\s]*\s*/, '')  // 去掉开头的版本号
      .replace(/^[(（].*?[)）]\s*/, '')   // 去掉紧随其后的 (2026-11-17)
      .trim()
    process.stdout.write(t + '\n')
    return 0
  }

  const sections = mergeSections(parseSections(found.body))
  const prevVersion = previousVersionOf(text, version)

  if (asJson) {
    process.stdout.write(JSON.stringify({ title: found.title, sections, prevVersion, body: found.body }, null, 2) + '\n')
    return 0
  }
  process.stdout.write(buildReleaseBody({ version, sections, prevVersion, author }) + '\n')
  return 0
}

// 仅在作为脚本直接执行时跑 main（被 import 做单测时不执行）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv))
}

export { CHANGELOG }
