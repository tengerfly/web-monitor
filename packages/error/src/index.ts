import { definePlugin, type MonitorContext } from '@web-monitor/core';
import { ErrorLevel, type ErrorOptions } from '@web-monitor/types';
import { DEFAULT_ERROR_OPTIONS, type ResolvedErrorOptions } from './types';
import { ErrorCollector } from './collectors/global';
import { RequestErrorCollector } from './collectors/request';
import { ErrorReporter } from './reporter';

export * from './types';
export {
  computeFingerprint,
  normalizeMessage,
  parseStack,
  buildTitle,
  type FingerprintInput,
} from './fingerprint';
export { buildSnapshot, toRequestBrief } from './snapshot';
export { ErrorReporter, normalizeError, type ReportOptions } from './reporter';
export { ErrorCollector } from './collectors/global';
export { RequestErrorCollector } from './collectors/request';

export interface ErrorPluginApi {
  /** 上报异常对象（带完整溯源信息） */
  captureException(error: unknown, extra?: Record<string, any>, level?: string): void;
  /** 上报文本消息 */
  captureMessage(message: string, level?: string, extra?: Record<string, any>): void;
  /** 上报致命错误（跳过采样） */
  captureFatal(error: unknown, extra?: Record<string, any>): void;
  /** 获取上报器（高级用法：自定义错误结构） */
  getReporter(): ErrorReporter | undefined;
}

const PLUGIN_NAME = 'error';

/**
 * 错误监控与溯源插件。
 * 最小接入：
 *   createMonitor({ appKey, host, plugins: [errorPlugin()] }).start();
 * 仅此一个插件即可获得：错误采集 + 指纹归组 + 行为轨迹 + 现场快照 + 接口调用链。
 */
export function errorPlugin(options: ErrorOptions = {}) {
  const localOptions: ResolvedErrorOptions = {
    ...DEFAULT_ERROR_OPTIONS,
    ...options,
    minLevel: options.minLevel || ErrorLevel.Warning,
    ignoreErrors: options.ignoreErrors || [],
  } as ResolvedErrorOptions;

  return definePlugin<ErrorOptions>(
    PLUGIN_NAME,
    (ctx: MonitorContext) => {
      if (!ctx.isPluginEnabled(PLUGIN_NAME)) {
        ctx.logger.info('error plugin disabled by config');
        return;
      }

      const remote = ctx.getRuntimeConfig<ErrorOptions>(PLUGIN_NAME, options);
      const opts: ResolvedErrorOptions = {
        ...localOptions,
        ...remote,
        // 这两个是函数/正则，不能被远程配置（JSON）覆盖
        ignoreErrors: localOptions.ignoreErrors,
        beforeSend: localOptions.beforeSend,
        businessCodeExtractor: localOptions.businessCodeExtractor,
        minLevel: remote.minLevel || localOptions.minLevel,
      } as ResolvedErrorOptions;

      if (opts.maxBreadcrumbs && ctx.breadcrumbs) {
        ctx.breadcrumbs.setCapacity(opts.maxBreadcrumbs);
      }

      ctx.defineCollector(new ErrorCollector(opts));
      ctx.defineCollector(new RequestErrorCollector(opts));

      const api: ErrorPluginApi = {
        captureException: (error, extra, level) =>
          ctx.getCollector<ErrorCollector>('error')?.captureException(error, extra, level),
        captureMessage: (message, level, extra) =>
          ctx.getCollector<ErrorCollector>('error')?.captureMessage(message, level, extra),
        captureFatal: (error, extra) =>
          ctx.getCollector<ErrorCollector>('error')?.captureFatal(error, extra),
        getReporter: () => ctx.getCollector<ErrorCollector>('error')?.getReporter(),
      };

      const target = ctx as unknown as Record<string, any>;
      target.error = api;

      ctx.logger.debug('error plugin installed', {
        minLevel: opts.minLevel,
        maxBreadcrumbs: opts.maxBreadcrumbs,
        requestError: opts.requestError,
      });
    },
    options,
  );
}
