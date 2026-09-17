/** 查询公共参数解析与 SQL 片段工具 */

export interface RawQuery {
  appKey?: string;
  start?: string;
  end?: string;
  env?: string;
  appVersion?: string;
  page?: string;
  pageSize?: string;
  keyword?: string;
  status?: string;
  category?: string;
  level?: string;
  limit?: string;
  [key: string]: string | undefined;
}

export interface TimeRange {
  start: Date;
  end: Date;
  /** 建议的时间分桶粒度（SQL 片段） */
  interval: string;
  /** 分桶毫秒数，用于生成完整时间轴 */
  bucketMs: number;
}

const DEFAULT_RANGE_MS = 24 * 60 * 60 * 1000;

function parseTime(value: string | undefined, fallback: Date): Date {
  if (!value) return fallback;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && String(numeric).length >= 10) {
    return new Date(numeric < 1e12 ? numeric * 1000 : numeric);
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? fallback : date;
}

/** 解析时间范围并自动选择分桶粒度：跨度越大桶越粗 */
export function parseTimeRange(query: RawQuery): TimeRange {
  const end = parseTime(query.end, new Date());
  const start = parseTime(query.start, new Date(end.getTime() - DEFAULT_RANGE_MS));
  const span = Math.max(end.getTime() - start.getTime(), 60_000);

  let bucketMs: number;
  if (span <= 2 * 60 * 60 * 1000) bucketMs = 60 * 1000;
  else if (span <= 24 * 60 * 60 * 1000) bucketMs = 15 * 60 * 1000;
  else if (span <= 7 * 24 * 60 * 60 * 1000) bucketMs = 60 * 60 * 1000;
  else if (span <= 31 * 24 * 60 * 60 * 1000) bucketMs = 6 * 60 * 60 * 1000;
  else bucketMs = 24 * 60 * 60 * 1000;

  const seconds = Math.round(bucketMs / 1000);
  const interval = seconds <= 60 ? 'INTERVAL 1 MINUTE' : `INTERVAL ${Math.round(seconds / 60)} MINUTE`;

  return { start, end, interval, bucketMs };
}

export function parsePaging(query: RawQuery, defaultSize = 20, maxSize = 200) {
  const page = Math.max(Number(query.page || 1) || 1, 1);
  const pageSize = Math.min(Math.max(Number(query.pageSize || defaultSize) || defaultSize, 1), maxSize);
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export interface SqlFilter {
  clause: string;
  params: Record<string, unknown>;
}

/** 构造 ClickHouse WHERE 片段（时间 + 应用 + 环境 + 版本） */
export function buildBaseFilter(
  query: RawQuery,
  range: TimeRange,
  extra: Record<string, unknown> = {},
): SqlFilter {
  const params: Record<string, unknown> = {
    appKey: query.appKey || '',
    start: formatDateTime(range.start),
    end: formatDateTime(range.end),
    ...extra,
  };
  const conditions = [
    'app_key = {appKey:String}',
    'timestamp >= {start:DateTime64(3)}',
    'timestamp <= {end:DateTime64(3)}',
  ];
  if (query.env) {
    conditions.push('env = {env:String}');
    params.env = query.env;
  }
  if (query.appVersion) {
    conditions.push('app_version = {appVersion:String}');
    params.appVersion = query.appVersion;
  }
  return { clause: conditions.join(' AND '), params };
}

/** ClickHouse 需要 'YYYY-MM-DD HH:mm:ss.SSS' 格式 */
export function formatDateTime(date: Date): string {
  return date.toISOString().replace('T', ' ').replace('Z', '');
}

/** 安全解析 JSON 字符串（CH 里存的是 String） */
export function safeParse<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'object') return value as T;
  try {
    return JSON.parse(String(value)) as T;
  } catch {
    return fallback;
  }
}

/** 生成完整时间轴（补齐没有数据的桶，避免折线图断裂） */
export function fillTimeline(
  points: Array<Record<string, any>>,
  range: TimeRange,
): Array<Record<string, any>> {
  const map = new Map<string, Record<string, any>>();
  points.forEach((point) => map.set(String(point.time), point));
  const result: Array<Record<string, any>> = [];
  const startMs = Math.floor(range.start.getTime() / range.bucketMs) * range.bucketMs;
  for (let time = startMs; time <= range.end.getTime(); time += range.bucketMs) {
    const key = formatDateTime(new Date(time)).slice(0, 19);
    const found = map.get(key);
    result.push(found || { time: key });
  }
  return result;
}
