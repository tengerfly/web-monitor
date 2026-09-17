import { definePlugin, type MonitorContext } from '@web-monitor/core';
import { MetricName, type PerformanceOptions } from '@web-monitor/types';
import { DEFAULT_PERFORMANCE_OPTIONS, computeScore, rateMetric, type ResolvedPerformanceOptions } from './types';
import { VitalsCollector } from './collectors/vitals';
import { NavigationCollector } from './collectors/navigation';
import { FpsCollector, LongTaskCollector, MemoryCollector } from './collectors/runtime';
import { ResourceCollector } from './collectors/resource';
import { NetworkCollector } from './collectors/network';
import { ApiCollector, RoutePerformanceCollector } from './collectors/api';

export * from './types';
export { VitalsCollector } from './collectors/vitals';
export { NavigationCollector } from './collectors/navigation';
export { LongTaskCollector, FpsCollector, MemoryCollector } from './collectors/runtime';
export { ResourceCollector } from './collectors/resource';
export { NetworkCollector } from './collectors/network';
export { ApiCollector, RoutePerformanceCollector } from './collectors/api';

export interface PerformancePluginApi {
  /** 手动上报自定义性能指标 */
  reportMetric(
    metric: string,
    value: number,
    options?: { unit?: string; tags?: Record<string, string | number> },
  ): void;
  /** 读取当前已知的 Vitals 快照 */
  getVitals(): Record<string, number>;
  /** 计算性能评分（0-100） */
  getScore(metrics?: Record<string, number>): number;
}

const PLUGIN_NAME = 'performance';

/**
 * 性能监控插件。
 * 独立使用时可只安装本插件与 core：
 *   createMonitor({ appKey, host, plugins: [performancePlugin()] })
 */
export function performancePlugin(options: PerformanceOptions = {}) {
  const localOptions = { ...DEFAULT_PERFORMANCE_OPTIONS, ...options } as ResolvedPerformanceOptions;

  return definePlugin<PerformanceOptions & { _resolved?: ResolvedPerformanceOptions }>(
    PLUGIN_NAME,
    (ctx: MonitorContext) => {
      if (!ctx.isPluginEnabled(PLUGIN_NAME)) {
        ctx.logger.info('performance plugin disabled by config');
        return;
      }

      // 远程配置覆盖本地配置（服务端可在线调阈值与开关）
      const remote = ctx.getRuntimeConfig<PerformanceOptions>(PLUGIN_NAME, options);
      const opts: ResolvedPerformanceOptions = {
        ...localOptions,
        ...remote,
        thresholds: { ...localOptions.thresholds, ...(remote.thresholds || {}) },
      };

      ctx.defineCollector(new VitalsCollector(opts));
      ctx.defineCollector(new NavigationCollector(opts));
      ctx.defineCollector(new LongTaskCollector(opts));
      ctx.defineCollector(new FpsCollector(opts));
      ctx.defineCollector(new MemoryCollector(opts));
      ctx.defineCollector(new ResourceCollector(opts));
      ctx.defineCollector(new NetworkCollector());
      ctx.defineCollector(new ApiCollector(opts));
      ctx.defineCollector(new RoutePerformanceCollector(opts));

      const api: PerformancePluginApi = {
        reportMetric: (metric, value, metricOptions) => ctx.reportMetric(metric, value, metricOptions),
        getVitals: () => {
          const vitals = ctx.getCollector<VitalsCollector>('performance:vitals');
          return vitals?.getSnapshot() || {};
        },
        getScore: (metrics) => {
          const vitals = ctx.getCollector<VitalsCollector>('performance:vitals');
          const data = metrics || vitals?.getSnapshot() || {};
          return computeScore(data as Record<string, number>);
        },
      };
      installApi(ctx, api);

      ctx.logger.debug('performance plugin installed', opts);
    },
    options,
  );
}

/** 暴露到监控实例上，便于业务调用 monitor.performance.reportMetric(...) */
function installApi(ctx: MonitorContext, api: PerformancePluginApi): void {
  const target = ctx as unknown as Record<string, any>;
  target.performance = api;
}

export { rateMetric, computeScore, MetricName };
