import { Controller, Get, Module, Query } from '@nestjs/common';
import { Injectable } from '@nestjs/common';
import type { OverviewMetrics, OverviewResult, TrendPoint } from '@web-monitor/types';
import { ClickHouseService } from '../../storage/clickhouse.service';
import { buildBaseFilter, parseTimeRange, type RawQuery, type TimeRange } from '../../common/query';

/** 性能评分：与 @web-monitor/performance 的 computeScore 口径一致（实时大屏模块复用） */
export function computeScore(metrics: Partial<OverviewMetrics>): number {
  const weights: Array<[keyof OverviewMetrics, number, number | undefined, boolean]> = [
    ['avgLcp', 0.3, 2500, false],
    ['avgInp', 0.25, 200, false],
    ['avgCls', 0.2, 0.1, false],
  ];
  let score = 0;
  let weightSum = 0;
  for (const [key, weight, good, higherIsBetter] of weights) {
    const value = metrics[key];
    if (value === undefined || value === null || !Number.isFinite(Number(value))) continue;
    const numeric = Number(value);
    let ratio: number;
    if (higherIsBetter) ratio = numeric;
    else ratio = good ? Math.min(good / Math.max(numeric, 1e-6), 1) : 1;
    score += (ratio > 0.9 ? 100 : ratio > 0.6 ? 60 : 20) * weight;
    weightSum += weight;
  }
  if (!weightSum) return 0;
  return Math.round(score / weightSum);
}

@Injectable()
export class OverviewService {
  constructor(private readonly ch: ClickHouseService) {}

  private async collectMetrics(query: RawQuery, range: TimeRange): Promise<OverviewMetrics> {
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const errors = this.ch.getTable('wm_errors');

    const [traffic, sessionStats, performance, apiStats, errorStats, vitalStats] = await Promise.all([
      this.ch.queryOne<{ pv: number; uv: number; sessions: number }>(
        `SELECT count() AS pv, uniqExact(anonymous_id) AS uv, uniqExact(session_id) AS sessions
         FROM ${events}
         WHERE ${clause} AND category = 'pv'`,
        params,
      ),
      this.ch.queryOne<{ bounceRate: number; avgSessionDuration: number; newUsers: number }>(
        `SELECT
            avgIf(pvCount = 1, 1) AS bounceRate,
            avgIf(sessionDuration > 0, sessionDuration) AS avgSessionDuration
         FROM (
            SELECT session_id, countIf(category = 'pv') AS pvCount,
                   sumIf(value, category = 'stay') AS sessionDuration
            FROM ${events}
            WHERE ${clause}
            GROUP BY session_id
         )`,
        params,
      ),
      this.ch.queryOne<{
        avgPageLoad: number;
        avgLcp: number;
        avgInp: number;
        avgCls: number;
      }>(
        `SELECT
            avgIf(value, category = 'navigation' AND name = 'pageLoad') AS avgPageLoad,
            avgIf(value, category = 'web-vital' AND name = 'LCP') AS avgLcp,
            avgIf(value, category = 'web-vital' AND name = 'INP') AS avgInp,
            avgIf(value, category = 'web-vital' AND name = 'CLS') AS avgCls
         FROM ${events}
         WHERE ${clause}`,
        params,
      ),
      this.ch.queryOne<{ apiSuccessRate: number; avgApiDuration: number }>(
        `SELECT avg(success) AS apiSuccessRate, avg(value) AS avgApiDuration
         FROM ${events}
         WHERE ${clause} AND category = 'api' AND value > 0`,
        params,
      ),
      this.ch.queryOne<{ errorCount: number; affectedUsers: number }>(
        `SELECT count() AS errorCount, uniqExact(anonymous_id) AS affectedUsers
         FROM ${errors}
         WHERE ${clause}`,
        params,
      ),
      this.ch.queryOne<{ total: number; passed: number }>(
        `SELECT count() AS total,
                countIf((name = 'LCP' AND value <= 2500) OR (name = 'INP' AND value <= 200) OR (name = 'CLS' AND value <= 0.1)) AS passed
         FROM ${events}
         WHERE ${clause} AND category = 'web-vital' AND name IN ('LCP', 'INP', 'CLS')`,
        params,
      ),
    ]);

    const newUsers = await this.ch.queryOne<{ count: number }>(
      `SELECT uniqExact(anonymous_id) AS count
       FROM ${events}
       WHERE ${clause}
         AND anonymous_id != ''
         AND anonymous_id NOT IN (
           SELECT DISTINCT anonymous_id FROM ${events}
           WHERE app_key = {appKey:String} AND timestamp < {start:DateTime64(3)} AND anonymous_id != ''
         )`,
      params,
    );

    const pv = Number(traffic?.pv || 0);
    const errorCount = Number(errorStats?.errorCount || 0);
    const metrics: OverviewMetrics = {
      pv,
      uv: Number(traffic?.uv || 0),
      sessions: Number(traffic?.sessions || 0),
      newUsers: Number(newUsers?.count || 0),
      bounceRate: round(Number(sessionStats?.bounceRate || 0), 4),
      avgSessionDuration: Math.round(Number(sessionStats?.avgSessionDuration || 0)),
      errorCount,
      errorRate: pv > 0 ? round(errorCount / pv, 4) : 0,
      affectedUsers: Number(errorStats?.affectedUsers || 0),
      avgPageLoad: Math.round(Number(performance?.avgPageLoad || 0)),
      avgLcp: Math.round(Number(performance?.avgLcp || 0)),
      avgInp: Math.round(Number(performance?.avgInp || 0)),
      avgCls: round(Number(performance?.avgCls || 0), 3),
      vitalsPassRate:
        vitalStats && Number(vitalStats.total) > 0
          ? round(Number(vitalStats.passed) / Number(vitalStats.total), 4)
          : 0,
      score: 0,
      apiSuccessRate: round(Number(apiStats?.apiSuccessRate ?? 0), 4),
      avgApiDuration: Math.round(Number(apiStats?.avgApiDuration || 0)),
    };
    metrics.score = computeScore(metrics);
    return metrics;
  }

