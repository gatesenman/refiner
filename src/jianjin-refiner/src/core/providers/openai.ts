import { humanizeError, toUserError, validateTextConfig } from '../errors';
import type { ChatRequest, ImageProvider, TextProvider, VideoJob, VideoProvider } from '../types';

export interface TextConfig { onUsage?: (u: { input: number; output: number }) => void; baseUrl: string; apiKey: string; model: string; stream?: boolean; maxTokens?: number; timeoutMs?: number; extraHeaders?: Record<string, string> }
export interface ImageConfig { baseUrl: string; apiKey: string; model: string; size?: string }
export interface VideoConfig { submitUrl: string; pollUrl: string; apiKey: string; model: string }

type FetchLike = typeof fetch;

function joinUrl(base: string, path: string) {
  return base.replace(/\/+$/, '') + path;
}

/**
 * OpenAI 兼容 Chat Completions 适配器：OpenAI / DeepSeek / 通义千问 DashScope 兼容模式 /
 * Moonshot / 智谱 / Ollama(/v1) / LM Studio / vLLM 等均可用。支持 SSE 流式。
 */
export function createOpenAIText(cfg: TextConfig, fetchImpl: FetchLike = fetch): TextProvider {
  return {
    id: `openai:${cfg.model}`,
    async chat(req: ChatRequest, onDelta, signal) {
      const bad = validateTextConfig(cfg);
      if (bad) throw toUserError(bad);
      const stream = cfg.stream !== false;
      // 60 秒内没有收到响应头视为超时（流式输出开始后不再计时）
      const ctrl = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, cfg.timeoutMs ?? 60000);
      const onAbort = () => ctrl.abort();
      signal?.addEventListener('abort', onAbort);
      let res: Response;
      try {
        res = await fetchImpl(joinUrl(cfg.baseUrl, '/chat/completions'), {
        method: 'POST',
        signal: ctrl.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}),
          ...(cfg.extraHeaders ?? {}),
        },
        body: JSON.stringify({ model: cfg.model, messages: req.messages, temperature: req.temperature, stream, ...(cfg.maxTokens ? { max_tokens: cfg.maxTokens } : {}) }),
        });
      } catch (e: any) {
        if (signal?.aborted) throw new Error('已取消');
        throw toUserError(humanizeError(timedOut ? Object.assign(new Error('timeout'), { timeout: true }) : e, { ...cfg, timeoutSec: Math.round((cfg.timeoutMs ?? 60000) / 1000) }));
      } finally { clearTimeout(timer); }
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        throw toUserError(humanizeError(Object.assign(new Error(`HTTP ${res.status}：${t.slice(0, 300)}`), { status: res.status }), cfg));
      }
      const ctype = res.headers.get('content-type') ?? '';
      if (!stream || !ctype.includes('event-stream') || !res.body) {
        const j: any = await res.json();
        const text = j?.choices?.[0]?.message?.content ?? '';
        if (j?.usage) cfg.onUsage?.({ input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 });
        onDelta?.(text);
        return text;
      }
      const reader = (res.body as any).getReader();
      const dec = new TextDecoder();
      let buf = '';
      let full = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          if (!line.startsWith('data:')) continue;
          const data = line.slice(5).trim();
          if (data === '[DONE]') continue;
          try {
            const j = JSON.parse(data);
            if (j?.usage?.prompt_tokens != null) cfg.onUsage?.({ input: j.usage.prompt_tokens ?? 0, output: j.usage.completion_tokens ?? 0 });
            const d = j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.message?.content ?? '';
            if (d) { full += d; onDelta?.(d); }
          } catch { /* 忽略心跳等非 JSON 行 */ }
        }
      }
      // 去掉推理模型的 <think> 段
      return full.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
    },
  };
}

/** OpenAI 兼容图像生成：POST {base}/images/generations */
export function createOpenAIImage(cfg: ImageConfig, fetchImpl: FetchLike = fetch): ImageProvider {
  return {
    id: `image:${cfg.model}`,
    async generate(req) {
      const res = await fetchImpl(joinUrl(cfg.baseUrl, '/images/generations'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) },
        body: JSON.stringify({ model: cfg.model, prompt: req.prompt, n: req.n ?? 1, size: req.size ?? cfg.size ?? '1024x1024' }),
      });
      if (!res.ok) throw new Error(`图像接口 HTTP ${res.status}：${(await res.text().catch(() => '')).slice(0, 200)}`);
      const j: any = await res.json();
      const list: any[] = j?.data ?? j?.images ?? [];
      return list.map((d) => (d.b64_json ? `data:image/png;base64,${d.b64_json}` : d.url)).filter(Boolean);
    },
  };
}

function pick(obj: any, paths: string[]): any {
  for (const p of paths) {
    const v = p.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
    if (v != null) return v;
  }
  return undefined;
}

function mapStatus(s: any): VideoJob['status'] {
  const v = String(s ?? '').toLowerCase();
  if (/succ|complete|done|finish/.test(v)) return 'succeeded';
  if (/fail|error|cancel/.test(v)) return 'failed';
  if (/queue|pend|submit|wait/.test(v)) return 'queued';
  return 'running';
}

/**
 * 通用异步视频适配器（薄层）：提交 → 轮询。
 * 兼容常见“任务式”接口：返回 id / task_id / data.task_id；轮询返回 status / video_url / data.video.url 等。
 * pollUrl 中用 {id} 占位。
 */
export function createHttpVideo(cfg: VideoConfig, fetchImpl: FetchLike = fetch): VideoProvider {
  const headers = { 'Content-Type': 'application/json', ...(cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}) };
  return {
    id: `video:${cfg.model}`,
    async submit(req) {
      const res = await fetchImpl(cfg.submitUrl, { method: 'POST', headers, body: JSON.stringify({ model: cfg.model, prompt: req.prompt, duration: req.duration, image_url: req.image }) });
      if (!res.ok) throw new Error(`视频接口 HTTP ${res.status}：${(await res.text().catch(() => '')).slice(0, 200)}`);
      const j: any = await res.json();
      const id = pick(j, ['id', 'task_id', 'data.task_id', 'data.id', 'output.task_id']);
      if (!id) throw new Error('视频接口未返回任务 id');
      return { id: String(id), status: mapStatus(pick(j, ['status', 'task_status', 'data.task_status', 'output.task_status']) ?? 'queued') };
    },
    async poll(jobId) {
      const res = await fetchImpl(cfg.pollUrl.replace('{id}', encodeURIComponent(jobId)), { headers });
      if (!res.ok) throw new Error(`视频轮询 HTTP ${res.status}`);
      const j: any = await res.json();
      const url = pick(j, ['video_url', 'url', 'data.video_url', 'data.video.url', 'output.video_url', 'data.task_result.videos.0.url', 'content.video_url']);
      return { id: jobId, status: url ? 'succeeded' : mapStatus(pick(j, ['status', 'task_status', 'data.task_status', 'output.task_status', 'data.status'])), url, message: pick(j, ['message', 'error.message', 'data.task_status_msg']) };
    },
  };
}
