#!/usr/bin/env node
// ============================================================
// 从 CHANGELOG.md 提取某个版本的章节正文 —— 供 GitHub Release 备注使用。
//
// 背景：发布工作流原先只做 `npm publish`，从不创建 Release，于是 Releases 页
// 一直停在手动建的 v1.7.0（1.7.1 之后的 18 个版本全缺）。v1.9.4 起由 CI 自动建：
// 备注直接取本脚本从 CHANGELOG 抽出的该版章节，避免「仓库里写了、Release 里没有」。
//
// 用法：
//   node scripts/release-notes.mjs --version 1.9.4        # 打印该版章节正文
//   node scripts/release-notes.mjs --version 1.9.4 --check # 只校验章节存在（无输出）
//
// 约定：CHANGELOG 的版本章节以 `## v<版本>(日期)` 起，直到下一个 `## ` 或文件末尾。
// 找不到时退出码 1（工作流据此回落到 --generate-notes，不会让发布变红）。
// ============================================================
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const CHANGELOG = join(here, '..', 'CHANGELOG.md')

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

function main(argv) {
  const args = argv.slice(2)
  const i = args.findIndex((a) => a === '--version' || a === '-v')
  const version = i >= 0 ? args[i + 1] : ''
  const checkOnly = args.includes('--check')
  if (!version) {
    console.error('用法：node scripts/release-notes.mjs --version <x.y.z> [--check]')
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
  process.stdout.write(found.body + '\n')
  return 0
}

// 仅在作为脚本直接执行时跑 main（被 import 做单测时不执行）
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main(process.argv))
}

export { CHANGELOG }
