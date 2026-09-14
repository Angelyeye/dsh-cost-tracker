// ============================================================
// DSH 花费统计插件 —— 极简 settings schema（零依赖）
//
// 背景：注册 `ctx.settings` 命名空间需要一个 schemastery 形状的 schema，
// 但本插件不强制依赖任何 npm 包（DSH 宿主自带的 schemastery 也不保证可从
// 本插件的解析路径加载）。实测该服务只依赖 schema 的三项能力：
//
//   1. 可调用：schema(rawValue) → 校验/归一化后的值（服务端 resolve() 会调用它）
//   2. 每个节点带 `.meta`（`redactSecrets` 据此识别 role:'secret' 字段）
//   3. `.toJSON()`（`describe()` 会序列化后发给浏览器，渲染配置卡片）
//
// 因此这里用普通对象 + 函数自建同形状的 schema：既能被宿主消费，
// 又不引入依赖。字段一律 `.default(undefined)`——只有用户在卡片里显式
// 保存才写入用户层，从而不覆盖配置文件里的既有值。
// ============================================================

const TYPES = {};

/**
 * 生成一个无类型限制的节点（接受任意 JSON 值，保留原样）。
 * @param {object} meta
 */
function anyNode(meta) {
  const node = (v) => v;
  node.meta = meta || {};
  node.toJSON = () => ({ type: undefined, meta: node.meta });
  return node
}

/** 归一化容器里的原始值：只保留 dict 中声明过的键 */
function pick(node, raw) {
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) return undefined
  const out = {}
  for (const [k, child] of Object.entries(node.dict)) {
    if (!(k in raw)) continue
    const v = child(raw[k])
    if (v !== undefined) out[k] = v
  }
  return out
}

function makeNode(type, meta, extra) {
  const node = (v) => {
    if (type === 'object') return pick(node, v)
    if (v === undefined) return undefined
    if (type === 'number') {
      const n = Number(v)
      return Number.isFinite(n) ? n : undefined
    }
    if (type === 'boolean') return typeof v === 'boolean' ? v : undefined
    if (type === 'string') return typeof v === 'string' ? v : undefined
    return v
  }
  node.meta = meta || {}
  Object.assign(node, extra || {})
  node.toJSON = () => {
    const out = { type, meta: node.meta }
    if (node.dict) {
      out.dict = {}
      for (const [k, child] of Object.entries(node.dict)) out.dict[k] = child.toJSON()
    }
    return out
  }
  return node
}

/**
 * 极简 schema 构造器（只用到了 object/string/number/boolean）。
 * 用法与 schemastery 一致：
 *   const S = defineSchema()
 *   S.object({ url: S.string().default(undefined), token: S.string().role('secret').default(undefined) })
 */
export function defineSchema() {
  const api = {
    /** 对象容器：返回只含声明键的对象 */
    object(dict) {
      const node = makeNode('object', { default: {} })
      node.dict = dict || {}
      return node
    },
    string() {
      const node = makeNode('string', {})
      node.role = (r) => { node.meta.role = r; return node }
      node.default = (d) => { node.meta.default = d; return node }
      node.description = (d) => { node.meta.description = d; return node }
      return node
    },
    number() {
      const node = makeNode('number', {})
      node.role = (r) => { node.meta.role = r; return node }
      node.default = (d) => { node.meta.default = d; return node }
      node.description = (d) => { node.meta.description = d; return node }
      return node
    },
    /** 非负整数（步长 1，与 schemastery 的 natural 对齐） */
    natural() {
      const node = makeNode('number', { step: 1, min: 0 })
      node.default = (d) => { node.meta.default = d; return node }
      node.description = (d) => { node.meta.description = d; return node }
      return node
    },
    boolean() {
      const node = makeNode('boolean', {})
      node.default = (d) => { node.meta.default = d; return node }
      node.description = (d) => { node.meta.description = d; return node }
      return node
    },
    any() { return anyNode({}) },
  }
  return api
}

export const Schema = defineSchema()

/** 供测试断言：schema 形状是否符合宿主的三项要求 */
export function schemaShape(schema) {
  return {
    callable: typeof schema === 'function',
    hasToJSON: typeof schema.toJSON === 'function',
    json: schema.toJSON(),
  }
}

export { TYPES }
