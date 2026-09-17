import {
  BaseCollector,
  addEventListenerSafe,
  getCssSelector,
  getWindow,
  stringifyValue,
  truncate,
  type MonitorContext,
} from '@web-monitor/core';
import {
  ErrorCategory,
  ErrorLevel,
  type ResourceErrorPayload,
} from '@web-monitor/types';
import { parseStack } from '../fingerprint';
import { ErrorReporter, normalizeError } from '../reporter';
import type { ResolvedErrorOptions } from '../types';

/**
 * 全局错误采集器。
 * 一个 error 监听（capture 阶段）同时覆盖两类错误：
 *  - JS 运行时错误（ErrorEvent）
 *  - 资源加载错误（script/link/img 等元素派发的 error 事件，不冒泡但可被捕获阶段拦截）
 * 这是「问题溯源」的数据入口，对外暴露 captureException / captureMessage。
 */
export class ErrorCollector extends BaseCollector {
  private reporter!: ErrorReporter;
  private consoleCleanups: Array<() => void> = [];

  constructor(private readonly opts: ResolvedErrorOptions) {
    super('error');
    this.pluginSampleRate = opts.sampleRate;
  }

  override setup(ctx: MonitorContext): void {
    super.setup(ctx);
    this.reporter = new ErrorReporter(ctx, this.opts);
  }

  protected onStart(): void {
    const win = getWindow();
    if (!win) return;

    const onError = (event: Event) => this.handleErrorEvent(event);
    this.addCleanup(addEventListenerSafe(win, 'error', onError, true));

    const onRejection = (event: PromiseRejectionEvent) => this.handleRejection(event);
    this.addCleanup(addEventListenerSafe(win, 'unhandledrejection', onRejection as EventListener));

    if (this.opts.consoleError) this.patchConsole();
    this.addCleanup(() => this.consoleCleanups.forEach((fn) => fn()));
  }

  /* ------------------------------ 对外 API ------------------------------ */

  captureException(error: unknown, extra: Record<string, any> = {}, level?: string): void {
    this.reporter.captureException(error, extra, level || ErrorLevel.Error, 'manual');
  }

  captureMessage(message: string, level?: string, extra?: Record<string, any>): void {
    this.reporter.captureMessage(message, level || ErrorLevel.Info, extra);
  }

  captureFatal(error: unknown, extra: Record<string, any> = {}): void {
    this.reporter.captureFatal(error, extra);
  }

  getReporter(): ErrorReporter {
    return this.reporter;
  }

  /* ------------------------------ 事件处理 ------------------------------ */

  private handleErrorEvent(event: Event): void {
    const errorEvent = event as ErrorEvent;
    const target = event.target as Element | null;
    const isResourceError =
      (!errorEvent.message || errorEvent.message === '') &&
      !!target &&
      target !== (getWindow() as unknown as Element) &&
      typeof (target as Element).tagName === 'string';

    if (isResourceError) {
      if (this.opts.resourceError) this.handleResourceError(target!);
      return;
    }
    this.handleJsError(errorEvent);
  }

  private handleJsError(event: ErrorEvent): void {
    try {
      const error = event.error as Error | undefined;
      const name = error?.name || 'Error';
      let message = error?.message || event.message || 'Unknown error';
      if (/^Script error\.?$/i.test(message)) {
        message =
          'Script error.（跨域脚本错误：请在 script 标签上添加 crossorigin 属性并确保服务端返回 CORS 头，否则拿不到错误详情）';
      }
      const stack = error?.stack;
      const frames = parseStack(stack);
      const filename = event.filename || frames[0]?.filename;

      this.reporter.report(
        ErrorCategory.JsError,
        {
          message,
          name,
          type: 'error',
          stack,
          filename,
          lineno: event.lineno || frames[0]?.lineno,
          colno: event.colno || frames[0]?.colno,
          frames,
          mechanism: 'window.onerror',
        },
        {
          level: ErrorLevel.Error,
          fingerprint: { category: ErrorCategory.JsError, name, message, frames, stack },
        },
      );
    } catch (error) {
      this.ctx.logger.warn('handle js error failed', error);
    }
  }

  private handleResourceError(target: Element): void {
    try {
      const tagName = target.tagName.toLowerCase();
      const url = String((target as HTMLImageElement).src || (target as HTMLLinkElement).href || '');
      if (!url) return;
      if (this.isSelfUrl(url)) return;

      const payload: Partial<ResourceErrorPayload> = {
        tagName,
        url: url.split('?')[0],
        selector: getCssSelector(target),
        errorType: this.inferResourceErrorType(url),
      };

      this.reporter.report(ErrorCategory.ResourceError, payload as Record<string, any>, {
        level: ErrorLevel.Warning,
        fingerprint: { category: ErrorCategory.ResourceError, resourceUrl: url },
      });
    } catch (error) {
      this.ctx.logger.warn('handle resource error failed', error);
    }
  }

  private handleRejection(event: PromiseRejectionEvent): void {
    try {
      const err = normalizeError(event.reason);
      const frames = parseStack(err.stack);
      this.reporter.report(
        ErrorCategory.JsError,
        {
          message: err.message,
          name: err.name,
          type: 'unhandledrejection',
          stack: err.stack,
          frames,
          mechanism: 'unhandledrejection',
        },
        {
          level: ErrorLevel.Error,
          fingerprint: {
            category: ErrorCategory.JsError,
            name: err.name,
            message: err.message,
            frames,
          },
        },
      );
    } catch (error) {
      this.ctx.logger.warn('handle rejection failed', error);
    }
  }

  private patchConsole(): void {
    const target = (getWindow() as any)?.console;
    if (!target) return;
    (['error', 'warn'] as const).forEach((level) => {
      const original = target[level];
      if (typeof original !== 'function') return;
      const instrument = this;
      target[level] = function patchedConsole(this: Console, ...args: any[]) {
        try {
          instrument.reporter.report(
            ErrorCategory.ConsoleError,
            {
              level,
              args: args.slice(0, 10).map((arg) => truncate(stringifyValue(arg), 1000)),
            },
            {
              level: level === 'error' ? ErrorLevel.Warning : ErrorLevel.Info,
              breadcrumb: false,
              fingerprint: {
                category: ErrorCategory.ConsoleError,
                name: 'ConsoleError',
                message: `${level}: ${args.map((arg) => stringifyValue(arg)).join(' ')}`,
              },
            },
          );
        } catch {
          /* 自保护：console 包装绝不能抛错 */
        }
        return original.apply(this, args as any);
      };
      instrument.consoleCleanups.push(() => {
        target[level] = original;
      });
    });
  }

  private inferResourceErrorType(url: string): string {
    if (!url) return 'unknown';
    try {
      const origin = getWindow()?.location?.origin;
      if (origin && !url.startsWith(origin) && !url.startsWith('data:')) return 'cors';
    } catch {
      /* ignore */
    }
    return 'network';
  }

  private isSelfUrl(url: string): boolean {
    const reportUrl = this.ctx?.transport?.getReportUrl?.();
    return !!reportUrl && url.startsWith(reportUrl.replace(/\/api\/.*$/, ''));
  }
}
