import {
  BaseCollector,
  getDocument,
  getElementText,
  getCssSelector,
  now,
} from '@web-monitor/core';
import { BehaviorCategory, EventType } from '@web-monitor/types';
import type { ResolvedBehaviorOptions } from '../types';

interface ExposureRecord {
  enterTime: number;
  visible: boolean;
  maxRatio: number;
}

/**
 * 元素曝光采集。
 * 只在配置了 exposureTargets 时启用（避免全量扫描 DOM 造成性能损耗），
 * 元素「进入视口并达到阈值比例」开始计时，离开视口时上报曝光时长。
 */
export class ExposureCollector extends BaseCollector {
  private observer?: IntersectionObserver;
  private records = new Map<Element, ExposureRecord>();
  private rescanTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly opts: ResolvedBehaviorOptions) {
    super('behavior:exposure');
    this.pluginSampleRate = opts.sampleRate;
  }

  protected onStart(): void {
    if (!this.opts.exposure || !this.opts.exposureTargets.length) return;
    const win = globalThis as { IntersectionObserver?: typeof IntersectionObserver };
    if (!win.IntersectionObserver) return;

    this.observer = new win.IntersectionObserver((entries) => this.handleEntries(entries), {
      threshold: [0, this.opts.exposureRatio, 1],
    });

    this.scan();
    this.rescanTimer = setInterval(() => this.scan(), 3000);
    this.addCleanup(() => {
      if (this.rescanTimer) clearInterval(this.rescanTimer);
      this.observer?.disconnect();
      this.records.clear();
    });
  }

  /** 重扫 DOM，把新出现的目标元素纳入观察 */
  private scan(): void {
    const doc = getDocument();
    if (!doc || !this.observer) return;
    const selector = this.opts.exposureTargets.join(',');
    let elements: Element[] = [];
    try {
      elements = Array.from(doc.querySelectorAll(selector));
    } catch {
      return;
    }
    elements.slice(0, 300).forEach((element) => {
      if (this.records.has(element)) return;
      this.records.set(element, { enterTime: 0, visible: false, maxRatio: 0 });
      this.observer!.observe(element);
    });
  }

  private handleEntries(entries: IntersectionObserverEntry[]): void {
    entries.forEach((entry) => {
      const record = this.records.get(entry.target);
      if (!record) return;
      const ratio = entry.intersectionRatio;
      if (ratio > record.maxRatio) record.maxRatio = ratio;

      if (!entry.isIntersecting || ratio < this.opts.exposureRatio) {
        if (record.visible) {
          this.emitExposure(entry.target, record);
          record.visible = false;
          record.enterTime = 0;
        }
        return;
      }

      if (!record.visible) {
        record.visible = true;
        record.enterTime = now();
      }
    });
  }

  private emitExposure(element: Element, record: ExposureRecord): void {
    const leaveTime = now();
    this.emit({
      type: EventType.Behavior,
      category: BehaviorCategory.Exposure,
      payload: {
        selector: getCssSelector(element),
        text: getElementText(element, 60),
        ratio: Math.round(record.maxRatio * 100) / 100,
        enterTime: record.enterTime,
        leaveTime,
        duration: Math.round(leaveTime - record.enterTime),
      },
    });
    record.maxRatio = 0;
  }
}
