import type { CommonContext, NetworkInfo } from './context';
import type {
  BreadcrumbType,
  ErrorCategory,
  ErrorLevel,
  MetricName,
  NavigationType,
  PerformanceCategory,
  Rating,
  ReplayFlushReason,
  ReplayIncrementalSource,
  ReplayMouseInteraction,
  ReplayNodeType,
  RequestErrorType,
  ResourceErrorType,
  RouteChangeType,
  VisibilityState,
} from './enums';

/* -------------------------------------------------------------------------- */
/*                                  信封                                       */
/* -------------------------------------------------------------------------- */

export interface SdkDescriptor {
  name: string;
  version: string;
}

/** 单条事件（差异字段） */
export interface MonitorEvent<P = Record<string, any>> {
  id: string;
  type: string;
  category: string;
  /** 事件发生时间（ms） */
  timestamp: number;
  /** 链路 ID */
  traceId?: string;
  payload: P;
}

/** 上报请求体 */
export interface IngestPayload {
  appKey: string;
  sdk: SdkDescriptor;
  common: CommonContext;
  events: MonitorEvent[];
}

export interface IngestResponseData {
  accepted: number;
  dropped: number;
  sampleRate: number;
}

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

/* -------------------------------------------------------------------------- */
/*                              性能类载荷                                     */
/* -------------------------------------------------------------------------- */

export interface WebVitalPayload {
  metric: MetricName | string;
  value: number;
  rating: Rating | string;
  navigationType?: string;
  delta?: number;
  /** 参与计算的条目数量（如 CLS 的 layout-shift 次数） */
  entries?: number;
}

export interface NavigationPayload {
  navigationType: NavigationType | string;
  /** 重定向耗时 */
  redirect: number;
  dns: number;
  tcp: number;
  tls: number;
  /** 请求耗时（requestStart -> responseStart） */
  request: number;
  /** 响应耗时（responseStart -> responseEnd） */
  response: number;
  /** 首字节时间 */
  firstByte: number;
  /** DOM 解析耗时 */
  domParse: number;
  domContentLoaded: number;
  load: number;
  /** 页面总加载耗时（loadEventEnd - startTime） */
  pageLoad: number;
  fp: number;
  fmp: number;
  tti: number;
  transferSize?: number;
  decodedBodySize?: number;
}

export interface ResourcePayload {
  /** 资源 URL（已去除 query 敏感参数） */
  name: string;
  initiatorType: string;
  duration: number;
  startTime: number;
  transferSize: number;
  encodedBodySize: number;
  decodedBodySize: number;
  protocol?: string;
}

export interface LongTaskEntry {
  startTime: number;
  duration: number;
}

export interface LongTaskPayload {
  count: number;
  totalDuration: number;
  maxDuration: number;
  /** Total Blocking Time 估算（超过 50ms 的部分累加） */
  tbt: number;
  entries: LongTaskEntry[];
}

export interface FpsPayload {
  fps: number;
  sampleDuration: number;
  frames: number;
  jankCount: number;
  maxFrameDuration: number;
}

export interface MemoryPayload {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
  /** 使用率（0-1） */
  usage: number;
}

export interface ApiPayload {
  method: string;
  /** 归一化后的 URL 模板，如 /api/order/:id */
  url: string;
  /** 原始 URL */
  rawUrl?: string;
  status: number;
  ok: boolean;
  duration: number;
  requestSize?: number;
  responseSize?: number;
  traceId?: string;
  /** 失败时的错误类型 */
  errorType?: RequestErrorType | string;
  /** 业务错误码（响应体解析） */
  businessCode?: string | number;
}

export interface RoutePerformancePayload {
  from: string;
  to: string;
  type: RouteChangeType | string;
  /** 路由切换耗时（点击/跳转 -> 目标页渲染完成） */
  duration: number;
}

export interface NetworkQualityPayload extends NetworkInfo {}

export interface WhiteScreenPayload {
  url: string;
  /** 持续无可视内容的时间 */
  duration: number;
  /** 采样点数量 */
  pointCount: number;
}

export interface CustomMetricPayload {
  metric: string;
  value: number;
  unit?: string;
  tags?: Record<string, string | number>;
}

/* -------------------------------------------------------------------------- */
/*                              错误溯源类载荷                                 */
/* -------------------------------------------------------------------------- */

/** 解析后的堆栈帧 */
export interface StackFrame {
  filename?: string;
  lineno?: number;
  colno?: number;
  function?: string;
  /** 原始（压缩后）行 */
  raw?: string;
  /** 是否已被 SourceMap 还原 */
  resolved?: boolean;
  /** 还原后的源码行内容 */
  sourceLine?: string;
  /** 还原后的源码上下文（前后各 5 行） */
  context?: string[];
}

