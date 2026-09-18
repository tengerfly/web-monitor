import {
  Controller,
  Get,
  Injectable,
  Logger,
  Module,
  NotFoundException,
  HttpException,
  HttpStatus,
  Sse,
  Param,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { interval, map, Observable, switchMap, timer } from 'rxjs';
import type { MessageEvent } from '@nestjs/common';
import type {
  RealtimeScreenSnapshot,
  ScreenAlertItem,
  ScreenErrorItem,
  ScreenMetrics,
  ScreenTopItem,
  ScreenTrendPoint,
  ScreenVitals,
} from '@web-monitor/types';
import { PrismaService } from '../../storage/prisma.service';
import { ClickHouseService } from '../../storage/clickhouse.service';
import { buildBaseFilter, type RawQuery, type TimeRange } from '../../common/query';
import { SseResponse } from '../../common/http';
import { computeScore } from '../query/overview.module';
import type { AppConfig } from '../../config/configuration';

/** 六类类目名（failure.categories 取值域） */
const CATEGORIES = ['metrics', 'trend', 'errors', 'topLists', 'alerts', 'vitals'] as const;

/** Core Vitals「良好」阈值（沿用存量总览口径） */
const VITAL_GOOD: Record<'LCP' | 'INP' | 'CLS', number> = { LCP: 2500, INP: 200, CLS: 0.1 };

/** SSE 心跳间隔（秒）：低于常见反向代理 60s 读超时 */
const HEARTBEAT_INTERVAL_MS = 15_000;
/** 背压 503 的建议重试等待（秒，经 Retry-After 头下发） */
const BACKPRESSURE_RETRY_AFTER_S = 10;
/** 错误流容量（PRD M01 §5 规则 3） */
const ERROR_STREAM_LIMIT = 50;
/** 未恢复告警供数上限（设计假设 A11） */
const UNRESOLVED_ALERT_LIMIT = 100;
/** 近 24 小时告警记录取样上限（防错误风暴放大） */
const RECENT_ALERT_LIMIT = 200;
/** Top 榜条目数 */
const TOP_N = 5;
/** 趋势点数 */
const TREND_POINTS = 60;

interface CacheEntry {
  snapshot: RealtimeScreenSnapshot;
  expiresAt: number;
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/** 当日 00:00（服务端时区，与存量 overview 口径一致） */
function startOfToday(): Date {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now;
}

/** 构造 TimeRange（本模块查询不使用分桶，interval/bucketMs 填最小粒度占位） */
function makeRange(start: Date, end: Date): TimeRange {
  return { start, end, interval: 'INTERVAL 1 MINUTE', bucketMs: 60_000 };
}

/** 对齐到分钟起点 */
function startOfMinute(date: Date): Date {
  const copy = new Date(date);
  copy.setSeconds(0, 0);
  return copy;
}

@Injectable()
export class RealtimeSnapshotService {
  private readonly logger = new Logger('RealtimeSnapshot');
  private readonly pushIntervalMs: number;
  /** TTL 缓存：同一 appKey 的多个挂屏在 TTL 内共享同一份快照（PRD 降级思路落点） */
  private readonly cache = new Map<string, CacheEntry>();
  /** 最后一次成功（ok/partial）快照：failed 时续发，避免死屏 */
  private readonly lastGood = new Map<string, { snapshot: RealtimeScreenSnapshot; at: number }>();

  constructor(
    private readonly ch: ClickHouseService,
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.pushIntervalMs = (config.get<AppConfig>('') as unknown as AppConfig).realtime.pushIntervalMs;
  }

  /** 获取快照：TTL 内直接复用缓存；仅「服务可达但供数失败」走失败标记（SUM-23 口径） */
  async getSnapshot(appKey: string): Promise<RealtimeScreenSnapshot> {
    await this.assertAppExists(appKey);

    const cached = this.cache.get(appKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) return cached.snapshot;

    const snapshot = await this.aggregate(appKey);
    if (snapshot.failure.status !== 'failed') {
      this.cache.set(appKey, { snapshot, expiresAt: now + this.pushIntervalMs });
      this.lastGood.set(appKey, { snapshot, at: now });
    }
    return snapshot;
  }

  /** 应用无效时 404（REST 直接返回；SSE 建流前拒绝） */
  private async assertAppExists(appKey: string): Promise<void> {
    const project = await this.prisma.project.findUnique({ where: { appKey }, select: { id: true } });
    if (!project) {
      throw new NotFoundException({ code: 'REALTIME_APP_NOT_FOUND', message: `应用不存在: ${appKey}` });
    }
  }

  /** 并行聚合六类类目；类目级失败置空并注明，全部失败回退最后成功快照 */
  private async aggregate(appKey: string): Promise<RealtimeScreenSnapshot> {
    const now = new Date();
    const results = await Promise.allSettled([
      this.aggregateMetrics(appKey, now),
      this.aggregateTrend(appKey, now),
      this.aggregateErrors(appKey),
      this.aggregateTopLists(appKey),
      this.aggregateAlerts(appKey, now),
      this.aggregateVitals(appKey, now),
    ]);

    const failedCategories = CATEGORIES.filter((_, index) => results[index].status === 'rejected');
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        this.logger.warn(`category ${CATEGORIES[index]} failed: ${(result.reason as Error)?.message}`);
      }
    });

    const status: RealtimeScreenSnapshot['failure']['status'] =
      failedCategories.length === 0 ? 'ok' : failedCategories.length === CATEGORIES.length ? 'failed' : 'partial';

    if (status === 'failed') {
      const good = this.lastGood.get(appKey);
      if (good) {
        return {
          ...good.snapshot,
          generatedAt: good.snapshot.generatedAt,
          failure: { status: 'failed', categories: [...failedCategories], lastSuccessAt: good.snapshot.generatedAt },
        };
      }
    }

    const empty: RealtimeScreenSnapshot = {
      appKey,
      generatedAt: now.toISOString(),
      generatedAtEpochMs: now.getTime(),
      statsWindow: { dayStartAt: startOfToday().toISOString(), windowMinutes: TREND_POINTS },
      metrics: { pv: 0, uv: 0, errorCount: 0, errorRate: 0, score: 0, activeSessions: 0, apiSuccessRate: 0 },
      trend: [],
      errors: [],
      topLists: { slowApis: [], jsErrors: [], worstPages: [] },
      alerts: { unresolved: [], recent24h: [] },
      vitals: { lcp: null, inp: null, cls: null, overall: null },
      failure: { status, categories: [...failedCategories] },
    };

    if (status === 'failed') return empty;

    // 部分失败：失败类目置空并注明（不用旧值冒充），成功类目正常填充
    const value = (index: number, fallback: unknown): unknown =>
      results[index].status === 'fulfilled' ? results[index].value : fallback;
    return {
      ...empty,
      metrics: (value(0, empty.metrics) as ScreenMetrics) ?? empty.metrics,
      trend: (value(1, empty.trend) as ScreenTrendPoint[]) ?? empty.trend,
      errors: (value(2, empty.errors) as ScreenErrorItem[]) ?? empty.errors,
      topLists: (value(3, empty.topLists) as RealtimeScreenSnapshot['topLists']) ?? empty.topLists,
      alerts: (value(4, empty.alerts) as RealtimeScreenSnapshot['alerts']) ?? empty.alerts,
      vitals: (value(5, empty.vitals) as ScreenVitals) ?? empty.vitals,
    };
  }

  /** 当日核心指标（口径见 PRD M01 §5：统计范围=当日 00:00 起；活跃会话=前 5 分钟） */
  private async aggregateMetrics(appKey: string, now: Date): Promise<ScreenMetrics> {
    const range: TimeRange = makeRange(startOfToday(), now);
    const raw: RawQuery = { appKey };
    const { clause, params } = buildBaseFilter(raw, range);
    const events = this.ch.getTable('wm_events');
    const activeRange: TimeRange = makeRange(new Date(now.getTime() - 5 * 60_000), now);
    const activeFilter = buildBaseFilter(raw, activeRange);

    const [traffic, errors, api, active] = await Promise.all([
      this.ch.queryOne<{ pv: number; uv: number }>(
        `SELECT count() AS pv, uniqExact(anonymous_id) AS uv
         FROM ${events} WHERE ${clause} AND category = 'pv'`,
        params,
      ),
      this.ch.queryOne<{ total: number }>(
        `SELECT count() AS total FROM ${this.ch.getTable('wm_errors')} WHERE ${clause}`,
        params,
      ),
      this.ch.queryOne<{ successRate: number }>(
        `SELECT countIf(success = 1) / greatest(count(), 1) AS successRate
         FROM ${events} WHERE ${clause} AND category = 'api'`,
        params,
      ),
      this.ch.queryOne<{ sessions: number }>(
        `SELECT uniqExact(session_id) AS sessions
         FROM ${events} WHERE ${activeFilter.clause}`,
        activeFilter.params,
      ),
    ]);

    const pv = Number(traffic?.pv ?? 0);
    const errorCount = Number(errors?.total ?? 0);
    const { avgLcp, avgInp, avgCls } = await this.vitalAvgs(raw, range);
    const metrics: ScreenMetrics = {
      pv,
      uv: Number(traffic?.uv ?? 0),
      errorCount,
      errorRate: pv > 0 ? round(errorCount / pv) : 0,
      score: 0,
      activeSessions: Number(active?.sessions ?? 0),
      apiSuccessRate: round(Number(api?.successRate ?? 0)),
    };
    metrics.score = computeScore({ avgLcp, avgInp, avgCls, ...metrics });
    return metrics;
  }

  /** 三项 web-vital 平均值（供性能评分） */
  private async vitalAvgs(raw: RawQuery, range: TimeRange): Promise<{ avgLcp: number; avgInp: number; avgCls: number }> {
    const { clause, params } = buildBaseFilter(raw, range);
    const row = await this.ch.queryOne<{ avgLcp: number; avgInp: number; avgCls: number }>(
      `SELECT
          avgIf(value, category = 'web-vital' AND name = 'LCP') AS avgLcp,
          avgIf(value, category = 'web-vital' AND name = 'INP') AS avgInp,
          avgIf(value, category = 'web-vital' AND name = 'CLS') AS avgCls
       FROM ${this.ch.getTable('wm_events')} WHERE ${clause}`,
      params,
    );
    return {
      avgLcp: Number(row?.avgLcp ?? 0),
      avgInp: Number(row?.avgInp ?? 0),
      avgCls: Number(row?.avgCls ?? 0),
    };
  }

  /** 最近 60 分钟逐分钟趋势：以统计时点所在分钟为终点、含终点共 60 点，无数据分钟补 null（A2） */
  private async aggregateTrend(appKey: string, now: Date): Promise<ScreenTrendPoint[]> {
    const endMinute = startOfMinute(now);
    const start = new Date(endMinute.getTime() - (TREND_POINTS - 1) * 60_000);
    const range: TimeRange = makeRange(start, now);
    const { clause, params } = buildBaseFilter({ appKey }, range);
    const events = this.ch.getTable('wm_events');
    const errors = this.ch.getTable('wm_errors');

    const [pvRows, errorRows] = await Promise.all([
      this.ch.query<{ minute: string; pv: number }>(
        `SELECT toStartOfMinute(timestamp) AS minute, count() AS pv
         FROM ${events} WHERE ${clause} AND category = 'pv'
         GROUP BY minute ORDER BY minute`,
        params,
      ),
      this.ch.query<{ minute: string; errors: number }>(
        `SELECT toStartOfMinute(timestamp) AS minute, count() AS errors
         FROM ${errors} WHERE ${clause}
         GROUP BY minute ORDER BY minute`,
        params,
      ),
    ]);

    const pvMap = new Map(pvRows.map((row) => [new Date(row.minute).getTime(), Number(row.pv)]));
    const errMap = new Map(errorRows.map((row) => [new Date(row.minute).getTime(), Number(row.errors)]));
    const points: ScreenTrendPoint[] = [];
    for (let index = 0; index < TREND_POINTS; index += 1) {
      const minuteEpochMs = start.getTime() + index * 60_000;
      points.push({ minuteEpochMs, pv: pvMap.get(minuteEpochMs) ?? null, errors: errMap.get(minuteEpochMs) ?? null });
    }
    return points;
  }

  /** 最新错误流：倒序、容量 50，fingerprint 作为跳转定位标识（SUM-04） */
  private async aggregateErrors(appKey: string): Promise<ScreenErrorItem[]> {
    const range: TimeRange = makeRange(new Date(0), new Date());
    const { clause, params } = buildBaseFilter({ appKey }, range);
    const rows = await this.ch.query<{
      fingerprint: string;
      type: string;
      message: string;
      page: string;
      occurredAt: string;
    }>(
      `SELECT fingerprint, type, message, url AS page, timestamp AS occurredAt
       FROM ${this.ch.getTable('wm_errors')} WHERE ${clause}
       ORDER BY timestamp DESC LIMIT ${ERROR_STREAM_LIMIT}`,
      params,
    );
    return rows.map((row) => ({
      fingerprint: String(row.fingerprint),
      type: String(row.type || '错误'),
      message: String(row.message),
      page: String(row.page ?? ''),
      occurredAt: new Date(row.occurredAt).toISOString(),
    }));
  }

  /** 三个 Top 榜（口径见 PRD M01 §5 规则 4：沿用存量聚合口径） */
  private async aggregateTopLists(appKey: string): Promise<RealtimeScreenSnapshot['topLists']> {
    const range: TimeRange = makeRange(startOfToday(), new Date());
    const { clause, params } = buildBaseFilter({ appKey }, range);
    const events = this.ch.getTable('wm_events');
    const errors = this.ch.getTable('wm_errors');

    const [slowApis, jsErrors, worstPages] = await Promise.all([
      this.ch.query<{ name: string; value: number }>(
        `SELECT name, avg(value) AS value FROM ${events}
         WHERE ${clause} AND category = 'api'
         GROUP BY name ORDER BY value DESC LIMIT ${TOP_N}`,
        params,
      ),
      this.ch.query<{ name: string; value: number }>(
        `SELECT fingerprint AS name, count() AS value FROM ${errors}
         WHERE ${clause}
         GROUP BY fingerprint ORDER BY value DESC LIMIT ${TOP_N}`,
        params,
      ),
      this.ch.query<{ name: string; value: number }>(
        `SELECT name, avg(value) AS value FROM ${events}
         WHERE ${clause} AND category = 'pv'
         GROUP BY name ORDER BY value DESC LIMIT ${TOP_N}`,
        params,
      ),
    ]);
    const toItems = (rows: { name: string; value: number }[], unit: ScreenTopItem['unit']): ScreenTopItem[] =>
      rows.map((row) => ({ name: String(row.name), value: round(Number(row.value), 1), unit }));
    return {
      slowApis: toItems(slowApis, 'ms'),
      jsErrors: toItems(jsErrors, 'count'),
      worstPages: toItems(worstPages, 'ms'),
    };
  }

  /** 告警结果：未恢复（≤100 最新优先）+ 近 24h 记录含 resolved（A5/A11；横幅仅消费未恢复） */
  private async aggregateAlerts(appKey: string, now: Date): Promise<RealtimeScreenSnapshot['alerts']> {
    const since24h = new Date(now.getTime() - 24 * 60 * 60_000);
    const toItem = (record: {
      id: string;
      metric: string;
      value: number;
      threshold: number;
      triggeredAt: Date;
      status: string;
      message: string;
      rule: { name: string };
    }): ScreenAlertItem => ({
      id: record.id,
      ruleName: record.rule?.name ?? '',
      metric: record.metric,
      value: Number(record.value),
      threshold: Number(record.threshold),
      triggeredAt: record.triggeredAt.toISOString(),
      status: record.status === 'resolved' ? 'resolved' : 'firing',
      message: record.message,
    });
    const [unresolved, recent] = await Promise.all([
      this.prisma.alertRecord.findMany({
        where: { appKey, status: 'firing' },
        orderBy: { triggeredAt: 'desc' },
        take: UNRESOLVED_ALERT_LIMIT,
        include: { rule: { select: { name: true } } },
      }),
      this.prisma.alertRecord.findMany({
        where: { appKey, triggeredAt: { gte: since24h } },
        orderBy: { triggeredAt: 'desc' },
        take: RECENT_ALERT_LIMIT,
        include: { rule: { select: { name: true } } },
      }),
    ]);
    return { unresolved: unresolved.map(toItem), recent24h: recent.map(toItem) };
  }

  /** 三项达标率 + 综合达标率（沿用存量「良好阈值事件占比」口径）；无样本为 null（A7，与零值区分） */
  private async aggregateVitals(appKey: string, now: Date): Promise<ScreenVitals> {
    const range: TimeRange = makeRange(startOfToday(), now);
    const { clause, params } = buildBaseFilter({ appKey }, range);
    const row = await this.ch.queryOne<{
      lcpTotal: number;
      lcpPassed: number;
      inpTotal: number;
      inpPassed: number;
      clsTotal: number;
      clsPassed: number;
    }>(
      `SELECT
          countIf(name = 'LCP') AS lcpTotal,
          countIf(name = 'LCP' AND value <= ${VITAL_GOOD.LCP}) AS lcpPassed,
          countIf(name = 'INP') AS inpTotal,
          countIf(name = 'INP' AND value <= ${VITAL_GOOD.INP}) AS inpPassed,
          countIf(name = 'CLS') AS clsTotal,
          countIf(name = 'CLS' AND value <= ${VITAL_GOOD.CLS}) AS clsPassed
       FROM ${this.ch.getTable('wm_events')}
       WHERE ${clause} AND category = 'web-vital' AND name IN ('LCP', 'INP', 'CLS')`,
      params,
    );
    if (!row) return { lcp: null, inp: null, cls: null, overall: null };
    const rate = (total: number, passed: number): number | null =>
      Number(total) > 0 ? round(Number(passed) / Number(total)) : null;
    const lcp = rate(row.lcpTotal, row.lcpPassed);
    const inp = rate(row.inpTotal, row.inpPassed);
    const cls = rate(row.clsTotal, row.clsPassed);
    const totals = Number(row.lcpTotal) + Number(row.inpTotal) + Number(row.clsTotal);
    const passedSum = Number(row.lcpPassed) + Number(row.inpPassed) + Number(row.clsPassed);
    const overall = rate(totals, passedSum);
    return { lcp, inp, cls, overall };
  }
}

