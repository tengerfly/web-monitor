import { RouteChangeType } from '@web-monitor/types';
import { addEventListenerSafe, getHistory, getLocation, getWindow } from '../utils/global';
import { getPathFromUrl } from '../utils/url';
import { now } from '../utils/misc';

export interface RouteChangeInfo {
  from: string;
  to: string;
  type: RouteChangeType | string;
  /** 触发时间 */
  timestamp: number;
  url: string;
}

type RouteListener = (info: RouteChangeInfo) => void;

/**
 * 路由变更监听（性能与行为的共享底座）。
 * 兼容 history 路由（pushState/replaceState/popstate）与 hash 路由（hashchange）。
 * pushState/replaceState 无法通过事件监听，只能猴子补丁，这是业界唯一可靠方案。
 */
export class RouteInstrument {
  private listeners = new Set<RouteListener>();
  private cleanupFns: Array<() => void> = [];
  private currentPath = '/';
  private installed = false;
  private originalPushState?: History['pushState'];
  private originalReplaceState?: History['replaceState'];

  setup(): void {
    this.currentPath = getPathFromUrl();
  }

  install(): void {
    if (this.installed) return;
    const history = getHistory();
    if (!history) return;
    this.installed = true;
    const instrument = this;

    this.originalPushState = history.pushState;
    this.originalReplaceState = history.replaceState;

    const originalPush = this.originalPushState;
    const originalReplace = this.originalReplaceState;

    history.pushState = function patchedPushState(this: History, ...args: any[]) {
      const result = originalPush.apply(this, args as any);
      instrument.handleChange(RouteChangeType.PushState);
      return result;
    } as History['pushState'];

    history.replaceState = function patchedReplaceState(this: History, ...args: any[]) {
      const result = originalReplace.apply(this, args as any);
      instrument.handleChange(RouteChangeType.ReplaceState);
      return result;
    } as History['replaceState'];

    this.cleanupFns.push(() => {
      if (this.originalPushState) history.pushState = this.originalPushState;
      if (this.originalReplaceState) history.replaceState = this.originalReplaceState;
    });

    this.cleanupFns.push(
      addEventListenerSafe(getWindow(), 'popstate', () =>
        instrument.handleChange(RouteChangeType.PopState),
      ),
    );
    this.cleanupFns.push(
      addEventListenerSafe(getWindow(), 'hashchange', () =>
        instrument.handleChange(RouteChangeType.HashChange),
      ),
    );
  }

  uninstall(): void {
    this.cleanupFns.forEach((fn) => fn());
    this.cleanupFns = [];
    this.installed = false;
  }

  private handleChange(type: RouteChangeType | string): void {
    const nextPath = getPathFromUrl();
    if (nextPath === this.currentPath && type !== RouteChangeType.PopState) return;
    const info: RouteChangeInfo = {
      from: this.currentPath,
      to: nextPath,
      type,
      timestamp: now(),
      url: getLocation()?.href || '',
    };
    this.currentPath = nextPath;
    this.listeners.forEach((listener) => {
      try {
        listener(info);
      } catch {
        /* 单个监听异常不影响其他监听 */
      }
    });
  }

  onChange(listener: RouteListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getCurrentPath(): string {
    return this.currentPath;
  }

  /** 手动触发路由变更（兼容自定义路由方案） */
  notify(type: RouteChangeType | string = RouteChangeType.Initial): void {
    this.handleChange(type);
  }

  destroy(): void {
    this.uninstall();
    this.listeners.clear();
  }
}
