export const noop = (): void => void 0;

export const now = (): number => Date.now();

/** 下一个宏任务执行 */
export const nextTick = (fn: () => void): void => {
  setTimeout(fn, 0);
};

/** 节流：首次立即执行，之后在窗口期内最多执行一次 */
export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  wait = 200,
  options: { leading?: boolean; trailing?: boolean } = {},
): T & { cancel: () => void } {
  const { leading = true, trailing = true } = options;
  let last = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: any[] | null = null;

  const invoke = (args: any[]) => {
    last = now();
    fn(...args);
  };

  const wrapped = function (this: unknown, ...args: any[]) {
    const elapsed = now() - last;
    lastArgs = args;
    if (leading && elapsed >= wait) {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      invoke(args);
      return;
    }
    if (trailing && !timer) {
      timer = setTimeout(() => {
        timer = null;
        if (lastArgs) invoke(lastArgs);
      }, Math.max(wait - elapsed, 0));
    }
  } as T & { cancel: () => void };

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  return wrapped;
}

/** 防抖 */
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  wait = 200,
): T & { cancel: () => void; flush: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: any[] | null = null;

  const wrapped = function (this: unknown, ...args: any[]) {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (lastArgs) fn(...lastArgs);
    }, wait);
  } as T & { cancel: () => void; flush: () => void };

  wrapped.cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    lastArgs = null;
  };
  wrapped.flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (lastArgs) fn(...lastArgs);
  };
  return wrapped;
}

/** 在浏览器空闲时执行，避免监控逻辑抢占主线程 */
export function runIdle(fn: () => void, timeout = 2000): void {
  const w = globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') {
    w.requestIdleCallback(fn, { timeout });
    return;
  }
  setTimeout(fn, 0);
}

/** 错误信息归一化为可读字符串 */
export function stringifyValue(value: unknown, depth = 0): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  const type = typeof value;
  if (type === 'string') return value as string;
  if (type === 'number' || type === 'boolean' || type === 'bigint') return String(value);
  if (type === 'symbol') return (value as symbol).toString();
  if (type === 'function') {
    const name = (value as { name?: string }).name || 'anonymous';
    return `[Function ${name}]`;
  }
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (value instanceof Date) return value.toISOString();
  if (depth > 2) return '[Object]';
  try {
    if (Array.isArray(value)) {
      return `[${value.map((v) => stringifyValue(v, depth + 1)).join(', ')}]`;
    }
    return JSON.stringify(value, (_k, v) => (typeof v === 'function' ? '[Function]' : v));
  } catch {
    return '[unserializable]';
  }
}

/** 数字保留小数位 */
export const round = (value: number, digits = 2): number => {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

/** 生成短哈希（用于指纹） */
export function shortHash(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}
