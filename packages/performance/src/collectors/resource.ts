import { BaseCollector, getWindow, type EventDraft } from '@web-monitor/core';
import { EventType, PerformanceCategory } from '@web-monitor/types';
import type { ResolvedPerformanceOptions } from '../types';
import { createObserver, safeNumber } from '../utils';

/**
 * 静态资源性能采集。
 * 只上报「慢资源」（超过阈值），避免全量资源打爆存储；资源总量由服务端按事件计数统计。
 */
export class ResourceCollector extends BaseCollector {
  private reportedUrls = new Set<string>();
  private observer?: PerformanceObserver;

  constructor(private readonly opts: ResolvedPerformanceOptions) {
    super('performance:resource');
    this.pluginSampleRate = opts.sampleRate;
  }

  protected onStart(): void {
    if (!this.opts.resource) return;
    const observer = createObserver(['resource'], (entries) => {
      entries.forEach((entry) => this.handleEntry(entry as PerformanceResourceTiming));
    });
    if (observer) {
      this.observer = observer;
      this.addCleanup(() => observer.disconnect());
    }
  }

  private handleEntry(entry: PerformanceResourceTiming): void {
    if (!entry.name || entry.name.startsWith('data:')) return;
    // 监控自身上报请求不计入
    if (this.isSelf(entry.name)) return;

    const duration = safeNumber(entry.duration);
    if (duration < this.opts.slowResourceThreshold) return;
    if (this.reportedUrls.has(entry.name)) return;
    this.reportedUrls.add(entry.name);
    if (this.reportedUrls.size > 500) this.reportedUrls.clear();

    const draft: EventDraft = {
      type: EventType.Performance,
      category: PerformanceCategory.Resource,
      payload: {
        name: entry.name.split('?')[0],
        initiatorType: entry.initiatorType || 'other',
        duration,
        startTime: safeNumber(entry.startTime),
        transferSize: entry.transferSize || 0,
        encodedBodySize: entry.encodedBodySize || 0,
        decodedBodySize: entry.decodedBodySize || 0,
        protocol: (entry as any).nextHopProtocol,
        slow: true,
      },
    };
    this.emit(draft);
  }

  private isSelf(url: string): boolean {
    const reportUrl = this.ctx?.transport?.getReportUrl?.();
    return !!reportUrl && url.startsWith(reportUrl.replace(/\/api\/.*$/, ''));
  }

  /** 供其他采集器复用的当前页面资源统计 */
  getResourceCount(): number {
    const win = getWindow();
    try {
      return win?.performance?.getEntriesByType('resource').length || 0;
    } catch {
      return 0;
    }
  }
}
