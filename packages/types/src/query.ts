/**
 * 查询契约：服务端 Query API 的出入参与返回结构。
 * 看板通过 `@web-monitor/types` 引用，保证前后端字段一致。
 */

import type { Breadcrumb, ErrorSnapshot, ReplayRecord, StackFrame } from './events';

/** 通用时间范围与分页查询参数 */
export interface QueryBase {
  appKey: string;
  /** ISO 时间或毫秒时间戳 */
  start?: string | number;
  end?: string | number;
  env?: string;
  appVersion?: string;
}

export interface PageQuery extends QueryBase {
  page?: number;
  pageSize?: number;
  orderBy?: string;
  order?: 'asc' | 'desc';
}

export interface PagedResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

/** 时间序列点 */
export interface TrendPoint {
  time: string;
  [metric: string]: number | string;
}

/* ------------------------------- 应用管理 -------------------------------- */

export interface Project {
  id: string;
  appKey: string;
  name: string;
  description?: string;
  envs: string[];
  sampleRate: number;
  plugins: Record<string, boolean>;
  maskRules?: Record<string, string[]>;
  retentionDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectCreateDto {
  name: string;
  description?: string;
  envs?: string[];
  sampleRate?: number;
  plugins?: Record<string, boolean>;
  retentionDays?: number;
}

export type ProjectUpdateDto = Partial<ProjectCreateDto>;

/* --------------------------------- 总览 --------------------------------- */

export interface OverviewMetrics {
  pv: number;
  uv: number;
  sessions: number;
  newUsers: number;
  bounceRate: number;
  avgSessionDuration: number;
  errorCount: number;
  errorRate: number;
  affectedUsers: number;
  avgPageLoad: number;
  avgLcp: number;
  avgInp: number;
  avgCls: number;
  vitalsPassRate: number;
  score: number;
  apiSuccessRate: number;
  avgApiDuration: number;
}

export interface OverviewResult {
  metrics: OverviewMetrics;
  /** 与上一个同长度周期对比的变化率 */
  compare?: Partial<Record<keyof OverviewMetrics, number>>;
  trend: TrendPoint[];
}

/* -------------------------------- 性能 ---------------------------------- */

export interface VitalSummaryItem {
  metric: string;
  p50: number;
  p75: number;
  p95: number;
  avg: number;
  samples: number;
  passRate: number;
}

export interface PerformanceSummaryResult {
  vitals: VitalSummaryItem[];
  navigation: {
    avgDns: number;
    avgTcp: number;
    avgTls: number;
    avgRequest: number;
    avgResponse: number;
    avgDomParse: number;
    avgLoad: number;
    avgFp: number;
    avgFmp: number;
    avgTti: number;
    samples: number;
  };
  longTask: { avgCount: number; avgTbt: number; avgFps: number };
  memory: { avgUsage: number; maxUsage: number };
}

export interface ResourceStatItem {
  name: string;
  initiatorType: string;
  count: number;
  avgDuration: number;
  p95: number;
  avgSize: number;
  failCount: number;
}

export interface ApiStatItem {
  url: string;
  method: string;
  count: number;
  avgDuration: number;
  p95: number;
  p99: number;
  successRate: number;
  statusCodes: Record<string, number>;
}

export interface DimensionStatItem {
  label: string;
  count: number;
  avgValue: number;
}

/* -------------------------------- 错误 ---------------------------------- */

export interface ErrorGroupItem {
  id: string;
  fingerprint: string;
  appKey: string;
  name: string;
  message: string;
  category: string;
  level: string;
  status: string;
  count: number;
  affectedUsers: number;
  affectedSessions: number;
  firstSeen: string;
  lastSeen: string;
  appVersions: string[];
  pages: string[];
  assignee?: string;
  note?: string;
  /** 最近趋势，用于列表内迷你图 */
  spark?: number[];
}

export interface ErrorDetailEvent {
  id: string;
  timestamp: string;
  sessionId: string;
  userId?: string;
  anonymousId: string;
  pageId: string;
  url: string;
  appVersion?: string;
  env: string;
  devices: string;
  browsers: string;
  os: string;
  breadcrumbs: Breadcrumb[];
  snapshot?: ErrorSnapshot;
  raw?: Record<string, any>;
}

export interface ErrorDetailResult {
  group: ErrorGroupItem;
  /** SourceMap 还原后的堆栈帧 */
  frames: StackFrame[];
  rawStack?: string;
  /** 分布统计 */
  distribution: {
    byPage: DimensionStatItem[];
    byBrowser: DimensionStatItem[];
    byOs: DimensionStatItem[];
    byDevice: DimensionStatItem[];
    byVersion: DimensionStatItem[];
  };
  events: PagedResult<ErrorDetailEvent>;
  trend: TrendPoint[];
}

export interface ErrorListQuery extends PageQuery {
  keyword?: string;
  status?: string;
  category?: string;
  level?: string;
}

export interface ErrorStatusUpdateDto {
  status: string;
  assignee?: string;
  note?: string;
}

/* -------------------------------- 行为 ---------------------------------- */

export interface PageBehaviorStatItem {
  path: string;
  title?: string;
  pv: number;
  uv: number;
  avgDuration: number;
  avgScrollDepth: number;
  bounceRate: number;
  exitRate: number;
}

export interface BehaviorPathNode {
  path: string;
  count: number;
  children?: BehaviorPathNode[];
}

export interface FunnelStep {
  name: string;
  /** 事件名或页面路径 */
  match: { type: 'page' | 'event'; value: string };
  count: number;
  rate: number;
}

export interface FunnelResult {
  steps: FunnelStep[];
  total: number;
}

export interface HeatmapPoint {
  x: number;
  y: number;
  count: number;
}

export interface BehaviorEventItem {
  id: string;
  timestamp: string;
  sessionId: string;
  userId?: string;
  anonymousId: string;
  pageId: string;
  category: string;
  type: string;
  summary: string;
  payload: Record<string, any>;
}

export interface BehaviorEventQuery extends PageQuery {
  keyword?: string;
  category?: string;
  sessionId?: string;
  userId?: string;
  eventName?: string;
}

export interface BehaviorPathQuery extends QueryBase {
  limit?: number;
  /** 起始页过滤 */
  entryPath?: string;
}

/* ------------------------------ 用户与会话 ------------------------------- */

export interface SessionItem {
  sessionId: string;
  userId?: string;
  anonymousId: string;
  startTime: string;
  endTime: string;
  duration: number;
  pageViews: number;
  entryUrl: string;
  exitUrl: string;
  device: string;
  browser: string;
  os: string;
  geo?: string;
  errorCount: number;
  hasReplay: boolean;
}

export interface SessionTimelineItem {
  timestamp: string;
  kind: 'pv' | 'click' | 'route' | 'request' | 'error' | 'custom' | 'console' | 'form';
  title: string;
  detail?: string;
  level: 'info' | 'warning' | 'error';
  raw?: Record<string, any>;
}

export interface SessionDetailResult {
  session: SessionItem;
  timeline: SessionTimelineItem[];
  errors: ErrorGroupItem[];
  metrics: { pv: number; errorCount: number; avgApiDuration: number; maxLcp?: number };
}

export interface UserProfileItem {
  userId?: string;
  anonymousId: string;
  firstSeen: string;
  lastSeen: string;
  sessions: number;
  pv: number;
  errorCount: number;
  devices: string[];
  browsers: string[];
  geo?: string;
}

export interface ReplayDataResult {
  sessionId: string;
  pageId?: string;
  startTime: number;
  endTime: number;
  width: number;
  height: number;
  events: ReplayRecord[];
  /** 错误发生时刻，用于时间轴标记 */
  errorMarks: Array<{ timestamp: number; errorId: string; message: string }>;
}

/* -------------------------------- 告警 ---------------------------------- */

export interface AlertRule {
  id: string;
  appKey: string;
  name: string;
  enabled: boolean;
  /** 监控指标 */
  metric:
    | 'error_count'
    | 'error_rate'
    | 'affected_users'
    | 'new_error'
    | 'p95_latency'
    | 'api_error_rate'
    | 'lcp_p75'
    | 'white_screen'
    | 'slow_api_count';
  /** 比较方式 */
  operator: 'gt' | 'gte' | 'lt' | 'lte';
  threshold: number;
  /** 统计窗口（分钟） */
  window: number;
  /** 静默期（分钟），避免告警风暴 */
  silence: number;
  /** 最小触发次数 */
  minCount?: number;
  channels: AlertChannel[];
  filter?: { pages?: string[]; versions?: string[]; envs?: string[] };
  createdAt: string;
  updatedAt: string;
}

export interface AlertChannel {
  type: 'email' | 'webhook' | 'dingtalk' | 'wecom' | 'feishu';
  /** 邮箱列表 / Webhook 地址 */
  target: string;
  /** 钉钉/企微/飞书机器人密钥 */
  secret?: string;
}

export interface AlertRuleDto {
  name: string;
  enabled?: boolean;
  metric: AlertRule['metric'];
  operator: AlertRule['operator'];
  threshold: number;
  window: number;
  silence?: number;
  minCount?: number;
  channels: AlertChannel[];
  filter?: AlertRule['filter'];
}

export interface AlertRecord {
  id: string;
  ruleId: string;
  ruleName: string;
  appKey: string;
  metric: string;
  value: number;
  threshold: number;
  triggeredAt: string;
  status: 'firing' | 'resolved';
  notified: boolean;
  message: string;
}

/* ------------------------------ SourceMap ------------------------------- */

export interface SourceMapItem {
  id: string;
  appKey: string;
  appVersion: string;
  fileName: string;
  size: number;
  createdAt: string;
}
