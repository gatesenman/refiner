/** API Key 加密存储：settings.json 中所有名为 apiKey 的字段以 enc:v1:<base64> 保存（Electron safeStorage / Windows DPAPI） */
export interface Cipher { available(): boolean; encrypt(s: string): Buffer; decrypt(b: Buffer): string }
export const ENC_PREFIX = 'enc:v1:';

function mapKeys(o: any, fn: (v: string) => string): any {
  if (Array.isArray(o)) return o.map((x) => mapKeys(x, fn));
  if (!o || typeof o !== 'object') return o;
  const r: any = {};
  for (const [k, v] of Object.entries(o)) r[k] = k === 'apiKey' && typeof v === 'string' ? fn(v) : mapKeys(v, fn);
  return r;
}

/** 写盘前：明文 → 密文（加密不可用时原样保留） */
export function sealSettings(s: any, c: Cipher): any {
  if (!c.available()) return s;
  return mapKeys(s, (v) => (!v || v.startsWith(ENC_PREFIX) ? v : ENC_PREFIX + c.encrypt(v).toString('base64')));
}

/** 读盘后：密文 → 明文；返回是否发现了需要迁移的明文 Key */
export function openSettings(s: any, c: Cipher): { settings: any; plaintextFound: boolean; failed: number } {
  let plaintextFound = false, failed = 0;
  const settings = mapKeys(s, (v) => {
    if (!v) return v;
    if (!v.startsWith(ENC_PREFIX)) { plaintextFound = true; return v; }
    try { return c.decrypt(Buffer.from(v.slice(ENC_PREFIX.length), 'base64')); } catch { failed++; return ''; }
  });
  return { settings, plaintextFound, failed };
}
