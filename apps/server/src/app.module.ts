import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { LogErrorInterceptor, LogModule } from '@server-log/nestjs';
import { ThrottlerModule } from '@nestjs/throttler';
import configuration from './config/configuration';
import { PrismaService } from './storage/prisma.service';
import { ClickHouseService } from './storage/clickhouse.service';
import { ResponseInterceptor } from './common/http';
import { AllExceptionsFilter } from './common/http';
import { IngestModule } from './modules/ingest/ingest.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { RemoteConfigModule } from './modules/remote-config/remote-config.module';
import { OverviewModule } from './modules/query/overview.module';
import { PerformanceQueryModule } from './modules/query/performance.module';
import { ErrorsQueryModule } from './modules/query/errors.module';
import { BehaviorQueryModule } from './modules/query/behavior.module';
import { SessionsQueryModule } from './modules/query/sessions.module';
import { SourceMapModule } from './modules/sourcemap/sourcemap.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { HealthModule } from './modules/health/health.module';
import { RealtimeModule } from './modules/realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, load: [configuration] }),
    ThrottlerModule.forRoot([
      {
        // 上报接口 QPS 保护：单 IP 每分钟 600 次（约 10 QPS），可按需调整
        ttl: 60_000,
        limit: 600,
      },
    ]),
    // server-log 统一日志：请求上下文中间件 + 内置 Logger 桥接（级别走 SERVER_LOG_LEVEL）
    LogModule.forRoot({ category: 'web-monitor' }),
    IngestModule,
    ProjectsModule,
    RemoteConfigModule,
    OverviewModule,
    PerformanceQueryModule,
    ErrorsQueryModule,
    BehaviorQueryModule,
    SessionsQueryModule,
    SourceMapModule,
    AlertsModule,
    HealthModule,
    RealtimeModule,
  ],
  providers: [
    PrismaService,
    ClickHouseService,
    // 异常日志拦截在外层（先记录后由 ResponseInterceptor/AllExceptionsFilter 整形）
    { provide: APP_INTERCEPTOR, useClass: LogErrorInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
  exports: [PrismaService, ClickHouseService],
})
export class AppModule {}
