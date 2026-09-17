import { Body, Controller, Get, Injectable, Module, Post, Query } from '@nestjs/common';
import type {
  BehaviorEventItem,
  BehaviorPathNode,
  FunnelResult,
  FunnelStep,
  HeatmapPoint,
  PageBehaviorStatItem,
  PagedResult,
  TrendPoint,
} from '@web-monitor/types';
import { ClickHouseService } from '../../storage/clickhouse.service';
import { buildBaseFilter, parsePaging, parseTimeRange, safeParse, type RawQuery } from '../../common/query';

const round = (value: unknown, digits = 2): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
};

const normalizeTime = (value: unknown): string => String(value).replace('T', ' ').slice(0, 19);

@Injectable()
export class BehaviorService {
  constructor(private readonly ch: ClickHouseService) {}

  /** 页面排行：PV/UV/停留/滚动深度/退出率 */
  async pages(query: RawQuery): Promise<PageBehaviorStatItem[]> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const limit = Math.min(Number(query.limit || 50) || 50, 200);

    const [pvRows, stayRows, exitRows] = await Promise.all([
      this.ch.query<any>(
        `SELECT name AS path, count() AS pv, uniqExact(anonymous_id) AS uv, uniqExact(session_id) AS sessions
         FROM ${events}
         WHERE ${clause} AND category = 'pv'
         GROUP BY path
         ORDER BY pv DESC
         LIMIT {limit:UInt32}`,
        { ...params, limit },
      ),
      this.ch.query<any>(
        `SELECT name AS path,
                avg(value) AS avgDuration,
                avg(JSONExtractFloat(extra, 'maxScrollDepth')) AS avgScrollDepth
         FROM ${events}
         WHERE ${clause} AND category = 'stay'
         GROUP BY path`,
        params,
      ),
      this.ch.query<any>(
        `SELECT path, count() AS exits FROM (
            SELECT session_id, argMax(name, timestamp) AS path
            FROM ${events}
            WHERE ${clause} AND category = 'pv'
            GROUP BY session_id
         )
         GROUP BY path`,
        params,
      ),
    ]);

    const stayMap = new Map(stayRows.map((row) => [String(row.path), row]));
    const exitMap = new Map(exitRows.map((row) => [String(row.path), Number(row.exits)]));

