import { Controller, Get, Injectable, Module, NotFoundException, Param, Query } from '@nestjs/common';
import type {
  ErrorGroupItem,
  PagedResult,
  ReplayDataResult,
  ReplayRecord,
  SessionDetailResult,
  SessionItem,
  SessionTimelineItem,
  UserProfileItem,
} from '@web-monitor/types';
import { ClickHouseService } from '../../storage/clickhouse.service';
import { PrismaService } from '../../storage/prisma.service';
import { buildBaseFilter, parsePaging, parseTimeRange, safeParse, type RawQuery } from '../../common/query';

const round = (value: unknown, digits = 0): number => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  const factor = 10 ** digits;
  return Math.round(numeric * factor) / factor;
};

const toIso = (value: unknown): string => {
  const text = String(value).replace(' ', 'T');
  const date = new Date(text.endsWith('Z') ? text : `${text}Z`);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
};

/**
 * 会话与用户细查。
 *
 * 会话不落独立表，直接从事件流聚合而出（见 clickhouse-schema.sql 的说明），
 * 好处是永远不会出现「会话统计与明细对不上」的一致性事故。
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly ch: ClickHouseService,
    private readonly prisma: PrismaService,
  ) {}

  private sessionAggregationSql(where: string): string {
    const eventsTable = this.ch.getTable('wm_events');
    return `SELECT session_id,
                   any(user_id) AS user_id,
                   any(anonymous_id) AS anonymous_id,
                   min(timestamp) AS start_time,
                   max(timestamp) AS end_time,
                   dateDiff('millisecond', min(timestamp), max(timestamp)) AS duration,
                   countIf(category = 'pv') AS page_views,
                   argMin(url, timestamp) AS entry_url,
                   argMax(url, timestamp) AS exit_url,
                   any(device_type) AS device,
                   any(browser) AS browser,
                   any(os) AS os,
                   any(concat(geo_country, ' ', geo_region, ' ', geo_city)) AS geo
            FROM ${eventsTable}
            WHERE ${where}
            GROUP BY session_id`;
  }

  async list(query: RawQuery): Promise<PagedResult<SessionItem>> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const errors = this.ch.getTable('wm_errors');
    const replay = this.ch.getTable('wm_replay');
    const { page, pageSize, offset } = parsePaging(query, 20);

    const conditions = [clause];
    const allParams: Record<string, unknown> = { ...params };
    if (query.userId) {
      conditions.push('(user_id = {userId:String} OR anonymous_id = {userId:String})');
      allParams.userId = query.userId;
    }
    if (query.sessionId) {
      conditions.push('session_id = {sessionId:String}');
      allParams.sessionId = query.sessionId;
    }
    const where = conditions.join(' AND ');

    const [rows, total] = await Promise.all([
      this.ch.query<any>(
        `SELECT * FROM (${this.sessionAggregationSql(where)})
         ORDER BY start_time DESC
         LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
        { ...allParams, limit: pageSize, offset },
      ),
      this.ch.queryOne<{ total: number }>(
        `SELECT uniqExact(session_id) AS total FROM ${events} WHERE ${where}`,
        allParams,
      ),
    ]);

    const sessionIds = rows.map((row) => String(row.session_id));
    if (!sessionIds.length) return { list: [], total: 0, page, pageSize };

    const [errorCounts, replayIds] = await Promise.all([
      this.ch.query<{ session_id: string; count: number }>(
        `SELECT session_id, count() AS count FROM ${errors}
         WHERE app_key = {appKey:String} AND session_id IN {sessionIds:Array(String)}
         GROUP BY session_id`,
        { appKey: query.appKey || '', sessionIds },
      ),
      this.ch.query<{ session_id: string }>(
        `SELECT DISTINCT session_id FROM ${replay}
         WHERE app_key = {appKey:String} AND session_id IN {sessionIds:Array(String)}`,
        { appKey: query.appKey || '', sessionIds },
      ),
    ]);

    const errorMap = new Map(errorCounts.map((row) => [row.session_id, Number(row.count)]));
    const replaySet = new Set(replayIds.map((row) => row.session_id));

    const list: SessionItem[] = rows.map((row) => ({
      sessionId: String(row.session_id),
      userId: row.user_id || undefined,
      anonymousId: String(row.anonymous_id || ''),
      startTime: toIso(row.start_time),
      endTime: toIso(row.end_time),
      duration: round(row.duration),
      pageViews: Number(row.page_views || 0),
      entryUrl: String(row.entry_url || ''),
      exitUrl: String(row.exit_url || ''),
      device: String(row.device || ''),
      browser: String(row.browser || ''),
      os: String(row.os || ''),
      geo: String(row.geo || '').trim() || undefined,
      errorCount: errorMap.get(String(row.session_id)) || 0,
      hasReplay: replaySet.has(String(row.session_id)),
    }));

    return { list, total: Number(total?.total || 0), page, pageSize };
  }

  async detail(sessionId: string, query: RawQuery): Promise<SessionDetailResult> {
    const appKey = query.appKey || '';
    const events = this.ch.getTable('wm_events');
    const errors = this.ch.getTable('wm_errors');
    const replay = this.ch.getTable('wm_replay');

    const sessionRow = await this.ch.queryOne<any>(
      `SELECT * FROM (${this.sessionAggregationSql(
        'app_key = {appKey:String} AND session_id = {sessionId:String}',
      )}) LIMIT 1`,
      { appKey, sessionId },
    );
    if (!sessionRow) throw new NotFoundException(`session ${sessionId} not found`);

    const [eventRows, errorRows, replayRow] = await Promise.all([
      this.ch.query<any>(
        `SELECT timestamp, event_type, category, name, value, page_id, extra, status, success
         FROM ${events}
         WHERE app_key = {appKey:String} AND session_id = {sessionId:String}
         ORDER BY timestamp
         LIMIT 5000`,
        { appKey, sessionId },
      ),
      this.ch.query<any>(
        `SELECT timestamp, message, level, fingerprint, category, page_id, name
         FROM ${errors}
         WHERE app_key = {appKey:String} AND session_id = {sessionId:String}
         ORDER BY timestamp
         LIMIT 500`,
        { appKey, sessionId },
      ),
      this.ch.queryOne<{ count: number }>(
        `SELECT count() AS count FROM ${replay}
         WHERE app_key = {appKey:String} AND session_id = {sessionId:String}`,
        { appKey, sessionId },
      ),
    ]);

    const timeline: SessionTimelineItem[] = [
      ...eventRows.map((row) => this.toTimelineItem(row)),
      ...errorRows.map((row) => ({
        timestamp: String(row.timestamp).replace('T', ' ').slice(0, 23),
        kind: 'error' as const,
        title: `[${row.level}] ${row.message}`,
        detail: String(row.name || ''),
        level: 'error' as const,
        raw: { fingerprint: row.fingerprint, category: row.category, pageId: row.page_id },
      })),
    ].sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    const fingerprints = Array.from(new Set(errorRows.map((row) => String(row.fingerprint))));
    let errorGroups: ErrorGroupItem[] = [];
    if (fingerprints.length) {
      const groups = await this.prisma.errorGroup.findMany({
        where: { appKey, fingerprint: { in: fingerprints } },
      });
      errorGroups = groups.map((group) => ({
        id: group.id,
        fingerprint: group.fingerprint,
        appKey: group.appKey,
        name: group.name,
        message: group.message,
        category: group.category,
        level: group.level,
        status: group.status,
        count: group.count,
        affectedUsers: 0,
        affectedSessions: 0,
        firstSeen: group.firstSeen.toISOString(),
        lastSeen: group.lastSeen.toISOString(),
        appVersions: group.appVersions,
        pages: group.pages,
      }));
    }

    const lcp = eventRows.find((row) => row.category === 'web-vital' && row.name === 'LCP');
    const apiRows = eventRows.filter((row) => row.category === 'api');

    return {
      session: {
        sessionId,
        userId: sessionRow.user_id || undefined,
        anonymousId: String(sessionRow.anonymous_id || ''),
        startTime: toIso(sessionRow.start_time),
        endTime: toIso(sessionRow.end_time),
        duration: round(sessionRow.duration),
        pageViews: Number(sessionRow.page_views || 0),
        entryUrl: String(sessionRow.entry_url || ''),
        exitUrl: String(sessionRow.exit_url || ''),
        device: String(sessionRow.device || ''),
        browser: String(sessionRow.browser || ''),
        os: String(sessionRow.os || ''),
        geo: String(sessionRow.geo || '').trim() || undefined,
        errorCount: errorRows.length,
        hasReplay: Number(replayRow?.count || 0) > 0,
      },
      timeline,
      errors: errorGroups,
      metrics: {
        pv: Number(sessionRow.page_views || 0),
        errorCount: errorRows.length,
        avgApiDuration: apiRows.length
          ? round(apiRows.reduce((sum, row) => sum + Number(row.value || 0), 0) / apiRows.length)
          : 0,
        maxLcp: lcp ? round(lcp.value) : undefined,
      },
    };
  }

  private toTimelineItem(row: any): SessionTimelineItem {
    const category = String(row.category);
    const name = String(row.name || '');
    const extra = safeParse<Record<string, any>>(row.extra, {});
    const timestamp = String(row.timestamp).replace('T', ' ').slice(0, 23);

    const map: Record<string, { kind: SessionTimelineItem['kind']; title: string; detail?: string; level: SessionTimelineItem['level'] }> = {
      pv: { kind: 'pv', title: `访问 ${name}`, detail: extra.title, level: 'info' },
      click: { kind: 'click', title: `点击 ${name}`, detail: extra.text, level: 'info' },
      'route-change': { kind: 'route', title: `路由跳转 → ${name}`, detail: `${Math.round(row.value)}ms`, level: 'info' },
      api: {
        kind: 'request',
        title: `接口 ${extra.method || 'GET'} ${name}`,
        detail: `${row.status} · ${Math.round(row.value)}ms`,
        level: row.success ? 'info' : 'error',
      },
      form: { kind: 'form', title: `表单 ${extra.action || ''} ${name}`, detail: extra.value, level: 'info' },
      console: { kind: 'console', title: `控制台 ${name}`, detail: (extra.args || []).join(' '), level: 'warning' },
      custom: { kind: 'custom', title: `埋点 ${name}`, detail: JSON.stringify(extra.properties || {}), level: 'info' },
      exposure: { kind: 'custom', title: `曝光 ${name}`, detail: `${Math.round(extra.duration || 0)}ms`, level: 'info' },
      stay: { kind: 'custom', title: `停留 ${name}`, detail: `${Math.round((extra.visibleDuration || 0) / 1000)}s`, level: 'info' },
      scroll: { kind: 'custom', title: `滚动 ${Math.round(extra.maxDepth || 0)}%`, level: 'info' },
      'web-vital': { kind: 'custom', title: `${name} = ${round(row.value, name === 'CLS' ? 4 : 0)}`, level: 'info' },
      navigation: { kind: 'custom', title: `页面加载 ${Math.round(row.value)}ms`, level: 'info', detail: undefined },
    };

    const found = map[category];
    if (found) {
      return { timestamp, kind: found.kind, title: found.title, detail: found.detail, level: found.level, raw: { ...extra } };
    }
    return {
      timestamp,
      kind: 'custom',
      title: `${category} ${name}`,
      detail: row.value ? `${round(row.value, 2)}` : undefined,
      level: 'info',
      raw: { ...extra },
    };
  }

  /** 回放数据：合并所有分片并按时间排序，同时带上错误标记 */
  async replay(sessionId: string, query: RawQuery): Promise<ReplayDataResult> {
    const appKey = query.appKey || '';
    const replayTable = this.ch.getTable('wm_replay');
    const errorsTable = this.ch.getTable('wm_errors');

    const [chunks, errorRows] = await Promise.all([
      this.ch.query<any>(
        `SELECT chunk_index, events FROM ${replayTable}
         WHERE app_key = {appKey:String} AND session_id = {sessionId:String}
         ORDER BY chunk_index`,
        { appKey, sessionId },
      ),
      this.ch.query<any>(
        `SELECT timestamp, fingerprint, message FROM ${errorsTable}
         WHERE app_key = {appKey:String} AND session_id = {sessionId:String}
         ORDER BY timestamp LIMIT 200`,
        { appKey, sessionId },
      ),
    ]);

    if (!chunks.length) throw new NotFoundException(`replay for session ${sessionId} not found`);

    const events: ReplayRecord[] = [];
    chunks.forEach((chunk) => {
      const list = safeParse<ReplayRecord[]>(chunk.events, []);
      events.push(...list);
    });
    events.sort((a, b) => a.timestamp - b.timestamp);

    const meta = events.find((event) => event.type === 4);
    const startTime = events.length ? events[0].timestamp : 0;
    const endTime = events.length ? events[events.length - 1].timestamp : 0;

    return {
      sessionId,
      startTime,
      endTime,
      width: Number(meta?.data?.width || 1280),
      height: Number(meta?.data?.height || 720),
      events,
      errorMarks: errorRows.map((row) => ({
        timestamp: new Date(String(row.timestamp).replace(' ', 'T') + 'Z').getTime(),
        errorId: String(row.fingerprint || ''),
        message: String(row.message || ''),
      })),
    };
  }

  /** 用户列表（按匿名 ID 聚合，登录用户取其 userId） */
  async users(query: RawQuery): Promise<PagedResult<UserProfileItem>> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const events = this.ch.getTable('wm_events');
    const errors = this.ch.getTable('wm_errors');
    const { page, pageSize, offset } = parsePaging(query, 20);

    const conditions = [clause];
    const allParams: Record<string, unknown> = { ...params };
    if (query.keyword) {
      conditions.push('(anonymous_id ILIKE {keyword:String} OR user_id ILIKE {keyword:String})');
      allParams.keyword = `%${query.keyword}%`;
    }
    const where = conditions.join(' AND ');

    const [rows, total] = await Promise.all([
      this.ch.query<any>(
        `SELECT anonymous_id,
                any(user_id) AS user_id,
                min(timestamp) AS first_seen,
                max(timestamp) AS last_seen,
                uniqExact(session_id) AS sessions,
                countIf(category = 'pv') AS pv,
                groupUniqArray(device_type) AS devices,
                groupUniqArray(browser) AS browsers,
                any(concat(geo_country, ' ', geo_region, ' ', geo_city)) AS geo
         FROM ${events}
         WHERE ${where} AND anonymous_id != ''
         GROUP BY anonymous_id
         ORDER BY last_seen DESC
         LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
        { ...allParams, limit: pageSize, offset },
      ),
      this.ch.queryOne<{ total: number }>(
        `SELECT uniqExact(anonymous_id) AS total FROM ${events} WHERE ${where} AND anonymous_id != ''`,
        allParams,
      ),
    ]);

    const ids = rows.map((row) => String(row.anonymous_id));
    const errorCounts = ids.length
      ? await this.ch.query<{ anonymous_id: string; count: number }>(
          `SELECT anonymous_id, count() AS count FROM ${errors}
           WHERE app_key = {appKey:String} AND anonymous_id IN {ids:Array(String)}
           GROUP BY anonymous_id`,
          { appKey: query.appKey || '', ids },
        )
      : [];
    const errorMap = new Map(errorCounts.map((row) => [row.anonymous_id, Number(row.count)]));

    const list: UserProfileItem[] = rows.map((row) => ({
      userId: row.user_id || undefined,
      anonymousId: String(row.anonymous_id),
      firstSeen: toIso(row.first_seen),
      lastSeen: toIso(row.last_seen),
      sessions: Number(row.sessions || 0),
      pv: Number(row.pv || 0),
      errorCount: errorMap.get(String(row.anonymous_id)) || 0,
      devices: (row.devices || []).filter(Boolean),
      browsers: (row.browsers || []).filter(Boolean),
      geo: String(row.geo || '').trim() || undefined,
    }));

    return { list, total: Number(total?.total || 0), page, pageSize };
  }
}

@Controller()
export class SessionsController {
  constructor(private readonly service: SessionsService) {}

  @Get('sessions')
  list(@Query() query: RawQuery) {
    return this.service.list(query);
  }

  @Get('sessions/:sessionId/replay')
  replay(@Param('sessionId') sessionId: string, @Query() query: RawQuery) {
    return this.service.replay(sessionId, query);
  }

  @Get('sessions/:sessionId')
  detail(@Param('sessionId') sessionId: string, @Query() query: RawQuery) {
    return this.service.detail(sessionId, query);
  }

  @Get('users')
  users(@Query() query: RawQuery) {
    return this.service.users(query);
  }
}

@Module({
  controllers: [SessionsController],
  providers: [SessionsService],
})
export class SessionsQueryModule {}
