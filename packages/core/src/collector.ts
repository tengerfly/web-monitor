import type { EventDraft, MonitorContext, Collector } from './types';

/**
 * 采集器基类。
 * 提供：生命周期幂等、异常隔离、清理函数托管、事件提交快捷方法。
 * 所有能力包的自研采集器都应继承它，保证「单个采集器异常不影响整体链路」。
 */
export abstract class BaseCollector implements Collector {
  readonly name: string;
  readonly deps?: string[];
  protected ctx!: MonitorContext;
  private started = false;
  private destroyed = false;
  private cleanups: Array<() => void> = [];

  protected constructor(name: string, deps?: string[]) {
    this.name = name;
    this.deps = deps;
  }

  setup(ctx: MonitorContext): void {
    this.ctx = ctx;
  }

  start(): void {
    if (this.started || this.destroyed || !this.ctx) return;
    this.started = true;
    this.safe(() => this.onStart(), 'start');
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.safe(() => this.onStop(), 'stop');
    this.runCleanups();
  }

  destroy(): void {
    if (this.destroyed) return;
    this.stop();
    this.safe(() => this.onDestroy(), 'destroy');
    this.runCleanups();
    this.destroyed = true;
  }

  isStarted(): boolean {
    return this.started;
  }

  protected abstract onStart(): void;
  protected onStop(): void {}
  protected onDestroy(): void {}

  /** 注册清理函数，stop/destroy 时统一执行 */
  protected addCleanup(fn: () => void): void {
    this.cleanups.push(fn);
  }

  private runCleanups(): void {
    const list = this.cleanups;
    this.cleanups = [];
    list.forEach((fn) => this.safe(fn, 'cleanup'));
  }

  /** 异常隔离执行 */
  protected safe<T>(fn: () => T, scope: string): T | undefined {
    try {
      return fn();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.ctx?.hooks?.emitError(err, `${this.name}:${scope}`);
      this.ctx?.logger?.warn(`collector ${this.name} ${scope} failed`, err);
      return undefined;
    }
  }

  /**
   * 能力包级采样率。
   * 由采集器自行设置（通常来自插件 options.sampleRate），会作为事件级采样率生效，
   * 与全局采样率叠加，实现「按能力包独立控流」。
   */
  protected pluginSampleRate?: number;

  /** 提交事件 */
  protected emit<P = Record<string, any>>(draft: EventDraft<P>): void {
    if (!this.ctx) return;
    this.ctx.push(
      this.pluginSampleRate === undefined || draft.sampleRate !== undefined
        ? draft
        : { ...draft, sampleRate: this.pluginSampleRate },
    );
  }
}
