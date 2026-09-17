import { shortHash, type StackFrame } from '@web-monitor/core';

const UUID_RE = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}/gi;
const NUMBER_RE = /\b\d+(\.\d+)?\b/g;
const QUOTED_RE = /(['"`])(?:\\.|(?!\1)[^\\])*\1/g;
const URL_RE = /https?:\/\/[^\s)]+/g;
const HEX_RE = /\b0x[0-9a-f]+\b/gi;

/**
 * 错误消息归一化：把「变量部分」抹掉，让同类错误落到同一个指纹。
 * 例如 "Cannot read properties of undefined (reading 'user_1024')" -> "... (reading '<var>')"
 */
export function normalizeMessage(message: string): string {
  if (!message) return '';
  return message
    .replace(URL_RE, '<url>')
    .replace(UUID_RE, '<id>')
    .replace(HEX_RE, '<hex>')
    .replace(QUOTED_RE, "'<str>'")
    .replace(NUMBER_RE, '<num>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** 解析 stack 文本为结构化帧 */
export function parseStack(stack?: string): StackFrame[] {
  if (!stack) return [];
  const lines = stack.split('\n');
  const frames: StackFrame[] = [];
  for (const line of lines) {
    const text = line.trim();
    if (!text.startsWith('at ') && !/^[^@\s]+@/.test(text)) continue;
    // 形式一：at fnName (http://a/b.js:1:2)
    // 形式二：at http://a/b.js:1:2
    // 形式三：fnName@http://a/b.js:1:2（Firefox）
    let match = text.match(/^at\s+(.*?)\s+\((.+?):(\d+):(\d+)\)$/);
    if (!match) match = text.match(/^at\s+(.+?):(\d+):(\d+)$/);
    if (match) {
      const isWithFn = match.length === 5;
      frames.push({
        function: isWithFn ? match[1] : undefined,
        filename: isWithFn ? match[2] : match[1],
        lineno: Number(isWithFn ? match[3] : match[2]),
        colno: Number(isWithFn ? match[4] : match[3]),
        raw: text,
      });
      continue;
    }
    const firefox = text.match(/^(.*?)@(.+?):(\d+):(\d+)$/);
    if (firefox) {
      frames.push({
        function: firefox[1] || undefined,
        filename: firefox[2],
        lineno: Number(firefox[3]),
        colno: Number(firefox[4]),
        raw: text,
      });
      continue;
    }
    // 兜底：保留原始行便于人工排查
    if (frames.length && frames[frames.length - 1].raw) continue;
    frames.push({ raw: text });
  }
  return frames.slice(0, 50);
}

/** 从帧列表中提取「特征串」——只取前 3 帧的文件名与函数名，避免行号变化导致指纹漂移 */
function frameSignature(frames: StackFrame[]): string {
  return frames
    .slice(0, 3)
    .map((frame) => {
      const file = (frame.filename || '').split('?')[0].split('/').slice(-1)[0] || '';
      return `${frame.function || 'anon'}@${file}`;
    })
    .join('>');
}

export interface FingerprintInput {
  category: string;
  name?: string;
  message?: string;
  stack?: string;
  frames?: StackFrame[];
  /** 资源错误用：资源地址 */
  resourceUrl?: string;
  /** 接口错误用：方法 + 归一化 URL + 状态码 */
  requestKey?: string;
}

/**
 * 计算错误指纹。
 * 同一份构建产物的同一处错误必须稳定得到同一指纹——这是错误聚合的前提。
 */
export function computeFingerprint(input: FingerprintInput): string {
  const frames = input.frames || parseStack(input.stack);
  const signature = frameSignature(frames);

  if (input.category === 'resource-error') {
    const file = (input.resourceUrl || '').split('?')[0].split('/').slice(-1)[0];
    return shortHash(`resource-error|${file}`);
  }
  if (input.category === 'request-error') {
    return shortHash(`request-error|${input.requestKey || ''}`);
  }

  const normalized = normalizeMessage(input.message || '');
  const name = input.name || 'Error';
  return shortHash(`${input.category}|${name}|${normalized}|${signature}`);
}

/** 生成错误标题（用于列表展示） */
export function buildTitle(name: string | undefined, message: string, max = 200): string {
  const text = message || 'Unknown error';
  const title = name && name !== 'Error' ? `${name}: ${text}` : text;
  return title.length > max ? `${title.slice(0, max)}...` : title;
}
