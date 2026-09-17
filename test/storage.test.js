// ============================================================
// dsh-cost-tracker 存储层测试（零依赖，直接 node 运行）
//   node test/storage.test.js
// 覆盖：日键/保留边界/日汇总聚合/总量合并/旧格式迁移/
//       持久化往返/损坏自愈/安全上限/索引文件可加载
// ============================================================
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createStore, collectTotals, collectByDay, rollupRecord,
  applyRetention, dayKey, writeFileAtomic, isTransientRenameError,
  checkStoreLock, writeStoreLock, releaseStoreLock,
  DETAIL_DAYS, MAX_AXIS_DAYS, MAX_DETAILS,
} from '../store.js'

let failures = 0
const passed = []
function ok(cond, msg) {
  if (cond) passed.push(msg)
  else { failures += 1; console.error('FAIL: ' + msg) }
}
function approx(a, b, msg) {
  const d = Math.abs(a - b)
  ok(d < 1e-9, `${msg} (${a} ≈ ${b})`)
}

const NOW = 1780000000000 // 固定“当前”时间用于确定性测试
const DAY = 86400000

function rec(ts, over = {}) {
  return Object.assign({
    ts, provider: 'deepseek-official', model: 'deepseek-v4-flash',
    sessionId: 's1', purpose: 'chat', cost: 0.001,
    estimated: false, period: 'flat',
    tokens: { input: 100, output: 200, cacheRead: 50, cacheWrite: 20 },
    subscription: false,
  }, over)
}
function tokensOf(r) { return r.tokens.input + r.tokens.output + r.tokens.cacheRead + r.tokens.cacheWrite }

// ---------- 1. dayKey（UTC+8 边界） ----------
{
  // 北京时间 2026-05-01 00:00 = UTC 2026-04-30 16:00
  const bjMidnight = Date.UTC(2026, 3, 30, 16, 0, 0)
  ok(dayKey(bjMidnight) === '2026-05-01', 'dayKey: UTC+8 午夜归入次日')
  ok(dayKey(bjMidnight - 1) === '2026-04-30', 'dayKey: 前一天仍归前日')
}

// ---------- 2. 保留边界（DETAIL_DAYS 天） ----------
{
  const details = [], rollups = {}
  const inWin = rec(NOW - (DETAIL_DAYS - 1) * DAY)
  const atEdge = rec(NOW - DETAIL_DAYS * DAY)   // 恰好 180 天整：属于窗口内（< cutoff 才折叠）
  const out = rec(NOW - (DETAIL_DAYS + 1) * DAY)
  // 按时间升序（与真实写入顺序一致）
  details.push(out, atEdge, inWin)
  const n = applyRetention(details, rollups, NOW)
  ok(n === 1, `保留边界: 折叠 1 条（实际 ${n}）`)
  ok(details.length === 2 && details[0] === atEdge && details[1] === inWin, '保留边界: 窗口内（含恰好 180 天）明细保留')
  ok(Object.keys(rollups).length === 1, `保留边界: 生成 1 个日汇总（实际 ${Object.keys(rollups).length}）`)
}

// ---------- 3. 日汇总聚合正确性 ----------
{
  const rollups = {}
  const r1 = rec(NOW - 200 * DAY, { period: 'peak', cost: 0.1, tokens: { input: 100, output: 100, cacheRead: 0, cacheWrite: 0 } })
  const r2 = rec(NOW - 200 * DAY, { period: 'peak', cost: 0.2, tokens: { input: 50, output: 50, cacheRead: 10, cacheWrite: 10 } })
  const r3 = rec(NOW - 200 * DAY, { period: 'off-peak', cost: 0.05, tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0 } })
  const r4 = rec(NOW - 201 * DAY, { period: 'flat', cost: 0.3, tokens: { input: 1, output: 1, cacheRead: 1, cacheWrite: 1 } })
  const rSub = rec(NOW - 202 * DAY, { provider: 'moonshot-ai', model: 'kimi-coding', subscription: true, estimated: true, cost: 0.5, period: 'flat', tokens: { input: 1000, output: 2000, cacheRead: 100, cacheWrite: 100 } })
  for (const r of [r1, r2, r3, r4, rSub]) rollupRecord(rollups, r)
  const dk200 = dayKey(r1.ts)
  const e = rollups[dk200]['deepseek-official/deepseek-v4-flash']
  ok(e.calls === 3, `日汇总: 同日同模型 3 次调用（实际 ${e.calls}）`)
  approx(e.cost, 0.35, '日汇总: 当日费用求和')
  approx(e.peak, 0.3, '日汇总: 高峰分段')
  approx(e.off, 0.05, '日汇总: 闲时分段')
  approx(e.flat, 0, '日汇总: 平峰分段')
  ok(e.input === 160 && e.output === 170 && e.cacheRead === 10 && e.cacheWrite === 10, '日汇总: tokens 分段求和')
  ok(rollups[dayKey(rSub.ts)]['moonshot-ai/kimi-coding'].subscription === true, '日汇总: 订阅模型标记保留')
  ok(rollups[dayKey(rSub.ts)]['moonshot-ai/kimi-coding'].estimated === true, '日汇总: estimated 标记保留')
}

