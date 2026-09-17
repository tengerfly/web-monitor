import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../storage/prisma.service';
import { IngestService } from '../ingest/ingest.module';

export interface ProjectDto {
  name: string;
  description?: string;
  envs?: string[];
  sampleRate?: number;
  plugins?: Record<string, boolean>;
  pluginConfig?: Record<string, any>;
  maskRules?: Record<string, any>;
  retentionDays?: number;
}

const DEFAULT_PLUGINS = {
  performance: true,
  behavior: true,
  error: true,
  replay: false,
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: IngestService,
  ) {}

  private generateAppKey(): string {
    return `wm_${randomBytes(6).toString('hex')}`;
  }

  async list() {
    const projects = await this.prisma.project.findMany({ orderBy: { createdAt: 'desc' } });
    return projects.map((project) => this.toDto(project));
  }

  async detail(appKey: string) {
    const project = await this.prisma.project.findUnique({ where: { appKey } });
    if (!project) throw new NotFoundException(`project ${appKey} not found`);
    return this.toDto(project);
  }

  async create(dto: ProjectDto) {
    if (!dto?.name) throw new BadRequestException('name is required');
    const project = await this.prisma.project.create({
      data: {
        appKey: this.generateAppKey(),
        name: dto.name,
        description: dto.description,
        envs: dto.envs?.length ? dto.envs : ['production'],
        sampleRate: dto.sampleRate ?? 1,
        plugins: (dto.plugins || DEFAULT_PLUGINS) as any,
        pluginConfig: (dto.pluginConfig || {}) as any,
        maskRules: (dto.maskRules || {}) as any,
        retentionDays: dto.retentionDays ?? 90,
      },
    });
    this.ingest.invalidateProject(project.appKey);
    return this.toDto(project);
  }

  async update(appKey: string, dto: ProjectDto) {
    await this.detail(appKey);
    const project = await this.prisma.project.update({
      where: { appKey },
      data: {
        name: dto.name,
        description: dto.description,
        envs: dto.envs,
        sampleRate: dto.sampleRate,
        plugins: dto.plugins as any,
        pluginConfig: dto.pluginConfig as any,
        maskRules: dto.maskRules as any,
        retentionDays: dto.retentionDays,
      },
    });
    this.ingest.invalidateProject(appKey);
    return this.toDto(project);
  }

  async remove(appKey: string) {
    await this.detail(appKey);
    await this.prisma.project.delete({ where: { appKey } });
    this.ingest.invalidateProject(appKey);
    return { appKey, deleted: true };
  }

  /** 重置 appKey（泄露或迁移场景），旧数据保留 */
  async rotateKey(appKey: string) {
    await this.detail(appKey);
    const project = await this.prisma.project.update({
      where: { appKey },
      data: { appKey: this.generateAppKey() },
    });
    this.ingest.invalidateProject(appKey);
    this.ingest.invalidateProject(project.appKey);
    return this.toDto(project);
  }

  private toDto(project: {
    id: string;
    appKey: string;
    name: string;
    description: string | null;
    envs: string[];
    sampleRate: number;
    plugins: unknown;
    pluginConfig?: unknown;
    maskRules: unknown;
    retentionDays: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: project.id,
      appKey: project.appKey,
      name: project.name,
      description: project.description || undefined,
      envs: project.envs,
      sampleRate: project.sampleRate,
      plugins: (project.plugins || {}) as Record<string, boolean>,
      pluginConfig: (project.pluginConfig || {}) as Record<string, any>,
      maskRules: (project.maskRules || {}) as Record<string, any>,
      retentionDays: project.retentionDays,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
    };
  }
}

@Controller('projects')
export class ProjectsController {
  constructor(private readonly service: ProjectsService) {}

  @Get()
  list() {
    return this.service.list();
  }

  @Post()
  create(@Body() dto: ProjectDto) {
    return this.service.create(dto);
  }

  @Get(':appKey')
  detail(@Param('appKey') appKey: string) {
    return this.service.detail(appKey);
  }

  @Put(':appKey')
  update(@Param('appKey') appKey: string, @Body() dto: ProjectDto) {
    return this.service.update(appKey, dto);
  }

  @Delete(':appKey')
  remove(@Param('appKey') appKey: string) {
    return this.service.remove(appKey);
  }

  @Post(':appKey/rotate-key')
  rotateKey(@Param('appKey') appKey: string) {
    return this.service.rotateKey(appKey);
  }
}

@Module({
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
