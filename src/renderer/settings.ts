import type { Providers, ChatRequest, TextProvider, ImageProvider, VideoProvider } from '../core';
import { createMockText, createMockMedia, imageMedia, videoMedia, uid, estimateTokens } from '../core';

export interface Settings {
  theme: 'dark' | 'light';
  demoMode: boolean;
  /** 专家模式：露出自由度、算子、智能体流水线等引擎细节（默认关闭 = 简单模式） */
  expert: boolean;
  /** 演示提示条已看过并关闭 */
  demoNoticeSeen?: boolean;
  /** 首页“怎么用”说明已看过（有过作品后不再显示） */
  howSeen?: boolean;
  text: { baseUrl: string; apiKey: string; model: string; stream: boolean; maxTokens?: number };
  /** 进入下一步时自动开始运行（默认关：停在准备态，让用户先选范围） */
  autoRunNext?: boolean;
  /** 界面缩放（Ctrl+= / Ctrl+-） */
  fontScale?: number;
  /** 价目表覆盖（元/百万 tokens） */
  prices?: Record<string, { input: number; output: number }>;
  /** 预算上限（元），0 或空 = 不限 */
  budget?: { perRun?: number; perWork?: number };
  /** v1.8 多处同时处理的并行数（1 = 依次处理） */
  parallel?: number;
  /** v2.1 多处细化时逐处确认（每改完一处先问再继续） */
  confirmEach?: boolean;
  /** v2.2 第一次铺整体前先做多视角预写作（默认开） */
  survey?: boolean;
  /** v2.2 适用于所有作品的偏好 */
  globalPrefs?: import('../core').Pref[];
  /** 自动备份保留份数 */
  backupKeep?: number;
  /** 自动更新地址（generic：放 latest.yml 的目录 URL） */
  updateUrl?: string;
  image: { enabled: boolean; baseUrl: string; apiKey: string; model: string; size: string };
  video: { enabled: boolean; submitUrl: string; pollUrl: string; apiKey: string; model: string };
}

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  demoMode: true,
  expert: false,
  text: { baseUrl: 'https://api.deepseek.com/v1', apiKey: '', model: 'deepseek-chat', stream: true },
  image: { enabled: false, baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'dall-e-3', size: '1024x1024' },
  video: { enabled: false, submitUrl: '', pollUrl: '', apiKey: '', model: '' },
};

export const TEXT_PRESETS: { name: string; baseUrl: string; model: string }[] = [
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: '通义千问（DashScope 兼容模式）', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { name: 'Moonshot / Kimi', baseUrl: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
  { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
  { name: '硅基流动 SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen2.5-7B-Instruct' },
  { name: 'Ollama（本机）', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
];

export function mergeSettings(s: any): Settings {
  const d = DEFAULT_SETTINGS;
  if (!s) return d;
  return { ...d, ...s, text: { ...d.text, ...s.text }, image: { ...d.image, ...s.image }, video: { ...d.video, ...s.video } };
}

function ipcText(cfg: Settings['text'], onUsage?: (u: { input: number; output: number }) => void): TextProvider {
  return {
    id: `openai:${cfg.model}`,
    async chat(req: ChatRequest, onDelta, signal) {
      const callId = uid('call');
      const onAbort = () => window.api.abort(callId);
      signal?.addEventListener('abort', onAbort);
      try {
        const { meta: _m, ...clean } = req;
        const r: any = await window.api.chat(callId, cfg, clean, onDelta);
        if (r && typeof r === 'object') { if (r.usage) onUsage?.(r.usage); return r.text ?? ''; }
        return r;
      } catch (e: any) {
        throw new Error(String(e?.message ?? e).replace(/^Error invoking remote method 'ai:chat': (Error: )?/, ''));
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    },
  };
}

function ipcImage(cfg: Settings['image']): ImageProvider {
  return { id: `image:${cfg.model}`, generate: (req) => window.api.image(cfg, { prompt: req.prompt, size: req.size, n: req.n }) };
}

export function ipcVideo(cfg: Settings['video']): VideoProvider {
  return {
    id: `video:${cfg.model}`,
    submit: (req) => window.api.videoSubmit(cfg, req),
    poll: (id) => window.api.videoPoll(cfg, id),
  };
}

export function buildProviders(s: Settings, meter?: Meter): Providers {
  if (s.demoMode) return { text: metered(createMockText(14), meter), media: createMockMedia() };
  // 能力表：新增模态只需在这里注册一个 capability → MediaProvider
  return {
    text: metered(ipcText(s.text, (u) => meter?.real(u)), meter),
    media: {
      image: s.image.enabled && s.image.baseUrl ? imageMedia(ipcImage(s.image)) : undefined,
      video: s.video.enabled && s.video.submitUrl ? videoMedia(ipcVideo(s.video)) : undefined,
    },
  };
}

/** 用量计量：每次调用先按字数估算；服务商返回了真实 usage 时以真实值覆盖这一次的估算 */
export interface Meter { add(u: { input: number; output: number; estimated: boolean }): void; real(u: { input: number; output: number }): void }
export function createMeter() {
  const calls: { input: number; output: number; estimated: boolean }[] = [];
  let pendingReal: { input: number; output: number } | null = null;
  const m: Meter & { total(): { input: number; output: number; estimated: boolean } } = {
    add(u) { if (pendingReal) { calls.push({ ...pendingReal, estimated: false }); pendingReal = null; } else calls.push(u); },
    real(u) { pendingReal = u; },
    total() { return calls.reduce((t, c) => ({ input: t.input + c.input, output: t.output + c.output, estimated: t.estimated || c.estimated }), { input: 0, output: 0, estimated: false }); },
  };
  return m;
}
function metered(p: TextProvider, meter?: Meter): TextProvider {
  if (!meter) return p;
  return { id: p.id, async chat(req, onDelta, signal) {
    const out = await p.chat(req, onDelta, signal);
    meter.add({ input: estimateTokens(req.messages.map((x) => x.content).join('\n')), output: estimateTokens(out), estimated: true });
    return out;
  } };
}
