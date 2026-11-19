import type { ImageProvider, MediaProvider, VideoProvider } from '../types';

/**
 * 适配层：把具体模态的 Provider 包装成通用 MediaProvider。
 * 这是唯一知道“图片 / 视频”语义的地方；引擎只按 manifest.media.capability 查表调用。
 */
export function imageMedia(p: ImageProvider): MediaProvider {
  return {
    id: p.id,
    async run(req) {
      const urls = await p.generate({ prompt: req.prompt, size: req.params?.size as string | undefined, n: 1, meta: req.meta });
      return urls.length ? { status: 'succeeded', urls } : { status: 'failed', message: '服务未返回结果' };
    },
  };
}

export function videoMedia(p: VideoProvider): MediaProvider {
  return {
    id: p.id,
    async run(req) {
      const j = await p.submit({ prompt: req.prompt, duration: req.params?.duration != null ? Number(req.params.duration) : undefined, image: req.params?.image as string | undefined });
      return { status: j.status, jobId: j.id, urls: j.url ? [j.url] : undefined, message: j.message };
    },
    async poll(id) {
      const j = await p.poll(id);
      return { status: j.status, jobId: j.id, urls: j.url ? [j.url] : undefined, message: j.message };
    },
  };
}
