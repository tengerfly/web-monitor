import type { RealtimeScreenSnapshot } from '@web-monitor/types';
import { get } from '../../api/client';

/**
 * SSE 端点路径（契约源：TDD V1 RealtimeModule）。
 * 供原生 EventSource 直连（new EventSource(url)，不经 axios），必须是含 /api/v1 的完整浏览器路径。
 */
export const streamUrl = (appKey: string): string =>
  `/api/v1/realtime/screen/${encodeURIComponent(appKey)}/stream`;

/**
 * REST 快照兜底路径（契约源：TDD V1 RealtimeModule）。
 * 供 axios 客户端使用：相对路径（不带 /api/v1，与 api/endpoints.ts 约定一致），
 * 由 client.ts 的 baseURL='/api/v1' 拼接后最终请求 /api/v1/realtime/screen/:appKey/snapshot。
 * 注意不要在此补 /api/v1 前缀，否则会拼出 /api/v1/api/v1 双前缀 404（BUG-20260919-04）。
 */
export const snapshotUrl = (appKey: string): string =>
  `/realtime/screen/${encodeURIComponent(appKey)}/snapshot`;

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