/** SSE 快照流：首帧立即、每 pushIntervalMs 一帧、15s 心跳、断开自动清理 */
@Injectable()
export class ScreenStreamController {
  private readonly logger = new Logger('RealtimeStream');
  private readonly activeConnections = new Set<string>();
  private readonly pushIntervalMs: number;
  private readonly maxClients: number;
  private readonly retryBaseMs: number;

  constructor(
    private readonly snapshots: RealtimeSnapshotService,
    config: ConfigService,
  ) {
    const realtime = (config.get<AppConfig>('') as unknown as AppConfig).realtime;
    this.pushIntervalMs = realtime.pushIntervalMs;
    this.maxClients = realtime.maxClients;
    this.retryBaseMs = realtime.retryBaseMs;
  }

  @SseResponse()
  @Sse(':appKey/stream')
  stream(@Param('appKey') appKey: string): Observable<MessageEvent> {
    // 背压：连接数达上限时在建流前拒绝（503 + Retry-After 由客户端按 retry 语义退避）
    if (this.activeConnections.size >= this.maxClients) {
      throw new HttpException(
        { code: 'REALTIME_CLIENT_LIMIT', message: '实时连接数已达上限', retryAfter: BACKPRESSURE_RETRY_AFTER_S },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    const connectionId = `${appKey}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    return new Observable<MessageEvent>((subscriber) => {
      this.activeConnections.add(connectionId);
      this.logger.log(`sse open (${connectionId}), active=${this.activeConnections.size}`);
      let first = true;
      // 首帧立即（timer 0），其后每 pushIntervalMs 一帧；switchMap 保证上一轮聚合未完成时不叠加
      const subscription = timer(0, this.pushIntervalMs)
        .pipe(
          switchMap(() => this.snapshots.getSnapshot(appKey)),
          map((snapshot) => {
            const retry = first ? this.retryBaseMs : undefined;
            first = false;
            return { type: 'snapshot', data: snapshot, retry } satisfies MessageEvent;
          }),
        )
        .subscribe({
          next: (event) => subscriber.next(event),
          error: (error) => subscriber.error(error),
        });
      // 15s 心跳保活（代理/网关读超时通常 60s）
      const heartbeat = interval(HEARTBEAT_INTERVAL_MS).subscribe(() => {
        try {
          subscriber.next({ type: 'ping', data: 'ping' });
        } catch {
          heartbeat.unsubscribe();
        }
      });
      return () => {
        subscription.unsubscribe();
        heartbeat.unsubscribe();
        this.activeConnections.delete(connectionId);
        this.logger.log(`sse close (${connectionId}), active=${this.activeConnections.size}`);
      };
    });
  }
}

/** REST 快照：首 paint 与 SSE 不可用时的降级通道 */
@Controller('api/v1/realtime/screen')
export class ScreenSnapshotController {
  constructor(private readonly snapshots: RealtimeSnapshotService) {}

  @Get(':appKey/snapshot')
  async snapshot(@Param('appKey') appKey: string): Promise<RealtimeScreenSnapshot> {
    return this.snapshots.getSnapshot(appKey);
  }
}

@Module({
  controllers: [ScreenStreamController, ScreenSnapshotController],
  providers: [RealtimeSnapshotService],
})
export class RealtimeModule {}
