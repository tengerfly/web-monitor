import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { HttpException, type MessageEvent } from '@nestjs/common';
import {
  RealtimeSnapshotService,
  ScreenStreamController,
} from './realtime.module';

/** 构造可复用的 ClickHouse stub：按 SQL 片段特征返回行 */
function makeCh(overrides: Partial<Record<string, unknown>> = {}) {
  const query = vi.fn(async (sql: string): Promise<Record<string, any>[]> => {
    if (sql.includes("category = 'pv'") && sql.includes('GROUP BY minute')) {
      return [{ minute: '2026-09-18 14:00:00', pv: 10 }];
    }
    if (sql.includes('fingerprint AS name')) {
      return [{ name: 'fp-1', value: 18 }];
    }
    if (sql.includes('url AS page')) {
      return [{ fingerprint: 'fp-e1', type: 'JS 错误', message: 'm1', page: '/x', occurredAt: '2026-09-18 14:00:00' }];
    }
    if (sql.includes('AS value FROM') && sql.includes("category = 'api'")) {
      return [{ name: '/api/order/list', value: 1842 }];
    }
    if (sql.includes('AS value FROM') && sql.includes("category = 'pv'")) {
      return [{ name: '/seckill', value: 4200 }];
    }
    if (sql.includes('countIf')) {
      return [{ lcpTotal: 100, lcpPassed: 92, inpTotal: 100, inpPassed: 88, clsTotal: 100, clsPassed: 96 }];
    }
    if (sql.includes('uniqExact(session_id)')) return [{ sessions: 42 }];
    if (sql.includes('countIf(success = 1)')) return [{ successRate: 0.996 }];
    if (sql.includes("category = 'pv'")) return [{ pv: 100, uv: 30 }];
    if (sql.includes('avgIf(value')) return [{ avgLcp: 2000, avgInp: 150, avgCls: 0.05 }];
    return [];
  });
  const queryOne = vi.fn(async (sql: string): Promise<Record<string, any> | undefined> => {
    if (sql.includes('FROM wm_errors WHERE') && sql.includes('count() AS total')) return { total: 23 };
    if (sql.includes('countIf') && sql.includes("name = 'LCP'")) {
      return { lcpTotal: 100, lcpPassed: 92, inpTotal: 100, inpPassed: 88, clsTotal: 100, clsPassed: 96 };
    }
    if (sql.includes('countIf(success = 1)')) return [{ successRate: 0.996 }][0];
    if (sql.includes('uniqExact(session_id)')) return { sessions: 42 };
    if (sql.includes('count() AS pv') && sql.includes('uniqExact(anonymous_id)')) return { pv: 100, uv: 30 };
    if (sql.includes('ORDER BY timestamp DESC')) return undefined;
    return undefined;
  });
  void overrides;
  return {
    query,
    queryOne,
    getTable: (name: string) => name,
  };
}

function makePrisma(overrides: { project?: unknown; firing?: unknown[]; recent?: unknown[]; alertsFail?: boolean } = {}) {
  return {
    project: { findUnique: vi.fn(async () => (overrides.project !== undefined ? overrides.project : { id: 'p1' })) },
    alertRecord: {
      findMany: vi.fn(async (args: { where: { status?: string } }) => {
        if (overrides.alertsFail) throw new Error('prisma down');
        return args.where.status === 'firing'
          ? (overrides.firing ?? [
              {
                id: 'a1',
                metric: 'error_rate',
                value: 2.4,
                threshold: 2,
                triggeredAt: new Date('2026-09-18T14:20:00'),
                status: 'firing',
                message: '错误率突增',
                rule: { name: '错误率突增' },
              },
            ])
          : (overrides.recent ?? [
              {
                id: 'a1',
                metric: 'error_rate',
                value: 2.4,
                threshold: 2,
                triggeredAt: new Date('2026-09-18T14:20:00'),
                status: 'firing',
                message: '错误率突增',
                rule: { name: '错误率突增' },
              },
              {
                id: 'a2',
                metric: 'new_error',
                value: 1,
                threshold: 1,
                triggeredAt: new Date('2026-09-18T13:47:00'),
                status: 'resolved',
                message: '新错误',
                rule: { name: '新错误告警' },
              },
            ]);
      }),
    },
  };
}

function makeConfig(realtime?: Partial<{ pushIntervalMs: number; retryBaseMs: number; maxClients: number }>) {
  const config = {
    realtime: { pushIntervalMs: 5000, retryBaseMs: 10000, retryMaxMs: 60000, maxClients: 200, ...realtime },
  };
  return { get: () => config } as never;
}

