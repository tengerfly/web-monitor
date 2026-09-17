import {
  BehaviorCategory,
  PerformanceCategory,
  ReplayCategory,
  type CommonContext,
  type GeoInfo,
  type MonitorEvent,
} from '@web-monitor/types';
import { formatDateTime, safeParse } from '../../common/query';

/** wm_events 宽表行 */
export interface EventRow {
  app_key: string;
  event_type: string;
  category: string;
  timestamp: string;
  session_id: string;
  user_id: string;
  anonymous_id: string;
  page_id: string;
  url: string;
  page_title: string;
  app_version: string;
  env: string;
  trace_id: string;
  name: string;
  value: number;
  status: number;
  success: number;
  extra: string;
  context: string;
  device_type: string;
  device_brand: string;
  browser: string;
  browser_ver: string;
  os: string;
  geo_country: string;
  geo_region: string;
  geo_city: string;
}

/** wm_errors 明细行 */
export interface ErrorRow {
  app_key: string;
  timestamp: string;
  fingerprint: string;
  category: string;
  level: string;
  message: string;
  name: string;
  type: string;
  stack: string;
  frames: string;
  filename: string;
  lineno: number;
  colno: number;
  session_id: string;
  user_id: string;
  anonymous_id: string;
  page_id: string;
  url: string;
  app_version: string;
  env: string;
  trace_id: string;
  breadcrumbs: string;
  snapshot: string;
  extra: string;
  device_type: string;
  browser: string;
  os: string;
  geo_country: string;
  geo_region: string;
  geo_city: string;
}

/** wm_replay 分片行 */
export interface ReplayRow {
  app_key: string;
  session_id: string;
  page_id: string;
  chunk_index: number;
  timestamp: string;
  start_time: string;
  end_time: string;
  width: number;
  height: number;
  events: string;
  reasons: string;
  app_version: string;
  env: string;
  device_type: string;
}

const num = (value: unknown, fallback = 0): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const str = (value: unknown, max = 2000): string => {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : String(value);
  return text.length > max ? `${text.slice(0, max)}...[truncated]` : text;
};

/** 提取公共列 */
function buildBase(
  event: MonitorEvent,
  common: CommonContext,
  geo: GeoInfo,
  appKey: string,
): Omit<EventRow, 'name' | 'value' | 'status' | 'success' | 'extra' | 'page_title'> & {
  page_title: string;
} {
  const context = common.context;
  return {
    app_key: appKey,
    event_type: event.type,
    category: event.category,
    timestamp: formatDateTime(new Date(event.timestamp)),
    session_id: common.sessionId,
    user_id: common.userId || '',
    anonymous_id: common.anonymousId,
    page_id: common.pageId,
    url: str(common.url, 1000),
    page_title: '',
    app_version: common.appVersion || '',
    env: common.env,
    trace_id: event.traceId || '',
    context: JSON.stringify({
      device: context?.device,
      os: context?.os,
      browser: context?.browser,
      network: context?.network,
      custom: common.custom,
    }),
    device_type: context?.device?.type || '',
    device_brand: context?.device?.brand || '',
    browser: context?.browser?.name || '',
    browser_ver: context?.browser?.version || '',
    os: context?.os?.name || '',
    geo_country: geo.country || '',
    geo_region: geo.region || '',
    geo_city: geo.city || '',
  };
}

/**
 * 把「上报事件」映射为宽表行。
 * 不同 category 只影响 name / value / status / success / extra 四列，
 * 公共维度统一成列，这让 PV、性能、慢接口、热力图都能用同一条查询范式。
 */
