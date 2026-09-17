import type {
  AlertRecord,
  AlertRule,
  AlertRuleDto,
  ApiStatItem,
  BehaviorEventItem,
  BehaviorPathNode,
  DimensionStatItem,
  ErrorDetailResult,
  ErrorGroupItem,
  FunnelResult,
  FunnelStep,
  HeatmapPoint,
  OverviewResult,
  PageBehaviorStatItem,
  PagedResult,
  PerformanceSummaryResult,
  Project,
  ProjectCreateDto,
  ReplayDataResult,
  ResourceStatItem,
  SessionDetailResult,
  SessionItem,
  SourceMapItem,
  TrendPoint,
  UserProfileItem,
} from '@web-monitor/types';
import { del, get, patch, post, put } from './client';

export interface RangeParams {
  appKey: string;
  start: number;
  end: number;
  env?: string;
  appVersion?: string;
}

/* --------------------------------- 应用管理 -------------------------------- */

export const fetchProjects = () => get<Project[]>('/projects');
export const createProject = (data: ProjectCreateDto) => post<Project>('/projects', data);
export const updateProject = (appKey: string, data: Partial<ProjectCreateDto>) =>
  put<Project>(`/projects/${appKey}`, data);
export const deleteProject = (appKey: string) => del<{ appKey: string }>(`/projects/${appKey}`);
export const rotateAppKey = (appKey: string) => post<Project>(`/projects/${appKey}/rotate-key`);

/* ---------------------------------- 总览 ---------------------------------- */

export const fetchOverview = (params: RangeParams) => get<OverviewResult>('/overview', params);

/* ---------------------------------- 性能 ---------------------------------- */

export const fetchPerformanceSummary = (params: RangeParams) =>
  get<PerformanceSummaryResult>('/performance/summary', params);

export const fetchPerformanceTrend = (params: RangeParams & { category?: string }) =>
  get<{ list: TrendPoint[]; metrics: string[] }>('/performance/trend', params);

export const fetchResources = (params: RangeParams & { limit?: number }) =>
  get<ResourceStatItem[]>('/performance/resources', params);

export const fetchApis = (params: RangeParams & { limit?: number }) =>
  get<ApiStatItem[]>('/performance/apis', params);

export const fetchRoutes = (params: RangeParams & { limit?: number }) =>
  get<Array<{ path: string; count: number; avgDuration: number; p95: number }>>(
    '/performance/routes',
    params,
  );

export const fetchDimensions = (
  params: RangeParams & { dimension: string; metric?: string },
) => get<Array<DimensionStatItem & { p95?: number }>>('/performance/dimensions', params);

/* ---------------------------------- 错误 ---------------------------------- */

export const fetchErrors = (params: RangeParams & {
  page?: number;
  pageSize?: number;
  keyword?: string;
  status?: string;
  category?: string;
  level?: string;
}) => get<PagedResult<ErrorGroupItem>>('/errors', params);

export const fetchErrorTrend = (params: RangeParams) => get<TrendPoint[]>('/errors/trend', params);

export const fetchErrorDetail = (id: string, params: RangeParams & { page?: number; pageSize?: number }) =>
  get<ErrorDetailResult>(`/errors/${id}`, params);

export const updateErrorStatus = (id: string, data: { status: string; assignee?: string; note?: string }) =>
  patch<ErrorGroupItem>(`/errors/${id}/status`, data);

/* ---------------------------------- 行为 ---------------------------------- */

export const fetchBehaviorPages = (params: RangeParams & { limit?: number }) =>
  get<PageBehaviorStatItem[]>('/behavior/pages', params);

export const fetchBehaviorTrend = (params: RangeParams) => get<TrendPoint[]>('/behavior/trend', params);

export const fetchBehaviorEvents = (params: RangeParams & {
  page?: number;
  pageSize?: number;
  category?: string;
  keyword?: string;
  sessionId?: string;
  userId?: string;
}) => get<PagedResult<BehaviorEventItem>>('/behavior/events', params);

export const fetchBehaviorPaths = (params: RangeParams & { limit?: number }) =>
  get<BehaviorPathNode[]>('/behavior/paths', params);

export const fetchFunnel = (params: RangeParams, steps: FunnelStep[]) =>
  post<FunnelResult>('/behavior/funnel', { steps }, params);

export const fetchHeatmap = (params: RangeParams & { pageId: string }) =>
  get<HeatmapPoint[]>('/behavior/heatmap', params);

/* ------------------------------- 会话与用户 ------------------------------- */

export const fetchSessions = (params: RangeParams & {
  page?: number;
  pageSize?: number;
  userId?: string;
  sessionId?: string;
}) => get<PagedResult<SessionItem>>('/sessions', params);

export const fetchSessionDetail = (sessionId: string, params: RangeParams) =>
  get<SessionDetailResult>(`/sessions/${sessionId}`, params);

export const fetchReplay = (sessionId: string, params: RangeParams) =>
  get<ReplayDataResult>(`/sessions/${sessionId}/replay`, params);

export const fetchUsers = (params: RangeParams & {
  page?: number;
  pageSize?: number;
  keyword?: string;
}) => get<PagedResult<UserProfileItem>>('/users', params);

/* --------------------------------- 告警 ---------------------------------- */

export const fetchAlertRules = (appKey: string) => get<AlertRule[]>('/alerts/rules', { appKey });
export const createAlertRule = (appKey: string, data: AlertRuleDto) =>
  post<AlertRule>(`/alerts/rules/${appKey}`, data);
export const updateAlertRule = (id: string, data: Partial<AlertRuleDto>) =>
  put<AlertRule>(`/alerts/rules/${id}`, data);
export const deleteAlertRule = (id: string) => del<{ id: string }>(`/alerts/rules/${id}`);
export const fetchAlertRecords = (params: { appKey?: string; page?: number; pageSize?: number }) =>
  get<PagedResult<AlertRecord>>('/alerts/records', params);

/* ------------------------------- SourceMap ------------------------------- */

export const fetchSourceMaps = (appKey: string, appVersion?: string) =>
  get<SourceMapItem[]>(`/projects/${appKey}/sourcemaps`, { appVersion });
export const uploadSourceMap = (
  appKey: string,
  data: { appVersion: string; fileName: string; content: string },
) => post<SourceMapItem>(`/projects/${appKey}/sourcemaps`, data);
export const deleteSourceMap = (id: string) => del<{ id: string }>(`/sourcemaps/${id}`);
