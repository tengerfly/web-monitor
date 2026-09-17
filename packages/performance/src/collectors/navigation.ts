import {
  BaseCollector,
  addEventListenerSafe,
  getDocument,
  getWindow,
  nextTick,
  type EventDraft,
} from '@web-monitor/core';
import { EventType, MetricName, PerformanceCategory } from '@web-monitor/types';
import { rateMetric, type ResolvedPerformanceOptions } from '../types';
import { afterPaint, getLegacyTiming, getNavigationEntry, safeNumber } from '../utils';

interface FmpSample {
  time: number;
  count: number;
}

/**
 * 页面加载阶段拆解 + FMP / TTI 近似 + 白屏检测。
 * 权威数据来自 PerformanceNavigationTiming，旧浏览器回退 performance.timing。
 */
export class NavigationCollector extends BaseCollector {
  private fmpSamples: FmpSample[] = [];
  private fmpTimer: ReturnType<typeof setInterval> | null = null;
  private lastLongTaskEnd = 0;
  private reported = false;
  private navCleanups: Array<() => void> = [];

  constructor(private readonly opts: ResolvedPerformanceOptions) {
    super('performance:navigation');
    this.pluginSampleRate = opts.sampleRate;
  }

  protected onStart(): void {
    this.observeLongTaskForTti();
    this.trackFmp();
    this.addCleanup(() => {
      if (this.fmpTimer) clearInterval(this.fmpTimer);
      this.navCleanups.forEach((fn) => fn());
    });

    const doc = getDocument();
    if (doc && doc.readyState === 'complete') {
      nextTick(() => this.report());
      return;
    }
    this.navCleanups.push(
      addEventListenerSafe(getWindow(), 'load', () => setTimeout(() => this.report(), 0)),
    );
    // 兜底：5s 后仍未 load 也要出数据
    const fallback = setTimeout(() => this.report(), 5000);
    this.navCleanups.push(() => clearTimeout(fallback));
  }

  private observeLongTaskForTti(): void {
    const Observer = (getWindow() as any)?.PerformanceObserver as typeof PerformanceObserver | undefined;
    if (!Observer) return;
    try {
      const observer = new Observer((list) => {
        list.getEntries().forEach((entry) => {
          this.lastLongTaskEnd = Math.max(this.lastLongTaskEnd, entry.startTime + entry.duration);
        });
      });
      observer.observe({ type: 'longtask', buffered: true } as any);
      this.navCleanups.push(() => observer.disconnect());
    } catch {
      /* 不支持 longtask 的环境忽略 */
    }
  }

  /** FMP 近似：DOM 节点数达到最终规模 90% 的时间点 */
  private trackFmp(): void {
    const doc = getDocument();
    if (!doc?.documentElement) return;
    const start = (getWindow() as any)?.performance?.now?.() ?? 0;
    this.fmpTimer = setInterval(() => {
      const current = ((getWindow() as any)?.performance?.now?.() ?? 0) - start;
      const count = doc.getElementsByTagName('*').length;
      this.fmpSamples.push({ time: current, count });
      if (current > 10000) {
        if (this.fmpTimer) clearInterval(this.fmpTimer);
        this.fmpTimer = null;
        this.reportFmp();
      }
    }, 200);
  }

  private reportFmp(): void {
    if (!this.fmpSamples.length) return;
    const maxCount = Math.max(...this.fmpSamples.map((s) => s.count));
    const target = maxCount * 0.9;
    const hit = this.fmpSamples.find((s) => s.count >= target);
    if (!hit) return;
    this.emit({
      type: EventType.Performance,
      category: PerformanceCategory.WebVital,
      payload: {
        metric: MetricName.FMP,
        value: safeNumber(hit.time) / 1000,
        rating: rateMetric(MetricName.FMP, hit.time),
        approximate: true,
      },
    });
  }

