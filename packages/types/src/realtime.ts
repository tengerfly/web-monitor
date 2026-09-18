/**
 * 实时大屏契约（TDD V1 · RealtimeModule）
 * 服务端 RealtimeScreenSnapshot 的唯一定义源；看板与 SDK 均从此处消费，禁止各端自定义。
 */

/** 六类大屏核心指标（统计范围：当日 00:00 服务端时区 → 统计时点） */
export interface ScreenMetrics {
  pv: number;
  uv: number;
  errorCount: number;
  /** 0~1 小数（沿用存量总览口径），无样本为 0 */
  errorRate: number;
  /** 性能评分 0~100（沿用存量总览口径） */
  score: number;
  /** 活跃会话：统计时点前 5 分钟内有过上报的会话数 */
  activeSessions: number;
  /** 0~1 小数 */
  apiSuccessRate: number;
}

/** 趋势单点：固定 60 点、以统计时点所在分钟为终点；无数据分钟补 null */
export interface ScreenTrendPoint {
  minuteEpochMs: number;
  pv: number | null;
  errors: number | null;
}

/** 错误滚动流条目（≤50，倒序）；fingerprint 为错误定位标识（沿用存量错误详情定位方式） */
export interface ScreenErrorItem {
  fingerprint: string;
  type: string;
  message: string;
  /** 所属页面（wm_errors.url） */
  page: string;
  occurredAt: string;
}

export type ScreenTopItemUnit = 'ms' | 'count';

/** Top 榜条目（各榜单 ≤5；不足按实际条数） */
export interface ScreenTopItem {
  name: string;
  value: number;
  unit: ScreenTopItemUnit;
}

/** 告警条目（横幅仅消费 unresolved；recent24h 含 resolved 供数据预留） */
export interface ScreenAlertItem {
  id: string;
  ruleName: string;
  metric: string;
  /** 触发时值 */
  value: number;
  threshold: number;
  triggeredAt: string;
  status: 'firing' | 'resolved';
  message?: string;
}

/** Core Vitals 达标率（0~1 小数；无样本为 null，与「零值」严格区分） */
export interface ScreenVitals {
  lcp: number | null;
  inp: number | null;
  cls: number | null;
  overall: number | null;
}

/** 本轮供数失败标记（仅覆盖「服务可达但供数失败」；连接中断由客户端超时判定） */
export interface RealtimeFailure {
  status: 'ok' | 'partial' | 'failed';
  /** 置空的类目名（metrics/trend/errors/topLists/alerts/vitals） */
  categories: string[];
  /** 最后一次成功聚合的 ISO 时刻（failed 时必有） */
  lastSuccessAt?: string;
}

/** 大屏快照（SSE snapshot 帧 data 与 REST 快照 data 同构） */
export interface RealtimeScreenSnapshot {
  appKey: string;
  /** 本轮统计截止时刻（ISO，服务端时区） */
  generatedAt: string;
  generatedAtEpochMs: number;
  statsWindow: {
    /** 当日 00:00（服务端时区） */
    dayStartAt: string;
    /** 趋势窗口分钟数（固定 60） */
    windowMinutes: number;
  };
  metrics: ScreenMetrics;
  trend: ScreenTrendPoint[];
  errors: ScreenErrorItem[];
  topLists: {
    slowApis: ScreenTopItem[];
    jsErrors: ScreenTopItem[];
    worstPages: ScreenTopItem[];
  };
  alerts: {
    unresolved: ScreenAlertItem[];
    recent24h: ScreenAlertItem[];
  };
  vitals: ScreenVitals;
  failure: RealtimeFailure;
}