function makeService(
  ch = makeCh(),
  prisma = makePrisma(),
  config = makeConfig(),
): RealtimeSnapshotService {
  return new RealtimeSnapshotService(ch as never, prisma as never, config);
}

describe('RealtimeSnapshotService', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-09-18T14:32:00') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('AC-M01-001 全类目成功 → failure.status=ok 且 metrics 七项齐备', async () => {
    const service = makeService();
    const snapshot = await service.getSnapshot('wm_demo00000001');
    expect(snapshot.failure.status).toBe('ok');
    expect(snapshot.metrics).toMatchObject({ pv: 100, uv: 30, errorCount: 23, activeSessions: 42 });
    expect(snapshot.metrics.score).toBeGreaterThan(0);
    expect(snapshot.generatedAtEpochMs).toBeTypeOf('number');
  });

  it('AC-M01-002 趋势固定 60 点、无数据分钟补 null', async () => {
    const service = makeService();
    const snapshot = await service.getSnapshot('wm_demo00000001');
    expect(snapshot.trend).toHaveLength(60);
    const filled = snapshot.trend.filter((point) => point.pv !== null);
    expect(filled.length).toBe(1);
    expect(snapshot.trend[59].minuteEpochMs).toBe(snapshot.trend[0].minuteEpochMs + 59 * 60_000);
  });

  it('AC-M01-003/004 错误流与 Top 榜容量与字段', async () => {
    const service = makeService();
    const snapshot = await service.getSnapshot('wm_demo00000001');
    expect(snapshot.topLists.slowApis[0]).toMatchObject({ name: '/api/order/list', unit: 'ms' });
    expect(snapshot.topLists.jsErrors[0]).toMatchObject({ name: 'fp-1', value: 18, unit: 'count' });
    expect(snapshot.topLists.worstPages.length).toBeLessThanOrEqual(5);
  });

  it('AC-M01-005/012 告警分槽：unresolved 仅 firing，recent24h 含 resolved 且状态可区分', async () => {
    const service = makeService();
    const snapshot = await service.getSnapshot('wm_demo00000001');
    expect(snapshot.alerts.unresolved).toHaveLength(1);
    expect(snapshot.alerts.unresolved[0].ruleName).toBe('错误率突增');
    expect(snapshot.alerts.recent24h.map((item) => item.status)).toContain('resolved');
  });

  it('AC-M01-006/014 达标率：有样本返回比率，无样本为 null（与零值区分）', async () => {
    const service = makeService();
    const snapshot = await service.getSnapshot('wm_demo00000001');
    expect(snapshot.vitals).toMatchObject({ lcp: 0.92, inp: 0.88, cls: 0.96, overall: 0.92 });

    const emptyCh = makeCh();
    emptyCh.queryOne.mockImplementation(async (sql: string) => {
      if (sql.includes('countIf')) return { lcpTotal: 0, lcpPassed: 0, inpTotal: 0, inpPassed: 0, clsTotal: 0, clsPassed: 0 };
      return undefined;
    });
    const emptySnapshot = await new RealtimeSnapshotService(
      emptyCh as never,
      makePrisma() as never,
      makeConfig(),
    ).getSnapshot('wm_demo00000001');
    expect(emptySnapshot.vitals).toEqual({ lcp: null, inp: null, cls: null, overall: null });
  });

  it('AC-M01-007/011 部分类目失败 → partial + categories 注明 + 失败类目置空', async () => {
    const ch = makeCh();
    ch.queryOne.mockImplementation(async (sql: string) => {
      // 仅达标率类目失败：达标率 SQL 特征 = countIf + name='LCP'；
      // 不能只按 countIf（接口成功率子查询也用）或 name='LCP'（评分 avgIf 也用），否则误伤 metrics 类目
      if (sql.includes('countIf') && sql.includes("name = 'LCP'")) throw new Error('vitals timeout');
      if (sql.includes('count() AS pv') && sql.includes('uniqExact(anonymous_id)')) return { pv: 50, uv: 20 };
      return undefined;
    });
    ch.query.mockImplementation(async (sql: string) => {
      if (sql.includes("category = 'pv'") && sql.includes('GROUP BY minute')) {
        return [{ minute: '2026-09-18 14:00:00', pv: 10 }];
      }
      if (sql.includes('fingerprint AS name')) return [{ name: 'fp-1', value: 18 }];
      if (sql.includes('AS value FROM') && sql.includes("category = 'api'")) return [{ name: '/api/x', value: 100 }];
      if (sql.includes('AS value FROM') && sql.includes("category = 'pv'")) return [{ name: '/home', value: 900 }];
      if (sql.includes('uniqExact(session_id)')) return [{ sessions: 7 }];
      if (sql.includes('countIf(success = 1)')) return [{ successRate: 0.99 }];
      if (sql.includes("category = 'pv'")) return [{ pv: 50, uv: 20 }];
      if (sql.includes('avgIf(value')) return [{ avgLcp: 2000, avgInp: 150, avgCls: 0.05 }];
      return [];
    });
    const snapshot = await makeService(ch).getSnapshot('wm_demo00000001');
    expect(snapshot.failure.status).toBe('partial');
    expect(snapshot.failure.categories).toContain('vitals');
    expect(snapshot.vitals).toEqual({ lcp: null, inp: null, cls: null, overall: null });
    expect(snapshot.metrics.pv).toBe(50);
  });

  it('AC-M01-008 全部六类失败 → failed', async () => {
    const ch = makeCh();
    ch.query.mockRejectedValue(new Error('clickhouse down'));
    ch.queryOne.mockRejectedValue(new Error('clickhouse down'));
    const snapshot = await makeService(ch, makePrisma({ alertsFail: true })).getSnapshot('wm_demo00000001');
    expect(snapshot.failure.status).toBe('failed');
    expect(snapshot.failure.categories).toHaveLength(6);
  });

  it('AC-M01-008 补充：CH 全失败但告警库正常 → partial（告警类目仍可用）', async () => {
    const ch = makeCh();
    ch.query.mockRejectedValue(new Error('clickhouse down'));
    ch.queryOne.mockRejectedValue(new Error('clickhouse down'));
    const snapshot = await makeService(ch).getSnapshot('wm_demo00000001');
    expect(snapshot.failure.status).toBe('partial');
    expect(snapshot.failure.categories).not.toContain('alerts');
  });

  it('AC-M01-009/010 应用不存在 → 404 REALTIME_APP_NOT_FOUND', async () => {
    const service = makeService(makeCh(), makePrisma({ project: null }));
    const error = await service.getSnapshot('ghost').then(() => null, (e) => e);
    expect(error.getResponse()).toMatchObject({ code: 'REALTIME_APP_NOT_FOUND' });
  });

  it('AC-M01-015 TTL 内多消费方共享同一快照（聚合只执行一轮）', async () => {
    const ch = makeCh();
    const service = makeService(ch);
    await service.getSnapshot('wm_demo00000001');
    const callsAfterFirst = ch.query.mock.calls.length;
    await service.getSnapshot('wm_demo00000001');
    expect(ch.query.mock.calls.length).toBe(callsAfterFirst);
  });

  it('TTL 过期后重新聚合', async () => {
    const ch = makeCh();
    const service = makeService(ch);
    await service.getSnapshot('wm_demo00000001');
    const callsAfterFirst = ch.query.mock.calls.length;
    vi.advanceTimersByTime(5001);
    await service.getSnapshot('wm_demo00000001');
    expect(ch.query.mock.calls.length).toBeGreaterThan(callsAfterFirst);
  });
});

