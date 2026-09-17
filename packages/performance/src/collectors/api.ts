import { BaseCollector, getWindow, type EventDraft } from '@web-monitor/core';
import { EventType, PerformanceCategory } from '@web-monitor/types';
import type { ResolvedPerformanceOptions } from '../types';
import { safeNumber } from '../utils';

/**
 * 接口性能采集：消费 core 的请求拦截结果，产出耗时 / 状态码 / 成功率数据。
 * 失败的请求同时会被 error 包捕获为 request-error，两者通过 traceId 关联，
 * 这里只负责「性能维度」，不重复承担错误上报职责。
 */
export class ApiCollector extends BaseCollector {
  constructor(private readonly opts: ResolvedPerformanceOptions) {
    super('performance:api');
    this.pluginSampleRate = opts.sampleRate;
  }

  protected onStart(): void {
    if (!this.opts.api) return;
    const off = this.ctx.emitter.on('request:end', (result) => {
      const duration = safeNumber(result.duration);
      const draft: EventDraft = {
        type: EventType.Performance,
        category: PerformanceCategory.Api,
        timestamp: result.timestamp,
        traceId: result.traceId,
        payload: {
          method: result.method,
          url: result.url,
          rawUrl: result.rawUrl,
          status: result.status,
          ok: result.ok,
          duration,
          requestSize: result.requestSize,
          responseSize: result.responseSize,
          errorType: result.errorType,
          businessCode: result.businessCode,
          slow: duration >= this.opts.slowApiThreshold,
          from: result.from,
        },
      };
      this.emit(draft);
    });
    this.addCleanup(off);
  }
}

/**
 * SPA 路由切换性能采集：从路由变更到目标页完成两次绘制的时间。
 */
export class RoutePerformanceCollector extends BaseCollector {
  private routeStart = 0;
  private pendingRoute: { from: string; to: string; type: string } | null = null;

  constructor(private readonly opts: ResolvedPerformanceOptions) {
    super('performance:route');
    this.pluginSampleRate = opts.sampleRate;
  }

  protected onStart(): void {
    const off = this.ctx.emitter.on('route:change', ({ from, to, type, timestamp }) => {
      // 上一次路由尚未结算时直接丢弃，避免数据串页
      this.routeStart = timestamp;
      this.pendingRoute = { from, to, type };

      const win = getWindow() as Window | undefined;
      if (!win?.requestAnimationFrame) {
        this.settle();
        return;
      }
      win.requestAnimationFrame(() => {
        win.requestAnimationFrame(() => this.settle());
      });
    });
    this.addCleanup(off);
  }

  private settle(): void {
    if (!this.pendingRoute) return;
    const route = this.pendingRoute;
    const duration = safeNumber(Date.now() - this.routeStart);
    this.pendingRoute = null;
    this.emit({
      type: EventType.Performance,
      category: PerformanceCategory.RouteChange,
      payload: { ...route, duration, slow: duration >= 1000 },
    });
  }

  /** 供看板展示的当前页面路由 */
  getCurrentRoute(): string {
    return this.ctx.router.getCurrentPath();
  }
}