export function mapEventToRow(
  event: MonitorEvent,
  common: CommonContext,
  geo: GeoInfo,
  appKey: string,
): EventRow | null {
  const payload = (event.payload || {}) as Record<string, any>;
  const base = buildBase(event, common, geo, appKey);
  const row: EventRow = { ...base, name: '', value: 0, status: 0, success: 1, extra: '{}' };

  switch (event.category) {
    // ------------------------------ 性能 ------------------------------
    case PerformanceCategory.WebVital:
      row.name = str(payload.metric, 40);
      row.value = num(payload.value);
      row.extra = JSON.stringify({
        rating: payload.rating,
        entries: payload.entries,
        navigationType: payload.navigationType,
        approximate: payload.approximate,
      });
      break;

    case PerformanceCategory.Navigation:
      row.name = 'pageLoad';
      row.value = num(payload.pageLoad ?? payload.load);
      row.extra = JSON.stringify(payload);
      break;

    case PerformanceCategory.Resource:
      row.name = str(payload.name, 1000);
      row.value = num(payload.duration);
      row.extra = JSON.stringify({
        initiatorType: payload.initiatorType,
        transferSize: payload.transferSize,
        startTime: payload.startTime,
      });
      break;

    case PerformanceCategory.LongTask:
      row.name = 'longtask';
      row.value = num(payload.maxDuration);
      row.extra = JSON.stringify({
        count: payload.count,
        totalDuration: payload.totalDuration,
        tbt: payload.tbt,
        entries: payload.entries,
      });
      break;

    case PerformanceCategory.Fps:
      row.name = 'fps';
      row.value = num(payload.fps);
      row.extra = JSON.stringify({
        jankCount: payload.jankCount,
        maxFrameDuration: payload.maxFrameDuration,
        frames: payload.frames,
      });
      break;

    case PerformanceCategory.Memory:
      row.name = 'memory';
      row.value = num(payload.usage);
      row.extra = JSON.stringify({
        usedJSHeapSize: payload.usedJSHeapSize,
        totalJSHeapSize: payload.totalJSHeapSize,
      });
      break;

    case PerformanceCategory.Api:
      row.name = str(payload.url, 1000);
      row.value = num(payload.duration);
      row.status = num(payload.status);
      row.success = payload.ok ? 1 : 0;
      row.extra = JSON.stringify({
        method: payload.method,
        rawUrl: payload.rawUrl,
        requestSize: payload.requestSize,
        responseSize: payload.responseSize,
        errorType: payload.errorType,
        businessCode: payload.businessCode,
        slow: payload.slow,
      });
      break;

    case PerformanceCategory.RouteChange:
      row.name = str(payload.to, 500);
      row.value = num(payload.duration);
      row.extra = JSON.stringify({ from: payload.from, type: payload.type });
      break;

    case PerformanceCategory.Network:
      row.name = str(payload.effectiveType || payload.type || 'unknown', 40);
      row.value = num(payload.rtt);
      row.extra = JSON.stringify(payload);
      break;

    case PerformanceCategory.WhiteScreen:
      row.name = 'white-screen';
      row.value = num(payload.duration);
      row.extra = JSON.stringify({ url: payload.url, emptyRatio: payload.emptyRatio });
      break;

    case PerformanceCategory.CustomMetric:
      row.name = str(payload.metric, 200);
      row.value = num(payload.value);
      row.extra = JSON.stringify({ unit: payload.unit, tags: payload.tags });
      break;

    // ------------------------------ 行为 ------------------------------
    case BehaviorCategory.Pv:
      row.name = str(payload.path, 500);
      row.value = num(payload.duration);
      row.page_title = str(payload.title, 300);
      row.url = str(common.url, 1000);
      row.extra = JSON.stringify({
        isEntry: payload.isEntry,
        fromPath: payload.fromPath,
        sessionDuration: payload.sessionDuration,
        pageCount: payload.pageCount,
        channel: payload.channel,
        referrer: payload.referrer,
      });
      break;

    case BehaviorCategory.Stay:
      row.name = str(payload.path, 500);
      row.value = num(payload.duration);
      row.extra = JSON.stringify({
        visibleDuration: payload.visibleDuration,
        maxScrollDepth: payload.maxScrollDepth,
      });
      break;

    case BehaviorCategory.Click:
      row.name = str(payload.selector, 500);
      row.value = 0;
      row.extra = JSON.stringify({
        text: payload.text,
        tagName: payload.tagName,
        attributes: payload.attributes,
        x: payload.x,
        y: payload.y,
        pageX: payload.pageX,
        pageY: payload.pageY,
      });
      break;

    case BehaviorCategory.Exposure:
      row.name = str(payload.selector, 500);
      row.value = num(payload.duration);
      row.extra = JSON.stringify({ text: payload.text, ratio: payload.ratio });
      break;

    case BehaviorCategory.Scroll:
      row.name = common.pageId;
      row.value = num(payload.depth);
      row.extra = JSON.stringify({ maxDepth: payload.maxDepth, documentHeight: payload.documentHeight });
      break;

    case BehaviorCategory.Form:
      row.name = str(payload.field || payload.selector, 300);
      row.value = num(payload.duration);
      row.extra = JSON.stringify({
        action: payload.action,
        selector: payload.selector,
        value: payload.value,
        errorMessage: payload.errorMessage,
      });
      break;

    case BehaviorCategory.Console:
      row.name = str(payload.level, 20);
      row.extra = JSON.stringify({ args: payload.args });
      break;

    case BehaviorCategory.Visibility:
      row.name = str(payload.state, 20);
      row.extra = JSON.stringify({ route: payload.route });
      break;

    case BehaviorCategory.Custom: {
      const custom = payload as { eventName?: string; properties?: Record<string, any>; category?: string };
      row.name = str(custom.eventName, 200);
      row.extra = JSON.stringify({ properties: custom.properties, customCategory: custom.category });
      break;
    }

    // ------------------------------ 自定义 ------------------------------
    case 'custom': {
      const custom = payload as { eventName?: string; properties?: Record<string, any>; category?: string };
      row.name = str(custom.eventName, 200);
      row.extra = JSON.stringify({ properties: custom.properties, customCategory: custom.category });
      break;
    }

    default:
      row.name = str(payload.metric || payload.url || event.category, 500);
      row.value = num(payload.value ?? payload.duration);
      row.extra = JSON.stringify(payload);
      break;
  }

  return row;
}

