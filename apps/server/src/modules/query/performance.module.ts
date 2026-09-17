import { BadRequestException, Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import type {
  ApiStatItem,
  DimensionStatItem,
  PerformanceSummaryResult,
  ResourceStatItem,
  TrendPoint,
  VitalSummaryItem,
} from '@web-monitor/types';
import { ClickHouseService } from '../../storage/clickhouse.service';
import { buildBaseFilter, parseTimeRange, type RawQuery } from '../../common/query';

/** 允许分组的维度列白名单（防注入） */
const DIMENSION_COLUMNS: Record<string, string> = {
  device: 'device_type',
  brand: 'device_brand',
  browser: 'browser',
  browserVersion: 'browser_ver',
  os: 'os',
  country: 'geo_country',
  region: 'geo_region',
  city: 'geo_city',
  version: 'app_version',
  env: 'env',
  page: 'page_id',
};

const round = (value: unknown, digits = 2): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
};

@Injectable()
export class PerformanceService {
  constructor(private readonly ch: ClickHouseService) {}

  /** 性能概览：Vitals 分位、加载阶段均值、长任务与内存 */
  async summary(query: RawQuery): Promise<PerformanceSummaryResult> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');

    const [vitals, navigation, longTask, fpsStat] = await Promise.all([
      this.ch.query<{
        name: string;
        p50: number;
        p75: number;
        p95: number;
        avg: number;
        samples: number;
        passed: number;
      }>(
        `SELECT name,
                quantile(0.5)(value) AS p50,
                quantile(0.75)(value) AS p75,
                quantile(0.95)(value) AS p95,
                avg(value) AS avg,
                count() AS samples,
                countIf((name = 'LCP' AND value <= 2500) OR (name = 'INP' AND value <= 200) OR (name = 'CLS' AND value <= 0.1)
                        OR (name = 'FCP' AND value <= 1800) OR (name = 'TTFB' AND value <= 800)) AS passed
         FROM ${events}
         WHERE ${clause} AND category = 'web-vital' AND value > 0
         GROUP BY name`,
        params,
      ),
      this.ch.queryOne<Record<string, number>>(
        `SELECT avg(JSONExtractFloat(extra, 'dns')) AS avgDns,
                avg(JSONExtractFloat(extra, 'tcp')) AS avgTcp,
                avg(JSONExtractFloat(extra, 'tls')) AS avgTls,
                avg(JSONExtractFloat(extra, 'request')) AS avgRequest,
                avg(JSONExtractFloat(extra, 'response')) AS avgResponse,
                avg(JSONExtractFloat(extra, 'domParse')) AS avgDomParse,
                avg(JSONExtractFloat(extra, 'load')) AS avgLoad,
                avg(JSONExtractFloat(extra, 'fp')) AS avgFp,
                avg(JSONExtractFloat(extra, 'fmp')) AS avgFmp,
                avg(JSONExtractFloat(extra, 'tti')) AS avgTti,
                count() AS samples
         FROM ${events}
         WHERE ${clause} AND category = 'navigation'`,
        params,
      ),
      this.ch.queryOne<{ avgCount: number; avgTbt: number }>(
        `SELECT avg(JSONExtractFloat(extra, 'count')) AS avgCount,
                avg(JSONExtractFloat(extra, 'tbt')) AS avgTbt
         FROM ${events}
         WHERE ${clause} AND category = 'long-task'`,
        params,
      ),
      this.ch.queryOne<{ avgFps: number }>(
        `SELECT avg(value) AS avgFps FROM ${events} WHERE ${clause} AND category = 'fps'`,
        params,
      ),
    ]);

    const avgUsage = await this.ch.queryOne<{ avgUsage: number; maxUsage: number }>(
      `SELECT avg(value) AS avgUsage, max(value) AS maxUsage
       FROM ${events} WHERE ${clause} AND category = 'memory'`,
      params,
    );

    const vitalItems: VitalSummaryItem[] = vitals.map((row) => ({
      metric: row.name,
      p50: round(row.p50, row.name === 'CLS' ? 4 : 0),
      p75: round(row.p75, row.name === 'CLS' ? 4 : 0),
      p95: round(row.p95, row.name === 'CLS' ? 4 : 0),
      avg: round(row.avg, row.name === 'CLS' ? 4 : 0),
      samples: Number(row.samples),
      passRate: Number(row.samples) ? round(Number(row.passed) / Number(row.samples), 4) : 0,
    }));

