import { getWindow } from '@web-monitor/core';

/** 安全创建 PerformanceObserver，不支持或 entryType 非法时返回 undefined */
export function createObserver(
  entryTypes: string[],
  callback: (entries: PerformanceEntry[]) => void,
  options: { buffered?: boolean; durationThreshold?: number } = {},
): PerformanceObserver | undefined {
  const Observer = (getWindow() as any)?.PerformanceObserver as typeof PerformanceObserver | undefined;
  if (!Observer || typeof Observer !== 'function') return undefined;
  try {
    const supported =
      typeof (Observer as any).supportedEntryTypes !== 'undefined'
        ? (Observer as any).supportedEntryTypes as string[]
        : null;
    const usable = supported ? entryTypes.filter((type) => supported.includes(type)) : entryTypes;
    if (!usable.length) return undefined;

    const observer = new Observer((list) => {
      try {
        callback(list.getEntries());
      } catch {
        /* 自保护 */
      }
    });
    observer.observe({ type: usable[0], buffered: options.buffered ?? true, ...options } as any);
    // 逐个注册其余类型（observe 可多次调用）
    usable.slice(1).forEach((type) => {
      try {
        observer.observe({ type, buffered: options.buffered ?? true, ...options } as any);
      } catch {
        /* 忽略不支持的类型 */
      }
    });
    return observer;
  } catch {
    return undefined;
  }
}

/** 等待浏览器完成一次绘制（用于路由切换耗时等） */
export function afterPaint(callback: () => void): void {
  const win = getWindow();
  if (!win) return;
  if (typeof win.requestAnimationFrame !== 'function') {
    setTimeout(callback, 0);
    return;
  }
  win.requestAnimationFrame(() => {
    win.requestAnimationFrame(() => callback());
  });
}

/** 页面隐藏/卸载时执行一次（用于上报最终指标） */
export function onPageHide(callback: () => void, target: 'hidden' | 'unload' = 'hidden'): () => void {
  const win = getWindow();
  const doc = win?.document;
  if (!win || !doc) return () => void 0;

  let fired = false;
  const handler = () => {
    if (fired) return;
    fired = true;
    callback();
  };

  const onVisibility = () => {
    if (doc.visibilityState === 'hidden') handler();
  };

  doc.addEventListener('visibilitychange', onVisibility);
  win.addEventListener('pagehide', handler);
  if (target === 'unload') win.addEventListener('unload', handler);

  return () => {
    doc.removeEventListener('visibilitychange', onVisibility);
    win.removeEventListener('pagehide', handler);
    win.removeEventListener('unload', handler);
  };
}

export function getNavigationEntry(): PerformanceNavigationTiming | undefined {
  const win = getWindow();
  if (!win?.performance) return undefined;
  try {
    const entries = win.performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (entries.length) return entries[0];
    const timing = (win.performance as any).timing;
    if (timing) return undefined;
  } catch {
    /* ignore */
  }
  return undefined;
}

/** 兼容旧浏览器的 navigation timing（performance.timing） */
export function getLegacyTiming(): Record<string, number> | undefined {
  const win = getWindow();
  const timing = (win?.performance as any)?.timing;
  if (!timing || !timing.navigationStart) return undefined;
  return {
    start: timing.navigationStart,
    redirect: timing.redirectEnd - timing.redirectStart,
    dns: timing.domainLookupEnd - timing.domainLookupStart,
    tcp: timing.connectEnd - timing.connectStart,
    tls: timing.secureConnectionStart ? timing.connectEnd - timing.secureConnectionStart : 0,
    request: timing.responseStart - timing.requestStart,
    response: timing.responseEnd - timing.responseStart,
    firstByte: timing.responseStart - timing.navigationStart,
    domParse: timing.domInteractive - timing.responseEnd,
    domContentLoaded: timing.domContentLoadedEventEnd - timing.navigationStart,
    load: timing.loadEventEnd - timing.navigationStart,
  };
}

export const safeNumber = (value: number | undefined): number =>
  Number.isFinite(value as number) ? Math.max(0, Math.round(value as number)) : 0;
