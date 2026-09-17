import { definePlugin, type MonitorContext } from '@web-monitor/core';
import type { BehaviorOptions } from '@web-monitor/types';
import { resolveBehaviorOptions, type ResolvedBehaviorOptions } from './types';
import { PageCollector } from './collectors/page';
import { ClickCollector, FormCollector, ScrollCollector } from './collectors/interaction';
import { ExposureCollector } from './collectors/exposure';
import { ConsoleCollector } from './collectors/console';

export * from './types';
export { PageCollector } from './collectors/page';
export { ClickCollector, FormCollector, ScrollCollector } from './collectors/interaction';
export { ExposureCollector } from './collectors/exposure';
export { ConsoleCollector } from './collectors/console';

export interface BehaviorPluginApi {
  /** 自定义埋点（事件名 + 业务属性） */
  track(eventName: string, properties?: Record<string, any>, category?: string): void;
  /** 当前页面路径 */
  getCurrentPage(): string;
  /** 当前页面最大滚动深度 */
  getMaxScrollDepth(): number;
  /** 手动标记一个行为轨迹（会进入错误溯源的 breadcrumbs） */
  addBreadcrumb(message: string, data?: Record<string, any>): void;
}

const PLUGIN_NAME = 'behavior';

/**
 * 用户行为追踪插件。
 * 与性能监控完全独立，可单独安装：
 *   createMonitor({ appKey, host, plugins: [behaviorPlugin()] }).start();
 */
export function behaviorPlugin(options: BehaviorOptions = {}) {
  const localOptions = resolveBehaviorOptions(options);

  return definePlugin<BehaviorOptions>(
    PLUGIN_NAME,
    (ctx: MonitorContext) => {
      if (!ctx.isPluginEnabled(PLUGIN_NAME)) {
        ctx.logger.info('behavior plugin disabled by config');
        return;
      }

      const remote = ctx.getRuntimeConfig<BehaviorOptions>(PLUGIN_NAME, options);
      const opts: ResolvedBehaviorOptions = {
        ...localOptions,
        ...remote,
        clickTargets: remote.clickTargets || localOptions.clickTargets,
        exposureTargets: remote.exposureTargets || localOptions.exposureTargets,
        consoleLevels: remote.consoleLevels || localOptions.consoleLevels,
      };

      ctx.defineCollector(new PageCollector(opts));
      ctx.defineCollector(new ClickCollector(opts));
      ctx.defineCollector(new ScrollCollector(opts));
      ctx.defineCollector(new FormCollector(opts));
      ctx.defineCollector(new ExposureCollector(opts));
      ctx.defineCollector(new ConsoleCollector(opts));

      const api: BehaviorPluginApi = {
        track: (eventName, properties = {}, category) => ctx.track(eventName, properties, category),
        getCurrentPage: () =>
          ctx.getCollector<PageCollector>('behavior:page')?.getCurrentPath() ||
          ctx.router.getCurrentPath(),
        getMaxScrollDepth: () =>
          ctx.getCollector<PageCollector>('behavior:page')?.getMaxScrollDepth() || 0,
        addBreadcrumb: (message, data) =>
          ctx.breadcrumbs.push({ type: 'custom', message, data }),
      };

      const target = ctx as unknown as Record<string, any>;
      target.behavior = api;

      ctx.logger.debug('behavior plugin installed', opts);
    },
    options,
  );
}
