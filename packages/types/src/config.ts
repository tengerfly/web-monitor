import type { ErrorLevel } from './enums';

/** 脱敏规则 */
export interface MaskRules {
  /** 需要遮罩文本的选择器 */
  selectors?: string[];
  /** 需要忽略采集的选择器 */
  ignoreSelectors?: string[];
  /** 需要遮罩的属性名 */
  attributes?: string[];
  /** 需要遮罩的字段名（含响应体、URL query、埋点属性） */
  fields?: string[];
}

/** 性能监控配置 */
export interface PerformanceOptions {
  enabled?: boolean;
  sampleRate?: number;
  /** 是否采集静态资源耗时 */
  resource?: boolean;
  /** 慢资源阈值（ms），超过才上报 */
  slowResourceThreshold?: number;
  /** 是否采集长任务 */
  longTask?: boolean;
  /** 是否采集 FPS */
  fps?: boolean;
  /** 是否采集内存 */
  memory?: boolean;
  /** 是否采集接口耗时 */
  api?: boolean;
  /** 慢接口阈值（ms），超过必上报 */
  slowApiThreshold?: number;
  /** 是否采集白屏 */
  whiteScreen?: boolean;
  /** 内存采集间隔（ms） */
  memoryInterval?: number;
  thresholds?: Partial<Record<'LCP' | 'INP' | 'CLS' | 'FCP' | 'TTFB' | 'FID', number>>;
}

/** 用户行为追踪配置 */
export interface BehaviorOptions {
  enabled?: boolean;
  sampleRate?: number;
  /** 采集 PV */
  pv?: boolean;
  /** 采集路由跳转 */
  route?: boolean;
  /** 采集点击 */
  click?: boolean;
  /** 点击采集范围（CSS 选择器），默认全量 */
  clickRoot?: string;
  /** 需要上报的点击元素选择器（命中才上报），为空则全量上报 */
  clickTargets?: string[];
  /** 采集曝光 */
  exposure?: boolean;
  /** 曝光采集目标选择器 */
  exposureTargets?: string[];
  /** 曝光比例阈值 */
  exposureRatio?: number;
  /** 采集滚动 */
  scroll?: boolean;
  /** 滚动上报节流（ms） */
  scrollThrottle?: number;
  /** 采集表单交互 */
  form?: boolean;
  /** 是否采集输入值（默认 false，仅上报字段名） */
  formValue?: boolean;
  /** 采集 console */
  console?: boolean;
  /** console 级别 */
  consoleLevels?: Array<'log' | 'info' | 'warn' | 'error'>;
  /** 是否上报页面停留（离开时） */
  stay?: boolean;
}

/** 错误与溯源配置 */
export interface ErrorOptions {
  enabled?: boolean;
  sampleRate?: number;
  /** 最低上报级别 */
  minLevel?: ErrorLevel;
  /** 行为轨迹条数 */
  maxBreadcrumbs?: number;
  /** 是否携带错误现场快照 */
  snapshot?: boolean;
  /** 是否采集资源加载错误 */
  resourceError?: boolean;
  /** 是否采集接口错误 */
  requestError?: boolean;
  /** 是否采集 console.error */
  consoleError?: boolean;
  /** 接口业务错误码提取函数（返回非 0/非空即视为业务失败） */
  businessCodeExtractor?: (data: any) => string | number | undefined | void;
  /** 忽略的错误（按 message 匹配） */
  ignoreErrors?: Array<string | RegExp>;
  /** 上报前拦截（返回 null 丢弃） */
  beforeSend?: (payload: any) => any | null;
}

/** 会话回放配置 */
export interface ReplayOptions {
  enabled?: boolean;
  /** 录制采样率（成本控制） */
  sampleRate?: number;
  /** 单分片最大时长（ms） */
  flushInterval?: number;
  /** 单分片最大事件数 */
  maxEventsPerChunk?: number;
  /** 全量遮罩输入框 */
  maskAllInputs?: boolean;
  /** 遮罩文本（默认 false） */
  maskAllText?: boolean;
  /** 需要遮罩的选择器 */
  maskSelectors?: string[];
  /** 需要忽略的元素（不录制内容） */
  blockSelectors?: string[];
  /** 录制鼠标移动（关闭可显著降低体积） */
  recordMouseMove?: boolean;
  /** 录制 canvas */
  recordCanvas?: boolean;
  /** 是否只在检出错误后保留（节省存储） */
  onlyOnError?: boolean;
}

/** 远程配置下发结构（服务端 -> SDK） */
export interface RemoteConfig {
  sampleRate: number;
  plugins: {
    performance?: boolean;
    behavior?: boolean;
    error?: boolean;
    replay?: boolean;
  };
  performance?: PerformanceOptions;
  behavior?: BehaviorOptions;
  error?: Omit<ErrorOptions, 'businessCodeExtractor' | 'beforeSend'>;
  replay?: ReplayOptions;
  maskRules?: MaskRules;
  /** 上报地址（允许服务端下发切换） */
  host?: string;
  updatedAt?: string;
}
