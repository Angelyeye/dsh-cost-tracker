// 一次性真机核验：用本机已有凭据实打火山方舟管控面，确认签名被接受。
// 只读接口；不打印任何密钥内容。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { queryVolcenginePlan, volcengineAuthorization, VOLCENGINE_HOST, VOLCENGINE_VERSION, queryParamsToString } from '../volcengine.js'

const file = join(homedir(), '.dsh', '.credentials.yaml')
const text = readFileSync(file, 'utf8')
function pick(name) {
  const m = text.match(new RegExp('^\\s*' + name + '\\s*:\\s*(.+?)\\s*$', 'm'))
  return m ? m[1].replace(/^["']|["']$/g, '') : ''
}
const ak = pick('VOLC_ACCESSKEY')
const sk = pick('VOLC_SECRETKEY')
console.log('AK 前缀:', ak.slice(0, 4) + '…' + ak.slice(-2), '(长度 ' + ak.length + ')')
console.log('SK 是否存在:', sk.length > 0, '(长度 ' + sk.length + ')')

// ---- 1. 原始请求：直接看 HTTP 状态（区分「签名被拒」与「权限不足」） ----
for (const action of ['GetCodingPlanUsage', 'GetAFPUsage']) {
  const query = { Action: action, Version: VOLCENGINE_VERSION }
  const auth = volcengineAuthorization({ accessKeyId: ak, secretAccessKey: sk, query })
  const url = `https://${VOLCENGINE_HOST}/?${queryParamsToString(query)}`
  try {
    const r = await fetch(url, {
      headers: {
        'x-date': auth['X-Date'],
        'x-content-sha256': auth['X-Content-Sha256'],
        host: auth.Host,
        authorization: auth.Authorization,
        accept: 'application/json',
      },
    })
    const body = await r.text()
    console.log(`\n[${action}] HTTP ${r.status}`)
    console.log('  ' + body.slice(0, 600).replace(/\s+/g, ' '))
  } catch (e) {
    console.log(`\n[${action}] 请求异常: ${e.message}`)
  }
}

// ---- 2. 走插件的完整查询路径 ----
console.log('\n--- queryVolcenginePlan 端到端 ---')
try {
  const r = await queryVolcenginePlan({ accessKeyId: ak, secretAccessKey: sk })
  console.log('成功 action =', r.action)
  console.log('windows =', JSON.stringify(r.windows, null, 2))
} catch (e) {
  console.log('失败:', e.message, '| soft =', e.soft === true)
}
