import type { CSSProperties } from 'react';
import sprite from './remixicon.symbol.svg?raw';
import { ICON_NAMES } from './names';

/**
 * 统一图标：离线打包的 Remix Icon 图标集（线性风格、统一 24 栅格与笔画）。
 * 以 SVG 符号（symbol sprite，iconfont 的 Symbol 用法）渲染：矢量路径直接由渲染引擎绘制，
 * 不依赖任何系统字体或 emoji 字体，Windows / macOS / Linux / wine 下完全一致。
 * 插件与角色的 icon 字段写图标名；未知或旧式 emoji 回退为默认图标。
 */
if (typeof document !== 'undefined' && !document.getElementById('icon-sprite')) {
  const host = document.createElement('div');
  host.id = 'icon-sprite';
  host.style.display = 'contents';
  host.innerHTML = sprite;
  document.body.prepend(host);
}
const SET = new Set(ICON_NAMES);
export const DEFAULT_ICON = 'ri-file-list-3-line';
export const ROLE_FALLBACK = 'ri-robot-2-line';

export function iconName(name?: string | null, fallback = DEFAULT_ICON): string {
  if (!name) return fallback;
  const k = name.startsWith('ri-') ? name : 'ri-' + name;
  return SET.has(k) ? k : fallback;
}

export function Icon({ name, fallback, className = '', title, style, size }: { name?: string | null; fallback?: string; className?: string; title?: string; style?: CSSProperties; size?: number }) {
  const n = iconName(name, fallback);
  return (
    <svg className={`ic ${n} ${className}`} viewBox="0 0 24 24" fill="currentColor" aria-hidden={title ? undefined : true} style={size ? { fontSize: size, ...style } : style}>
      {title && <title>{title}</title>}
      <use href={`#${n}`} />
    </svg>
  );
}

/** 程序化步骤（守卫、循环控制）的图标 */
export function logIcon(role: string, stepId: string, roleIcon?: string): string {
  if (stepId.endsWith('-loop')) return 'ri-repeat-line';
  if (stepId === 'cross-review') return 'ri-team-line';
  if (role === 'guard') return 'ri-shield-check-line';
  return iconName(roleIcon, ROLE_FALLBACK);
}

/** 应用标志：三条逐级收窄的横条 = 由粗到细（矢量，不含文字） */
export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <span className="brand-logo" style={{ width: size, height: size, borderRadius: Math.round(size * 0.27) }}>
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" aria-hidden>
        <rect x="2" y="4" width="20" height="3.6" rx="1.8" fill="#fff" />
        <rect x="5.5" y="10.2" width="13" height="3.6" rx="1.8" fill="#fff" fillOpacity=".88" />
        <rect x="9" y="16.4" width="6" height="3.6" rx="1.8" fill="#fff" fillOpacity=".76" />
      </svg>
    </span>
  );
}

/** 在 SVG 内部使用的图标（如脑图节点上的锁定/固定标记） */
export function SvgIcon({ name, x, y, size, color, opacity }: { name: string; x: number; y: number; size: number; color?: string; opacity?: number }) {
  return <use href={`#${iconName(name)}`} x={x} y={y} width={size} height={size} fill={color ?? 'currentColor'} opacity={opacity} />;
}
