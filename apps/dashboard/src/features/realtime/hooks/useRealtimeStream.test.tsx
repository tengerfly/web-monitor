import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RealtimeScreenSnapshot } from '@web-monitor/types';
import { useRealtimeStream } from './useRealtimeStream';

/** 可控的 EventSource 测试替身：手工驱动 snapshot 帧与 error */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  readyState = FakeEventSource.CONNECTING;
  closed = false;
  url: string;
  private listeners = new Map<string, Array<(event: { data: string }) => void>>();
  private errorListeners: Array<(event: unknown) => void> = [];

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }
  addEventListener(type: string, listener: (event: { data: string }) => void): void {
    if (type === 'error') {
      this.errorListeners.push(listener as (event: unknown) => void);
      return;
    }
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }
  removeEventListener(): void {
    /* 测试替身不需要 */
  }
  close(): void {
    this.closed = true;
    this.readyState = FakeEventSource.CLOSED;
  }
  emitSnapshot(snapshot: RealtimeScreenSnapshot): void {
    this.readyState = FakeEventSource.OPEN;
    this.listeners.get('snapshot')?.forEach((fn) => fn({ data: JSON.stringify(snapshot) }));
  }
  emitError(fatal = false): void {
    if (fatal) this.readyState = FakeEventSource.CLOSED;
    this.errorListeners.forEach((fn) => fn({}));
  }
}

function makeSnapshot(overrides: Partial<RealtimeScreenSnapshot> = {}): RealtimeScreenSnapshot {
  return {
    appKey: 'wm_demo00000001',
    generatedAt: '2026-09-18T14:32:00',
    generatedAtEpochMs: Date.now(),
    statsWindow: { dayStartAt: '2026-09-18T00:00:00', windowMinutes: 60 },
    metrics: { pv: 100, uv: 30, errorCount: 23, errorRate: 0.18, score: 86, activeSessions: 42, apiSuccessRate: 0.996 },
    trend: Array.from({ length: 60 }, (_, index) => ({ minuteEpochMs: index * 60_000, pv: null, errors: null })),
    errors: [],
    topLists: { slowApis: [], jsErrors: [], worstPages: [] },
    alerts: { unresolved: [], recent24h: [] },
    vitals: { lcp: 0.92, inp: 0.88, cls: 0.96, overall: 0.9 },
    failure: { status: 'ok', categories: [] },
    ...overrides,
  };
}

describe('useRealtimeStream 状态机（TC-M02 ↔ AC-M02-004/007/010/013）', () => {
  let instances: FakeEventSource[];

  beforeEach(() => {
    vi.useFakeTimers();
    instances = FakeEventSource.instances = [];
    vi.stubGlobal('EventSource', FakeEventSource as unknown as typeof EventSource);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function render(appKey: string | undefined, fetcher?: (appKey: string) => Promise<RealtimeScreenSnapshot>) {
    return renderHook(() =>
      useRealtimeStream(appKey, {
        snapshotFetcher: fetcher ?? (async () => makeSnapshot()),
        fallbackIntervalMs: 5000,
        firstFrameTimeoutMs: 5000,
      }),
    );
  }

  it('TC-M02-001 idle：未选定应用时不建连', () => {
    const { result } = render(undefined);
    expect(result.current.phase).toBe('idle');
    expect(instances).toHaveLength(0);
  });

  it('AC-M02-004 首帧立即 → live，后续帧推进快照', async () => {
    const { result } = render('wm_demo00000001');
    const source = instances[0];
    expect(source.url).toContain('/realtime/screen/wm_demo00000001/stream');
    await act(async () => source.emitSnapshot(makeSnapshot()));
    expect(result.current.phase).toBe('live');
    expect(result.current.everSucceeded).toBe(true);
    expect(result.current.snapshot?.metrics.pv).toBe(100);
  });

  it('AC-M02-007 曾成功后断连 → interrupted 且保留旧快照', async () => {
    const { result } = render('wm_demo00000001');
    const source = instances[0];
    await act(async () => source.emitSnapshot(makeSnapshot()));
    act(() => source.emitError());
    expect(result.current.phase).toBe('interrupted');
    expect(result.current.everSucceeded).toBe(true);
    expect(result.current.snapshot?.metrics.pv).toBe(100);
  });

  it('AC-M02-013 首帧超时且从未成功 → interrupted（无时点语义）并启动 REST 兜底', async () => {
    const fetcher = vi.fn(async () => makeSnapshot({ metrics: { pv: 7, uv: 3, errorCount: 0, errorRate: 0, score: 90, activeSessions: 1, apiSuccessRate: 1 } }));
    const { result } = render('wm_demo00000001', fetcher);
    // 首帧等待超时 → 进入 interrupted 并启动兜底轮询
    await act(async () => {
      vi.advanceTimersByTime(5001);
    });
    expect(result.current.phase).toBe('interrupted');
    expect(result.current.everSucceeded).toBe(false);
    // 兜底轮询首个周期（+5s）拉到快照 → everSucceeded 翻转
    await act(async () => {
      vi.advanceTimersByTime(5000);
    });
    expect(fetcher).toHaveBeenCalled();
    expect(result.current.snapshot?.metrics.pv).toBe(7);
    expect(result.current.everSucceeded).toBe(true);
  });

  it('AC-M02-010 快速连续切换：以最后选择的应用为准且旧连接关闭', async () => {
    const { rerender } = renderHook((props: { appKey: string | undefined }) => useRealtimeStream(props.appKey), {
      initialProps: { appKey: 'app-a' },
    });
    rerender({ appKey: 'app-b' });
    rerender({ appKey: 'app-c' });
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    const open = instances.filter((source) => !source.closed);
    expect(open).toHaveLength(1);
    expect(open[0].url).toContain('app-c');
  });
});
