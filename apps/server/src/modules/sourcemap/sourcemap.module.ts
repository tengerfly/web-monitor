import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Logger,
  Module,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { SourceMapConsumer } from 'source-map-js';
import type { SourceMapItem, StackFrame } from '@web-monitor/types';
import { PrismaService } from '../../storage/prisma.service';

interface CachedConsumer {
  consumer: SourceMapConsumer | null;
  expireAt: number;
}

const CACHE_TTL = 10 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;

function basename(filePath: string): string {
  if (!filePath) return '';
  const withoutQuery = filePath.split('?')[0].split('#')[0];
  return withoutQuery.split('/').filter(Boolean).pop() || '';
}

/** 抽取源码上下文（错误行前后各 5 行） */
function extractContext(
  content: string,
  line: number,
): { center?: string; list: string[] } | undefined {
  if (!content || !line || line < 1) return undefined;
  const lines = content.split(/\r?\n/);
  const start = Math.max(0, line - 6);
  const end = Math.min(lines.length, line + 5);
  return {
    center: lines[line - 1],
    list: lines.slice(start, end),
  };
}

/**
 * SourceMap 管理。
 * 压缩后的错误堆栈只能定位到「哪一行哪一列」，只有还原到源码才有排查价值——
 * 这是「问题溯源」闭环中不可省略的一环。
 */
@Injectable()
export class SourceMapService {
  private readonly logger = new Logger('SourceMap');
  private readonly cache = new Map<string, CachedConsumer>();

  constructor(private readonly prisma: PrismaService) {}

  async upload(appKey: string, appVersion: string, fileName: string, content: string): Promise<SourceMapItem> {
    if (!appKey || !appVersion || !fileName || !content) {
      throw new BadRequestException('appKey / appVersion / fileName / content are required');
    }
    const record = await this.prisma.sourceMap.upsert({
      where: { appKey_appVersion_fileName: { appKey, appVersion, fileName } },
      create: { appKey, appVersion, fileName, content, size: content.length },
      update: { content, size: content.length },
    });
    this.cache.delete(`${appKey}:${appVersion}:${fileName}`);
    return this.toItem(record);
  }

  async list(appKey: string, appVersion?: string): Promise<SourceMapItem[]> {
    const records = await this.prisma.sourceMap.findMany({
      where: { appKey, ...(appVersion ? { appVersion } : {}) },
      orderBy: { createdAt: 'desc' },
      select: { id: true, appKey: true, appVersion: true, fileName: true, size: true, createdAt: true },
    });
    return records.map((record) => this.toItem(record));
  }

  async remove(id: string): Promise<{ id: string; deleted: boolean }> {
    await this.prisma.sourceMap.delete({ where: { id } });
    this.cache.clear();
    return { id, deleted: true };
  }

  /**
   * 还原堆栈帧。
   * 匹配策略：用帧文件名的 basename 去匹配上传的 map 文件名（构建产物文件名一般带 hash，天然唯一）。
   */
  async resolveFrames(appKey: string, appVersion: string, frames: StackFrame[]): Promise<StackFrame[]> {
    if (!frames.length || !appVersion) return frames;
    let records: Array<{ fileName: string; content: string }> = [];
    try {
      records = await this.prisma.sourceMap.findMany({
        where: { appKey, appVersion },
        select: { fileName: true, content: true },
      });
    } catch (error) {
      this.logger.warn(`load sourcemaps failed: ${(error as Error).message}`);
      return frames;
    }
    if (!records.length) return frames;

    const byName = new Map(records.map((record) => [record.fileName, record.content]));

    return frames.map((frame) => {
      try {
        const base = basename(frame.filename || '');
        const content = byName.get(base) || byName.get(frame.filename || '');
        if (!content || !frame.lineno) return frame;

        const consumer = this.getConsumer(appKey, appVersion, base, content);
        if (!consumer) return frame;

        const position = consumer.originalPositionFor({
          line: frame.lineno,
          column: Math.max((frame.colno || 1) - 1, 0),
        });
        if (!position || !position.source) return frame;

        const sourceContent = consumer.sourceContentFor(position.source, true) || undefined;
        const context = sourceContent && position.line
          ? extractContext(sourceContent, position.line)
          : undefined;

        return {
          ...frame,
          filename: position.source,
          lineno: position.line ?? frame.lineno,
          colno: position.column ?? frame.colno,
          function: position.name || frame.function,
          resolved: true,
          sourceLine: context?.center,
          context: context?.list,
        };
      } catch (error) {
        this.logger.debug(`resolve frame failed: ${(error as Error).message}`);
        return frame;
      }
    });
  }

  private getConsumer(
    appKey: string,
    appVersion: string,
    fileName: string,
    content: string,
  ): SourceMapConsumer | null {
    const key = `${appKey}:${appVersion}:${fileName}`;
    const cached = this.cache.get(key);
    if (cached && cached.expireAt > Date.now()) return cached.consumer;

    let consumer: SourceMapConsumer | null = null;
    try {
      consumer = new SourceMapConsumer(JSON.parse(content));
    } catch (error) {
      this.logger.warn(`parse sourcemap ${fileName} failed: ${(error as Error).message}`);
    }

    if (this.cache.size >= MAX_CACHE_ENTRIES) {
      const oldest = this.cache.keys().next().value;
      if (oldest) this.cache.delete(oldest);
    }
    this.cache.set(key, { consumer, expireAt: Date.now() + CACHE_TTL });
    return consumer;
  }

  private toItem(record: {
    id: string;
    appKey: string;
    appVersion: string;
    fileName: string;
    size: number;
    createdAt: Date;
  }): SourceMapItem {
    return {
      id: record.id,
      appKey: record.appKey,
      appVersion: record.appVersion,
      fileName: record.fileName,
      size: record.size,
      createdAt: record.createdAt.toISOString(),
    };
  }
}

@Controller()
export class SourceMapController {
  constructor(private readonly service: SourceMapService) {}

  @Get('projects/:appKey/sourcemaps')
  list(@Param('appKey') appKey: string, @Query('appVersion') appVersion?: string) {
    return this.service.list(appKey, appVersion);
  }

  @Post('projects/:appKey/sourcemaps')
  upload(
    @Param('appKey') appKey: string,
    @Body() body: { appVersion: string; fileName: string; content: string },
  ) {
    return this.service.upload(appKey, body?.appVersion, body?.fileName, body?.content);
  }

  @Delete('sourcemaps/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}

@Module({
  controllers: [SourceMapController],
  providers: [SourceMapService],
  exports: [SourceMapService],
})
export class SourceMapModule {}
