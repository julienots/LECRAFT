/**
 * Évaluateur Molang (langage d'expressions des add-ons de l'édition Bedrock) :
 * nombres, chaînes 'x', booléens, opérateurs (! - * / + < > <= >= == != && || ?? ? :),
 * variables (query./q., variable./v., temp./t., context./c.), fonctions (q.block_state('…'),
 * math.sin…), affectations simples et blocs `a; b; return c;`. Les expressions sont compilées
 * une fois puis évaluées avec un contexte.
 */
export type MolangValue = number | string | boolean;
export interface MolangContext {
  /** Requêtes : `q.nom` ou `q.nom(args)`. */
  query?: (name: string, args: MolangValue[]) => MolangValue | undefined;
  variables?: Record<string, MolangValue>;
}

type Node =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'var'; ns: string; name: string }
  | { k: 'call'; ns: string; name: string; args: Node[] }
  | { k: 'un'; op: string; a: Node }
  | { k: 'bin'; op: string; a: Node; b: Node }
  | { k: 'tern'; c: Node; a: Node; b: Node }
  | { k: 'assign'; ns: string; name: string; v: Node }
  | { k: 'seq'; list: Node[]; ret: boolean[] };

const NS: Record<string, string> = { q: 'query', query: 'query', v: 'variable', variable: 'variable', t: 'temp', temp: 'temp', c: 'context', context: 'context', math: 'math' };

function tokenize(src: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== "'") j++;
      out.push(src.slice(i, j + 1));
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (['==', '!=', '<=', '>=', '&&', '||', '??', '->'].includes(two)) {
      out.push(two);
      i += 2;
      continue;
    }
    if (/[0-9.]/.test(c)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (src[j] === 'f' || src[j] === 'F') j++;
      out.push(src.slice(i, j));
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_.:]/.test(src[j])) j++;
      out.push(src.slice(i, j));
      i = j;
      continue;
    }
    out.push(c);
    i++;
  }
  return out;
}

class Parser {
  i = 0;
  constructor(private t: string[]) {}
  peek() {
    return this.t[this.i];
  }
  next() {
    return this.t[this.i++];
  }
  eat(s: string) {
    if (this.t[this.i] === s) {
      this.i++;
      return true;
    }
    return false;
  }
  program(): Node {
    const list: Node[] = [];
    const ret: boolean[] = [];
    while (this.i < this.t.length) {
      const isRet = this.peek()?.toLowerCase() === 'return';
      if (isRet) this.next();
      if (this.peek() === ';') {
        this.next();
        continue;
      }
      list.push(this.expr());
      ret.push(isRet);
      if (!this.eat(';')) break;
    }
    if (list.length === 1 && !ret[0]) return list[0];
    return { k: 'seq', list, ret };
  }
  expr(): Node {
    const lhs = this.ternary();
    if (this.peek() === '=' && lhs.k === 'var') {
      this.next();
      return { k: 'assign', ns: lhs.ns, name: lhs.name, v: this.expr() };
    }
    return lhs;
  }
  ternary(): Node {
    const c = this.binary(0);
    if (this.eat('?')) {
      const a = this.expr();
      if (this.eat(':')) return { k: 'tern', c, a, b: this.expr() };
      return { k: 'tern', c, a, b: { k: 'num', v: 0 } };
    }
    return c;
  }
  static PREC: Record<string, number> = { '??': 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '>': 5, '<=': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7 };
  binary(min: number): Node {
    let a = this.unary();
    for (;;) {
      const op = this.peek();
      const p = Parser.PREC[op];
      if (p === undefined || p <= min - 1 || p < min) break;
      this.next();
      const b = this.binary(p + 1);
      a = { k: 'bin', op, a, b };
    }
    return a;
  }
  unary(): Node {
    if (this.eat('!')) return { k: 'un', op: '!', a: this.unary() };
    if (this.eat('-')) return { k: 'un', op: '-', a: this.unary() };
    if (this.eat('+')) return this.unary();
    return this.primary();
  }
  primary(): Node {
    const t = this.next();
    if (t === undefined) return { k: 'num', v: 0 };
    if (t === '(') {
      const e = this.expr();
      this.eat(')');
      return e;
    }
    if (t === '{') {
      // bloc { a; b; }
      const list: Node[] = [];
      while (this.peek() !== undefined && this.peek() !== '}') {
        list.push(this.expr());
        this.eat(';');
      }
      this.eat('}');
      return { k: 'seq', list, ret: list.map(() => false) };
    }
    if (t.startsWith("'")) return { k: 'str', v: t.slice(1, -1) };
    if (/^[0-9.]/.test(t)) return { k: 'num', v: parseFloat(t) };
    const low = t.toLowerCase();
    if (low === 'true') return { k: 'num', v: 1 };
    if (low === 'false') return { k: 'num', v: 0 };
    const dot = low.indexOf('.');
    const ns = dot > 0 ? NS[low.slice(0, dot)] ?? low.slice(0, dot) : 'query';
    const name = dot > 0 ? low.slice(dot + 1) : low;
    if (this.peek() === '(') {
      this.next();
      const args: Node[] = [];
      while (this.peek() !== undefined && this.peek() !== ')') {
        args.push(this.expr());
        if (!this.eat(',')) break;
      }
      this.eat(')');
      return { k: 'call', ns, name, args };
    }
    return { k: 'var', ns, name };
  }
}