/** 映射错误事件 */
export function mapErrorToRow(
  event: MonitorEvent,
  common: CommonContext,
  geo: GeoInfo,
  appKey: string,
): ErrorRow {
  const payload = (event.payload || {}) as Record<string, any>;
  const context = common.context;
  return {
    app_key: appKey,
    timestamp: formatDateTime(new Date(event.timestamp)),
    fingerprint: str(payload.fingerprint, 64),
    category: event.category,
    level: str(payload.level || 'error', 20),
    message: str(payload.message || payload.url || '', 4000),
    name: str(payload.name || '', 200),
    type: str(payload.type || payload.errorType || '', 100),
    stack: str(payload.stack, 8000),
    frames: JSON.stringify(payload.frames || []),
    filename: str(payload.filename, 1000),
    lineno: num(payload.lineno),
    colno: num(payload.colno),
    session_id: common.sessionId,
    user_id: common.userId || '',
    anonymous_id: common.anonymousId,
    page_id: common.pageId,
    url: str(common.url, 1000),
    app_version: common.appVersion || '',
    env: common.env,
    trace_id: event.traceId || payload.traceId || '',
    breadcrumbs: JSON.stringify(payload.breadcrumbs || []),
    snapshot: JSON.stringify(payload.snapshot || {}),
    extra: JSON.stringify({
      mechanism: payload.mechanism,
      componentStack: payload.componentStack,
      status: payload.status,
      statusText: payload.statusText,
      businessCode: payload.businessCode,
      responseBody: payload.responseBody,
      duration: payload.duration,
      tagName: payload.tagName,
      selector: payload.selector,
      args: payload.args,
      extra: payload.extra,
    }),
    device_type: context?.device?.type || '',
    browser: context?.browser?.name || '',
    os: context?.os?.name || '',
    geo_country: geo.country || '',
    geo_region: geo.region || '',
    geo_city: geo.city || '',
  };
}

/** 映射回放分片（meta 事件不落分片表，仅用于标记） */
export function mapReplayToRow(
  event: MonitorEvent,
  common: CommonContext,
  appKey: string,
): ReplayRow | null {
  if (event.category !== ReplayCategory.Chunk) return null;
  const payload = (event.payload || {}) as Record<string, any>;
  return {
    app_key: appKey,
    session_id: common.sessionId,
    page_id: common.pageId,
    chunk_index: num(payload.index),
    timestamp: formatDateTime(new Date(event.timestamp)),
    start_time: formatDateTime(new Date(num(payload.startTime, event.timestamp))),
    end_time: formatDateTime(new Date(num(payload.endTime, event.timestamp))),
    width: 0,
    height: 0,
    events: JSON.stringify(payload.events || []),
    reasons: JSON.stringify(payload.reasons || []),
    app_version: common.appVersion || '',
    env: common.env,
    device_type: common.context?.device?.type || '',
  };
}

export { safeParse, str, num };
