import { Body, Controller, Get, Injectable, Module, Param, Patch, Query } from '@nestjs/common';
import type {
  Breadcrumb,
  DimensionStatItem,
  ErrorDetailEvent,
  ErrorDetailResult,
  ErrorGroupItem,
  PagedResult,
  StackFrame,
  TrendPoint,
} from '@web-monitor/types';
import { ClickHouseService } from '../../storage/clickhouse.service';
import { PrismaService } from '../../storage/prisma.service';
import {
  buildBaseFilter,
  parsePaging,
  parseTimeRange,
  safeParse,
  type RawQuery,
} from '../../common/query';
import { SourceMapService } from '../sourcemap/sourcemap.module';

@Injectable()
export class ErrorsService {
  constructor(
    private readonly ch: ClickHouseService,
    private readonly prisma: PrismaService,
    private readonly sourceMap: SourceMapService,
  ) {}

  /**
   * 错误列表。
   *
   * PG 负责「分组实体 + 状态流转 + 过滤」，CH 负责「影响面与趋势」的精确统计，
   * 两边通过 fingerprint 在应用层合并——避免跨库 JOIN 带来的复杂度与性能问题。
   */
  async list(query: RawQuery): Promise<PagedResult<ErrorGroupItem>> {
    const appKey = query.appKey || '';
    const { page, pageSize, offset } = parsePaging(query);
    const range = parseTimeRange(query);

    const where: Record<string, any> = { appKey };
    if (query.status) where.status = query.status;
    if (query.category) where.category = query.category;
    if (query.level) where.level = query.level;
    if (query.appVersion) where.appVersions = { has: query.appVersion };
    if (query.keyword) {
      where.OR = [
        { message: { contains: query.keyword, mode: 'insensitive' } },
        { name: { contains: query.keyword, mode: 'insensitive' } },
        { fingerprint: { contains: query.keyword } },
      ];
    }

    const [groups, total] = await Promise.all([
      this.prisma.errorGroup.findMany({
        where,
        orderBy: { lastSeen: 'desc' },
        skip: offset,
        take: pageSize,
      }),
      this.prisma.errorGroup.count({ where }),
    ]);

    if (!groups.length) return { list: [], total, page, pageSize };

    const fingerprints = groups.map((group) => group.fingerprint);
    const { clause, params } = buildBaseFilter(query, range);
    const errorsTable = this.ch.getTable('wm_errors');

    const [stats, trendRows] = await Promise.all([
      this.ch.query<{ fingerprint: string; count: number; users: number; sessions: number }>(
        `SELECT fingerprint,
                count() AS count,
                uniqExact(anonymous_id) AS users,
                uniqExact(session_id) AS sessions
         FROM ${errorsTable}
         WHERE ${clause} AND fingerprint IN {fingerprints:Array(String)}
         GROUP BY fingerprint`,
        { ...params, fingerprints },
      ),
      // 迷你趋势（7 天按天），用于列表内联展示
      this.ch.query<{ fingerprint: string; time: string; count: number }>(
        `SELECT fingerprint,
                toStartOfInterval(timestamp, INTERVAL 1 DAY) AS time,
                count() AS count
         FROM ${errorsTable}
         WHERE ${clause} AND fingerprint IN {fingerprints:Array(String)}
         GROUP BY fingerprint, time
         ORDER BY time`,
        { ...params, fingerprints },
      ),
    ]);

    const statMap = new Map(stats.map((row) => [row.fingerprint, row]));
    const trendMap = new Map<string, number[]>();
    trendRows.forEach((row) => {
      const list = trendMap.get(row.fingerprint) || [];
      list.push(Number(row.count));
      trendMap.set(row.fingerprint, list);
    });

    const list: ErrorGroupItem[] = groups.map((group) => {
      const stat = statMap.get(group.fingerprint);
      return {
        id: group.id,
        fingerprint: group.fingerprint,
        appKey: group.appKey,
        name: group.name,
        message: group.message,
        category: group.category,
        level: group.level,
        status: group.status,
        count: Number(stat?.count || group.count),
        affectedUsers: Number(stat?.users || 0),
        affectedSessions: Number(stat?.sessions || 0),
        firstSeen: group.firstSeen.toISOString(),
        lastSeen: group.lastSeen.toISOString(),
        appVersions: group.appVersions,
        pages: group.pages,
        assignee: group.assignee || undefined,
        note: group.note || undefined,
        spark: trendMap.get(group.fingerprint) || [],
      };
    });

    return { list, total, page, pageSize };
  }