const num = (v: MolangValue | undefined): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : v === undefined ? 0 : Number(v) || 0);
const truthy = (v: MolangValue | undefined) => (typeof v === 'string' ? v.length > 0 : num(v) !== 0);
const DEG = Math.PI / 180;

const MATH: Record<string, (a: number[]) => number> = {
  sin: (a) => Math.sin(a[0] * DEG),
  cos: (a) => Math.cos(a[0] * DEG),
  abs: (a) => Math.abs(a[0]),
  floor: (a) => Math.floor(a[0]),
  ceil: (a) => Math.ceil(a[0]),
  round: (a) => Math.round(a[0]),
  trunc: (a) => Math.trunc(a[0]),
  sqrt: (a) => Math.sqrt(a[0]),
  pow: (a) => Math.pow(a[0], a[1]),
  min: (a) => Math.min(a[0], a[1]),
  max: (a) => Math.max(a[0], a[1]),
  clamp: (a) => Math.min(Math.max(a[0], a[1]), a[2]),
  lerp: (a) => a[0] + (a[1] - a[0]) * a[2],
  mod: (a) => a[0] % a[1],
  exp: (a) => Math.exp(a[0]),
  ln: (a) => Math.log(a[0]),
  pi: () => Math.PI,
  atan: (a) => Math.atan(a[0]) / DEG,
  atan2: (a) => Math.atan2(a[0], a[1]) / DEG,
  asin: (a) => Math.asin(a[0]) / DEG,
  acos: (a) => Math.acos(a[0]) / DEG,
  random: (a) => a[0] + Math.random() * (a[1] - a[0]),
  random_integer: (a) => Math.floor(a[0] + Math.random() * (a[1] - a[0] + 1)),
  die_roll: (a) => { let s = 0; for (let i = 0; i < a[0]; i++) s += a[1] + Math.random() * (a[2] - a[1]); return s; },
  hermite_blend: (a) => 3 * a[0] * a[0] - 2 * a[0] * a[0] * a[0],
  sign: (a) => Math.sign(a[0]),
  copy_sign: (a) => Math.sign(a[1]) * Math.abs(a[0]),
  min_angle: (a) => { let x = a[0] % 360; if (x > 180) x -= 360; if (x < -180) x += 360; return x; },
};

