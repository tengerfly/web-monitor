import { getDocument, getWindow, round, type MonitorContext, type RequestResult } from '@web-monitor/core';
import { VisibilityState, type ErrorSnapshot, type RequestBrief } from '@web-monitor/types';

/** 请求结果 -> 精简摘要（控制错误事件体积） */
export function toRequestBrief(result: RequestResult): RequestBrief {
  return {
    method: result.method,
    url: result.url,
    status: result.status,
    duration: round(result.duration, 0),
    ok: result.ok,
    timestamp: result.timestamp,
  };
}

/**
 * 构建错误现场快照。
 * 这是「溯源」的基础事实：错误发生在什么环境、什么页面、什么网络、最近一次请求是什么。
 */
export function buildSnapshot(ctx: MonitorContext, includeHeavy = true): ErrorSnapshot {
  const win = getWindow();
  const doc = getDocument();
  const eventContext = ctx.getEventContext();

  const snapshot: ErrorSnapshot = {
    visibility: (doc?.visibilityState as VisibilityState) || VisibilityState.Visible,
    route: ctx.context.getPageId(),
    title: ctx.context.getTitle(),
    viewport: eventContext.device.viewport || '',
    userAgent: ctx.context.getUserAgent(),
    network: eventContext.network,
    failedRequestCount: ctx.requests.getFailedCount(),
  };

  const last = ctx.requests.getLast();
  if (last) snapshot.lastRequest = toRequestBrief(last);
  const lastSuccess = ctx.requests.getLastSuccess();
  if (lastSuccess) snapshot.lastSuccessRequest = toRequestBrief(lastSuccess);

  if (includeHeavy) {
    const memory = (win?.performance as any)?.memory;
    if (memory) {
      snapshot.memory = {
        usedJSHeapSize: memory.usedJSHeapSize,
        totalJSHeapSize: memory.totalJSHeapSize,
        jsHeapSizeLimit: memory.jsHeapSizeLimit,
        usage: memory.jsHeapSizeLimit
          ? round(memory.usedJSHeapSize / memory.jsHeapSizeLimit, 4)
          : 0,
      };
    }
  }

  return snapshot;
}
