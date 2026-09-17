/** 安全的全局对象访问（兼容 SSR / Node 环境，避免直接引用 window 报错） */

export const hasWindow = (): boolean => typeof window !== 'undefined' && !!window.document;

export const getWindow = (): (Window & typeof globalThis) | undefined =>
  hasWindow() ? window : undefined;

export const getDocument = (): Document | undefined => (hasWindow() ? window.document : undefined);

export const getNavigator = (): Navigator | undefined =>
  hasWindow() ? window.navigator : undefined;

export const getLocation = (): Location | undefined => (hasWindow() ? window.location : undefined);

export const getHistory = (): History | undefined => (hasWindow() ? window.history : undefined);

export const getStorage = (type: 'local' | 'session'): Storage | undefined => {
  if (!hasWindow()) return undefined;
  try {
    return type === 'local' ? window.localStorage : window.sessionStorage;
  } catch {
    // Safari 隐私模式下访问 localStorage 会抛异常
    return undefined;
  }
};

/** 统一的事件监听助手，返回解绑函数；SSR 环境返回空函数 */
export function addEventListenerSafe(
  target: EventTarget | undefined,
  type: string,
  handler: EventListener,
  options?: AddEventListenerOptions | boolean,
): () => void {
  if (!target) return () => void 0;
  target.addEventListener(type, handler, options);
  return () => target.removeEventListener(type, handler, options);
}

/** 兼容旧浏览器的 PerformanceObserver 获取 */
export function getPerformanceObserver(): typeof PerformanceObserver | undefined {
  const w = getWindow() as unknown as { PerformanceObserver?: typeof PerformanceObserver };
  return w?.PerformanceObserver;
}

/** 是否处于可见状态 */
export function isVisible(): boolean {
  const doc = getDocument();
  if (!doc) return false;
  return doc.visibilityState === 'visible';
}

/** 是否处于页面卸载流程中 */
export function isUnloading(): boolean {
  const doc = getDocument();
  return !!doc && doc.visibilityState === 'hidden';
}
