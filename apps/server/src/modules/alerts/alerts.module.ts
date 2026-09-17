import {
  Body,
  Controller,
  Delete,
  Get,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import nodemailer, { type Transporter } from 'nodemailer';
import type { AlertChannel, AlertRecord, AlertRule, AlertRuleDto } from '@web-monitor/types';
import { PrismaService } from '../../storage/prisma.service';
import { ClickHouseService } from '../../storage/clickhouse.service';
import { formatDateTime, parsePaging, type RawQuery } from '../../common/query';
import type { AppConfig } from '../../config/configuration';

/** 指标计算上下文 */
interface MetricWindow {
  appKey: string;
  start: Date;
  end: Date;
}

/**
 * 通知发送器。
 * 覆盖企业内最常见的四类通道：邮件、通用 Webhook、钉钉、企业微信、飞书。
 */
@Injectable()
export class NotifierService {
  private readonly logger = new Logger('Notifier');
  private transporter?: Transporter;

  constructor(private readonly config: ConfigService) {
    const mail = (this.config.get<AppConfig>('') as unknown as AppConfig)?.mail;
    if (mail?.host && mail.user) {
      this.transporter = nodemailer.createTransport({
        host: mail.host,
        port: mail.port,
        secure: mail.secure,
        auth: { user: mail.user, pass: mail.password },
      });
    }
  }

  async send(channels: AlertChannel[], title: string, message: string): Promise<boolean> {
    let notified = false;
    for (const channel of channels || []) {
      try {
        if (channel.type === 'email') {
          notified = (await this.sendMail(channel, title, message)) || notified;
        } else {
          notified = (await this.sendWebhook(channel, title, message)) || notified;
        }
      } catch (error) {
        this.logger.warn(`send alert via ${channel.type} failed: ${(error as Error).message}`);
      }
    }
    return notified;
  }

  private async sendMail(channel: AlertChannel, title: string, message: string): Promise<boolean> {
    if (!this.transporter) {
      this.logger.warn('SMTP not configured, skip email alert');
      return false;
    }
    const mail = this.config.get<AppConfig>('') as unknown as AppConfig;
    await this.transporter.sendMail({
      from: mail.mail.from,
      to: channel.target.split(/[,;]/).map((item) => item.trim()).filter(Boolean),
      subject: `[web-monitor] ${title}`,
      text: message,
    });
    return true;
  }

  /** 钉钉 / 企业微信 / 飞书 / 通用 Webhook */
  private async sendWebhook(channel: AlertChannel, title: string, message: string): Promise<boolean> {
    const payload = this.buildWebhookPayload(channel, title, message);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch(channel.target, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      clearTimeout(timer);
      return response.ok;
    } catch (error) {
      clearTimeout(timer);
      throw error;
    }
  }

  private buildWebhookPayload(
    channel: AlertChannel,
    title: string,
    message: string,
  ): Record<string, any> {
    switch (channel.type) {
      case 'dingtalk':
        return { msgtype: 'markdown', markdown: { title, text: `### ${title}\n\n${message}` } };
      case 'wecom':
        return { msgtype: 'markdown', markdown: { content: `### ${title}\n\n${message}` } };
      case 'feishu':
        return { msg_type: 'text', content: { text: `【${title}】\n${message}` } };
      default:
        return { title, message, source: 'web-monitor', timestamp: Date.now() };
    }
  }
}

@Injectable()
export class AlertsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('Alerts');
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly ch: ClickHouseService,
    private readonly notifier: NotifierService,
    private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const interval = Number((this.config.get<AppConfig>('') as unknown as AppConfig)?.alertCheckInterval || 60);
    this.timer = setInterval(() => void this.evaluateAll(), interval * 1000);
    this.logger.log(`alert scheduler started, interval ${interval}s`);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /* --------------------------------- 规则 CRUD --------------------------------- */

  async listRules(appKey?: string): Promise<AlertRule[]> {
    const rules = await this.prisma.alertRule.findMany({
      where: appKey ? { appKey } : {},
      orderBy: { createdAt: 'desc' },
    });
    return rules.map((rule) => ({
      id: rule.id,
      appKey: rule.appKey,
      name: rule.name,
      enabled: rule.enabled,
      metric: rule.metric as AlertRule['metric'],
      operator: rule.operator as AlertRule['operator'],
      threshold: rule.threshold,
      window: rule.window,
      silence: rule.silence,
      minCount: rule.minCount,
      channels: (rule.channels || []) as unknown as AlertChannel[],
      filter: (rule.filter || {}) as AlertRule['filter'],
      createdAt: rule.createdAt.toISOString(),
      updatedAt: rule.updatedAt.toISOString(),
    }));
  }

  async createRule(appKey: string, dto: AlertRuleDto): Promise<AlertRule> {
    const rule = await this.prisma.alertRule.create({
      data: {
        appKey,
        name: dto.name,
        enabled: dto.enabled ?? true,
        metric: dto.metric,
        operator: dto.operator,
        threshold: dto.threshold,
        window: dto.window,
        silence: dto.silence ?? 30,
        minCount: dto.minCount ?? 1,
        channels: (dto.channels || []) as any,
        filter: (dto.filter || {}) as any,
      },
    });
    return (await this.listRules(rule.appKey)).find((item) => item.id === rule.id)!;
  }

  async updateRule(id: string, dto: Partial<AlertRuleDto>): Promise<AlertRule> {
    await this.prisma.alertRule.update({
      where: { id },
      data: {
        name: dto.name,
        enabled: dto.enabled,
        metric: dto.metric,
        operator: dto.operator,
        threshold: dto.threshold,
        window: dto.window,
        silence: dto.silence,
        minCount: dto.minCount,
        channels: dto.channels as any,
        filter: dto.filter as any,
      },
    });
    const rule = await this.prisma.alertRule.findUnique({ where: { id } });
    return (await this.listRules(rule?.appKey)).find((item) => item.id === id)!;
  }

  async removeRule(id: string): Promise<{ id: string; deleted: boolean }> {
    await this.prisma.alertRule.delete({ where: { id } });
    return { id, deleted: true };
  }

  async listRecords(query: RawQuery) {
    const { page, pageSize, offset } = parsePaging(query, 20);
    const where: Record<string, any> = {};
    if (query.appKey) where.appKey = query.appKey;
    if (query.status) where.status = query.status;

    const [records, total] = await Promise.all([
      this.prisma.alertRecord.findMany({
        where,
        orderBy: { triggeredAt: 'desc' },
        skip: offset,
        take: pageSize,
        include: { rule: { select: { name: true } } },
      }),
      this.prisma.alertRecord.count({ where }),
    ]);

    return {
      list: records.map<AlertRecord>((record) => ({
        id: record.id,
        ruleId: record.ruleId,
        ruleName: record.rule?.name || '',
        appKey: record.appKey,
        metric: record.metric,
        value: record.value,
        threshold: record.threshold,
        triggeredAt: record.triggeredAt.toISOString(),
        status: record.status as AlertRecord['status'],
        notified: record.notified,
        message: record.message,
      })),
      total,
      page,
      pageSize,
    };
  }

  /* ---------------------------------- 指标计算 --------------------------------- */

  /** 计算规则当前窗口的指标值 */
  async computeMetric(rule: { appKey: string; metric: string; window: number }): Promise<number> {
    const end = new Date();
    const start = new Date(end.getTime() - Math.max(rule.window, 1) * 60_000);
    const window: MetricWindow = { appKey: rule.appKey, start, end };
    const params = {
      appKey: window.appKey,
      start: formatDateTime(window.start),
      end: formatDateTime(window.end),
    };
    const events = this.ch.getTable('wm_events');
    const errors = this.ch.getTable('wm_errors');
    const where = 'app_key = {appKey:String} AND timestamp >= {start:DateTime64(3)} AND timestamp <= {end:DateTime64(3)}';

    switch (rule.metric) {
      case 'error_count': {
        const row = await this.ch.queryOne<{ value: number }>(
          `SELECT count() AS value FROM ${errors} WHERE ${where}`,
          params,
        );
        return Number(row?.value || 0);
      }
      case 'error_rate': {
        const row = await this.ch.queryOne<{ value: number }>(
          `SELECT
             (SELECT count() FROM ${errors} WHERE ${where}) /
             greatest((SELECT count() FROM ${events} WHERE ${where} AND category = 'pv'), 1) AS value`,
          params,
        );
        return Number(row?.value || 0);
      }
      case 'affected_users': {
        const row = await this.ch.queryOne<{ value: number }>(
          `SELECT uniqExact(anonymous_id) AS value FROM ${errors} WHERE ${where}`,
          params,
        );
        return Number(row?.value || 0);
      }
      case 'p95_latency': {
        const row = await this.ch.queryOne<{ value: number }>(
          `SELECT quantile(0.95)(value) AS value FROM ${events} WHERE ${where} AND category = 'api'`,
          params,
        );
        return Math.round(Number(row?.value || 0));
      }
      case 'api_error_rate': {
        const row = await this.ch.queryOne<{ value: number }>(
          `SELECT 1 - avg(success) AS value FROM ${events} WHERE ${where} AND category = 'api'`,
          params,
        );
        return Number(row?.value || 0);
      }
      case 'lcp_p75': {
        const row = await this.ch.queryOne<{ value: number }>(
          `SELECT quantile(0.75)(value) AS value FROM ${events} WHERE ${where} AND category = 'web-vital' AND name = 'LCP'`,
          params,
        );
        return Math.round(Number(row?.value || 0));
      }
      case 'white_screen': {
        const row = await this.ch.queryOne<{ value: number }>(
          `SELECT count() AS value FROM ${events} WHERE ${where} AND category = 'white-screen'`,
          params,
        );
        return Number(row?.value || 0);
      }
      case 'slow_api_count': {
        const row = await this.ch.queryOne<{ value: number }>(
          `SELECT count() AS value FROM ${events} WHERE ${where} AND category = 'api' AND value > 1000`,
          params,
        );
        return Number(row?.value || 0);
      }
      case 'new_error': {
        const count = await this.prisma.errorGroup.count({
          where: { appKey: rule.appKey, firstSeen: { gte: window.start, lte: window.end } },
        });
        return count;
      }
      default:
        return 0;
    }
  }

  private compare(value: number, operator: string, threshold: number): boolean {
    switch (operator) {
      case 'gt':
        return value > threshold;
      case 'gte':
        return value >= threshold;
      case 'lt':
        return value < threshold;
      case 'lte':
        return value <= threshold;
      default:
        return false;
    }
  }

  /** 扫描全部启用规则并触发告警 */
  async evaluateAll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const rules = await this.prisma.alertRule.findMany({ where: { enabled: true } });
      for (const rule of rules) {
        try {
          await this.evaluateRule(rule);
        } catch (error) {
          this.logger.warn(`evaluate rule ${rule.id} failed: ${(error as Error).message}`);
        }
      }
    } finally {
      this.running = false;
    }
  }

  async evaluateRule(rule: {
    id: string;
    appKey: string;
    name: string;
    metric: string;
    operator: string;
    threshold: number;
    window: number;
    silence: number;
    minCount: number;
    channels: unknown;
  }): Promise<void> {
    const value = await this.computeMetric(rule);
    const triggered = this.compare(value, rule.operator, rule.threshold);
    if (!triggered || value < rule.minCount) {
      // 若此前处于 firing，则标记恢复
      await this.prisma.alertRecord.updateMany({
        where: { ruleId: rule.id, status: 'firing' },
        data: { status: 'resolved', resolvedAt: new Date() },
      });
      return;
    }

    // 静默期判断：避免告警风暴
    const silenceStart = new Date(Date.now() - Math.max(rule.silence, 0) * 60_000);
    const recent = await this.prisma.alertRecord.findFirst({
      where: { ruleId: rule.id, status: 'firing', triggeredAt: { gte: silenceStart } },
    });
    if (recent) return;

    const title = `告警触发：${rule.name}`;
    const message = [
      `应用：${rule.appKey}`,
      `指标：${rule.metric}`,
      `当前值：${value}`,
      `阈值：${rule.operator} ${rule.threshold}`,
      `统计窗口：最近 ${rule.window} 分钟`,
      `触发时间：${new Date().toISOString()}`,
    ].join('\n');

    const notified = await this.notifier.send(
      (rule.channels || []) as AlertChannel[],
      title,
      message,
    );

    await this.prisma.alertRecord.create({
      data: {
        ruleId: rule.id,
        appKey: rule.appKey,
        metric: rule.metric,
        value,
        threshold: rule.threshold,
        status: 'firing',
        notified,
        message,
      },
    });
    this.logger.log(`alert fired: ${rule.name} (${rule.metric}=${value})`);
  }

  /** 手动触发一次全量评估（便于联调） */
  async triggerEvaluation(): Promise<{ triggered: number }> {
    await this.evaluateAll();
    const count = await this.prisma.alertRecord.count({ where: { status: 'firing' } });
    return { triggered: count };
  }
}

@Controller()
export class AlertsController {
  constructor(private readonly service: AlertsService) {}

  @Get('alerts/rules')
  listRules(@Query('appKey') appKey?: string) {
    return this.service.listRules(appKey);
  }

  @Post('alerts/rules/:appKey')
  createRule(@Param('appKey') appKey: string, @Body() dto: AlertRuleDto) {
    return this.service.createRule(appKey, dto);
  }

  @Put('alerts/rules/:id')
  updateRule(@Param('id') id: string, @Body() dto: Partial<AlertRuleDto>) {
    return this.service.updateRule(id, dto);
  }

  @Delete('alerts/rules/:id')
  removeRule(@Param('id') id: string) {
    return this.service.removeRule(id);
  }

  @Get('alerts/records')
  listRecords(@Query() query: RawQuery) {
    return this.service.listRecords(query);
  }

  @Post('alerts/evaluate')
  evaluate() {
    return this.service.triggerEvaluation();
  }
}

@Module({
  controllers: [AlertsController],
  providers: [AlertsService, NotifierService],
  exports: [AlertsService],
})
export class AlertsModule {}