  /** 错误趋势 */
  async trend(query: RawQuery): Promise<TrendPoint[]> {
    const range = parseTimeRange(query);
    const { clause, params } = buildBaseFilter(query, range);
    const errorsTable = this.ch.getTable('wm_errors');
    const rows = await this.ch.query<{ time: string; errors: number; users: number; groups: number }>(
      `SELECT toStartOfInterval(timestamp, ${range.interval}) AS time,
              count() AS errors,
              uniqExact(anonymous_id) AS users,
              uniqExact(fingerprint) AS groups
       FROM ${errorsTable}
       WHERE ${clause}
       GROUP BY time
       ORDER BY time`,
      params,
    );
    return rows.map((row) => ({
      time: String(row.time).replace('T', ' ').slice(0, 19),
      errors: Number(row.errors),
      users: Number(row.users),
      groups: Number(row.groups),
    }));
  }

  /** 错误详情：分组信息 + SourceMap 还原堆栈 + 分布 + 最近事件 */
  async detail(id: string, query: RawQuery): Promise<ErrorDetailResult> {
    const group = await this.prisma.errorGroup.findUnique({ where: { id } });
    if (!group) {
      throw new Error(`error group ${id} not found`);
    }

    const range = parseTimeRange({ ...query, appKey: group.appKey });
    const { clause, params } = buildBaseFilter({ ...query, appKey: group.appKey }, range);
    const errorsTable = this.ch.getTable('wm_errors');
    const { page, pageSize, offset } = parsePaging(query, 20);

    const groupClause = `${clause} AND fingerprint = {fingerprint:String}`;
    const groupParams = { ...params, fingerprint: group.fingerprint };

    const [stat, events, total, distribution, trendRows, framesRow] = await Promise.all([
      this.ch.queryOne<{ count: number; users: number; sessions: number; first: string; last: string }>(
        `SELECT count() AS count, uniqExact(anonymous_id) AS users, uniqExact(session_id) AS sessions,
                min(timestamp) AS first, max(timestamp) AS last
         FROM ${errorsTable} WHERE ${groupClause}`,
        groupParams,
      ),
      this.ch.query<any>(
        `SELECT * FROM ${errorsTable}
         WHERE ${groupClause}
         ORDER BY timestamp DESC
         LIMIT {limit:UInt32} OFFSET {offset:UInt32}`,
        { ...groupParams, limit: pageSize, offset },
      ),
      this.ch.queryOne<{ total: number }>(
        `SELECT count() AS total FROM ${errorsTable} WHERE ${groupClause}`,
        groupParams,
      ),
      this.ch.query<any>(
        `SELECT 'page' AS dim, page_id AS label, count() AS count, 0 AS avgValue FROM ${errorsTable} WHERE ${groupClause} GROUP BY label
         UNION ALL
         SELECT 'browser' AS dim, browser AS label, count() AS count, 0 AS avgValue FROM ${errorsTable} WHERE ${groupClause} GROUP BY label
         UNION ALL
         SELECT 'os' AS dim, os AS label, count() AS count, 0 AS avgValue FROM ${errorsTable} WHERE ${groupClause} GROUP BY label
         UNION ALL
         SELECT 'device' AS dim, device_type AS label, count() AS count, 0 AS avgValue FROM ${errorsTable} WHERE ${groupClause} GROUP BY label
         UNION ALL
         SELECT 'version' AS dim, app_version AS label, count() AS count, 0 AS avgValue FROM ${errorsTable} WHERE ${groupClause} GROUP BY label`,
        groupParams,
      ),
      this.ch.query<{ time: string; count: number }>(
        `SELECT toStartOfInterval(timestamp, ${range.interval}) AS time, count() AS count
         FROM ${errorsTable} WHERE ${groupClause} GROUP BY time ORDER BY time`,
        groupParams,
      ),
      this.ch.queryOne<{ frames: string; stack: string; filename: string; lineno: number; colno: number; app_version: string }>(
        `SELECT frames, stack, filename, lineno, colno, app_version
         FROM ${errorsTable} WHERE ${groupClause}
         ORDER BY timestamp DESC LIMIT 1`,
        groupParams,
      ),
    ]);

    let frames = safeParse<StackFrame[]>(framesRow?.frames, []);
    const rawStack = framesRow?.stack || undefined;
    // SourceMap 还原：命中则覆盖 frames，未命中保持原始压缩堆栈
    if (frames.length && framesRow?.app_version) {
      frames = await this.sourceMap.resolveFrames(group.appKey, framesRow.app_version, frames);
    }

    const dims = {
      byPage: [] as DimensionStatItem[],
      byBrowser: [] as DimensionStatItem[],
      byOs: [] as DimensionStatItem[],
      byDevice: [] as DimensionStatItem[],
      byVersion: [] as DimensionStatItem[],
    };
    distribution.forEach((row) => {
      const item: DimensionStatItem = {
        label: String(row.label || 'unknown'),
        count: Number(row.count),
        avgValue: 0,
      };
      if (row.dim === 'page') dims.byPage.push(item);
      else if (row.dim === 'browser') dims.byBrowser.push(item);
      else if (row.dim === 'os') dims.byOs.push(item);
      else if (row.dim === 'device') dims.byDevice.push(item);
      else dims.byVersion.push(item);
    });
    Object.values(dims).forEach((list) =>
      list.sort((a, b) => Number(b.count) - Number(a.count)),
    );

    const detailEvents: ErrorDetailEvent[] = events.map((row) => ({
      id: `${row.timestamp}-${row.session_id}`,
      timestamp: String(row.timestamp).replace('T', ' ').slice(0, 23),
      sessionId: row.session_id,
      userId: row.user_id || undefined,
      anonymousId: row.anonymous_id,
      pageId: row.page_id,
      url: row.url,
      appVersion: row.app_version || undefined,
      env: row.env,
      devices: row.device_type,
      browsers: row.browser,
      os: row.os,
      breadcrumbs: safeParse<Breadcrumb[]>(row.breadcrumbs, []),
      snapshot: safeParse<any>(row.snapshot, undefined),
      raw: safeParse<any>(row.extra, {}),
    }));

    return {
      group: {
        id: group.id,
        fingerprint: group.fingerprint,
        appKey: group.appKey,
        name: group.name,
        message: group.message,
        category: group.category,
        level: group.level,
        status: group.status,
        count: Number(stat?.count || group.count),
        affectedUsers: Number(stat?.users || 0),
        affectedSessions: Number(stat?.sessions || 0),
        firstSeen: (stat?.first ? new Date(stat.first).toISOString() : group.firstSeen.toISOString()),
        lastSeen: (stat?.last ? new Date(stat.last).toISOString() : group.lastSeen.toISOString()),
        appVersions: group.appVersions,
        pages: group.pages,
        assignee: group.assignee || undefined,
        note: group.note || undefined,
      },
      frames,
      rawStack,
      distribution: dims,
      events: {
        list: detailEvents,
        total: Number(total?.total || 0),
        page,
        pageSize,
      },
      trend: trendRows.map((row) => ({
        time: String(row.time).replace('T', ' ').slice(0, 19),
        count: Number(row.count),
      })),
    };
  }

  /** 状态流转（待处理 / 已修复 / 已忽略） */
  async updateStatus(id: string, body: { status: string; assignee?: string; note?: string }) {
    return this.prisma.errorGroup.update({
      where: { id },
      data: {
        status: body.status,
        assignee: body.assignee,
        note: body.note,
      },
    });
  }
}

@Controller('errors')
export class ErrorsController {
  constructor(private readonly service: ErrorsService) {}

  @Get()
  list(@Query() query: RawQuery) {
    return this.service.list(query);
  }

  @Get('trend')
  trend(@Query() query: RawQuery) {
    return this.service.trend(query);
  }

  @Get(':id')
  detail(@Param('id') id: string, @Query() query: RawQuery) {
    return this.service.detail(id, query);
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: { status: string; assignee?: string; note?: string },
  ) {
    return this.service.updateStatus(id, body);
  }
}

@Module({
  imports: [],
  controllers: [ErrorsController],
  providers: [ErrorsService, SourceMapService],
})
export class ErrorsQueryModule {}