describe('ScreenStreamController', () => {
  it('首帧立即发出且 type=snapshot、携带 retry', async () => {
    const service = makeService();
    const controller = new ScreenStreamController(service as never, makeConfig());
    const events$ = controller.stream('wm_demo00000001');
    const first = await vi.waitFor(() => new Promise<MessageEvent>((resolve) => events$.subscribe(resolve)));
    expect(first.type).toBe('snapshot');
    expect((first as { retry?: number }).retry).toBe(10000);
  });

  it('AC-M01-010 应用无效 → 订阅后以 REALTIME_APP_NOT_FOUND 错误终止（不产生事件帧）', async () => {
    const controller = new ScreenStreamController(
      makeService(makeCh(), makePrisma({ project: null })) as never,
      makeConfig(),
    );
    const events$ = controller.stream('ghost');
    const error = await new Promise<unknown>((resolve, reject) => {
      events$.subscribe({
        next: (_event: MessageEvent) => reject(new Error('不应产生事件帧')),
        error: (e: unknown) => resolve(e),
      });
    });
    expect((error as HttpException).getResponse()).toMatchObject({ code: 'REALTIME_APP_NOT_FOUND' });
  });

  it('背压：连接数达 maxClients → 503 REALTIME_CLIENT_LIMIT', () => {
    const controller = new ScreenStreamController(makeService() as never, makeConfig({ maxClients: 0 }));
    try {
      controller.stream('wm_demo00000001');
      throw new Error('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(HttpException);
      const response = (error as HttpException).getResponse() as { code: string };
      expect(response.code).toBe('REALTIME_CLIENT_LIMIT');
      expect((error as HttpException).getStatus()).toBe(503);
    }
  });
});
