import {
  ErrorLevel,
  EventType,
  MAX_EVENT_PAYLOAD_SIZE,
  type CommonContext,
  type EventContext,
  type MonitorEvent,
} from '@web-monitor/types';
import { Emitter } from './emitter';
import { HookManager } from './hooks';
import { SessionManager } from './session';
import { ContextManager } from './context';
import { BreadcrumbBuffer } from './breadcrumb';
import { Transport } from './transport';
import { RequestInstrument, type RequestResult } from './instrument/request';
import { RouteInstrument } from './instrument/route';
import { InteractionBreadcrumbCollector } from './collectors/breadcrumb';
import { createLogger, type Logger } from './utils/logger';
import {
  applyRemoteConfig,
  createRuntimeConfig,
  resolveOptions,
  type MonitorOptions,
  type ResolvedOptions,
  type RuntimeConfig,
} from './config';
import { generateEventId, isSampled } from './utils/uuid';
import { byteLength, safeStringify } from './utils/object';
import { now, runIdle } from './utils/misc';
import { resolveMaskRules, sanitizeData } from './utils/sanitize';
import { addEventListenerSafe, getDocument } from './utils/global';
import type {
  Collector,
  EventDraft,
  MonitorContext,
  MonitorEventMap,
  Plugin,
} from './types';

/** SDK 版本号（发版时与 package.json 同步） */
export const SDK_VERSION = '0.1.0';
export const SDK_NAME = '@web-monitor/core';

interface ErrorCollectorLike {
  captureException?: (error: unknown, extra?: Record<string, any>, level?: string) => void;
  captureMessage?: (message: string, level?: string, extra?: Record<string, any>) => void;
}

/**
 * 监控实例：SDK 的总装配与运行时上下文。
 * 业务侧通过 createMonitor(options) 创建，通常只调用 start() 与埋点 API。
 */
export class Monitor implements MonitorContext {
  readonly version = SDK_VERSION;
  readonly options: ResolvedOptions;
  readonly runtime: RuntimeConfig;
  readonly logger: Logger;
  readonly emitter = new Emitter<MonitorEventMap>();
  readonly hooks = new HookManager();
  readonly session = new SessionManager();
  readonly context: ContextManager;
  readonly breadcrumbs = new BreadcrumbBuffer();
  readonly transport: Transport;
  readonly requests: RequestInstrument;
  readonly router = new RouteInstrument();

  private collectors = new Map<string, Collector>();
  private cleanups: Array<() => void> = [];
  private plugins: Plugin[] = [];
  private started = false;
  private destroyed = false;

  constructor(options: MonitorOptions) {
    this.options = resolveOptions(options);
    this.logger = createLogger(this.options.debug);
    this.runtime = createRuntimeConfig(this.options);
    this.context = new ContextManager(this.options, this.session, SDK_NAME);

    this.transport = new Transport({
      options: this.options,
      hooks: this.hooks,
      emitter: this.emitter,
      logger: this.logger,
      getCommon: () => this.getCommon(),
      sdkName: SDK_NAME,
      sdkVersion: SDK_VERSION,
    });

    this.requests = new RequestInstrument({
      excludeUrls: this.options.reportUrl ? [this.options.reportUrl] : [],
      businessCodeExtractor: this.resolveBusinessCodeExtractor(options.plugins || []),
      onResult: (result) => this.onRequestResult(result),
    });

    this.install(options.plugins || []);
    this.emitter.emit('monitor:init', { options: this.options });
    if (this.options.autoStart) this.start();
  }

  /* ------------------------------ 装配与生命周期 ------------------------------ */

