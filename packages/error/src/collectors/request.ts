import { BaseCollector, type MonitorContext } from '@web-monitor/core';
import { ErrorCategory, ErrorLevel } from '@web-monitor/types';
import { ErrorReporter } from '../reporter';
import { ErrorCollector } from './global';
import type { ResolvedErrorOptions } from '../types';

/**
 * 接口错误采集器。
 * 消费 core 请求拦截结果，把「失败请求」转成可归组的错误事件，
 * 并复用错误上报器补齐行为轨迹与现场快照——这样在看板上能从
 * 「接口失败」直接跳到「该用户当时在做什么」。
 */
export class RequestErrorCollector extends BaseCollector {
  private reporter!: ErrorReporter;

  constructor(private readonly opts: ResolvedErrorOptions) {
    super('error:request', ['error']);
    this.pluginSampleRate = opts.sampleRate;
  }

  override setup(ctx: MonitorContext): void {
    super.setup(ctx);
    // 复用全局错误采集器的上报器：共享 ignoreErrors / beforeSend / minLevel 配置
    const errorCollector = ctx.getCollector<ErrorCollector>('error');
    this.reporter = errorCollector
      ? errorCollector.getReporter()
      : new ErrorReporter(ctx, this.opts);
  }

  protected onStart(): void {
    if (!this.opts.requestError) return;
    const off = this.ctx.emitter.on('request:end', (result) => {
      if (result.ok) return;
      const status = result.status;

      // 404 静态资源类的请求失败降级为 warning，避免淹没真实业务错误
      const level = status >= 500 || status === 0 ? ErrorLevel.Error : ErrorLevel.Warning;
      const message = this.buildMessage(result);

      this.reporter.report(
        ErrorCategory.RequestError,
        {
          message,
          method: result.method,
          url: result.url,
          rawUrl: result.rawUrl,
          status,
          errorType: result.errorType,
          businessCode: result.businessCode,
          duration: Math.round(result.duration),
          responseBody: result.responseText,
        },
        {
          level,
          traceId: result.traceId,
          fingerprint: {
            category: ErrorCategory.RequestError,
            requestKey: `${result.method}|${result.url}|${status || result.errorType}`,
          },
        },
      );
    });
    this.addCleanup(off);
  }

  private buildMessage(result: {
    method: string;
    url: string;
    status: number;
    errorType?: string;
    businessCode?: string | number;
  }): string {
    if (result.errorType === 'business' && result.businessCode !== undefined) {
      return `业务错误 ${result.businessCode}：${result.method} ${result.url}`;
    }
    if (result.errorType === 'timeout') return `接口超时：${result.method} ${result.url}`;
    if (result.status === 0) return `网络异常：${result.method} ${result.url}`;
    return `接口 ${result.status}：${result.method} ${result.url}`;
  }
}
