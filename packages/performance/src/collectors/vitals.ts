import { BaseCollector, getWindow, round, type EventDraft } from '@web-monitor/core';
import {
  EventType,
  MetricName,
  PerformanceCategory,
  type NavigationType,
} from '@web-monitor/types';
import { rateMetric, type ResolvedPerformanceOptions } from '../types';
import { createObserver, getNavigationEntry, onPageHide, safeNumber } from '../utils';

interface LayoutShiftLike extends PerformanceEntry {
  value: number;
  hadRecentInput: boolean;
}
interface LcpLike extends PerformanceEntry {
  size?: number;
  element?: Element;
  url?: string;
}
interface EventTimingLike extends PerformanceEntry {
  interactionId?: number;
  processingStart?: number;
}

/**
 * Core Web Vitals 与关键绘制指标采集。
 * 指标口径对齐 Google web-vitals：
 *  - LCP / CLS / INP 在页面隐藏或发生交互后定稿上报（避免中途值失真）
 *  - FCP / TTFB / FP 拿到即上报
 */
export class VitalsCollector extends BaseCollector {
  private lcp = 0;
  private lcpElement?: string;
  private clsSessionValue = 0;
  private clsMaxSession = 0;
  private clsEntries: number[] = [];
  private lastShiftTime = 0;
  private interactionDurations: number[] = [];
  private inpValue = 0;
  private reported = new Set<string>();
  private observers: PerformanceObserver[] = [];
  private cleanup?: () => void;
  private navigationType?: string;

  constructor(private readonly opts: ResolvedPerformanceOptions) {
    super('performance:vitals');
    this.pluginSampleRate = opts.sampleRate;
  }

  protected onStart(): void {
    this.navigationType = (getNavigationEntry()?.type as NavigationType | string) || undefined;

    this.observePaint();
    this.observeLcp();
    this.observeLayoutShift();
    this.observeInteraction();
    this.observeFirstInput();
    this.observeTtfb();

    this.cleanup = onPageHide(() => this.finalize());
    this.addCleanup(() => this.cleanup?.());
    this.addCleanup(() => this.observers.forEach((observer) => observer.disconnect()));
  }

  protected override onStop(): void {
    this.finalize();
  }

  private push(metric: string, value: number, entries?: number, navigationType?: string): void {
    if (!Number.isFinite(value) || value <= 0) return;
    const rounded = metric === 'CLS' ? round(value, 4) : safeNumber(value);
    const draft: EventDraft = {
      type: EventType.Performance,
      category: PerformanceCategory.WebVital,
      payload: {
        metric,
        value: rounded,
        rating: rateMetric(metric, value),
        navigationType: navigationType || this.navigationType,
        entries,
        threshold: this.opts.thresholds[metric],
        exceeded:
          this.opts.thresholds[metric] !== undefined
            ? metric === 'FPS'
              ? value < this.opts.thresholds[metric]
              : value > this.opts.thresholds[metric]
            : undefined,
      },
    };
    this.emit(draft);
    this.reported.add(metric);
  }

  /* ------------------------------ 各指标采集 ------------------------------ */

  private observePaint(): void {
    const observer = createObserver(['paint'], (entries) => {
      entries.forEach((entry) => {
        const value = entry.startTime;
        if (entry.name === 'first-paint') this.push(MetricName.FP, value);
        if (entry.name === 'first-contentful-paint') this.push(MetricName.FCP, value);
      });
    });
    if (observer) this.observers.push(observer);
  }

  private observeLcp(): void {
    const observer = createObserver(['largest-contentful-paint'], (entries) => {
      const last = entries[entries.length - 1] as LcpLike;
      if (!last) return;
      this.lcp = last.startTime;
      if (last.element) {
        this.lcpElement = `${last.element.tagName?.toLowerCase() || ''}${
          last.element.className ? `.${String(last.element.className).split(/\s+/)[0]}` : ''
        }`;
      }
    });
    if (observer) this.observers.push(observer);
  }

  private observeLayoutShift(): void {
    const observer = createObserver(['layout-shift'], (entries) => {
      entries.forEach((entry) => {
        const shift = entry as LayoutShiftLike;
        if (shift.hadRecentInput) return;
        const startTime = shift.startTime;
        const firstEntryTime = this.clsEntries.length ? this.clsEntries[0] : startTime;
        // 会话窗口算法：间隔 < 1s 且总跨度 < 5s 视为同一窗口
        if (this.clsEntries.length && startTime - this.lastShiftTime < 1000 && startTime - firstEntryTime < 5000) {
          this.clsSessionValue += shift.value;
          this.clsEntries.push(startTime);
        } else {
          this.clsSessionValue = shift.value;
          this.clsEntries = [startTime];
        }
        this.lastShiftTime = startTime;
        if (this.clsSessionValue > this.clsMaxSession) this.clsMaxSession = this.clsSessionValue;
      });
    });
    if (observer) this.observers.push(observer);
  }

  private observeInteraction(): void {
    const observer = createObserver(
      ['event'],
      (entries) => {
        entries.forEach((entry) => {
          const event = entry as EventTimingLike;
          if (!event.interactionId) return;
          this.interactionDurations.push(event.duration);
          // 长交互即刻上报，便于快速发现卡顿问题
          if (event.duration >= this.opts.thresholds.INP * 2) {
            this.push(MetricName.INP, event.duration, 1, this.navigationType);
          }
        });
      },
      { durationThreshold: 40 } as any,
    );
    if (observer) this.observers.push(observer);
  }

  private observeFirstInput(): void {
    const observer = createObserver(['first-input'], (entries) => {
      const entry = entries[0] as EventTimingLike;
      if (!entry) return;
      const delay = (entry.processingStart ?? entry.startTime) - entry.startTime;
      this.push(MetricName.FID, delay);
    });
    if (observer) this.observers.push(observer);
  }

  private observeTtfb(): void {
    const nav = getNavigationEntry();
    if (nav) {
      this.push(MetricName.TTFB, nav.responseStart - nav.startTime);
      return;
    }
    const win = getWindow();
    const timing = (win?.performance as any)?.timing;
    if (timing?.navigationStart && timing.responseStart) {
      this.push(MetricName.TTFB, timing.responseStart - timing.navigationStart);
    }
  }

  /** 定稿并上报 LCP / CLS / INP（含 INP 的近似 P98 计算） */
  private finalize(): void {
    if (this.lcp > 0) this.push(MetricName.LCP, this.lcp, undefined, this.navigationType);
    if (this.lastShiftTime > 0) this.push(MetricName.CLS, this.clsMaxSession);
    const inp = this.computeInp();
    if (inp > 0) this.push(MetricName.INP, inp, this.interactionDurations.length, this.navigationType);
  }

  /** INP 取交互耗时的 P98（无足够样本时退化为最大值） */
  private computeInp(): number {
    const list = this.interactionDurations;
    if (!list.length) return this.inpValue;
    if (list.length < 50) return Math.max(...list);
    const sorted = [...list].sort((a, b) => a - b);
    const index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98));
    return sorted[index];
  }

  /** 供外部（如错误上报）读取当前已知指标 */
  getSnapshot(): Record<string, number> {
    return {
      LCP: this.lcp,
      CLS: round(this.clsMaxSession, 4),
      INP: this.computeInp(),
      interactions: this.interactionDurations.length,
    };
  }

  getLcpElement(): string | undefined {
    return this.lcpElement;
  }
}