  private install(plugins: Plugin[]): void {
    this.plugins = plugins;

    this.session.init((payload) => {
      this.emitter.emit('session:new', payload);
      this.breadcrumbs.push({
        type: 'navigation',
        message: `新会话开始 ${payload.sessionId}`,
        data: payload,
      });
    });

    if (this.options.beforeSend) this.hooks.onBeforeSend(this.options.beforeSend);
    if (this.options.onError) this.hooks.onError(this.options.onError);

    this.router.setup();
    this.cleanups.push(
      this.router.onChange((info) => {
        this.context.setPage(info.to);
        this.breadcrumbs.push({
          type: 'route',
          message: `${info.from} → ${info.to}（${info.type}）`,
          data: { ...info },
        });
        this.emitter.emit('route:change', {
          from: info.from,
          to: info.to,
          type: String(info.type),
          timestamp: info.timestamp,
        });
      }),
    );

    // 常驻交互轨迹采集器：保证「只装 core + error」时溯源线索依然完整
    this.defineCollector(new InteractionBreadcrumbCollector(this.options));

    plugins.forEach((plugin) => {
      try {
        const cleanup = plugin.install(this);
        if (typeof cleanup === 'function') this.cleanups.push(cleanup);
      } catch (error) {
        this.logger.error(`plugin ${plugin.name} install failed`, error);
        this.hooks.emitError(error as Error, `plugin:${plugin.name}`);
      }
    });

    // 插件安装完成后再回填业务错误码提取器（error 插件此时已就位）
    this.requests.setBusinessCodeExtractor(this.resolveBusinessCodeExtractor(plugins));
  }

  private resolveBusinessCodeExtractor(
    plugins: Plugin[],
  ): ((data: any) => string | number | undefined | void) | undefined {
    const errorPlugin = plugins.find((p) => p.name === 'error') as
      | Plugin<{ businessCodeExtractor?: (data: any) => string | number | undefined | void }>
      | undefined;
    return errorPlugin?.options?.businessCodeExtractor;
  }

  start(): void {
    if (this.started || this.destroyed) return;
    this.started = true;
    this.session.touch();

    if (this.options.interceptRoute) this.router.install();
    if (this.options.interceptRequest) this.requests.install();
    this.transport.start();
    this.startCollectors();
    this.listenLifecycle();
    runIdle(() => void this.fetchRemoteConfig());

    this.emitter.emit('monitor:start', { timestamp: now() });
    this.logger.info('monitor started', {
      appKey: this.options.appKey,
      env: this.options.env,
      appVersion: this.options.appVersion,
      plugins: this.plugins.map((plugin) => plugin.name),
    });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    this.collectors.forEach((collector) => collector.stop());
    this.requests.uninstall();
    this.router.uninstall();
    this.transport.stop();
    this.runCleanups();
    this.emitter.emit('monitor:stop', { timestamp: now() });
  }

  destroy(): void {
    if (this.destroyed) return;
    this.flush();
    this.stop();
    this.collectors.forEach((collector) => collector.destroy?.());
    this.collectors.clear();
    this.transport.destroy();
    this.router.destroy();
    this.hooks.clear();
    this.emitter.clear();
    this.destroyed = true;
  }

  flush(): void {
    this.collectors.forEach((collector) => collector.flush?.());
    this.transport.flush();
  }

  private listenLifecycle(): void {
    const doc = getDocument();
    if (!doc) return;
    this.cleanups.push(
      addEventListenerSafe(doc, 'visibilitychange', () => {
        if (doc.visibilityState === 'visible') this.session.touch();
      }),
    );
  }

  private runCleanups(): void {
    const list = this.cleanups;
    this.cleanups = [];
    list.forEach((fn) => {
      try {
        fn();
      } catch {
        /* ignore */
      }
    });
  }

  /** 按依赖拓扑顺序启动采集器 */
  private startCollectors(): void {
    const pending = Array.from(this.collectors.values());
    const startedNames = new Set<string>();
    let guard = 0;
    while (pending.length && guard++ < 100) {
      for (let i = pending.length - 1; i >= 0; i--) {
        const collector = pending[i];
        const deps = collector.deps || [];
        if (deps.every((dep) => startedNames.has(dep) || !this.collectors.has(dep))) {
          try {
            collector.start();
          } catch (error) {
            this.logger.warn(`collector ${collector.name} start failed`, error);
          }
          startedNames.add(collector.name);
          pending.splice(i, 1);
        }
      }
    }
    pending.forEach((collector) => {
      this.logger.warn(`collector ${collector.name} has unresolved deps`, collector.deps);
      try {
        collector.start();
      } catch {
        /* ignore */
      }
    });
  }