  private report(): void {
    if (this.reported) return;
    this.reported = true;

    const nav = getNavigationEntry();
    let payload: Record<string, any>;

    if (nav) {
      const startTime = nav.startTime;
      payload = {
        navigationType: nav.type || 'navigate',
        redirect: safeNumber(nav.redirectEnd - nav.redirectStart),
        dns: safeNumber(nav.domainLookupEnd - nav.domainLookupStart),
        tcp: safeNumber(nav.connectEnd - nav.connectStart),
        tls: safeNumber(
          nav.secureConnectionStart ? nav.connectEnd - nav.secureConnectionStart : 0,
        ),
        request: safeNumber(nav.responseStart - nav.requestStart),
        response: safeNumber(nav.responseEnd - nav.responseStart),
        firstByte: safeNumber(nav.responseStart - startTime),
        domParse: safeNumber(nav.domInteractive - nav.responseEnd),
        domContentLoaded: safeNumber(nav.domContentLoadedEventEnd - startTime),
        load: safeNumber(nav.loadEventEnd - startTime),
        pageLoad: safeNumber(nav.duration || nav.loadEventEnd - startTime),
        fp: this.getPaintTime('first-paint'),
        fmp: 0,
        tti: this.computeTti(nav.domContentLoadedEventEnd - startTime),
        transferSize: nav.transferSize,
        decodedBodySize: nav.decodedBodySize,
        protocol: (nav as any).nextHopProtocol,
        serverTiming: (nav as any).serverTiming?.length || 0,
      };
    } else {
      const legacy = getLegacyTiming();
      if (!legacy) return;
      payload = {
        navigationType: 'navigate',
        redirect: safeNumber(legacy.redirect),
        dns: safeNumber(legacy.dns),
        tcp: safeNumber(legacy.tcp),
        tls: safeNumber(legacy.tls),
        request: safeNumber(legacy.request),
        response: safeNumber(legacy.response),
        firstByte: safeNumber(legacy.firstByte),
        domParse: safeNumber(legacy.domParse),
        domContentLoaded: safeNumber(legacy.domContentLoaded),
        load: safeNumber(legacy.load),
        pageLoad: safeNumber(legacy.load),
        fp: this.getPaintTime('first-paint'),
        fmp: 0,
        tti: this.computeTti(legacy.domContentLoaded),
      };
    }

    const draft: EventDraft = {
      type: EventType.Performance,
      category: PerformanceCategory.Navigation,
      payload,
    };
    this.emit(draft);

    // TTI 作为独立指标上报，便于服务端阈值告警
    if (payload.tti > 0) {
      this.emit({
        type: EventType.Performance,
        category: PerformanceCategory.WebVital,
        payload: {
          metric: MetricName.TTI,
          value: payload.tti,
          rating: rateMetric(MetricName.TTI, payload.tti),
          approximate: true,
        },
      });
    }

    if (this.opts.whiteScreen) {
      afterPaint(() => this.checkWhiteScreen(payload.load));
    }
  }

  private getPaintTime(name: string): number {
    const win = getWindow();
    try {
      const entries = win?.performance?.getEntriesByType('paint') as PerformanceEntry[] | undefined;
      const hit = entries?.find((entry) => entry.name === name);
      return hit ? safeNumber(hit.startTime) : 0;
    } catch {
      return 0;
    }
  }

  /** TTI 近似：DOMContentLoaded 与最后一个长任务结束取较大值 */
  private computeTti(domContentLoaded: number): number {
    return safeNumber(Math.max(domContentLoaded, this.lastLongTaskEnd));
  }

  /**
   * 白屏检测：视口内九点采样，若绝大多数采样点落在「无内容」元素上则判定白屏。
   */
  private checkWhiteScreen(loadTime: number): void {
    const win = getWindow();
    const doc = getDocument();
    if (!win || !doc?.body || typeof doc.elementFromPoint !== 'function') return;

    const width = win.innerWidth;
    const height = win.innerHeight;
    if (!width || !height) return;

    const ratios = [0.1, 0.5, 0.9];
    let emptyCount = 0;
    let total = 0;

    ratios.forEach((rx) => {
      ratios.forEach((ry) => {
        total++;
        const x = Math.floor(width * rx);
        const y = Math.floor(height * ry);
        const element = doc.elementFromPoint(x, y);
        if (this.isEmptyElement(element)) emptyCount++;
      });
    });

    const ratio = total ? emptyCount / total : 0;
    if (ratio >= 0.9) {
      const duration = safeNumber(
        ((win.performance as any)?.now?.() ?? 0) - loadTime,
      );
      this.emit({
        type: EventType.Performance,
        category: PerformanceCategory.WhiteScreen,
        payload: {
          url: win.location.href,
          duration,
          pointCount: total,
          emptyRatio: ratio,
        },
      });
    }
  }

  private isEmptyElement(element: Element | null): boolean {
    if (!element) return true;
    const tag = element.tagName.toLowerCase();
    if (tag === 'html' || tag === 'body') return true;
    const text = (element.textContent || '').replace(/\s+/g, '');
    if (text.length > 0) return false;
    const style = (getWindow() as any)?.getComputedStyle?.(element);
    if (!style) return true;
    const hasBackground =
      style.backgroundImage !== 'none' ||
      (style.backgroundColor &&
        style.backgroundColor !== 'transparent' &&
        style.backgroundColor !== 'rgba(0, 0, 0, 0)');
    if (hasBackground) return false;
    if (tag === 'img' || tag === 'canvas' || tag === 'svg' || tag === 'video') return false;
    return true;
  }
}
