import { Controller, Get, Module, Query } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RemoteConfig } from '@web-monitor/types';
import { IngestService } from '../ingest/ingest.module';
import type { AppConfig } from '../../config/configuration';

/**
 * 远程配置下发。
 * 让业务方无需发版即可调整采样率、开关与阈值——这是线上治理监控自身成本的关键能力
 * （出问题时先降采样保业务，而不是先下线监控）。
 */
@Controller('config')
export class RemoteConfigController {
  constructor(
    private readonly ingest: IngestService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  async getConfig(@Query('appKey') appKey: string, @Query('sdk') sdk?: string) {
    const app = await this.ingest.getProject(appKey);
    const host = (this.config.get<AppConfig>('') as unknown as AppConfig)?.publicHost || '';
    void sdk;

    if (!app) {
      // 未注册的 appKey 返回一份「全部关闭」的配置，避免客户端持续上报无效数据
      const fallback: RemoteConfig = {
        sampleRate: 0,
        plugins: { performance: false, behavior: false, error: false, replay: false },
        host,
        updatedAt: new Date().toISOString(),
      };
      return fallback;
    }

    const pluginConfig = app.pluginConfig || {};
    const remote: RemoteConfig = {
      sampleRate: app.sampleRate,
      plugins: {
        performance: app.plugins?.performance !== false,
        behavior: app.plugins?.behavior !== false,
        error: app.plugins?.error !== false,
        replay: app.plugins?.replay === true,
      },
      performance: pluginConfig.performance,
      behavior: pluginConfig.behavior,
      error: pluginConfig.error,
      replay: pluginConfig.replay,
      maskRules: app.maskRules as RemoteConfig['maskRules'],
      host: host || undefined,
      updatedAt: new Date().toISOString(),
    };
    return remote;
  }
}

@Module({
  controllers: [RemoteConfigController],
})
export class RemoteConfigModule {}
