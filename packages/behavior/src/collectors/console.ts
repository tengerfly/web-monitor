import { BaseCollector, getWindow, stringifyValue, truncate, type MonitorContext } from '@web-monitor/core';
import { BehaviorCategory, EventType } from '@web-monitor/types';
import type { ResolvedBehaviorOptions } from '../types';

/**
 * 控制台采集（默认关闭）。
 * 打开后会与 error 包的 console 采集叠加，两者关心点不同：
 *  - error 包：把 console.error 当作「错误线索」
 *  - behavior 包：把 console 输出当作「用户行为序列的一环」
 */
export class ConsoleCollector extends BaseCollector {
  private localCleanups: Array<() => void> = [];
  private selfConsole?: (...args: any[]) => void;

  constructor(private readonly opts: ResolvedBehaviorOptions) {
    super('behavior:console');
    this.pluginSampleRate = opts.sampleRate;
  }

  override setup(ctx: MonitorContext): void {
    super.setup(ctx);
    this.selfConsole = ctx.options.debug ? ctx.logger.debug.bind(ctx.logger) : undefined;
  }

  protected onStart(): void {
    if (!this.opts.console) return;
    const target = (getWindow() as any)?.console;
    if (!target) return;

    this.opts.consoleLevels.forEach((level) => {
      const original = target[level];
      if (typeof original !== 'function') return;
      const instrument = this;
      target[level] = function patched(this: Console, ...args: any[]) {
        try {
          instrument.emit({
            type: EventType.Behavior,
            category: BehaviorCategory.Console,
            payload: {
              level,
              args: args.slice(0, 5).map((arg) => truncate(stringifyValue(arg), 500)),
            },
          });
        } catch {
          /* 自保护 */
        }
        return original.apply(this, args as any);
      };
      this.localCleanups.push(() => {
        target[level] = original;
      });
    });

    this.addCleanup(() => this.localCleanups.forEach((fn) => fn()));
  }
}
