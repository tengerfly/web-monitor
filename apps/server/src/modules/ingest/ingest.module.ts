import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Injectable,
  Logger,
  Module,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { randomUUID } from 'node:crypto';
import type { Request } from 'express';
import { EventType, type GeoInfo, type IngestPayload } from '@web-monitor/types';
import { ClickHouseService } from '../../storage/clickhouse.service';
import { PrismaService } from '../../storage/prisma.service';
import {
  mapErrorToRow,
  mapEventToRow,
  mapReplayToRow,
  type ErrorRow,
  type EventRow,
  type ReplayRow,
} from './event-mapper';

interface ProjectLite {
  appKey: string;
  name: string;
  sampleRate: number;
  plugins: Record<string, boolean>;
  pluginConfig: Record<string, any>;
  maskRules: Record<string, any>;
  envs: string[];
}

export interface IngestResult {
  accepted: number;
  dropped: number;
  sampleRate: number;
  invalid?: boolean;
}

/**
 * 上报网关。
 *
 * 设计要点：
 *  - 请求内只做「校验 + 映射 + 入队式写入」，不做重计算，保证网关吞吐
 *  - 错误分组计数用一条原子 UPSERT 完成，避免读-改-写竞态
 *  - appKey 校验结果本地缓存 60s，避免每批上报都打 PG
 */
@Injectable()
export class IngestService {
  private readonly logger = new Logger('Ingest');
  private readonly projectCache = new Map<string, { project: ProjectLite | null; expireAt: number }>();
  private static readonly CACHE_TTL = 60_000;
  private static readonly MAX_ARRAY_ITEMS = 50;

  constructor(
    private readonly ch: ClickHouseService,
    private readonly prisma: PrismaService,
  ) {}

  async getProject(appKey: string): Promise<ProjectLite | null> {
    const cached = this.projectCache.get(appKey);
    if (cached && cached.expireAt > Date.now()) return cached.project;

    let project: ProjectLite | null = null;
    try {
      const found = await this.prisma.project.findUnique({ where: { appKey } });
      if (found) {
        project = {
          appKey: found.appKey,
          name: found.name,
          sampleRate: found.sampleRate,
          plugins: (found.plugins || {}) as Record<string, boolean>,
          pluginConfig: (found.pluginConfig || {}) as Record<string, any>,
          maskRules: (found.maskRules || {}) as Record<string, any>,
          envs: found.envs || [],
        };
      }
    } catch (error) {
      this.logger.error(`load project ${appKey} failed: ${(error as Error).message}`);
      return null;
    }

    this.projectCache.set(appKey, { project, expireAt: Date.now() + IngestService.CACHE_TTL });
    return project;
  }

  invalidateProject(appKey: string): void {
    this.projectCache.delete(appKey);
  }

  /** 处理一批上报 */
  async ingest(payload: IngestPayload, geo: GeoInfo): Promise<IngestResult> {
    const events = Array.isArray(payload?.events) ? payload.events : [];
    const project = payload?.appKey ? await this.getProject(payload.appKey) : null;
    if (!project) {
      return { accepted: 0, dropped: events.length, sampleRate: 0, invalid: true };
    }
    if (!payload.common) {
      return { accepted: 0, dropped: events.length, sampleRate: project.sampleRate, invalid: true };
    }

    const eventRows: EventRow[] = [];
    const errorRows: ErrorRow[] = [];
    const replayRows: ReplayRow[] = [];
    let dropped = 0;

    for (const event of events) {
      try {
        if (!event || !event.type || !event.category) {
          dropped++;
          continue;
        }
        if (event.type === EventType.Error) {
          errorRows.push(mapErrorToRow(event, payload.common, geo, project.appKey));
        } else if (event.type === EventType.Replay) {
          const row = mapReplayToRow(event, payload.common, project.appKey);
          if (row) replayRows.push(row);
        } else {
          const row = mapEventToRow(event, payload.common, geo, project.appKey);
          if (row) eventRows.push(row);
          else dropped++;
        }
      } catch (error) {
        dropped++;
        this.logger.warn(`map event failed: ${(error as Error).message}`);
      }
    }

    await Promise.all([
      this.ch.insert('wm_events', eventRows),
      this.ch.insert('wm_errors', errorRows),
      this.ch.insert('wm_replay', replayRows),
    ]);

    if (errorRows.length) {
      // 错误分组更新失败不应影响上报成功语义，异步补偿
      void this.upsertErrorGroups(project.appKey, errorRows).catch((error) =>
        this.logger.error(`upsert error groups failed: ${(error as Error).message}`),
      );
    }

    return {
      accepted: eventRows.length + errorRows.length + replayRows.length,
      dropped,
      sampleRate: project.sampleRate,
    };
  }

