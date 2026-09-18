import type { RealtimeScreenSnapshot } from '@web-monitor/types';
import { get } from '../../api/client';

/** SSE 端点路径（契约源：TDD V1 RealtimeModule） */
export const streamUrl = (appKey: string): string =>
  `/api/v1/realtime/screen/${encodeURIComponent(appKey)}/stream`;

/** REST 快照兜底路径 */
export const snapshotUrl = (appKey: string): string =>
  `/api/v1/realtime/screen/${encodeURIComponent(appKey)}/snapshot`;

/** 拉取一次性快照（SSE 不可用时的降级通道） */
export async function fetchSnapshot(appKey: string): Promise<RealtimeScreenSnapshot> {
  return get<RealtimeScreenSnapshot>(snapshotUrl(appKey));
}

/**
 * 应用不存在判定：服务端以 HTTP 404 + REALTIME_APP_NOT_FOUND 表达。
 * axios 客户端错误路径会透传原始 error（含 response），据此区分「应用被删」与「网络失败」。
 */
export function isAppNotFound(error: unknown): boolean {
  const response = (error as { response?: { status?: number } })?.response;
  return response?.status === 404;
}