    return pvRows.map((row) => {
      const path = String(row.path);
      const stay = stayMap.get(path);
      const pv = Number(row.pv);
      return {
        path,
        pv,
        uv: Number(row.uv),
        avgDuration: round(stay?.avgDuration, 0),
        avgScrollDepth: round(stay?.avgScrollDepth, 0),
        bounceRate: pv > 0 ? round(Number(exitMap.get(path) || 0) / pv, 4) : 0,
        exitRate: pv > 0 ? round(Number(exitMap.get(path) || 0) / pv, 4) : 0,
      };
    });
  }

  /** 行为趋势（PV / UV / 点击数 / 自定义埋点数） */
  async trend(query: RawQuery): Promise<TrendPoint[]> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');

    const rows = await this.ch.query<any>(
      `SELECT toStartOfInterval(timestamp, ${range.interval}) AS time,
              countIf(category = 'pv') AS pv,
              uniqExactIf(anonymous_id, category = 'pv') AS uv,
              countIf(category = 'click') AS clicks,
              countIf(category = 'exposure') AS exposures,
              uniqExactIf(session_id, category = 'pv') AS sessions,
              countIf(event_type = 'custom') AS customs
       FROM ${events}
       WHERE ${clause}
       GROUP BY time
       ORDER BY time`,
      params,
    );

    return rows.map((row) => ({
      time: normalizeTime(row.time),
      pv: Number(row.pv),
      uv: Number(row.uv),
      clicks: Number(row.clicks),
      exposures: Number(row.exposures),
      sessions: Number(row.sessions),
      customs: Number(row.customs),
    }));
  }

  /** 事件明细检索 */
  async events(query: RawQuery): Promise<PagedResult<BehaviorEventItem>> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const { page, pageSize, offset } = parsePaging(query, 30);

    const conditions = [clause];
    const allParams: Record<string, unknown> = { ...params };
    if (query.category) {
      conditions.push('category = {category:String}');
      allParams.category = query.category;
    }
    if (query.eventName) {
      conditions.push('name = {eventName:String}');
      allParams.eventName = query.eventName;
    }
    if (query.sessionId) {
      conditions.push('session_id = {sessionId:String}');
      allParams.sessionId = query.sessionId;
    }
    if (query.userId) {
      conditions.push('(user_id = {userId:String} OR anonymous_id = {userId:String})');
      allParams.userId = query.userId;
    }
    if (query.keyword) {
      conditions.push('(name ILIKE {keyword:String} OR extra ILIKE {keyword:String})');
      allParams.keyword = `%${query.keyword}%`;
    }
    const where = conditions.join(' AND ');

    const [rows, total] = await Promise.all([
      this.ch.query<any>(
        `SELECT * FROM ${events}
         WHERE ${where}
         ORDER BY timestamp DESC
         LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
        { ...allParams, limit: pageSize, offset },
      ),
      this.ch.queryOne<{ total: number }>(`SELECT count() AS total FROM ${events} WHERE ${where}`, allParams),
    ]);

    const list: BehaviorEventItem[] = rows.map((row) => {
      const extra = safeParse<Record<string, any>>(row.extra, {});
      return {
        id: `${row.timestamp}-${row.session_id}-${row.category}`,
        timestamp: String(row.timestamp).replace('T', ' ').slice(0, 23),
        sessionId: row.session_id,
        userId: row.user_id || undefined,
        anonymousId: row.anonymous_id,
        pageId: row.page_id,
        category: row.category,
        type: row.event_type,
        summary: this.buildSummary(String(row.category), String(row.name), extra),
        payload: { name: row.name, value: row.value, ...extra },
      };
    });

    return { list, total: Number(total?.total || 0), page, pageSize };
  }

  private buildSummary(category: string, name: string, extra: Record<string, any>): string {
    switch (category) {
      case 'click':
        return `点击 ${name}${extra.text ? ` 「${extra.text}」` : ''}`;
      case 'pv':
        return `访问页面 ${name}`;
      case 'route-change':
        return `路由跳转 → ${name}`;
      case 'exposure':
        return `曝光 ${name}（${Math.round((extra.ratio || 0) * 100)}%，${Math.round(extra.duration || 0)}ms）`;
      case 'scroll':
        return `滚动至 ${Math.round(extra.maxDepth || 0)}%`;
      case 'form':
        return `表单 ${extra.action || ''} ${name}`;
      case 'custom':
        return `埋点 ${name}`;
      case 'console':
        return `控制台 ${name}`;
      case 'stay':
        return `停留 ${Math.round((extra.visibleDuration || 0) / 1000)}s`;
      case 'api':
        return `接口 ${name}`;
      default:
        return `${category} ${name}`;
    }
  }

  /** 用户路径：取每个会话的页面序列，统计 Top 路径 */
  async paths(query: RawQuery): Promise<BehaviorPathNode[]> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const limit = Math.min(Number(query.limit || 1000) || 1000, 5000);

    const rows = await this.ch.query<{ path: string[] }>(
      `SELECT groupArray(name) AS path FROM (
          SELECT session_id, name
          FROM ${events}
          WHERE ${clause} AND category = 'pv'
          ORDER BY session_id, timestamp
          LIMIT {limit:UInt32}
       )
       GROUP BY session_id`,
      { ...params, limit },
    );

    const counter = new Map<string, { count: number; steps: string[] }>();
    rows.forEach((row) => {
      const steps = (row.path || []).filter(Boolean);
      if (!steps.length) return;
      // 路径长度限制，避免长尾导致聚合爆炸
      const truncated = steps.slice(0, 8);
      const key = truncated.join(' → ');
      const found = counter.get(key);
      if (found) found.count++;
      else counter.set(key, { count: 1, steps: truncated });
    });

    return Array.from(counter.values())
      .sort((a, b) => b.count - a.count)
      .slice(0, 50)
      .map((item) => ({ path: item.steps.join(' → '), count: item.count }));
  }

  /**
   * 漏斗分析。
   * 实现方式：拉取相关事件流后在服务端按会话顺序推进漏斗，
   * 保证「步骤顺序」语义正确（无序集合计数会高估转化率）。
   */
  async funnel(query: RawQuery, steps: FunnelStep[]): Promise<FunnelResult> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const definitions = (steps || []).filter((step) => step?.match?.value);
    if (!definitions.length) return { steps: [], total: 0 };

    const stepNames = Array.from(new Set(definitions.map((step) => step.match.value)));
    const rows = await this.ch.query<{ session_id: string; name: string; category: string; timestamp: string }>(
      `SELECT session_id, name, category, timestamp
       FROM ${events}
       WHERE ${clause} AND name IN {stepNames:Array(String)}
       ORDER BY session_id, timestamp
       LIMIT 200000`,
      { ...params, stepNames },
    );

    const sessions = new Map<string, Array<{ name: string; category: string }>>();
    rows.forEach((row) => {
      const list = sessions.get(row.session_id) || [];
      list.push({ name: row.name, category: row.category });
      sessions.set(row.session_id, list);
    });

    const counters = new Array(definitions.length).fill(0);
    let total = 0;

    sessions.forEach((sequence) => {
      let stepIndex = 0;
      for (const event of sequence) {
        if (stepIndex >= definitions.length) break;
        const step = definitions[stepIndex];
        const isPageStep = step.match.type === 'page';
        const matches = isPageStep
          ? event.category === 'pv' && event.name === step.match.value
          : event.name === step.match.value && event.category !== 'pv';
        if (matches) {
          counters[stepIndex]++;
          stepIndex++;
        }
      }
    });

    total = counters[0] || 0;
    const result: FunnelStep[] = definitions.map((step, index) => ({
      name: step.name || step.match.value,
      match: step.match,
      count: counters[index],
      rate: total > 0 ? round(counters[index] / total, 4) : 0,
    }));

    return { steps: result, total };
  }

  /** 点击热力图（坐标聚合到 10px 网格） */
  async heatmap(query: RawQuery): Promise<HeatmapPoint[]> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const pageId = query.pageId || '';

    const rows = await this.ch.query<any>(
      `SELECT intDiv(JSONExtractInt(extra, 'pageX'), 10) * 10 AS x,
              intDiv(JSONExtractInt(extra, 'pageY'), 10) * 10 AS y,
              count() AS count
       FROM ${events}
       WHERE ${clause} AND category = 'click' AND page_id = {pageId:String}
       GROUP BY x, y
       HAVING count > 0
       ORDER BY count DESC
       LIMIT 3000`,
      { ...params, pageId },
    );

    return rows.map((row) => ({
      x: Number(row.x),
      y: Number(row.y),
      count: Number(row.count),
    }));
  }
}

@Controller('behavior')
export class BehaviorController {
  constructor(private readonly service: BehaviorService) {}

  @Get('pages')
  pages(@Query() query: RawQuery) {
    return this.service.pages(query);
  }

  @Get('trend')
  trend(@Query() query: RawQuery) {
    return this.service.trend(query);
  }

  @Get('events')
  events(@Query() query: RawQuery) {
    return this.service.events(query);
  }

  @Get('paths')
  paths(@Query() query: RawQuery) {
    return this.service.paths(query);
  }

  @Get('heatmap')
  heatmap(@Query() query: RawQuery) {
    return this.service.heatmap(query);
  }

  @Post('funnel')
  funnel(@Query() query: RawQuery, @Body() body: { steps: FunnelStep[] }) {
    return this.service.funnel(query, body?.steps || []);
  }
}

@Module({
  controllers: [BehaviorController],
  providers: [BehaviorService],
})
export class BehaviorQueryModule {}
