import {
  stringifyValue,
  truncate,
  type MonitorContext,
} from '@web-monitor/core';
import {
  BreadcrumbType,
  ErrorCategory,
  ErrorLevel,
  EventType,
  type Breadcrumb,
  type ErrorSnapshot,
} from '@web-monitor/types';
import { computeFingerprint, buildTitle, parseStack, type FingerprintInput } from './fingerprint';
import { buildSnapshot } from './snapshot';
import { severityOf, type ResolvedErrorOptions } from './types';

export interface ReportOptions {
  level?: ErrorLevel | string;
  fingerprint: FingerprintInput;
  traceId?: string;
  /** 跳过采样（fatal 级别默认强制上报） */
  force?: boolean;
  /** 是否额外写入行为轨迹 */
  breadcrumb?: boolean;
}

/**
 * 错误上报器：统一构造「溯源三件套」（指纹 + 行为轨迹 + 现场快照）并提交事件。
 * 所有错误采集器都通过它上报，保证数据结构一致。
 */
export class ErrorReporter {
  constructor(
    private readonly ctx: MonitorContext,
    private readonly opts: ResolvedErrorOptions,
  ) {}

  /** 级别过滤：低于 minLevel 的错误丢弃 */
  shouldReport(level?: string): boolean {
    return severityOf(level) >= severityOf(this.opts.minLevel);
  }

  /** 忽略规则匹配 */
  isIgnored(message: string): boolean {
    if (!message) return false;
    return this.opts.ignoreErrors.some((rule) =>
      typeof rule === 'string' ? message.includes(rule) : rule.test(message),
    );
  }

  getBreadcrumbs(): Breadcrumb[] {
    if (this.opts.maxBreadcrumbs <= 0) return [];
    return this.ctx.breadcrumbs.getAll().slice(-this.opts.maxBreadcrumbs);
  }

  report(category: string, payload: Record<string, any>, options: ReportOptions): void {
    try {
      const level = options.level || ErrorLevel.Error;
      if (!this.shouldReport(level)) return;

      const message = String(payload.message || payload.url || payload.selector || '');
      if (this.isIgnored(message)) return;

      const fingerprint = computeFingerprint(options.fingerprint);
      const snapshot: ErrorSnapshot = buildSnapshot(this.ctx, this.opts.snapshot);

      let body: Record<string, any> = {
        ...payload,
        fingerprint,
        level,
        breadcrumbs: this.getBreadcrumbs(),
        snapshot,
      };

      if (this.opts.beforeSend) {
        const result = this.opts.beforeSend(body);
        if (!result) return;
        body = result;
      }

      this.ctx.push({
        type: EventType.Error,
        category,
        payload: body,
        traceId: options.traceId,
        sampleRate: this.opts.sampleRate,
        force: options.force ?? level === ErrorLevel.Fatal,
      });

      this.ctx.emitter.emit('error:captured', {
        fingerprint,
        category,
        timestamp: Date.now(),
      });

      if (options.breadcrumb !== false) {
        this.ctx.breadcrumbs.push({
          type: BreadcrumbType.Error,
          message: truncate(`错误 ${buildTitle(body.name, message, 120)}`, 300),
          level: 'error',
          data: { category, fingerprint },
        });
      }
    } catch (error) {
      this.ctx.logger.warn('report error failed', error);
    }
  }

  /** 上报异常对象 */
  captureException(
    error: unknown,
    extra: Record<string, any> = {},
    level: string = ErrorLevel.Error,
    mechanism = 'manual',
  ): string {
    const err = normalizeError(error);
    const frames = parseStack(err.stack);
    this.report(
      ErrorCategory.CustomError,
      {
        message: err.message,
        name: err.name,
        stack: err.stack,
        extra,
        mechanism,
      },
      {
        level,
        fingerprint: {
          category: ErrorCategory.CustomError,
          name: err.name,
          message: err.message,
          frames,
        },
      },
    );
    return err.message;
  }

  /** 上报文本消息（非异常场景，如业务断言失败） */
  captureMessage(
    message: string,
    level: string = ErrorLevel.Info,
    extra: Record<string, any> = {},
  ): void {
    this.report(
      ErrorCategory.CustomError,
      { message, name: 'Message', extra, mechanism: 'captureMessage' },
      {
        level,
        breadcrumb: false,
        fingerprint: {
          category: ErrorCategory.CustomError,
          name: 'Message',
          message,
        },
      },
    );
  }

  /** fatal 级别快捷方法 */
  captureFatal(error: unknown, extra: Record<string, any> = {}): void {
    this.captureException(error, extra, ErrorLevel.Fatal, 'fatal');
  }
}

/** 把任意抛出物归一化为 Error */
export function normalizeError(error: unknown): { name: string; message: string; stack?: string } {
  if (error instanceof Error) {
    return { name: error.name || 'Error', message: error.message || String(error), stack: error.stack };
  }
  if (typeof error === 'string') return { name: 'Error', message: error, stack: undefined };
  if (error && typeof error === 'object') {
    const record = error as Record<string, any>;
    if (typeof record.message === 'string') {
      return {
        name: record.name || 'Error',
        message: record.message,
        stack: typeof record.stack === 'string' ? record.stack : undefined,
      };
    }
    if (typeof record.reason === 'string') {
      return { name: 'Error', message: record.reason };
    }
    return { name: 'Error', message: stringifyValue(error) };
  }
  return { name: 'Error', message: String(error) };
}
