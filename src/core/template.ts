/** 极简模板：{{a.b}}，{{#if x}}...{{/if}}，{{#unless x}}...{{/unless}} */
export function render(tpl: string, vars: Record<string, unknown>): string {
  const get = (path: string): unknown => path.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), vars);
  let out = tpl.replace(/\{\{#if\s+([\w.]+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_m, p, body) => {
    const v = get(p);
    return v && !(Array.isArray(v) && !v.length) ? body : '';
  });
  out = out.replace(/\{\{#unless\s+([\w.]+)\}\}([\s\S]*?)\{\{\/unless\}\}/g, (_m, p, body) => {
    const v = get(p);
    return v && !(Array.isArray(v) && !v.length) ? '' : body;
  });
  out = out.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, p) => {
    const v = get(p);
    if (v == null) return '';
    return typeof v === 'string' ? v : JSON.stringify(v, null, 1);
  });
  return out;
}

/** 条件表达式：stepId.field op value | always | never */
export function evalWhen(expr: string | undefined, results: Record<string, any>): boolean {
  if (!expr || expr.trim() === 'always') return true;
  if (expr.trim() === 'never') return false;
  return expr.split(/\s*\|\|\s*/).some((orPart) =>
    orPart.split(/\s*&&\s*/).every((part) => {
      const m = part.trim().match(/^([\w-]+)\.([\w]+)\s*(<=|>=|==|!=|<|>)\s*(.+)$/);
      if (!m) return false;
      const [, step, field, op, rawB] = m;
      const a = results[step]?.[field];
      if (a === undefined) return false; // 依赖步骤未运行 → 条件不成立
      let b: any = rawB.trim();
      if (b === 'true') b = true; else if (b === 'false') b = false; else if (!isNaN(Number(b))) b = Number(b); else b = b.replace(/^['"]|['"]$/g, '');
      switch (op) {
        case '<': return a < b; case '>': return a > b; case '<=': return a <= b; case '>=': return a >= b;
        case '==': return a == b; case '!=': return a != b;
      }
      return false;
    }),
  );
}