  /**
   * 按指纹聚合错误分组。
   * 使用 PostgreSQL UPSERT 保证并发下的计数正确性，并通过数组去重维护版本/页面分布。
   */
  private async upsertErrorGroups(appKey: string, rows: ErrorRow[]): Promise<void> {
    const grouped = new Map<string, {
      fingerprint: string;
      count: number;
      name: string;
      message: string;
      category: string;
      level: string;
      firstSeen: string;
      lastSeen: string;
      pages: string[];
      versions: string[];
    }>();

    for (const row of rows) {
      const existing = grouped.get(row.fingerprint);
      if (existing) {
        existing.count++;
        if (row.message && !existing.message) existing.message = row.message;
        if (row.page_id) existing.pages.push(row.page_id);
        if (row.app_version) existing.versions.push(row.app_version);
        if (row.timestamp > existing.lastSeen) existing.lastSeen = row.timestamp;
        continue;
      }
      grouped.set(row.fingerprint, {
        fingerprint: row.fingerprint,
        count: 1,
        name: row.name || 'Error',
        message: row.message || '',
        category: row.category,
        level: row.level || 'error',
        firstSeen: row.timestamp,
        lastSeen: row.timestamp,
        pages: row.page_id ? [row.page_id] : [],
        versions: row.app_version ? [row.app_version] : [],
      });
    }

    for (const group of grouped.values()) {
      const pages = Array.from(new Set(group.pages)).slice(0, IngestService.MAX_ARRAY_ITEMS);
      const versions = Array.from(new Set(group.versions)).slice(0, IngestService.MAX_ARRAY_ITEMS);
      await this.prisma.$executeRaw`
        INSERT INTO error_groups
          (id, app_key, fingerprint, name, message, category, level, status, count, app_versions, pages, first_seen, last_seen)
        VALUES
          (${randomUUID()}, ${appKey}, ${group.fingerprint}, ${group.name}, ${group.message},
           ${group.category}, ${group.level}, 'pending', ${group.count}, ${versions}, ${pages},
           ${new Date(group.firstSeen)}, ${new Date(group.lastSeen)})
        ON CONFLICT (app_key, fingerprint) DO UPDATE SET
          count = error_groups.count + EXCLUDED.count,
          message = EXCLUDED.message,
          level = EXCLUDED.level,
          last_seen = GREATEST(error_groups.last_seen, EXCLUDED.last_seen),
          pages = (SELECT ARRAY(SELECT DISTINCT unnest(error_groups.pages || EXCLUDED.pages))),
          app_versions = (SELECT ARRAY(SELECT DISTINCT unnest(error_groups.app_versions || EXCLUDED.app_versions)))
      `;
    }
  }
}

@Controller('ingest')
@UseGuards(ThrottlerGuard)
export class IngestController {
  constructor(private readonly service: IngestService) {}

  /** 主上报入口：fetch / sendBeacon 均走这里 */
  @Post()
  @HttpCode(200)
  async ingest(
    @Body() body: IngestPayload | string,
    @Req() request: Request,
    @Headers() headers: Record<string, string>,
  ) {
    const payload = this.parseBody(body);
    const result = await this.service.ingest(payload, resolveGeo(request, headers));
    return {
      code: result.invalid ? 40001 : 0,
      message: result.invalid ? 'invalid appKey' : 'ok',
      data: { accepted: result.accepted, dropped: result.dropped, sampleRate: result.sampleRate },
    };
  }

  /** 兼容个别场景的独立 beacon 端点 */
  @Post('beacon')
  @HttpCode(200)
  async beacon(
    @Body() body: IngestPayload | string,
    @Req() request: Request,
    @Headers() headers: Record<string, string>,
  ) {
    return this.ingest(body, request, headers);
  }

  private parseBody(body: IngestPayload | string): IngestPayload {
    if (typeof body === 'string') {
      try {
        return JSON.parse(body) as IngestPayload;
      } catch {
        return { appKey: '', sdk: { name: '', version: '' }, common: null as any, events: [] };
      }
    }
    return body;
  }
}

/** 解析客户端信息：优先使用反向代理注入的地域头，其次保留 IP 供后续接入 IP 库 */
export function resolveGeo(request: Request, headers: Record<string, string>): GeoInfo {
  const forwarded = headers['x-forwarded-for'] || headers['x-real-ip'] || '';
  const ip = (forwarded.split(',')[0] || request.ip || '').trim();
  return {
    ip,
    country: headers['x-geo-country'] || headers['cf-ipcountry'] || undefined,
    region: headers['x-geo-region'] || undefined,
    city: headers['x-geo-city'] || undefined,
  };
}

@Module({
  controllers: [IngestController],
  providers: [IngestService],
  exports: [IngestService],
})
export class IngestModule {}
