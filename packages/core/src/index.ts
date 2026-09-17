/**
 * @web-monitor/core —— 采集底座
 *
 * 业务方通常只需：
 *   import { createMonitor } from '@web-monitor/core';
 *   import { performancePlugin } from '@web-monitor/performance';
 *   createMonitor({ appKey, host, plugins: [performancePlugin()] }).start();
 */

// 协议类型重新导出，业务侧无需单独安装 @web-monitor/types
export * from '@web-monitor/types';

// 配置
export {
  DEFAULT_OPTIONS,
  resolveOptions,
  createRuntimeConfig,
  applyRemoteConfig,
  type MonitorOptions,
  type ResolvedOptions,
  type RuntimeConfig,
} from './config';

// 类型契约
export type {
  Collector,
  EventDraft,
  MonitorContext,
  MonitorEventMap,
  Plugin,
} from './types';
export { definePlugin } from './types';

// 核心构件（能力包开发需要）
export { Monitor, createMonitor, getGlobalMonitor, setGlobalMonitor, SDK_NAME, SDK_VERSION } from './monitor';
export { Emitter, type Listener } from './emitter';
export { HookManager, type BeforePushHook, type BeforeSendHook, type AfterSendHook } from './hooks';
export { BaseCollector } from './collector';
export { SessionManager } from './session';
export { ContextManager } from './context';
export { BreadcrumbBuffer, type BreadcrumbInput } from './breadcrumb';
export { Transport, type SendResult, type TransportDeps } from './transport';
export { LocalQueue, type QueueItem } from './queue';

// 共享采集器
export { RequestInstrument, type RequestResult, type RequestInstrumentOptions } from './instrument/request';
export { RouteInstrument, type RouteChangeInfo } from './instrument/route';

// 工具集
export * from './utils';