function evalNode(n: Node, ctx: MolangContext, temp: Record<string, MolangValue>): MolangValue {
  switch (n.k) {
    case 'num':
      return n.v;
    case 'str':
      return n.v;
    case 'var': {
      if (n.ns === 'math') return n.name === 'pi' ? Math.PI : 0;
      if (n.ns === 'variable' || n.ns === 'context') return ctx.variables?.[n.name] ?? 0;
      if (n.ns === 'temp') return temp[n.name] ?? 0;
      return ctx.query?.(n.name, []) ?? 0;
    }
    case 'call': {
      const args = n.args.map((a) => evalNode(a, ctx, temp));
      if (n.ns === 'math') return (MATH[n.name] ?? (() => 0))(args.map(num));
      return ctx.query?.(n.name, args) ?? 0;
    }
    case 'un':
      return n.op === '!' ? !truthy(evalNode(n.a, ctx, temp)) ? 1 : 0 : -num(evalNode(n.a, ctx, temp));
    case 'bin': {
      if (n.op === '&&') return truthy(evalNode(n.a, ctx, temp)) && truthy(evalNode(n.b, ctx, temp)) ? 1 : 0;
      if (n.op === '||') return truthy(evalNode(n.a, ctx, temp)) || truthy(evalNode(n.b, ctx, temp)) ? 1 : 0;
      const a = evalNode(n.a, ctx, temp);
      if (n.op === '??') return a === undefined || a === 0 ? evalNode(n.b, ctx, temp) : a;
      const b = evalNode(n.b, ctx, temp);
      switch (n.op) {
        case '==':
          return eq(a, b) ? 1 : 0;
        case '!=':
          return eq(a, b) ? 0 : 1;
        case '<':
          return num(a) < num(b) ? 1 : 0;
        case '>':
          return num(a) > num(b) ? 1 : 0;
        case '<=':
          return num(a) <= num(b) ? 1 : 0;
        case '>=':
          return num(a) >= num(b) ? 1 : 0;
        case '+':
          return num(a) + num(b);
        case '-':
          return num(a) - num(b);
        case '*':
          return num(a) * num(b);
        case '/':
          return num(b) === 0 ? 0 : num(a) / num(b);
      }
      return 0;
    }
    case 'tern':
      return truthy(evalNode(n.c, ctx, temp)) ? evalNode(n.a, ctx, temp) : evalNode(n.b, ctx, temp);
    case 'assign': {
      const v = evalNode(n.v, ctx, temp);
      if (n.ns === 'temp') temp[n.name] = v;
      else if (ctx.variables) ctx.variables[n.name] = v;
      return v;
    }
    case 'seq': {
      let last: MolangValue = 0;
      for (let i = 0; i < n.list.length; i++) {
        last = evalNode(n.list[i], ctx, temp);
        if (n.ret[i]) return last;
      }
      return n.ret.some(Boolean) ? last : n.list.length === 1 ? last : 0;
    }
  }
}

function eq(a: MolangValue, b: MolangValue) {
  if (typeof a === 'string' || typeof b === 'string') return String(a) === String(b);
  return num(a) === num(b);
}

const cache = new Map<string, Node>();

/** Compile (avec cache) puis évalue une expression Molang. Une erreur donne 0. */
export function molang(expr: MolangValue | undefined, ctx: MolangContext = {}): MolangValue {
  if (expr === undefined) return 0;
  if (typeof expr !== 'string') return expr;
  let n = cache.get(expr);
  if (!n) {
    try {
      n = new Parser(tokenize(expr)).program();
    } catch {
      n = { k: 'num', v: 0 };
    }
    if (cache.size > 5000) cache.clear();
    cache.set(expr, n);
  }
  try {
    return evalNode(n, ctx, {});
  } catch {
    return 0;
  }
}

export const molangNum = (e: MolangValue | undefined, ctx?: MolangContext) => num(molang(e, ctx));
export const molangBool = (e: MolangValue | undefined, ctx?: MolangContext) => truthy(molang(e, ctx));
