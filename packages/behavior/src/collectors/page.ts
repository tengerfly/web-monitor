import {
  BaseCollector,
  addEventListenerSafe,
  getChannel,
  getDocument,
  getReferrer,
  getWindow,
  now,
  throttle,
} from '@web-monitor/core';
import { BehaviorCategory, EventType, VisibilityState } from '@web-monitor/types';
import type { ResolvedBehaviorOptions } from '../types';

/**
 * 页面级行为采集：PV、停留时长、前台可见时长、滚动深度、页面可见性。
 * 停留时长区分「总时长」与「前台可见时长」——后台挂着的页面不应算作真实阅读。
 */
export class PageCollector extends BaseCollector {
  private currentPath = '/';
  private previousPath = '';
  private enterTime = 0;
  private visibleStart = 0;
  private visibleDuration = 0;
  private maxScrollDepth = 0;
  private lastPageDuration = 0;
  private pageCount = 0;
  private localCleanups: Array<() => void> = [];

  constructor(private readonly opts: ResolvedBehaviorOptions) {
    super('behavior:page');
    this.pluginSampleRate = opts.sampleRate;
  }

  protected onStart(): void {
    const doc = getDocument();
    if (!doc) return;
    if (!this.opts.pv && !this.opts.stay) return;

    this.currentPath = this.ctx.router.getCurrentPath();
    this.enterTime = now();
    this.visibleStart = now();

    if (this.opts.pv) this.reportPv(true);

    if (this.opts.scroll) {
      const handler = throttle(() => this.trackScrollDepth(), this.opts.scrollThrottle);
      this.localCleanups.push(
        addEventListenerSafe(getWindow(), 'scroll', handler as EventListener, { passive: true }),
      );
    }

    if (this.opts.route) {
      this.localCleanups.push(
        this.ctx.emitter.on('route:change', ({ to }) => {
          this.settleStay();
          this.startPage(to);
        }),
      );
    }

    this.localCleanups.push(
      addEventListenerSafe(doc, 'visibilitychange', () => {
        if (doc.visibilityState === 'hidden') {
          this.accumulateVisible();
          this.emitVisibility(VisibilityState.Hidden);
          if (this.opts.stay) this.emitStay();
        } else {
          this.visibleStart = now();
          this.emitVisibility(VisibilityState.Visible);
        }
      }),
    );

    this.localCleanups.push(
      addEventListenerSafe(getWindow(), 'pagehide', () => {
        this.accumulateVisible();
        if (this.opts.stay) this.emitStay();
      }),
    );

    this.addCleanup(() => this.localCleanups.forEach((fn) => fn()));
  }

  /** 供其他采集器读取当前页面路径 */
  getCurrentPath(): string {
    return this.currentPath;
  }

  getMaxScrollDepth(): number {
    return this.maxScrollDepth;
  }

  private startPage(path: string): void {
    this.previousPath = this.currentPath;
    this.currentPath = path;
    this.enterTime = now();
    this.visibleStart = now();
    this.visibleDuration = 0;
    this.maxScrollDepth = 0;
    if (this.opts.pv) this.reportPv(false);
  }

  private reportPv(isEntry: boolean): void {
    this.pageCount++;
    this.emit({
      type: EventType.Behavior,
      category: BehaviorCategory.Pv,
      payload: {
        path: this.currentPath,
        title: this.ctx.context.getTitle(),
        referrer: getReferrer(),
        fromPath: isEntry ? undefined : this.previousPath,
        duration: Math.round(this.lastPageDuration),
        sessionDuration: Math.round(this.ctx.session.getSessionDuration()),
        isEntry,
        pageCount: this.pageCount,
        channel: getChannel() || undefined,
      },
    });
  }

  private settleStay(): void {
    this.accumulateVisible();
    this.lastPageDuration = now() - this.enterTime;
    if (this.opts.stay) this.emitStay();
  }

  private emitStay(): void {
    const duration = now() - this.enterTime;
    const visible = this.visibleDuration + (this.visibleStart ? now() - this.visibleStart : 0);
    this.emit({
      type: EventType.Behavior,
      category: BehaviorCategory.Stay,
      payload: {
        path: this.currentPath,
        duration: Math.round(duration),
        visibleDuration: Math.round(visible),
        maxScrollDepth: this.maxScrollDepth,
      },
    });
  }

  private emitVisibility(state: VisibilityState): void {
    this.emit({
      type: EventType.Behavior,
      category: BehaviorCategory.Visibility,
      payload: { state, route: this.currentPath },
    });
  }

  private accumulateVisible(): void {
    if (!this.visibleStart) return;
    this.visibleDuration += now() - this.visibleStart;
    this.visibleStart = 0;
  }

  private trackScrollDepth(): void {
    const win = getWindow();
    const doc = getDocument();
    if (!win || !doc) return;
    const documentHeight = doc.documentElement.scrollHeight || 0;
    const viewportHeight = win.innerHeight || 0;
    const scrollable = documentHeight - viewportHeight;
    const depth = scrollable > 0 ? Math.round((win.scrollY / scrollable) * 100) : 100;
    if (depth > this.maxScrollDepth) this.maxScrollDepth = Math.min(depth, 100);
  }
}
