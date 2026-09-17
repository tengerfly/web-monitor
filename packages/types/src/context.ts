/** 环境上下文（设备 / 系统 / 浏览器 / 网络 / 地理位置） */

export type DeviceType = 'mobile' | 'tablet' | 'desktop' | 'unknown';

export interface DeviceInfo {
  type: DeviceType;
  brand?: string;
  model?: string;
  /** 屏幕分辨率，如 2560x1440 */
  screen?: string;
  /** 视口尺寸，如 1440x820 */
  viewport?: string;
  /** 设备像素比 */
  dpr?: number;
  orientation?: 'portrait' | 'landscape';
}

export interface OsInfo {
  name: string;
  version: string;
}

export interface BrowserInfo {
  name: string;
  version: string;
  engine?: string;
}

export interface NetworkInfo {
  /** 连接类型（4g / wifi / ethernet / unknown） */
  type?: string;
  /** 有效连接类型（Network Information API） */
  effectiveType?: string;
  /** 往返时延（ms） */
  rtt?: number;
  /** 下行带宽（Mbps） */
  downlink?: number;
  saveData?: boolean;
  online?: boolean;
}

export interface GeoInfo {
  ip?: string;
  country?: string;
  region?: string;
  city?: string;
  isp?: string;
}

export interface AppInfo {
  name?: string;
  version?: string;
  env?: string;
}

export interface SdkInfo {
  name: string;
  version: string;
}

/** 事件公共上下文 */
export interface EventContext {
  device: DeviceInfo;
  os: OsInfo;
  browser: BrowserInfo;
  network: NetworkInfo;
  app: AppInfo;
  sdk: SdkInfo;
  geo?: GeoInfo;
  /** 业务自定义上下文（setContext 注入） */
  custom?: Record<string, unknown>;
}

/** 同批次共享字段（会话 / 用户 / 页面 / 上下文） */
export interface CommonContext {
  appVersion?: string;
  env: string;
  sessionId: string;
  userId?: string;
  anonymousId: string;
  pageId: string;
  url: string;
  referrer?: string;
  context: EventContext;
  custom?: Record<string, unknown>;
}
