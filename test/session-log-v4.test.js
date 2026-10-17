// ============================================================
// 会话日志枚举：`session[.vN].jsonl[.zstd]` 全版本识别
//   node test/session-log-v4.test.js
//
// 拦的事故（0.2.x 实测）：宿主从某版起把新会话写成 `session.v4.jsonl.zstd`，
// 而插件只枚举 v3/无版本名两个硬编码后缀 → **v4 及以后的新会话被静默跳过**：
// 历史导入清单里 0 个 v4、没有报错、界面只是「不再补录新会话」。
// 本机实测：`.dsh\sessions` 下 68 个 v4 + 20 个 v3 + 10 个 legacy，
// 修复前 listSessionLogs 只返回 29 个（v3/legacy），v4 全丢。
//
// 断言两层：
//   ① 纯函数层：临时目录树（v3/v4/v5/无版本/plain/zstd/坏目录/非会话文件）；
//   ② 真实目录（存在时）：本机 sessions 根下的 v4 必须被枚举到。
// ============================================================
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { listSessionLogs } from '../import.js'

const here = dirname(fileURLToPath(import.meta.url))
let failures = 0
function check(name, condition, detail) {
  if (condition) console.log(`  PASS  ${name}`)
  else {
    failures++
    console.log(`  FAIL  ${name}`)
    if (detail !== undefined) console.log(`        ${detail}`)
  }
}

console.log('dsh-cost-tracker 会话日志枚举测试')
console.log('')

const home = mkdtempSync(join(tmpdir(), 'cost-sess-'))
const root = join(home, 'sessions')
function mk(project, session, files) {
  const dir = join(root, project, session)
  mkdirSync(dir, { recursive: true })
  for (const f of files) writeFileSync(join(dir, f), '', 'utf8')
}

// 每个会话目录放一份或多份，验证「版本高者优先 / 同版本 zstd 优先」
mk('proj-a', 'sess-v4', ['session.v4.jsonl.zstd'])
mk('proj-a', 'sess-v3', ['session.v3.jsonl.zstd'])
mk('proj-a', 'sess-legacy', ['session.jsonl.zstd'])
mk('proj-a', 'sess-plain', ['session.v3.jsonl'])
mk('proj-a', 'sess-v5', ['session.v5.jsonl.zstd'])
mk('proj-a', 'sess-mixed', ['session.v3.jsonl.zstd', 'session.v4.jsonl.zstd'])   // 取 v4
mk('proj-a', 'sess-same-version', ['session.v4.jsonl', 'session.v4.jsonl.zstd']) // 取 zstd
mk('proj-a', 'sess-empty', [])
mk('proj-a', 'sess-other', ['notes.txt', 'session.v3.jsonl.bak'])
mkdirSync(join(root, 'proj-a', 'not-a-dir-file.txt'), { recursive: true }) // 目录名像文件也不该炸
mk('proj-b', 'sess-b-v4', ['session.v4.jsonl.zstd', 'extra.jsonl'])

console.log('[1] 临时目录树：版本优先级与容错')
{
  const found = listSessionLogs(root).map((p) => p.slice(root.length + 1).replace(/\\/g, '/')).sort()
  const expected = [
    'proj-a/sess-legacy/session.jsonl.zstd',
    'proj-a/sess-mixed/session.v4.jsonl.zstd',
    'proj-a/sess-plain/session.v3.jsonl',
    'proj-a/sess-same-version/session.v4.jsonl.zstd',
    'proj-a/sess-v3/session.v3.jsonl.zstd',
    'proj-a/sess-v4/session.v4.jsonl.zstd',
    'proj-a/sess-v5/session.v5.jsonl.zstd',
    'proj-b/sess-b-v4/session.v4.jsonl.zstd',
  ].sort()
  check('枚举结果与预期完全一致（含 v4/v5）', JSON.stringify(found) === JSON.stringify(expected),
    '实际=' + JSON.stringify(found))
  check('v4 会话被识别（本次修复的核心）', found.indexOf('proj-a/sess-v4/session.v4.jsonl.zstd') >= 0)
  check('未知的更高版本 v5 也自动识别（不再需要改枚举）', found.indexOf('proj-a/sess-v5/session.v5.jsonl.zstd') >= 0)
  check('同版本 zstd 优先于 plain', found.indexOf('proj-a/sess-same-version/session.v4.jsonl.zstd') >= 0
    && found.indexOf('proj-a/sess-same-version/session.v4.jsonl') < 0, JSON.stringify(found))
  check('一个会话只出一份日志（不重复计数）',
    found.filter((p) => p.indexOf('proj-a/sess-mixed/') === 0).length === 1, JSON.stringify(found))
  check('空目录/无日志目录/非会话文件被跳过',
    found.every((p) => p.indexOf('sess-empty') < 0 && p.indexOf('sess-other') < 0 && p.indexOf('not-a-dir-file') < 0),
    JSON.stringify(found))
  check('旧格式（无版本号 / v3 / plain）继续被识别',
    found.indexOf('proj-a/sess-legacy/session.jsonl.zstd') >= 0 && found.indexOf('proj-a/sess-v3/session.v3.jsonl.zstd') >= 0
      && found.indexOf('proj-a/sess-plain/session.v3.jsonl') >= 0)
  check('根目录不存在时返回空数组（不抛错）', Array.isArray(listSessionLogs(join(home, 'nope'))) && listSessionLogs(join(home, 'nope')).length === 0)
}

console.log('[2] 真实 sessions 根（存在时）：v4 必须被枚举到')
{
  const realRoot = process.env.USERPROFILE ? join(process.env.USERPROFILE, '.dsh', 'sessions') : ''
  if (!realRoot || !existsSync(realRoot)) {
    console.log('  SKIP  本机没有 ~/.dsh/sessions（并非失败）')
  } else {
    const found = listSessionLogs(realRoot)
    const names = found.map((p) => p.split(/[\\/]/).pop())
    const v4 = names.filter((n) => n === 'session.v4.jsonl.zstd').length
    let v4OnDisk = 0
    for (const proj of readdirSync(realRoot, { withFileTypes: true })) {
      if (!proj.isDirectory()) continue
      const projDir = join(realRoot, proj.name)
      for (const sess of readdirSync(projDir, { withFileTypes: true })) {
        if (!sess.isDirectory()) continue
        if (existsSync(join(projDir, sess.name, 'session.v4.jsonl.zstd'))) v4OnDisk++
      }
    }
    check('磁盘上的 v4 会话全部被枚举到', v4 === v4OnDisk, `枚举到 ${v4} / 磁盘 ${v4OnDisk}`)
    check('枚举总数不少于 v4 数量', found.length >= v4, `total=${found.length} v4=${v4}`)
  }
}

try { rmSync(home, { recursive: true, force: true }) } catch (e) {}

console.log('')
if (failures > 0) {
  console.log(`FAILED: ${failures} 项断言未通过`)
  process.exit(1)
}
console.log('OK: 全部断言通过')
process.exit(0)
