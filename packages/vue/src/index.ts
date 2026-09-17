import { inject, type App, type InjectionKey, type Plugin } from 'vue';
import { createMonitor, type Monitor, type MonitorOptions } from '@web-monitor/core';

/** 注入键：供 useMonitor / useTrack 使用 */
export const MONITOR_INJECTION_KEY: InjectionKey<Monitor> = Symbol(
  'web-monitor',
) as unknown as InjectionKey<Monitor>;

export interface VueMonitorOptions extends MonitorOptions {
  /** 接管 app.config.errorHandler（Vue 组件内错误） */
  captureVueError?: boolean;
  /** 接管 app.config.warnHandler */
  captureVueWarn?: boolean;
}

/**
 * 创建 Vue 3 监控插件。
 *
 * 使用：
 *   const monitor = createWebMonitorPlugin({ appKey, host, plugins: [...] });
 *   app.use(monitor);
 *   installRouterTracking(router, monitor.instance);
 */
export function createWebMonitorPlugin(options: VueMonitorOptions): Plugin & { instance: Monitor } {
  const monitor = createMonitor(options);
  const { captureVueError = true, captureVueWarn = false } = options;

  const plugin: Plugin = {
    install(app: App) {
      // 保留业务原有的 errorHandler，避免接管后业务自身逻辑失效
      const originalErrorHandler = app.config.errorHandler;
      if (captureVueError) {
        app.config.errorHandler = (err: unknown, instance: any, info: string) => {
          try {
            monitor.reportError(err, {
              info,
              componentName: (instance?.$options as { name?: string } | undefined)?.name,
              mechanism: 'vue-errorHandler',
            });
          } catch {
            /* 自保护 */
          }
          originalErrorHandler?.(err, instance, info);
        };
      }

      const originalWarnHandler = app.config.warnHandler;
      if (captureVueWarn) {
        app.config.warnHandler = (msg: string, instance: any, trace: string) => {
          try {
            monitor.reportError(new Error(msg), { trace, mechanism: 'vue-warnHandler' }, 'warning');
          } catch {
            /* 自保护 */
          }
          originalWarnHandler?.(msg, instance, trace);
        };
      }

      app.provide(MONITOR_INJECTION_KEY, monitor);
      app.config.globalProperties.$monitor = monitor;
      if (!monitor.isStarted()) monitor.start();
    },
  };

  return Object.assign(plugin, { instance: monitor });
}

export interface VueRouterLike {
  afterEach: (hook: (to: any, from: any) => void) => void;
  beforeEach?: (hook: (to: any, from: any, next: (...args: any[]) => void) => void) => void;
}

/**
 * 路由埋点接入。
 * vue-router 使用 history API，core 已能捕获变化，这里额外做两件事：
 *  1. 用 router 的权威结果校正页面标识
 *  2. 记录带路由名的埋点，便于按「路由名」而非「路径」聚合
 */
export function installRouterTracking(router: VueRouterLike, monitor: Monitor): void {
  router.afterEach((to) => {
    try {
      monitor.router.notify();
      monitor.track('route_change', {
        path: to?.path,
        name: to?.name ? String(to.name) : undefined,
        fullPath: to?.fullPath,
        meta: to?.meta,
      }, 'navigation');
    } catch {
      /* 自保护 */
    }
  });
}

/** 组合式 API：获取监控实例 */
export function useMonitor(): Monitor | undefined {
  return inject(MONITOR_INJECTION_KEY, undefined);
}

/** 组合式 API：埋点 */
export function useTrack(): (
  eventName: string,
  properties?: Record<string, any>,
  category?: string,
) => void {
  const monitor = useMonitor();
  return (eventName: string, properties: Record<string, any> = {}, category?: string) => {
    monitor?.track(eventName, properties, category);
  };
}

export { createMonitor };
export type { Monitor, MonitorOptions };
