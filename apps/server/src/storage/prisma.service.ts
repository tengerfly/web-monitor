import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PostgreSQL 访问层。
 * 连接失败不阻断服务启动（监控服务本身不应因为存储抖动而完全不可用），
 * 但会在日志中明确告警——上报链路会持续失败，这是需要立刻处理的信号。
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Prisma');

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('PostgreSQL connected');
    } catch (error) {
      this.logger.error(`PostgreSQL connect failed: ${(error as Error).message}`);
    }
  }

  async onModuleDestroy(): Promise<void> {
    try {
      await this.$disconnect();
    } catch {
      /* ignore */
    }
  }
}
