import { BaseCollector, getDocument, getWindow, round, type EventDraft } from '@web-monitor/core';
import { EventType, PerformanceCategory } from '@web-monitor/types';
import { rateMetric, type ResolvedPerformanceOptions } from '../types';
import { createObserver, onPageHide, safeNumber } from '../utils';

/** 长任务与阻塞时长采集（衡量主线程繁忙程度） */
export class LongTaskCollector extends BaseCollector {
  private entries: Array<{ startTime: number; duration: number }> = [];
  private totalDuration = 0;
  private maxDuration = 0;
  private tbt = 0;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private cleanup?: () => void;

  constructor(private readonly opts: ResolvedPerformanceOptions) {
    super('performance:long-task');
    this.pluginSampleRate = opts.sampleRate;
  }

  protected onStart(): void {
    if (!this.opts.longTask) return;
    const observer = createObserver(['longtask'], (list) => {
      list.forEach((entry) => {
        const item = { startTime: safeNumber(entry.startTime), duration: safeNumber(entry.duration) };
        if (item.duration <= 0) return;
        this.entries.push(item);
        this.totalDuration += item.duration;
        this.maxDuration = Math.max(this.maxDuration, item.duration);
        // TBT：超过 50ms 的部分累加（Total Blocking Time）
        this.tbt += Math.max(item.duration - 50, 0);
      });
    });
    if (observer) this.addCleanup(() => observer.disconnect());

    this.flushTimer = setInterval(() => this.flush(), 30000);
    this.addCleanup(() => {
      if (this.flushTimer) clearInterval(this.flushTimer);
    });

    this.cleanup = onPageHide(() => this.flush());
    this.addCleanup(() => this.cleanup?.());
  }

  flush(): void {
    if (!this.entries.length) return;
    const entries = this.entries
      .slice()
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10);
    const draft: EventDraft = {
      type: EventType.Performance,
      category: PerformanceCategory.LongTask,
      payload: {
        count: this.entries.length,
        totalDuration: safeNumber(this.totalDuration),
        maxDuration: safeNumber(this.maxDuration),
        tbt: safeNumber(this.tbt),
        entries,
      },
    };
    this.emit(draft);
    this.entries = [];
    this.totalDuration = 0;
    this.maxDuration = 0;
    this.tbt = 0;
  }
}

/** 帧率与卡顿采集 */
export class FpsCollector extends BaseCollector {
  private rafId = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private frames: number[] = [];
  private lastFrameTime = 0;
  private running = false;

  constructor(private readonly opts: ResolvedPerformanceOptions) {
    super('performance:fps');
    this.pluginSampleRate = opts.sampleRate;
  }

  protected onStart(): void {
    if (!this.opts.fps) return;
    const doc = getDocument();
    this.timer = setInterval(() => this.sample(), 10000);
    this.addCleanup(() => {
      if (this.timer) clearInterval(this.timer);
      this.running = false;
      if (this.rafId) (getWindow() as any)?.cancelAnimationFrame?.(this.rafId);
    });

    if (doc) {
      const onVisibility = () => {
        this.running = doc.visibilityState === 'visible';
        if (this.running) this.loop();
      };
      doc.addEventListener('visibilitychange', onVisibility);
      this.addCleanup(() => doc.removeEventListener('visibilitychange', onVisibility));
    }

    this.running = true;
    this.loop();
  }

  private loop = (): void => {
    const win = getWindow();
    if (!win || !this.running) return;
    const tick = (timestamp: number) => {
      if (!this.running) return;
      if (this.lastFrameTime) {
        const delta = timestamp - this.lastFrameTime;
        if (delta > 0 && delta < 5000) this.frames.push(delta);
      }
      this.lastFrameTime = timestamp;
      this.rafId = win.requestAnimationFrame(tick);
    };
    this.rafId = win.requestAnimationFrame(tick);
  };

  private sample(): void {
    if (!this.frames.length) return;
    const frames = this.frames;
    this.frames = [];
    const total = frames.reduce((sum, value) => sum + value, 0);
    const sampleDuration = safeNumber(total);
    const fps = total > 0 ? round((frames.length / total) * 1000, 1) : 0;
    const jankCount = frames.filter((value) => value > 50).length;
    const maxFrameDuration = safeNumber(Math.max(...frames));

    this.emit({
      type: EventType.Performance,
      category: PerformanceCategory.Fps,
      payload: { fps, sampleDuration, frames: frames.length, jankCount, maxFrameDuration, rating: rateMetric('FPS', fps) },
    });
  }
}

/** 内存占用采集（仅 Chromium 支持 performance.memory） */
export class MemoryCollector extends BaseCollector {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: ResolvedPerformanceOptions) {
    super('performance:memory');
    this.pluginSampleRate = opts.sampleRate;
  }

  protected onStart(): void {
    if (!this.opts.memory) return;
    const memory = (getWindow() as any)?.performance?.memory;
    if (!memory) return;

    const collect = () => {
      const current = (getWindow() as any)?.performance?.memory;
      if (!current) return;
      const usage = current.jsHeapSizeLimit ? current.usedJSHeapSize / current.jsHeapSizeLimit : 0;
      this.emit({
        type: EventType.Performance,
        category: PerformanceCategory.Memory,
        payload: {
          usedJSHeapSize: current.usedJSHeapSize,
          totalJSHeapSize: current.totalJSHeapSize,
          jsHeapSizeLimit: current.jsHeapSizeLimit,
          usage: round(usage, 4),
        },
      });
    };

    collect();
    this.timer = setInterval(collect, this.opts.memoryInterval);
    this.addCleanup(() => {
      if (this.timer) clearInterval(this.timer);
    });
  }
}