  private async collectTrend(query: RawQuery, range: TimeRange): Promise<TrendPoint[]> {
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const errors = this.ch.getTable('wm_errors');
    const interval = range.interval;

    const [eventTrend, errorTrend] = await Promise.all([
      this.ch.query<{ time: string; pv: number; uv: number; apiErrors: number; apiTotal: number }>(
        `SELECT toStartOfInterval(timestamp, ${interval}) AS time,
                countIf(category = 'pv') AS pv,
                uniqExactIf(anonymous_id, category = 'pv') AS uv,
                countIf(category = 'api' AND success = 0) AS apiErrors,
                countIf(category = 'api') AS apiTotal
         FROM ${events}
         WHERE ${clause}
         GROUP BY time
         ORDER BY time`,
        params,
      ),
      this.ch.query<{ time: string; errors: number; errorUsers: number }>(
        `SELECT toStartOfInterval(timestamp, ${interval}) AS time,
                count() AS errors,
                uniqExact(anonymous_id) AS errorUsers
         FROM ${errors}
         WHERE ${clause}
         GROUP BY time
         ORDER BY time`,
        params,
      ),
    ]);

    const errorMap = new Map(errorTrend.map((row) => [normalizeTime(row.time), row]));
    const merged = eventTrend.map((row) => {
      const key = normalizeTime(row.time);
      const errorRow = errorMap.get(key);
      errorMap.delete(key);
      return {
        time: key,
        pv: Number(row.pv || 0),
        uv: Number(row.uv || 0),
        apiErrors: Number(row.apiErrors || 0),
        apiTotal: Number(row.apiTotal || 0),
        errors: Number(errorRow?.errors || 0),
        errorUsers: Number(errorRow?.errorUsers || 0),
      };
    });
    errorMap.forEach((row, time) => {
      merged.push({
        time,
        pv: 0,
        uv: 0,
        apiErrors: 0,
        apiTotal: 0,
        errors: Number(row.errors || 0),
        errorUsers: Number(row.errorUsers || 0),
      });
    });

    return merged
      .sort((a, b) => String(a.time).localeCompare(String(b.time)))
      .map((row) => ({
        ...row,
        errorRate: Number(row.pv) > 0 ? round(Number(row.errors) / Number(row.pv), 4) : 0,
      }));
  }

  async getOverview(query: RawQuery): Promise<OverviewResult> {
    const range = parseTimeRange(query);
    const [metrics, trend] = await Promise.all([
      this.collectMetrics(query, range),
      this.collectTrend(query, range),
    ]);

    // 上一个等长周期，用于环比展示
    const span = range.end.getTime() - range.start.getTime();
    const prevRange: TimeRange = {
      ...range,
      start: new Date(range.start.getTime() - span),
      end: new Date(range.start.getTime()),
    };
    let compare: OverviewResult['compare'];
    try {
      const previous = await this.collectMetrics(query, prevRange);
      compare = {};
      (Object.keys(metrics) as Array<keyof OverviewMetrics>).forEach((key) => {
        const current = Number(metrics[key]);
        const before = Number(previous[key]);
        if (!Number.isFinite(current) || !Number.isFinite(before) || before === 0) return;
        compare![key] = round((current - before) / before, 4);
      });
    } catch {
      compare = undefined;
    }

    return { metrics, compare, trend };
  }
}

function normalizeTime(value: unknown): string {
  return String(value).replace('T', ' ').slice(0, 19);
}

function round(value: number, digits: number): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

@Controller('overview')
export class OverviewController {
  constructor(private readonly service: OverviewService) {}

  @Get()
  get(@Query() query: RawQuery) {
    return this.service.getOverview(query);
  }
}

@Module({
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