// ---------- 4. collectTotals = 全部原始记录的精确实和 ----------
{
  const details = []
  const rollups = {}
  const all = []
  const mk = (ts, over) => { const r = rec(ts, over); all.push(r); return r }
  // 随机混合：窗口内外、峰谷平、订阅/按量
  mk(NOW - 1 * DAY, { period: 'peak', cost: 0.11, tokens: { input: 11, output: 12, cacheRead: 13, cacheWrite: 14 } })
  mk(NOW - 100 * DAY, { period: 'off-peak', cost: 0.22, tokens: { input: 21, output: 22, cacheRead: 23, cacheWrite: 24 } })
  mk(NOW - 200 * DAY, { period: 'peak', cost: 0.33, tokens: { input: 31, output: 32, cacheRead: 33, cacheWrite: 34 } })
  mk(NOW - 300 * DAY, { period: 'flat', cost: 0.44, tokens: { input: 41, output: 42, cacheRead: 43, cacheWrite: 44 } })
  mk(NOW - 400 * DAY, { provider: 'moonshot-ai', model: 'kimi-coding', subscription: true, estimated: true, period: 'flat', cost: 0.55, tokens: { input: 51, output: 52, cacheRead: 53, cacheWrite: 54 } })
  for (const r of all) {
    if (r.ts < NOW - DETAIL_DAYS * DAY) rollupRecord(rollups, r)
    else details.push(r)
  }
  const t = collectTotals(details, rollups)
  const real = all.filter(r => !r.subscription)
  const sub = all.filter(r => r.subscription)
  approx(t.realCost, real.reduce((s, r) => s + r.cost, 0), '总量: 按量费用')
  ok(t.realCalls === real.length, '总量: 按量次数')
  approx(t.realTokens, real.reduce((s, r) => s + tokensOf(r), 0), '总量: 按量 tokens')
  approx(t.subEquivalent, sub.reduce((s, r) => s + r.cost, 0), '总量: 订阅等效费用')
  ok(t.subCalls === sub.length, '总量: 订阅次数')
  approx(t.subTokens, sub.reduce((s, r) => s + tokensOf(r), 0), '总量: 订阅 tokens')
  // 分模型
  const mk2 = t.byModel.get('deepseek-official/deepseek-v4-flash')
  ok(mk2 && mk2.calls === real.length, '总量: 分模型次数')
  ok(mk2 && mk2.subscription === false, '总量: 分模型订阅标记')
  const kimi = t.byModel.get('moonshot-ai/kimi-coding')
  ok(kimi && kimi.subscription === true && kimi.estimated === true, '总量: 分模型订阅/估算标记')
}

// ---------- 5. collectByDay 分段 ----------
{
  const details = [rec(NOW - 1 * DAY, { period: 'peak', cost: 0.1 }), rec(NOW - 1 * DAY, { period: 'off-peak', cost: 0.2 })]
  const rollups = {}
  rollupRecord(rollups, rec(NOW - 200 * DAY, { period: 'peak', cost: 0.3 }))
  rollupRecord(rollups, rec(NOW - 200 * DAY, { period: 'flat', cost: 0.4 }))
  const days = collectByDay(details, rollups)
  const d1 = days.get(dayKey(NOW - 1 * DAY))
  const d200 = days.get(dayKey(NOW - 200 * DAY))
  ok(!!d1, 'collectByDay: 明细天存在')
  if (d1) { approx(d1.peak, 0.1, 'collectByDay: 明细天高峰'); approx(d1.off, 0.2, 'collectByDay: 明细天闲时') }
  ok(!!d200, 'collectByDay: 汇总天存在')
  if (d200) { approx(d200.peak, 0.3, 'collectByDay: 汇总天高峰'); approx(d200.flat, 0.4, 'collectByDay: 汇总天平峰') }
}