/** 行为轨迹条目 */
export interface Breadcrumb {
  id: string;
  type: BreadcrumbType | string;
  message: string;
  level: 'info' | 'warning' | 'error';
  timestamp: number;
  data?: Record<string, any>;
}

/** 最近一次请求摘要 */
export interface RequestBrief {
  method: string;
  url: string;
  status: number;
  duration: number;
  ok: boolean;
  timestamp: number;
}

/** 错误现场快照 */
export interface ErrorSnapshot {
  memory?: MemoryPayload;
  network?: NetworkInfo;
  visibility: VisibilityState | string;
  route: string;
  title: string;
  viewport: string;
  userAgent: string;
  /** 最近一次请求（含失败） */
  lastRequest?: RequestBrief;
  /** 最近一次成功请求 */
  lastSuccessRequest?: RequestBrief;
  /** 失败请求计数（当前会话） */
  failedRequestCount?: number;
}

export interface BaseErrorPayload {
  /** 错误指纹，同名同消息同堆栈特征归为一组 */
  fingerprint: string;
  level: ErrorLevel | string;
  breadcrumbs: Breadcrumb[];
  snapshot: ErrorSnapshot;
}

export interface JsErrorPayload extends BaseErrorPayload {
  message: string;
  name: string;
  /** error / unhandledrejection */
  type: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  frames: StackFrame[];
  /** 产生该错误的机制，如 window.onerror / react-error-boundary */
  mechanism?: string;
  componentStack?: string;
}

export interface ResourceErrorPayload extends BaseErrorPayload {
  tagName: string;
  url: string;
  selector?: string;
  errorType: ResourceErrorType | string;
}

export interface RequestErrorPayload extends BaseErrorPayload {
  method: string;
  url: string;
  rawUrl?: string;
  status: number;
  statusText?: string;
  errorType: RequestErrorType | string;
  responseBody?: string;
  duration?: number;
  traceId?: string;
}

export interface ConsoleErrorPayload extends BaseErrorPayload {
  level: 'error' | 'warn';
  args: string[];
}

export interface CustomErrorPayload extends BaseErrorPayload {
  message: string;
  name?: string;
  stack?: string;
  extra?: Record<string, any>;
}

/* -------------------------------------------------------------------------- */
/*                              行为类载荷                                     */
/* -------------------------------------------------------------------------- */

export interface PvPayload {
  path: string;
  title: string;
  referrer?: string;
  /** 来源页面路径（站内） */
  fromPath?: string;
  /** 上一个页面停留时长 */
  duration: number;
  /** 当前会话累计时长 */
  sessionDuration: number;
  /** 是否为会话入口页 */
  isEntry: boolean;
  /** 外链来源渠道（utm / 自定义参数） */
  channel?: string;
}

export interface BehaviorRoutePayload {
  from: string;
  to: string;
  type: RouteChangeType | string;
  duration: number;
}

export interface ClickPayload {
  /** CSS 选择器路径 */
  selector: string;
  /** XPath */
  xpath: string;
  /** 元素文本（截断且脱敏） */
  text: string;
  tagName: string;
  /** data-* 与配置的白名单属性 */
  attributes: Record<string, string>;
  x: number;
  y: number;
  pageX: number;
  pageY: number;
}

export interface ExposurePayload {
  selector: string;
  text: string;
  /** 曝光比例 0-1 */
  ratio: number;
  enterTime: number;
  leaveTime: number;
  duration: number;
}

export interface ScrollPayload {
  /** 当前深度百分比 0-100 */
  depth: number;
  maxDepth: number;
  scrollTop: number;
  documentHeight: number;
  viewportHeight: number;
}

export interface FormPayload {
  selector: string;
  action: 'focus' | 'blur' | 'change' | 'submit' | 'submit-fail';
  field?: string;
  /** 输入值（默认脱敏为 ***） */
  value?: string;
  duration?: number;
  errorMessage?: string;
}

export interface ConsolePayload {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  args: string[];
}

export interface VisibilityPayload {
  state: VisibilityState | string;
  /** 上一次状态持续的时长（ms） */
  duration?: number;
}

export interface StayPayload {
  path: string;
  /** 页面总时长（含后台） */
  duration: number;
  /** 前台可见时长 */
  visibleDuration: number;
  maxScrollDepth: number;
}

export interface CustomEventPayload {
  eventName: string;
  properties: Record<string, any>;
  /** 业务自定义分组 */
  category?: string;
}

/* -------------------------------------------------------------------------- */
/*                              回放类载荷                                     */
/* -------------------------------------------------------------------------- */

