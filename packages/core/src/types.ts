import type {
  CommonContext,
  EventContext,
  MonitorEvent,
  RemoteConfig,
} from '@web-monitor/types';
import type { ResolvedOptions, RuntimeConfig } from './config';
import type { Emitter } from './emitter';
import type { HookManager } from './hooks';
import type { Logger } from './utils/logger';
import type { SessionManager } from './session';
import type { ContextManager } from './context';
import type { BreadcrumbBuffer } from './breadcrumb';
import type { Transport, SendResult } from './transport';
import type { RequestInstrument, RequestResult } from './instrument/request';
import type { RouteInstrument } from './instrument/route';

/** 采集器事件草稿（由采集器产出，Monitor 负责注入公共字段） */
export interface EventDraft<P = Record<string, any>> {
  type: string;
  category: string;
  payload: P;
  /** 事件发生时间，默认取当前时间 */
  timestamp?: number;
  /** 链路 ID */
  traceId?: string;
  /** 事件级采样率（默认走运行时全局采样率） */
  sampleRate?: number;
  /** 置为 true 可跳过采样（重要事件必报） */
  force?: boolean;
  /** 是否对载荷做字段脱敏（回放等自带遮罩的数据可置 false 提升性能） */
  sanitize?: boolean;
}

/** 采集器：能力包的最小可插拔单元 */
export interface Collector {
  readonly name: string;
  /** 依赖的其他采集器名，Monitor 会按依赖顺序启动 */
  readonly deps?: string[];
  setup(ctx: MonitorContext): void;
  start(): void;
  stop(): void;
  destroy?(): void;
  /** 立即冲刷采集器内部缓冲（如回放分片） */
  flush?(): void;
}

/** 插件：能力包的对外注册单元 */
export interface Plugin<O = Record<string, any>> {
  readonly name: string;
  /** 该插件注册的采集器，用于按依赖排序与启停 */
  readonly collectors?: string[];
  /** 插件自身配置（可被远程配置覆盖后的结果） */
  readonly options?: O;
  install(ctx: MonitorContext): void | (() => void);
}

/** 请求结束事件 */
export interface MonitorEventMap {
  'monitor:init': { options: ResolvedOptions };
  'monitor:start': { timestamp: number };
  'monitor:stop': { timestamp: number };
  'monitor:flushed': { count: number };
  'session:new': { sessionId: string; previousSessionId?: string };
  'route:change': { from: string; to: string; type: string; timestamp: number };
  'request:start': {
    id: string;
    method: string;
    url: string;
    traceId: string;
    timestamp: number;
  };
  'request:end': RequestResult;
  'error:captured': { fingerprint: string; category: string; timestamp: number };
  'event:pushed': { event: MonitorEvent; sampleRate: number };
  'replay:mark': { timestamp: number; tag: string; payload?: Record<string, any> };
  'config:remote': { config: RemoteConfig };
  'transport:sent': SendResult;
}

/** 提供给插件的运行时上下文（SDK 内部 API 面） */
export interface MonitorContext {
  readonly version: string;
  readonly options: ResolvedOptions;
  readonly runtime: RuntimeConfig;
  readonly logger: Logger;
  readonly emitter: Emitter<MonitorEventMap>;
  readonly hooks: HookManager;
  readonly session: SessionManager;
  readonly context: ContextManager;
  readonly breadcrumbs: BreadcrumbBuffer;
  readonly transport: Transport;
  readonly requests: RequestInstrument;
  readonly router: RouteInstrument;

  /** 提交一个事件（自动采样、注入公共字段、走 hooks 与上报管道） */
  push<P = Record<string, any>>(event: EventDraft<P>): void;
  /** 强制提交（跳过采样） */
  pushForce<P = Record<string, any>>(event: EventDraft<P>): void;

  /** 自定义事件埋点 */
  track(eventName: string, properties?: Record<string, any>, category?: string): void;
  /** 自定义性能指标 */
  reportMetric(
    metric: string,
    value: number,
    options?: { unit?: string; tags?: Record<string, string | number> },
  ): void;

  defineCollector<T extends Collector>(collector: T): T;
  getCollector<T extends Collector = Collector>(name: string): T | undefined;
  hasCollector(name: string): boolean;

  getCommon(): CommonContext;
  getEventContext(): EventContext;
  getRuntimeConfig<T extends Record<string, any> = Record<string, any>>(
    plugin: string,
    local?: T,
  ): T;
  isPluginEnabled(plugin: string): boolean;

  identify(userId?: string | null, traits?: Record<string, unknown>): void;
  setUserContext(custom: Record<string, unknown>): void;

  /** 注册清理函数（destroy 时统一执行） */
  onCleanup(fn: () => void): void;
  flush(): void;
}

/** 插件工厂：便于能力包导出一致的插件形态 */
export function definePlugin<O extends Record<string, any>>(
  name: string,
  install: Plugin<O>['install'],
  options: O = {} as O,
  collectors?: string[],
): Plugin<O> {
  return { name, options, collectors, install };
}

/** 采集器基类实现约定（具体实现见 collector.ts） */
export interface CollectorConstructor<T extends Collector = Collector> {
  new (ctx: MonitorContext): T;
}
