import type { AxiosResponse } from 'axios';
import type { RealtimeScreenSnapshot } from '@web-monitor/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import clientInstance from '../../api/client';
import { fetchSnapshot, snapshotUrl, streamUrl } from './api';

/**
 * BUG-20260919-04 回归防护：REST 快照兜底请求曾因 snapshotUrl 自带 /api/v1 前缀，
 * 经 axios baseURL='/api/v1' 拼接成 /api/v1/api/v1/... 双前缀 404，导致断流后被误判
 * 「应用不可用」且兜底轮询停摆。本组用例在 axios 实例层拦截，锁定真实请求路径。
 */
describe('realtime REST 快照请求路径（BUG-20260919-04）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fetchSnapshot 实际请求不含 /api/v1/api/v1 双前缀，最终命中 /api/v1/realtime/screen/:appKey/snapshot', async () => {
    const snapshot = { appKey: 'wm_demo00000001' } as RealtimeScreenSnapshot;
    const requestSpy = vi
      .spyOn(clientInstance, 'request')
      .mockResolvedValue(snapshot as unknown as AxiosResponse);

    await expect(fetchSnapshot('wm_demo00000001')).resolves.toBe(snapshot);
    expect(requestSpy).toHaveBeenCalledTimes(1);

    const config = requestSpy.mock.calls[0][0];
    // axios 收到的是 snapshotUrl 给出的相对路径（与 api/endpoints.ts 约定一致），不含 /api/v1 前缀
    expect(config.url).toBe(snapshotUrl('wm_demo00000001'));
    expect(config.url).not.toContain('/api/v1/api/v1');
    // axios 实际拼出的完整请求路径（baseURL + url）= TDD 契约路径
    expect(clientInstance.getUri(config)).toBe(
      '/api/v1/realtime/screen/wm_demo00000001/snapshot',
    );
  });

  it('streamUrl 保持 /api/v1 完整前缀（供原生 EventSource 直连，不经 axios）', () => {
    expect(streamUrl('wm_demo00000001')).toBe(
      '/api/v1/realtime/screen/wm_demo00000001/stream',
    );
    expect(streamUrl('a/b?c')).toBe('/api/v1/realtime/screen/a%2Fb%3Fc/stream');
  });
});