  /* -------------------------------- 运行时 API ------------------------------- */

  push<P = Record<string, any>>(draft: EventDraft<P>): void {
    this.pushInternal(draft, false);
  }

  pushForce<P = Record<string, any>>(draft: EventDraft<P>): void {
    this.pushInternal(draft, true);
  }

  private pushInternal<P>(draft: EventDraft<P>, force: boolean): void {
    try {
      if (this.destroyed) return;
      const rate = draft.sampleRate ?? this.runtime.sampleRate;
      if (!force && !draft.force && !isSampled(rate)) return;
      this.session.touch();

      let payload: any = draft.payload;
      if (draft.sanitize !== false) {
        payload = sanitizeData(payload, this.options.maskRules.fields);
      }

      const event: MonitorEvent = {
        id: generateEventId(),
        type: draft.type,
        category: draft.category,
        timestamp: draft.timestamp ?? now(),
        traceId: draft.traceId,
        payload,
      };

      const text = safeStringify(payload);
      if (byteLength(text) > MAX_EVENT_PAYLOAD_SIZE) {
        event.payload = { __truncated: true, originalSize: byteLength(text) };
        this.logger.warn('event payload too large, truncated', draft.category);
      }

      const hooked = this.hooks.applyBeforePush(event);
      if (!hooked) return;
      this.emitter.emit('event:pushed', { event: hooked, sampleRate: rate });
      this.transport.push(hooked);
    } catch (error) {
      this.logger.warn('push event failed', error);
      this.hooks.emitError(error as Error, 'push');
    }
  }

  defineCollector<T extends Collector>(collector: T): T {
    if (!this.collectors.has(collector.name)) {
      collector.setup(this);
      this.collectors.set(collector.name, collector);
      if (this.started) {
        try {
          collector.start();
        } catch (error) {
          this.logger.warn(`collector ${collector.name} start failed`, error);
        }
      }
    }
    return collector;
  }

  getCollector<T extends Collector = Collector>(name: string): T | undefined {
    return this.collectors.get(name) as T | undefined;
  }

  hasCollector(name: string): boolean {
    return this.collectors.has(name);
  }

  getCommon(): CommonContext {
    return this.context.getCommon();
  }

  getEventContext(): EventContext {
    return this.context.getEventContext();
  }

  getRuntimeConfig<T extends Record<string, any> = Record<string, any>>(
    plugin: string,
    local?: T,
  ): T {
    const remote = (this.runtime as unknown as Record<string, any>)[plugin] || {};
    return { ...(local || {}), ...remote } as T;
  }

  isPluginEnabled(plugin: string): boolean {
    return this.runtime.plugins[plugin] !== false;
  }

  identify(userId?: string | null, traits?: Record<string, unknown>): void {
    this.session.setUserId(userId);
    if (traits) this.context.setCustom(traits);
    this.breadcrumbs.push({
      type: 'custom',
      message: `用户标识切换为 ${userId || '匿名'}`,
      data: traits,
    });
  }

  setUserContext(custom: Record<string, unknown>): void {
    this.context.setCustom(custom);
  }

  onCleanup(fn: () => void): void {
    this.cleanups.push(fn);
  }

  isStarted(): boolean {
    return this.started;
  }

  /* -------------------------------- 埋点 API -------------------------------- */

  /** 自定义事件埋点 */
  track(eventName: string, properties: Record<string, any> = {}, category?: string): void {
    this.push({
      type: EventType.Custom,
      category: 'custom',
      payload: { eventName, properties, category },
    });
    this.breadcrumbs.push({
      type: 'custom',
      message: `埋点 ${eventName}`,
      data: properties,
    });
  }