// ---------- 6. v1 裸数组迁移 + 持久化往返 ----------
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ct-'))
  const file = join(dir, 'records.json')
  try {
    const old1 = rec(NOW - 400 * DAY, { cost: 0.7 })
    const old2 = rec(NOW - 500 * DAY, { cost: 0.8 })
    const recent = rec(NOW - 1 * DAY, { cost: 0.9 })
    // 写 v1 格式（裸数组）
    writeFileSync(file, JSON.stringify([old1, old2, recent]), 'utf8')
    const s1 = createStore(file)
    s1.load()
    ok(s1.details.length === 1, `迁移: 明细剩 1 条（实际 ${s1.details.length}）`)
    ok(Object.keys(s1.rollups).length === 2, `迁移: 汇总 2 天（实际 ${Object.keys(s1.rollups).length}）`)
    const t1 = collectTotals(s1.details, s1.rollups)
    approx(t1.realCost, 0.7 + 0.8 + 0.9, '迁移: 总量不变')
    // 持久化为 v2
    s1.persist()
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    ok(raw.v === 2 && Array.isArray(raw.details) && raw.rollups && typeof raw.rollups === 'object', '持久化: v2 格式')
    // 重新加载（模拟重启），不重复计数
    const s2 = createStore(file)
    s2.load()
    const t2 = collectTotals(s2.details, s2.rollups)
    approx(t2.realCost, t1.realCost, '往返: 重启后总量一致（不重复计数）')
    ok(s2.details.length === 1, '往返: 明细数一致')
    ok(Object.keys(s2.rollups).length === 2, '往返: 汇总天数一致')
    // 再持久化一次（幂等）
    s2.persist()
    const s3 = createStore(file)
    s3.load()
    const t3 = collectTotals(s3.details, s3.rollups)
    approx(t3.realCost, t1.realCost, '往返: 二次加载总量仍一致')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------- 7. add() 自动折叠 ----------
{
  const s = createStore(join(tmpdir(), 'dsh-ct-add-' + Date.now() + '.json'))
  s.add(rec(NOW - 300 * DAY, { cost: 0.5 }))
  s.add(rec(NOW - 1 * DAY, { cost: 0.6 }))
  ok(s.details.length === 1 && Object.keys(s.rollups).length === 1, 'add: 超窗记录自动进汇总')
  approx(collectTotals(s.details, s.rollups).realCost, 1.1, 'add: 总量正确')
}

// ---------- 8. clear() ----------
{
  const s = createStore(join(tmpdir(), 'dsh-ct-clr-' + Date.now() + '.json'))
  s.add(rec(NOW - 300 * DAY))
  s.add(rec(NOW - 1 * DAY))
  const n = s.counts().calls
  ok(n === 2, `clear: 计数含汇总（实际 ${n}）`)
  s.clear()
  ok(s.details.length === 0 && Object.keys(s.rollups).length === 0, 'clear: 明细与汇总均清空')
  ok(s.counts().calls === 0, 'clear: 计数归零')
}

// ---------- 9. 损坏文件自愈 ----------
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ct-'))
  const file = join(dir, 'records.json')
  try {
    writeFileSync(file, '{ not json !!!', 'utf8')
    const s = createStore(file)
    s.load()
    ok(s.details.length === 0 && Object.keys(s.rollups).length === 0, '损坏: 从零开始')
    const entries = readdirSync(dir)
    const backup = entries.find(e => e.startsWith('records.json.corrupt-'))
    ok(!!backup, `损坏: 原文件备份为 .corrupt-*（实际 ${entries.join(', ')}）`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------- 10. 安全上限 ----------
{
  const s = createStore(join(tmpdir(), 'dsh-ct-max-' + Date.now() + '.json'), { maxDetails: 3 })
  // 用真实当前时间：10 条都在 180 天窗口内（不触发日汇总），安全上限裁剪到 3 条
  const realNow = Date.now()
  for (let i = 0; i < 10; i++) s.add(rec(realNow - (100 + i) * DAY))
  ok(s.details.length === 3, `安全上限: 明细不超过 maxDetails（实际 ${s.details.length}）`)
  ok(collectTotals(s.details, s.rollups).realCalls === 3, '安全上限: 窗内超额按上限裁剪')
}

// ---------- 11. 常量 sanity ----------
ok(DETAIL_DAYS === 180, '常量: DETAIL_DAYS=180')
ok(MAX_AXIS_DAYS === 730, '常量: MAX_AXIS_DAYS=730')
ok(MAX_DETAILS === 200000, '常量: MAX_DETAILS=200000')

// ---------- 12. index.js 可加载（导出插件对象） ----------
{
  const mod = await import('../index.js')
  ok(mod.default && mod.default.name === 'cost-tracker', 'index.js: 默认导出插件对象 name=cost-tracker')
  ok(typeof mod.default.apply === 'function', 'index.js: apply 为函数')
}

// ---------- 13. 原子落盘：Windows 瞬时占用（EPERM/EBUSY）必须重试而非直接失败 ----------
// 线上现场（v1.8.9 重启时）：
//   cost tracker persist failed Error: EPERM: operation not permitted,
//     rename '...cost-tracker-records.json.tmp' -> '...cost-tracker-records.json'
// 旧实现「一次 rename 定生死」：杀毒/索引器/上一个实例的瞬时占用就报错，用户看到完整堆栈。
// 新实现：临时文件名带 pid + 退避重试；仍失败也不「直接覆盖写」（半个 JSON 会被
// load() 判为损坏并改名 .corrupt-*，损失更大），而是留给调用方重试。
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ct-atomic-'))
  const file = join(dir, 'records.json')
  try {
    // 13.1 正常路径：一次 rename 成功，且不留临时文件
    const r1 = writeFileAtomic(file, '{"a":1}', {})
    ok(r1.ok && r1.mode === 'rename' && r1.attempts === 1, `原子写: 一次成功（attempts=${r1.attempts}）`)
    ok(readFileSync(file, 'utf8') === '{"a":1}', '原子写: 内容正确')
    ok(readdirSync(dir).length === 1, `原子写: 不留临时文件（实际 ${readdirSync(dir).join(', ')}）`)

    // 13.2 瞬时占用：前两次 EPERM，第三次成功 → 退避重试应救回来
    const eperm = () => Object.assign(new Error('EPERM: operation not permitted, rename'), { code: 'EPERM' })
    let calls = 0
    const sleeps = []
    let tmpName = ''
    const flaky = {
      mkdirSync: () => {},
      writeFileSync: (p, d) => { tmpName = p; writeFileSync(p, d, 'utf8') },
      unlinkSync: (p) => { try { rmSync(p) } catch (e) {} },
      renameSync: (from, to) => { calls += 1; if (calls <= 2) throw eperm(); renameSync(from, to) },
    }
    const r2 = writeFileAtomic(join(dir, 'flaky.json'), '{"b":2}', { fs: flaky, sleep: (ms) => sleeps.push(ms) })
    ok(r2.ok && r2.attempts === 3, `瞬时占用: 重试 3 次后成功（attempts=${r2.attempts}, ok=${r2.ok}）`)
    ok(sleeps.length === 2 && sleeps[0] === 20 && sleeps[1] === 40, `瞬时占用: 退避 20/40ms（实际 ${sleeps.join('/')}）`)
    ok(tmpName.includes(String(process.pid)), '临时文件名带 pid（两实例不抢同一个临时文件）')
    ok(!existsSync(join(dir, 'flaky.json.' + process.pid + '.tmp')), '瞬时占用: 成功后临时文件已 rename 走')

    // 13.3 持续占用：不覆盖目标、不无限重试、临时文件清理掉
    let unlinked = null
    let wroteTarget = false
    const locked = {
      mkdirSync: () => {},
      writeFileSync: (p) => { if (!p.endsWith('.tmp')) wroteTarget = true },
      unlinkSync: (p) => { unlinked = p },
      renameSync: () => { throw eperm() },
    }
    const r3 = writeFileAtomic(file, '{"c":3}', { fs: locked, sleep: () => {}, tries: 4 })
    ok(!r3.ok && r3.attempts === 4 && r3.transient === true, `持续占用: 重试 ${r3.attempts} 次后放弃且标记为占用`)
    ok(!wroteTarget, '持续占用: **不得**直接覆盖写目标（半个 JSON 会被判损坏）')
    ok(unlinked !== null, '持续占用: 临时文件已清理')
    ok(readFileSync(file, 'utf8') === '{"a":1}', '持续占用: 目标文件保持原内容不变')

    // 13.4 非占用类错误（ENOENT）：不值得重试，立刻失败
    let enoentCalls = 0
    const broken = {
      mkdirSync: () => {},
      writeFileSync: () => {},
      unlinkSync: () => {},
      renameSync: () => { enoentCalls += 1; throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }) },
    }
    const r4 = writeFileAtomic(join(dir, 'x.json'), '{}', { fs: broken, sleep: () => {} })
    ok(!r4.ok && enoentCalls === 1, `非占用类错误: 只尝试 1 次（实际 ${enoentCalls}）`)
    ok(r4.transient === false, '非占用类错误: 不标记为「被占用」')

    // 13.5 store.persist() 走同一路径：真实文件系统上正常落盘并可读回
    const s = createStore(file)
    s.add(rec(NOW - 1 * DAY, { cost: 1.25 }))
    ok(s.persist() === true, 'store.persist(): 正常环境下成功')
    const back = createStore(file)
    back.load()
    approx(collectTotals(back.details, back.rollups).realCost, 1.25, 'store.persist(): 落盘后可读回')

    // 13.6 错误分类：占用码可重试，代码类错误不重试
    ok(isTransientRenameError({ code: 'EPERM' }) && isTransientRenameError({ code: 'EBUSY' }), '错误分类: EPERM/EBUSY 视为占用')
    ok(!isTransientRenameError({ code: 'ENOENT' }) && !isTransientRenameError(null), '错误分类: 其它错误不重试')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// ---------- 14. 实例锁：多实例要「说清楚」，且绝不阻断启动 ----------
// 现场根因（v1.8.10）：上一个 dsh 实例还在跑，用户又起了一个 —— 两个实例写同一份
// 记录文件，旧的固定临时文件名 + 单次 rename 就撞上 EPERM。这里改成启动时直接点名。
{
  const dir = mkdtempSync(join(tmpdir(), 'dsh-ct-lock-'))
  const file = join(dir, 'records.json')
  const lockFile = file + '.lock'
  try {
    // 14.1 没有锁文件 → 不提示
    ok(checkStoreLock(file).heldBy === null, '实例锁: 无锁文件时不提示')

    // 14.2 自己写的锁不提示（同一个进程重复初始化很常见）
    writeStoreLock(file, { version: '1.8.11' })
    ok(existsSync(lockFile), '实例锁: 已写入锁文件')
    const mine = JSON.parse(readFileSync(lockFile, 'utf8'))
    ok(mine.pid === process.pid && mine.version === '1.8.11', '实例锁: 记录 pid 与版本')
    ok(checkStoreLock(file).heldBy === null, '实例锁: 自己的锁不提示')

    // 14.3 另一个「存活」实例的锁 → 明确提示（注入存活判定，避免依赖真实进程）
    writeFileSync(lockFile, JSON.stringify({ pid: 424242, at: Date.now(), version: '1.8.9' }), 'utf8')
    const held = checkStoreLock(file, { isAlive: (p) => p === 424242 })
    ok(held.heldBy === 424242, '实例锁: 认出占用者 pid')
    ok(!!held.text && held.text.includes('424242') && held.text.includes('1.8.9'), '实例锁: 提示里含 pid 与占用者版本')
    ok(/请只保留一个 dsh 实例/.test(held.text), '实例锁: 给出可执行的处理办法')

    // 14.4 陈旧锁（持有者已退出）不提示
    ok(checkStoreLock(file, { isAlive: () => false }).heldBy === null, '实例锁: 陈旧锁不提示')

    // 14.5 真实存活判定：自己 / 不存在的 pid
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid }), 'utf8')
    ok(checkStoreLock(file).heldBy === null, '实例锁: 真实判定下自己的 pid 不算占用')
    writeFileSync(lockFile, JSON.stringify({ pid: 999999 }), 'utf8')
    ok(checkStoreLock(file).heldBy === null, '实例锁: 不存在的 pid 视为陈旧')

    // 14.6 只清理自己的锁
    writeFileSync(lockFile, JSON.stringify({ pid: 424242 }), 'utf8')
    releaseStoreLock(file)
    ok(existsSync(lockFile), '实例锁: 不删别人的锁')
    writeFileSync(lockFile, JSON.stringify({ pid: process.pid }), 'utf8')
    releaseStoreLock(file)
    ok(!existsSync(lockFile), '实例锁: 退出时删掉自己的锁')

    // 14.7 锁文件损坏也不炸、不阻断
    writeFileSync(lockFile, '{ 坏掉的 json', 'utf8')
    ok(checkStoreLock(file).heldBy === null, '实例锁: 锁文件损坏时静默忽略')
    const s = createStore(file)
    s.load()
    ok(s.lock({ version: '1.8.11' }) !== null, '实例锁: store.lock() 不抛错（启动不被阻断）')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

console.log('\n' + passed.length + ' passed, ' + failures + ' failed')
process.exit(failures === 0 ? 0 : 1)