    return {
      vitals: vitalItems,
      navigation: {
        avgDns: round(navigation?.avgDns),
        avgTcp: round(navigation?.avgTcp),
        avgTls: round(navigation?.avgTls),
        avgRequest: round(navigation?.avgRequest),
        avgResponse: round(navigation?.avgResponse),
        avgDomParse: round(navigation?.avgDomParse),
        avgLoad: round(navigation?.avgLoad),
        avgFp: round(navigation?.avgFp),
        avgFmp: round(navigation?.avgFmp),
        avgTti: round(navigation?.avgTti),
        samples: Number(navigation?.samples || 0),
      },
      longTask: {
        avgCount: round(longTask?.avgCount),
        avgTbt: round(longTask?.avgTbt),
        avgFps: round(fpsStat?.avgFps ?? 0, 1),
      },
      memory: {
        avgUsage: round(avgUsage?.avgUsage, 4),
        maxUsage: round(avgUsage?.maxUsage, 4),
      },
    };
  }

  /** 指标趋势：按时间桶 + 指标名透视 */
  async trend(query: RawQuery): Promise<{ list: TrendPoint[]; metrics: string[] }> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const categories = (query.category || 'web-vital').split(',').map((item) => item.trim());

    const rows = await this.ch.query<{ time: string; name: string; avg: number; p95: number; count: number }>(
      `SELECT toStartOfInterval(timestamp, ${range.interval}) AS time,
              name,
              avg(value) AS avg,
              quantile(0.95)(value) AS p95,
              count() AS count
       FROM ${events}
       WHERE ${clause} AND category IN {categories:Array(String)} AND value > 0
       GROUP BY time, name
       ORDER BY time`,
      { ...params, categories },
    );

    const map = new Map<string, TrendPoint>();
    const metrics = new Set<string>();
    rows.forEach((row) => {
      const time = String(row.time).replace('T', ' ').slice(0, 19);
      if (!map.has(time)) map.set(time, { time });
      const point = map.get(time)!;
      point[row.name] = round(row.avg, row.name === 'CLS' ? 4 : 0);
      point[`${row.name}_p95`] = round(row.p95, row.name === 'CLS' ? 4 : 0);
      point[`${row.name}_count`] = Number(row.count);
      metrics.add(row.name);
    });

    return {
      list: Array.from(map.values()).sort((a, b) => String(a.time).localeCompare(String(b.time))),
      metrics: Array.from(metrics),
    };
  }

  /** 慢资源排行 */
  async resources(query: RawQuery): Promise<ResourceStatItem[]> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const limit = Math.min(Number(query.limit || 20) || 20, 100);

    const rows = await this.ch.query<any>(
      `SELECT name,
              JSONExtractString(extra, 'initiatorType') AS initiatorType,
              count() AS count,
              avg(value) AS avgDuration,
              quantile(0.95)(value) AS p95,
              avg(JSONExtractFloat(extra, 'transferSize')) AS avgSize
       FROM ${events}
       WHERE ${clause} AND category = 'resource'
       GROUP BY name, initiatorType
       ORDER BY p95 DESC
       LIMIT {limit:UInt32}`,
      { ...params, limit },
    );

    return rows.map((row) => ({
      name: String(row.name),
      initiatorType: String(row.initiatorType || 'other'),
      count: Number(row.count),
      avgDuration: round(row.avgDuration),
      p95: round(row.p95),
      avgSize: Math.round(Number(row.avgSize || 0)),
      failCount: 0,
    }));
  }

  /** 慢接口排行 + 状态码分布 */
  async apis(query: RawQuery): Promise<ApiStatItem[]> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const limit = Math.min(Number(query.limit || 20) || 20, 100);

    const [rows, statusRows] = await Promise.all([
      this.ch.query<any>(
        `SELECT name AS url,
                JSONExtractString(extra, 'method') AS method,
                count() AS count,
                avg(value) AS avgDuration,
                quantile(0.95)(value) AS p95,
                quantile(0.99)(value) AS p99,
                avg(success) AS successRate
         FROM ${events}
         WHERE ${clause} AND category = 'api'
         GROUP BY url, method
         ORDER BY p95 DESC
         LIMIT {limit:UInt32}`,
        { ...params, limit },
      ),
      this.ch.query<any>(
        `SELECT name AS url,
                JSONExtractString(extra, 'method') AS method,
                toString(status) AS status,
                count() AS count
         FROM ${events}
         WHERE ${clause} AND category = 'api'
         GROUP BY url, method, status`,
        params,
      ),
    ]);

    const statusMap = new Map<string, Record<string, number>>();
    statusRows.forEach((row) => {
      const key = `${row.url}|${row.method}`;
      const record = statusMap.get(key) || {};
      record[String(row.status)] = Number(row.count);
      statusMap.set(key, record);
    });

    return rows.map((row) => ({
      url: String(row.url),
      method: String(row.method || 'GET'),
      count: Number(row.count),
      avgDuration: round(row.avgDuration),
      p95: round(row.p95),
      p99: round(row.p99),
      successRate: round(row.successRate, 4),
      statusCodes: statusMap.get(`${row.url}|${row.method}`) || {},
    }));
  }

  /** 慢路由排行（SPA 路由切换耗时） */
  async routes(query: RawQuery): Promise<Array<{ path: string; count: number; avgDuration: number; p95: number }>> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const limit = Math.min(Number(query.limit || 20) || 20, 100);

    const rows = await this.ch.query<any>(
      `SELECT name AS path, count() AS count, avg(value) AS avgDuration, quantile(0.95)(value) AS p95
       FROM ${events}
       WHERE ${clause} AND category = 'route-change'
       GROUP BY path
       ORDER BY p95 DESC
       LIMIT {limit:UInt32}`,
      { ...params, limit },
    );
    return rows.map((row) => ({
      path: String(row.path),
      count: Number(row.count),
      avgDuration: round(row.avgDuration),
      p95: round(row.p95),
    }));
  }

  /** 维度分布：按设备/浏览器/OS/地域/版本对比页面加载耗时 */
  async dimensions(query: RawQuery): Promise<DimensionStatItem[]> {
    const dimension = query.dimension || 'device';
    const column = DIMENSION_COLUMNS[dimension];
    if (!column) {
      throw new BadRequestException(
        `unsupported dimension: ${dimension}, allowed: ${Object.keys(DIMENSION_COLUMNS).join(', ')}`,
      );
    }
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const metricName = query.metric || 'pageLoad';

    const rows = await this.ch.query<any>(
      `SELECT ${column} AS label,
              count() AS count,
              avg(value) AS avgValue,
              quantile(0.95)(value) AS p95
       FROM ${events}
       WHERE ${clause} AND category IN ('navigation', 'web-vital') AND name = {metricName:String}
       GROUP BY label
       ORDER BY count DESC
       LIMIT 30`,
      { ...params, metricName },
    );

    return rows.map((row) => ({
      label: String(row.label || 'unknown'),
      count: Number(row.count),
      avgValue: round(row.avgValue),
      p95: round(row.p95),
    })) as unknown as DimensionStatItem[];
  }
}

@Controller('performance')
export class PerformanceController {
  constructor(private readonly service: PerformanceService) {}

  @Get('summary')
  summary(@Query() query: RawQuery) {
    return this.service.summary(query);
  }

  @Get('trend')
  trend(@Query() query: RawQuery) {
    return this.service.trend(query);
  }

  @Get('resources')
  resources(@Query() query: RawQuery) {
    return this.service.resources(query);
  }

  @Get('apis')
  apis(@Query() query: RawQuery) {
    return this.service.apis(query);
  }

  @Get('routes')
  routes(@Query() query: RawQuery) {
    return this.service.routes(query);
  }

  @Get('dimensions')
  dimensions(@Query() query: RawQuery) {
    return this.service.dimensions(query);
  }
}

@Module({
  controllers: [PerformanceController],
  providers: [PerformanceService],
})
export class PerformanceQueryModule {}
