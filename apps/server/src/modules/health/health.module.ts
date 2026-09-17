import { Controller, Get, Module } from '@nestjs/common';
import { PrismaService } from '../../storage/prisma.service';
import { ClickHouseService } from '../../storage/clickhouse.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ch: ClickHouseService,
  ) {}

  @Get()
  async check() {
    const result = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      postgres: 'unknown',
      clickhouse: 'unknown',
      version: '0.1.0',
    };

    try {
      await this.prisma.$queryRaw`SELECT 1`;
      result.postgres = 'ok';
    } catch (error) {
      result.postgres = `error: ${(error as Error).message}`;
      result.status = 'degraded';
    }

    try {
      await this.ch.query('SELECT 1 AS ok');
      result.clickhouse = 'ok';
    } catch (error) {
      result.clickhouse = `error: ${(error as Error).message}`;
      result.status = 'degraded';
    }

    return result;
  }
}

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