  /** 自定义性能指标 */
  reportMetric(
    metric: string,
    value: number,
    options: { unit?: string; tags?: Record<string, string | number> } = {},
  ): void {
    this.push({
      type: EventType.Performance,
      category: 'custom-metric',
      payload: { metric, value, unit: options.unit, tags: options.tags },
    });
  }

  /** 手动上报错误（优先交给 error 插件以获得指纹与溯源信息） */
  reportError(
    error: unknown,
    extra: Record<string, any> = {},
    level: string = ErrorLevel.Error,
  ): void {
    const collector = this.collectors.get('error') as unknown as ErrorCollectorLike | undefined;
    if (collector?.captureException) {
      collector.captureException(error, extra, level);
      return;
    }
    const err = error instanceof Error ? error : new Error(String(error));
    this.push({
      type: EventType.Error,
      category: 'custom-error',
      payload: {
        message: err.message,
        name: err.name,
        stack: err.stack,
        level,
        extra,
        fingerprint: `${err.name}|${err.message}`,
        breadcrumbs: this.breadcrumbs.getAll(),
      },
    });
  }

  /* ------------------------------- 内部接线 -------------------------------- */

  private onRequestResult(result: RequestResult): void {
    this.breadcrumbs.push({
      type: 'request',
      message: `${result.method} ${result.url} → ${result.status || result.errorType || 'failed'} (${Math.round(
        result.duration,
      )}ms)`,
      level: result.ok ? 'info' : 'error',
      timestamp: result.timestamp,
      data: {
        method: result.method,
        url: result.url,
        rawUrl: result.rawUrl,
        status: result.status,
        duration: Math.round(result.duration),
        ok: result.ok,
        errorType: result.errorType,
        businessCode: result.businessCode,
        traceId: result.traceId,
      },
    });
    this.emitter.emit('request:end', result);
  }

  private async fetchRemoteConfig(): Promise<void> {
    if (!this.options.remoteConfig || !this.options.configUrl) return;
    try {
      const url = `${this.options.configUrl}?appKey=${encodeURIComponent(
        this.options.appKey,
      )}&sdk=${SDK_VERSION}`;
      const response = await fetch(url, { method: 'GET', credentials: 'omit', mode: 'cors' });
      if (!response.ok) return;
      const json = await response.json();
      if (!json?.data) return;

      Object.assign(this.runtime, applyRemoteConfig(this.runtime, json.data));

      if (json.data.maskRules) {
        const merged = resolveMaskRules({
          selectors: [...this.options.maskRules.selectors, ...(json.data.maskRules.selectors || [])],
          ignoreSelectors: [
            ...this.options.maskRules.ignoreSelectors,
            ...(json.data.maskRules.ignoreSelectors || []),
          ],
          attributes: [
            ...this.options.maskRules.attributes,
            ...(json.data.maskRules.attributes || []),
          ],
          fields: [...this.options.maskRules.fields, ...(json.data.maskRules.fields || [])],
        });
        (this.options as { maskRules: typeof merged }).maskRules = merged;
      }

      if (json.data.host) {
        const host = String(json.data.host).replace(/\/+$/, '');
        this.transport.setReportUrl(`${host}/api/v1/ingest`);
      }

      this.emitter.emit('config:remote', { config: json.data });
      this.logger.info('remote config applied', json.data);
    } catch (error) {
      this.logger.debug('remote config fetch failed', error);
    }
  }
}

/** 创建监控实例 */
export function createMonitor(options: MonitorOptions): Monitor {
  return new Monitor(options);
}

let globalInstance: Monitor | undefined;

export function setGlobalMonitor(monitor: Monitor): Monitor {
  globalInstance = monitor;
  return monitor;
}

export function getGlobalMonitor(): Monitor | undefined {
  return globalInstance;
}