export interface ReplayRecord {
  type: number;
  timestamp: number;
  delay?: number;
  data: any;
}

export interface ReplayMetaPayload {
  startTime: number;
  endTime: number;
  duration: number;
  width: number;
  height: number;
  totalChunks: number;
  reason: ReplayFlushReason | string;
}

export interface ReplayChunkPayload {
  index: number;
  startTime: number;
  endTime: number;
  events: ReplayRecord[];
  reasons: string[];
}

/** 序列化 DOM 节点 */
export interface SerializedNode {
  type: ReplayNodeType;
  id?: number;
  tagName?: string;
  attributes?: Record<string, string | boolean | number>;
  childNodes?: SerializedNode[];
  textContent?: string;
  isSVG?: boolean;
  needBlock?: boolean;
}

export interface MutationAdds {
  parentId: number;
  nextId?: number | null;
  node: SerializedNode;
}

export interface MutationRemoves {
  parentId: number;
  id: number;
  isAnimated?: boolean;
}

export interface MutationTexts {
  id: number;
  value: string;
}

export interface MutationAttributes {
  id: number;
  attributes: Record<string, string | null>;
}

export interface MutationData {
  source: ReplayIncrementalSource.Mutation;
  adds: MutationAdds[];
  removes: MutationRemoves[];
  texts: MutationTexts[];
  attributes: MutationAttributes[];
  isAttachIframe?: boolean;
}

export interface MouseMoveData {
  source: ReplayIncrementalSource.MouseMove;
  positions: Array<{ x: number; y: number; id: number; timeOffset: number }>;
}

export interface MouseInteractionData {
  source: ReplayIncrementalSource.MouseInteraction;
  type: ReplayMouseInteraction;
  id: number;
  x: number;
  y: number;
}

export interface ScrollData {
  source: ReplayIncrementalSource.Scroll;
  id: number;
  x: number;
  y: number;
}

export interface ViewportResizeData {
  source: ReplayIncrementalSource.ViewportResize;
  width: number;
  height: number;
}

export interface InputData {
  source: ReplayIncrementalSource.Input;
  id: number;
  text?: string;
  isChecked?: boolean;
}

export type ReplayIncrementalData =
  | MutationData
  | MouseMoveData
  | MouseInteractionData
  | ScrollData
  | ViewportResizeData
  | InputData;

/* -------------------------------------------------------------------------- */
/*                            事件联合类型                                     */
/* -------------------------------------------------------------------------- */

export type PerformanceEventPayload =
  | WebVitalPayload
  | NavigationPayload
  | ResourcePayload
  | LongTaskPayload
  | FpsPayload
  | MemoryPayload
  | ApiPayload
  | RoutePerformancePayload
  | NetworkQualityPayload
  | WhiteScreenPayload
  | CustomMetricPayload;

export type ErrorEventPayload =
  | JsErrorPayload
  | ResourceErrorPayload
  | RequestErrorPayload
  | ConsoleErrorPayload
  | CustomErrorPayload;

export type BehaviorEventPayload =
  | PvPayload
  | BehaviorRoutePayload
  | ClickPayload
  | ExposurePayload
  | ScrollPayload
  | FormPayload
  | ConsolePayload
  | VisibilityPayload
  | StayPayload
  | CustomEventPayload;

export type ReplayEventPayload = ReplayMetaPayload | ReplayChunkPayload;

/** category -> payload 的映射，供服务端与看板做类型收窄 */
export interface CategoryPayloadMap {
  [PerformanceCategory.WebVital]: WebVitalPayload;
  [PerformanceCategory.Navigation]: NavigationPayload;
  [PerformanceCategory.Resource]: ResourcePayload;
  [PerformanceCategory.LongTask]: LongTaskPayload;
  [PerformanceCategory.Fps]: FpsPayload;
  [PerformanceCategory.Memory]: MemoryPayload;
  [PerformanceCategory.Api]: ApiPayload;
  [PerformanceCategory.RouteChange]: RoutePerformancePayload;
  [PerformanceCategory.Network]: NetworkQualityPayload;
  [PerformanceCategory.WhiteScreen]: WhiteScreenPayload;
  [PerformanceCategory.CustomMetric]: CustomMetricPayload;
  [ErrorCategory.JsError]: JsErrorPayload;
  [ErrorCategory.ResourceError]: ResourceErrorPayload;
  [ErrorCategory.RequestError]: RequestErrorPayload;
  [ErrorCategory.ConsoleError]: ConsoleErrorPayload;
  [ErrorCategory.CustomError]: CustomErrorPayload;
}
