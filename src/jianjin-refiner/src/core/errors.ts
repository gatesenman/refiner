/**
 * 错误人话化：把 HTTP / 网络 / 解析错误翻译成用户能处理的中文，并保留原始错误作为“详情”。
 * 约定：Error.message = `${人话}${DETAIL_SEP}${原始错误}`，界面按 DETAIL_SEP 拆成“说明 + 可折叠详情”。
 */
export const DETAIL_SEP = '\n〔详情〕';

export interface HumanError { kind: 'nokey' | 'auth' | 'notfound' | 'ratelimit' | 'network' | 'timeout' | 'url' | 'server' | 'cancel' | 'other'; message: string; detail?: string }

export function hostOf(url: string): string {
  try { return new URL(url).host || url; } catch { return url || '（未填写）'; }
}

/** 本地校验 Base URL：返回提示文案或 null */
export function checkBaseUrl(url: string): string | null {
  const u = (url ?? '').trim();
  if (!u) return '请填写接口地址（Base URL）';
  if (!/^https?:\/\//i.test(u)) return '地址需以 http:// 或 https:// 开头';
  try { new URL(u); } catch { return '地址格式不正确，例如 https://api.deepseek.com/v1'; }
  return null;
}

export function isLocalUrl(url: string): boolean {
  return /^https?:\/\/(localhost|127\.\d+\.\d+\.\d+|0\.0\.0\.0|\[::1\]|192\.168\.|10\.)/i.test((url ?? '').trim()) || /:11434\b/.test(url ?? '');
}

/** 发请求前的本地拦截：没填 Key / 地址不合法 → 不发请求 */
export function validateTextConfig(cfg: { baseUrl: string; apiKey?: string; model?: string }): HumanError | null {
  const u = checkBaseUrl(cfg.baseUrl);
  if (u) return { kind: 'url', message: u };
  if (!cfg.model?.trim()) return { kind: 'notfound', message: '请填写模型名称，例如 deepseek-chat' };
  if (!cfg.apiKey?.trim() && !isLocalUrl(cfg.baseUrl)) return { kind: 'nokey', message: '请先填写 API Key。没有 Key？可以先用演示模式体验。' };
  return null;
}

/** 把任意错误翻译成人话 */
export function humanizeError(e: unknown, ctx: { baseUrl?: string; model?: string; timeoutSec?: number } = {}): HumanError {
  const raw = String((e as any)?.message ?? e ?? '');
  if (raw.includes(DETAIL_SEP)) { const [m, d] = raw.split(DETAIL_SEP); return { kind: 'other', message: m, detail: d }; }
  const host = hostOf(ctx.baseUrl ?? '');
  const status = Number((e as any)?.status ?? raw.match(/HTTP\s*(\d{3})/)?.[1] ?? 0);
  const code = String((e as any)?.cause?.code ?? (e as any)?.code ?? '');
  if ((e as any)?.name === 'AbortError' && !(e as any)?.timeout || /已取消|aborted by user/.test(raw)) return { kind: 'cancel', message: '已取消', detail: raw };
  if ((e as any)?.timeout || /timeout|timed out|超时|ETIMEDOUT|UND_ERR_HEADERS_TIMEOUT/i.test(raw + code)) return { kind: 'timeout', message: `${host} 超过 ${ctx.timeoutSec ?? 60} 秒没有响应，请稍后重试，或检查网络 / 代理。`, detail: raw };
  if (status === 401 || status === 403) return { kind: 'auth', message: 'API Key 无效或没有权限，请检查是否复制完整、是否与所选服务商匹配。', detail: raw };
  if (status === 404) return { kind: 'notfound', message: `接口地址或模型名不对：${ctx.model ? `「${ctx.model}」在 ${host} 上不存在` : `${host} 上找不到这个接口`}。请核对 Base URL（通常以 /v1 结尾）和模型名。`, detail: raw };
  if (status === 429) return { kind: 'ratelimit', message: '请求太频繁或额度用完，请稍后再试或检查账户余额。', detail: raw };
  if (status === 400 && /model/i.test(raw)) return { kind: 'notfound', message: `服务商不认识模型「${ctx.model ?? ''}」，请检查模型名称。`, detail: raw };
  if (status >= 500) return { kind: 'server', message: `${host} 服务暂时出错（${status}），请稍后再试。`, detail: raw };
  if (/Failed to parse URL|Invalid URL|ERR_INVALID_URL/i.test(raw)) return { kind: 'url', message: '接口地址格式不正确：地址需以 http:// 或 https:// 开头。', detail: raw };
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|ECONNRESET|EHOSTUNREACH|ENETUNREACH|network|socket|Failed to fetch/i.test(raw + code)) return { kind: 'network', message: `无法连接到 ${host}。请检查网络、代理，或地址是否正确。`, detail: raw };
  if (status) return { kind: 'other', message: `服务返回错误（HTTP ${status}）。`, detail: raw };
  return { kind: 'other', message: raw || '未知错误' };
}

export function toUserError(h: HumanError): Error {
  const err = new Error(h.detail ? h.message + DETAIL_SEP + h.detail : h.message);
  (err as any).kind = h.kind;
  return err;
}

/** 界面用：把消息拆成“说明 + 详情” */
export function splitDetail(msg: string): { message: string; detail?: string } {
  const m = String(msg ?? '').replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
  const i = m.indexOf(DETAIL_SEP);
  return i < 0 ? { message: m } : { message: m.slice(0, i), detail: m.slice(i + DETAIL_SEP.length) };
}
