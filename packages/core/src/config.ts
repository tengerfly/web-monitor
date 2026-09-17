import {
  CONFIG_PATH,
  INGEST_PATH,
  type MaskRules,
  type MonitorEvent,
  type RemoteConfig,
} from '@web-monitor/types';
import { resolveMaskRules } from './utils/sanitize';
import type { Plugin } from './types';

/** 用户传入的监控配置 */
export interface MonitorOptions {
  /** 应用唯一标识（在监控平台创建应用后获得） */
  appKey: string;
  /** 上报服务地址，如 https://monitor.example.com */
  host?: string;
  /** 直接指定上报 URL（优先级高于 host） */
  reportUrl?: string;
  /** 环境标识：production / staging / development */
  env?: string;
  appName?: string;
  appVersion?: string;
  /** 初始登录用户 ID */
  userId?: string;
  /** 全局采样率 0-1 */
  sampleRate?: number;
  /** 达到多少条事件触发上报 */
  batchSize?: number;
  /** 定时上报间隔（ms） */
  flushInterval?: number;
  /** 内存缓冲区上限（超出后丢弃最旧事件） */
  maxQueueSize?: number;
  /** 本地持久化队列上限（失败重试用） */
  maxLocalQueueSize?: number;
  /** 上报失败重试次数 */
  maxRetries?: number;
  /** 重试基础间隔（ms），指数退避 */
  retryDelay?: number;
  /** 上报超时（ms） */
  timeout?: number;
  /** 每分钟最大上报事件数（防雪崩） */
  maxEventsPerMinute?: number;
  /** 是否输出调试日志 */
  debug?: boolean;
  /** 是否拉取服务端远程配置 */
  remoteConfig?: boolean;
  /** 初始化后是否自动 start */
  autoStart?: boolean;
  /** 是否自动拦截 fetch / XHR（性能与错误溯源共用） */
  interceptRequest?: boolean;
  /** 是否自动监听路由变化 */
  interceptRoute?: boolean;
  /** 页面隐藏/卸载时是否强制上报 */
  reportOnUnload?: boolean;
  /** 本地队列事件有效期（ms） */
  localQueueTTL?: number;
  /** 脱敏规则 */
  maskRules?: MaskRules;
  /** 能力插件（performance / error / behavior / replay） */
  plugins?: Plugin[];
  /** 全局事件拦截，返回空数组或 null 表示本批次不上报 */
  beforeSend?: (events: MonitorEvent[]) => MonitorEvent[] | null;
  /** SDK 内部错误回调（自保护，不影响业务） */
  onError?: (error: Error, scope?: string) => void;
}

/** 已解析的配置（所有默认值已填充） */
export interface ResolvedOptions {
  appKey: string;
  host: string;
  reportUrl: string;
  configUrl: string;
  env: string;
  appName: string;
  appVersion: string;
  userId?: string;
  sampleRate: number;
  batchSize: number;
  flushInterval: number;
  maxQueueSize: number;
  maxLocalQueueSize: number;
  maxRetries: number;
  retryDelay: number;
  timeout: number;
  maxEventsPerMinute: number;
  debug: boolean;
  remoteConfig: boolean;
  autoStart: boolean;
  interceptRequest: boolean;
  interceptRoute: boolean;
  reportOnUnload: boolean;
  localQueueTTL: number;
  maskRules: Required<MaskRules>;
  plugins: Plugin[];
  beforeSend?: (events: MonitorEvent[]) => MonitorEvent[] | null;
  onError?: (error: Error, scope?: string) => void;
}

export const DEFAULT_OPTIONS = {
  host: '',
  env: 'production',
  appName: '',
  appVersion: '',
  sampleRate: 1,
  batchSize: 10,
  flushInterval: 5000,
  maxQueueSize: 100,
  maxLocalQueueSize: 200,
  maxRetries: 3,
  retryDelay: 1000,
  timeout: 5000,
  maxEventsPerMinute: 3000,
  debug: false,
  remoteConfig: true,
  autoStart: false,
  interceptRequest: true,
  interceptRoute: true,
  reportOnUnload: true,
  localQueueTTL: 24 * 60 * 60 * 1000,
} as const;

const trimTrailingSlash = (url: string): string => url.replace(/\/+$/, '');

export function resolveOptions(options: MonitorOptions): ResolvedOptions {
  if (!options || !options.appKey) {
    throw new Error('[web-monitor] options.appKey is required');
  }
  const host = trimTrailingSlash(options.host || '');
  const reportUrl = options.reportUrl || (host ? `${host}${INGEST_PATH}` : '');
  const configUrl = host ? `${host}${CONFIG_PATH}` : '';

  return {
    ...DEFAULT_OPTIONS,
    ...options,
    host,
    reportUrl,
    configUrl,
    maskRules: resolveMaskRules(options.maskRules),
    plugins: options.plugins || [],
  } as ResolvedOptions;
}

/** 运行时配置（远程下发 + 本地可改），供插件读取 */
export interface RuntimeConfig {
  sampleRate: number;
  plugins: Record<string, boolean>;
  performance?: Record<string, any>;
  behavior?: Record<string, any>;
  error?: Record<string, any>;
  replay?: Record<string, any>;
  maskRules?: MaskRules;
  host?: string;
}

export const createRuntimeConfig = (options: ResolvedOptions): RuntimeConfig => ({
  sampleRate: options.sampleRate,
  plugins: { performance: true, behavior: true, error: true, replay: true },
});

export const applyRemoteConfig = (runtime: RuntimeConfig, remote: RemoteConfig): RuntimeConfig => ({
  ...runtime,
  sampleRate: typeof remote.sampleRate === 'number' ? remote.sampleRate : runtime.sampleRate,
  plugins: { ...runtime.plugins, ...(remote.plugins || {}) },
  performance: remote.performance || runtime.performance,
  behavior: remote.behavior || runtime.behavior,
  error: remote.error || runtime.error,
  replay: remote.replay || runtime.replay,
  maskRules: remote.maskRules || runtime.maskRules,
  host: remote.host || runtime.host,
});
