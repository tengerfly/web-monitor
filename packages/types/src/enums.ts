/**
 * 全局枚举与常量
 * 注意：该文件会被 SDK / 服务端 / 看板共同引用，新增枚举值属于向下兼容变更。
 */

/** 事件大类 */
export enum EventType {
  Performance = 'performance',
  Error = 'error',
  Behavior = 'behavior',
  Replay = 'replay',
  Custom = 'custom',
}

/** 性能事件子类别 */
export enum PerformanceCategory {
  WebVital = 'web-vital',
  Navigation = 'navigation',
  Resource = 'resource',
  LongTask = 'long-task',
  Fps = 'fps',
  Memory = 'memory',
  Api = 'api',
  RouteChange = 'route-change',
  Network = 'network',
  WhiteScreen = 'white-screen',
  CustomMetric = 'custom-metric',
}

/** 错误事件子类别 */
export enum ErrorCategory {
  JsError = 'js-error',
  ResourceError = 'resource-error',
  RequestError = 'request-error',
  ConsoleError = 'console-error',
  CustomError = 'custom-error',
}

/** 行为事件子类别 */
export enum BehaviorCategory {
  Pv = 'pv',
  RouteChange = 'route-change',
  Click = 'click',
  Exposure = 'exposure',
  Scroll = 'scroll',
  Form = 'form',
  Console = 'console',
  Visibility = 'visibility',
  Stay = 'stay',
  Custom = 'custom',
}

/** 回放事件子类别 */
export enum ReplayCategory {
  Meta = 'replay-meta',
  Chunk = 'replay-chunk',
}

/** Core Web Vitals 及兼容指标名 */
export enum MetricName {
  LCP = 'LCP',
  INP = 'INP',
  CLS = 'CLS',
  FCP = 'FCP',
  TTFB = 'TTFB',
  FID = 'FID',
  FP = 'FP',
  FMP = 'FMP',
  TTI = 'TTI',
}

/** 指标评级（对齐 Google Web Vitals 阈值口径） */
export enum Rating {
  Good = 'good',
  NeedsImprovement = 'needs-improvement',
  Poor = 'poor',
}

/** 错误级别 */
export enum ErrorLevel {
  Fatal = 'fatal',
  Error = 'error',
  Warning = 'warning',
  Info = 'info',
}

/** 错误分组处理状态 */
export enum ErrorStatus {
  Pending = 'pending',
  Resolved = 'resolved',
  Ignored = 'ignored',
}

/** 行为轨迹类型（错误溯源用） */
export enum BreadcrumbType {
  Click = 'click',
  Route = 'route',
  Request = 'request',
  Console = 'console',
  Input = 'input',
  Navigation = 'navigation',
  Custom = 'custom',
  Error = 'error',
}

/** 路由变更方式 */
export enum RouteChangeType {
  PushState = 'pushState',
  ReplaceState = 'replaceState',
  PopState = 'popstate',
  HashChange = 'hashchange',
  Initial = 'initial',
}

/** Navigation Timing 导航类型（对应 PerformanceNavigationTiming.type） */
export enum NavigationType {
  Navigate = 'navigate',
  Reload = 'reload',
  BackForward = 'back_forward',
  Prerender = 'prerender',
}

/** 接口错误类型 */
export enum RequestErrorType {
  Http = 'http',
  Timeout = 'timeout',
  Network = 'network',
  Cors = 'cors',
  Business = 'business',
}

/** 资源加载错误类型 */
export enum ResourceErrorType {
  Network = 'network',
  Cors = 'cors',
  NotFound = '404',
  Unknown = 'unknown',
}

/** 页面可见性状态 */
export enum VisibilityState {
  Visible = 'visible',
  Hidden = 'hidden',
  Prerender = 'prerender',
}

/* -------------------------------------------------------------------------- */
/*                      会话回放（对齐 rrweb 数据结构）                        */
/* -------------------------------------------------------------------------- */

/** 回放记录大类 */
export enum ReplayEventType {
  DomContentLoaded = 0,
  Load = 1,
  FullSnapshot = 2,
  IncrementalSnapshot = 3,
  Meta = 4,
  Custom = 5,
}

/** 增量快照来源 */
export enum ReplayIncrementalSource {
  Mutation = 0,
  MouseMove = 1,
  MouseInteraction = 2,
  Scroll = 3,
  ViewportResize = 4,
  Input = 5,
  TouchMove = 6,
  MediaInteraction = 7,
}

/** 鼠标交互类型 */
export enum ReplayMouseInteraction {
  MouseUp = 0,
  MouseDown = 1,
  Click = 2,
  ContextMenu = 3,
  DblClick = 4,
  Focus = 5,
  Blur = 6,
  TouchStart = 7,
  TouchMoveDeparted = 8,
  TouchEnd = 9,
}

/** 序列化 DOM 节点类型 */
export enum ReplayNodeType {
  Document = 0,
  DocumentType = 1,
  Element = 2,
  Text = 3,
  Cdata = 4,
  Comment = 5,
}

/** 回放分片结束原因 */
export enum ReplayFlushReason {
  Duration = 'duration',
  Size = 'size',
  Unload = 'unload',
  Manual = 'manual',
}

/* -------------------------------------------------------------------------- */
/*                                  常量                                       */
/* -------------------------------------------------------------------------- */

/** 上报接口路径 */
export const INGEST_PATH = '/api/v1/ingest';
/** 远程配置接口路径 */
export const CONFIG_PATH = '/api/v1/config';
/** 链路追踪请求头 */
export const TRACE_ID_HEADER = 'X-Trace-Id';
/** 会话无操作过期时间（毫秒） */
export const SESSION_TIMEOUT = 30 * 60 * 1000;
/** 单次上报最大体积（字节） */
export const MAX_BATCH_SIZE = 64 * 1024;
/** 单事件载荷最大体积（字节），超出截断 */
export const MAX_EVENT_PAYLOAD_SIZE = 32 * 1024;
/** 默认错误行为轨迹条数 */
export const DEFAULT_MAX_BREADCRUMBS = 20;

/** Web Vitals 默认阈值（用于评级与告警） */
export const DEFAULT_VITAL_THRESHOLDS: Record<string, [number, number]> = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  FID: [100, 300],
};
